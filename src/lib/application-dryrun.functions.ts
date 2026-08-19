// End-to-End Dry-Run für den "application_received"-Flow.
//
// Zweck: reproduziert exakt die Schritte aus
// src/routes/api/public/applications.ts (Tenant-Lookup, Booking-Modus,
// Link-Konstruktion, Preflight, Edge-Function-Call), ohne echte Bewerbung
// in der DB anzulegen und ohne email_send_log-Fehler zu schreiben.
// Wenn dieser Report grün ist, funktioniert auch der echte Flow.
//
// Wird von /admin/email-templates (Tab "End-to-End") aufgerufen.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  landing_page_id: z.string().uuid(),
  test_email: z.string().email(),
  send_email: z.boolean().optional().default(true),
});

type Step = {
  key: string;
  label: string;
  ok?: boolean;
  detail?: string;
  reason?: string;
};


function tenantMailBlockReason(tenant: any | null): string | null {
  if (!tenant) return "tenant_not_found";
  if (tenant.is_active === false) return "tenant_inactive";
  if (tenant.emails_paused) {
    return tenant.emails_paused_reason
      ? `tenant_emails_paused: ${tenant.emails_paused_reason}`
      : "tenant_emails_paused";
  }
  if (!tenant.smtp_host || !tenant.smtp_port || !tenant.smtp_username || !tenant.smtp_password) {
    return "smtp_not_configured";
  }
  return null;
}

function portalBaseFromTenant(tenant: any | null): string | null {
  const domain = String(tenant?.primary_domain ?? tenant?.domain ?? "")
    .trim()
    .replace(/^portal\./, "");
  return domain ? `https://portal.${domain}` : null;
}

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

export const listLandingPagesForDryRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("landing_pages")
      .select("id, slug, source_slug, tenant_id, domain, booking_mode, is_published, intermediate_company_name")
      .eq("is_published", true)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as any[] };
  });

export const dryRunApplicationReceived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const steps: Step[] = [];
    const push = (s: Step) => steps.push(s);
    let overallOk = true;
    const fail = (s: Step) => { overallOk = false; push({ ...s, ok: false }); };

    // 1) Landing Page laden
    const { data: lp, error: lpErr } = await supabaseAdmin
      .from("landing_pages")
      .select("id, slug, source_slug, tenant_id, calendly_url, partner_company_id, interview_mode, linked_fasttrack_landing_id, intermediate_company_name, booking_mode, domain")
      .eq("id", data.landing_page_id)
      .maybeSingle();

    if (lpErr || !lp) {
      fail({ key: "landing", label: "Landing Page laden", detail: lpErr?.message ?? "not_found", reason: "landing_not_found" });
      return { ok: false, steps, summary: "Landing Page nicht gefunden" };
    }
    push({
      key: "landing",
      label: "Landing Page laden",
      ok: true,
      detail: `slug="${lp.slug ?? lp.source_slug ?? "-"}" · booking_mode=${lp.booking_mode ?? "calendly"} · interview_mode=${lp.interview_mode ?? "-"}`,
    });

    const tenantId = lp.tenant_id as string | null;
    if (!tenantId) {
      fail({ key: "tenant_id", label: "Tenant-Auflösung", reason: "tenant_missing", detail: "Landing hat keine tenant_id" });
      return { ok: false, steps, summary: "Landing hat keine tenant_id — echte Bewerbung würde abgelehnt (400)" };
    }
    push({ key: "tenant_id", label: "Tenant-Auflösung", ok: true, detail: tenantId });

    // 2) Tenant laden + Preflight (emails_paused / SMTP)
    const { data: tenant, error: tenantErr } = await supabaseAdmin
      .from("tenants")
      .select("id, name, domain, primary_domain, smtp_host, smtp_port, smtp_username, smtp_password, is_active, emails_paused, emails_paused_reason, smtp_health_status")
      .eq("id", tenantId)
      .maybeSingle();

    if (tenantErr || !tenant) {
      fail({ key: "tenant_load", label: "Tenant laden", reason: "tenant_lookup_failed", detail: tenantErr?.message ?? "not_found" });
      return { ok: false, steps, summary: "Tenant nicht gefunden" };
    }
    const blockReason = tenantMailBlockReason(tenant);
    if (blockReason) {
      fail({
        key: "tenant_preflight",
        label: "Tenant Preflight",
        reason: blockReason,
        detail: `Tenant "${tenant.name}" (paused=${tenant.emails_paused}, smtp=${tenant.smtp_health_status ?? "unknown"})`,
      });
      return { ok: false, steps, summary: `Tenant-Preflight fehlgeschlagen: ${blockReason}` };
    }
    push({
      key: "tenant_preflight",
      label: "Tenant Preflight",
      ok: true,
      detail: `"${tenant.name}" · emails_paused=false · SMTP=${tenant.smtp_health_status ?? "ok"}`,
    });

    // 3) Booking-Mode + Booking-Link berechnen (identisch zu applications.ts)
    const bookingMode: "calendly" | "internal" = (lp.booking_mode as any) ?? "calendly";
    const portalBase = portalBaseFromTenant(tenant);

    let ownBookingUrl: string | null = null;
    if (bookingMode === "internal" && portalBase) {
      // Prüfen ob eine aktive availability_schedule für diese Landing existiert.
      const { data: schedules } = await supabaseAdmin
        .from("availability_schedules")
        .select("id, landing_page_id")
        .eq("landing_page_id", lp.id)
        .eq("active", true)
        .limit(1);
      if ((schedules ?? []).length > 0) {
        // Fake-Token nur für die URL-Konstruktion (wird nicht gespeichert)
        ownBookingUrl = `${portalBase}/termin/buchen/DRY-RUN-TOKEN`;
        push({ key: "booking", label: "Booking-Link (internal)", ok: true, detail: ownBookingUrl });
      } else {
        push({
          key: "booking",
          label: "Booking-Link (internal)",
          ok: true,
          detail: "⚠ booking_mode=internal, aber keine aktive availability_schedule — Fallback greift",
        });
      }
    } else if (bookingMode === "calendly") {
      const calendlyOnLanding = typeof lp.calendly_url === "string" && lp.calendly_url.trim()
        ? lp.calendly_url.trim()
        : null;
      if (calendlyOnLanding) {
        push({ key: "booking", label: "Booking-Link (calendly)", ok: true, detail: calendlyOnLanding });
      } else {
        push({
          key: "booking",
          label: "Booking-Link (calendly)",
          ok: true,
          detail: "⚠ Kein calendly_url gesetzt — Bestätigungsmail nutzt Portal-Fallback",
        });
      }
    }

    const calendlyOnLanding = typeof lp.calendly_url === "string" && lp.calendly_url.trim() ? lp.calendly_url.trim() : null;
    const confirmationBookingLink = ownBookingUrl || calendlyOnLanding || null;
    const fallbackPortalLink = portalBase;
    const confirmationActionLink = confirmationBookingLink || fallbackPortalLink || "";

    if (!confirmationActionLink) {
      fail({
        key: "action_link",
        label: "confirmation_action_link",
        reason: "confirmation_action_link_missing",
        detail: "Weder Booking-Link noch Portal-URL — echter Flow würde als failed loggen",
      });
      return { ok: false, steps, summary: "confirmation_action_link_missing — echter Flow würde jetzt fehlschlagen" };
    }
    push({
      key: "action_link",
      label: "confirmation_action_link",
      ok: true,
      detail: confirmationActionLink,
    });

    // 4) Suppression / Bounce-Preflight
    const { data: suppressed } = await supabaseAdmin
      .from("suppressed_emails")
      .select("email, bounce_type")
      .eq("email", data.test_email.toLowerCase())
      .maybeSingle();
    if (suppressed) {
      fail({
        key: "suppression",
        label: "Suppression-Check",
        reason: "recipient_suppressed",
        detail: `Empfänger "${data.test_email}" ist suppressed (${(suppressed as any).bounce_type})`,
      });
      return { ok: false, steps, summary: "Empfänger ist suppressed" };
    }
    push({ key: "suppression", label: "Suppression-Check", ok: true, detail: "nicht suppressed" });

    // 5) Optional: echte Testmail über send-invitation-email versenden
    if (!data.send_email) {
      push({ key: "send", label: "Edge-Function-Call", ok: true, detail: "übersprungen (send_email=false)" });
      return {
        ok: overallOk,
        steps,
        summary: overallOk ? "✅ Dry-Run grün (ohne Mailversand)" : "❌ Dry-Run fehlgeschlagen",
      };
    }

    const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.API_EXTERNAL_URL ?? "").replace(/\/+$/, "");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? "";
    if (!supabaseUrl || !serviceKey) {
      fail({
        key: "send",
        label: "Edge-Function-Call",
        reason: "mail_function_env_missing",
        detail: "SUPABASE_URL oder SERVICE_ROLE_KEY fehlt im Server-Env",
      });
      return { ok: false, steps, summary: "Server-Env unvollständig — Edge-Function-Call unmöglich" };
    }

    const isOpaque = serviceKey.startsWith("sb_publishable_") || serviceKey.startsWith("sb_secret_");
    const headers: Record<string, string> = { "Content-Type": "application/json", apikey: serviceKey };
    if (!isOpaque) headers.Authorization = `Bearer ${serviceKey}`;

    const body = {
      to: data.test_email,
      fullName: "[DRY-RUN] Test Bewerber",
      firstName: "Test",
      lastName: "Bewerber",
      registrationLink: confirmationActionLink,
      tenantId,
      templateName: "application_received",
      subjectPrefix: "[DRY-RUN] ",
      placeholders: {
        partner_name: lp.intermediate_company_name ?? "",
        calendly_link: confirmationBookingLink ?? "",
        booking_link: confirmationBookingLink ?? "",
      },
    };

    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/send-invitation-email`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const text = await response.clone().text();
      let payload: any = null;
      if (text) { try { payload = JSON.parse(text); } catch { payload = text; } }

      if (!response.ok || (payload && typeof payload === "object" && payload.error)) {
        const reason = (payload && typeof payload === "object" && (payload.error ?? payload.message))
          || (typeof payload === "string" ? payload : `HTTP ${response.status}`);
        fail({
          key: "send",
          label: "Edge-Function-Call",
          reason: String(reason),
          detail: `HTTP ${response.status} · Body: ${typeof payload === "string" ? payload : JSON.stringify(payload)}`,
        });
        return { ok: false, steps, summary: `Edge-Function fehlgeschlagen: ${reason}` };
      }
      push({
        key: "send",
        label: "Edge-Function-Call",
        ok: true,
        detail: `HTTP ${response.status} · message_id=${(payload && typeof payload === "object" && payload.messageId) || "n/a"}`,
      });
    } catch (e: any) {
      fail({
        key: "send",
        label: "Edge-Function-Call",
        reason: e?.message ?? "network_error",
        detail: String(e),
      });
      return { ok: false, steps, summary: `Netzwerkfehler beim Edge-Function-Call: ${e?.message}` };
    }

    return {
      ok: overallOk,
      steps,
      summary: overallOk
        ? `✅ Dry-Run grün — Testmail an ${data.test_email} versendet`
        : "❌ Dry-Run fehlgeschlagen",
    };
  });
