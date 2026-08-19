// End-to-End Dry-Run für ALLE Bewerber-, Mitarbeiter- und System-Flows.
//
// Ruft je Flow die produktive Edge-Function mit realistischen Test-Daten
// und `[DRY-RUN]`-Präfix im Subject auf. Keine DB-Änderungen, keine
// email_send_log-Fehler.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  landing_page_id: z.string().uuid(),
  test_email: z.string().email(),
});

export type FlowStep = {
  key: string;
  group: "applicant" | "employee" | "system";
  label: string;
  ok: boolean;
  ms: number;
  reason?: string;
  detail?: string;
};

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

function portalBase(tenant: any): string {
  const domain = String(tenant?.primary_domain ?? tenant?.domain ?? "")
    .trim().replace(/^portal\./, "");
  return domain ? `https://portal.${domain}` : "https://portal.example.com";
}

type FlowDef = {
  key: string;
  group: "applicant" | "employee" | "system";
  label: string;
  // Baut den Body für send-invitation-email
  build: (ctx: { tenantId: string; tenant: any; landing: any; to: string; base: string }) => Record<string, any>;
};

const FLOWS: FlowDef[] = [
  {
    key: "application_received",
    group: "applicant",
    label: "Bewerbung eingegangen",
    build: ({ tenantId, tenant, landing, to, base }) => ({
      to,
      fullName: "[DRY-RUN] Max Mustermann",
      firstName: "Max",
      lastName: "Mustermann",
      registrationLink: `${base}/termin/buchen/DRY-RUN-TOKEN`,
      tenantId,
      templateName: "application_received",
      subjectPrefix: "[DRY-RUN] ",
      placeholders: {
        partner_name: landing?.intermediate_company_name ?? "",
        booking_link: `${base}/termin/buchen/DRY-RUN-TOKEN`,
        calendly_link: landing?.calendly_url ?? "",
      },
    }),
  },
  {
    key: "booking_confirmation",
    group: "applicant",
    label: "Terminbestätigung",
    build: ({ tenantId, to, base }) => ({
      to,
      fullName: "[DRY-RUN] Max Mustermann",
      firstName: "Max",
      registrationLink: `${base}/termin/buchen/DRY-RUN-TOKEN`,
      tenantId,
      templateName: "booking_confirmation",
      subjectPrefix: "[DRY-RUN] ",
      placeholders: {
        appointment_time: "Montag, 15.09.2026 um 14:00 Uhr",
        cancel_link: `${base}/termin/absagen/DRY-RUN-TOKEN`,
      },
    }),
  },
  {
    key: "appointment_reminder_24h",
    group: "applicant",
    label: "Erinnerung 24h vor Termin",
    build: ({ tenantId, to, base }) => ({
      to,
      fullName: "[DRY-RUN] Max Mustermann",
      firstName: "Max",
      registrationLink: `${base}/termin/buchen/DRY-RUN-TOKEN`,
      tenantId,
      templateName: "appointment_reminder_24h",
      subjectPrefix: "[DRY-RUN] ",
      placeholders: {
        appointment_time: "morgen um 14:00 Uhr",
        cancel_link: `${base}/termin/absagen/DRY-RUN-TOKEN`,
      },
    }),
  },
  {
    key: "app_no_show",
    group: "applicant",
    label: "No-Show Nachfass",
    build: ({ tenantId, to, base }) => ({
      to,
      fullName: "[DRY-RUN] Max Mustermann",
      firstName: "Max",
      registrationLink: `${base}/termin/buchen/DRY-RUN-TOKEN`,
      tenantId,
      templateName: "app_no_show",
      subjectPrefix: "[DRY-RUN] ",
      placeholders: { booking_link: `${base}/termin/buchen/DRY-RUN-TOKEN` },
    }),
  },
  {
    key: "app_no_booking",
    group: "applicant",
    label: "Kein Termin gebucht (Reminder)",
    build: ({ tenantId, to, base }) => ({
      to,
      fullName: "[DRY-RUN] Max Mustermann",
      firstName: "Max",
      registrationLink: `${base}/termin/buchen/DRY-RUN-TOKEN`,
      tenantId,
      templateName: "app_no_booking",
      subjectPrefix: "[DRY-RUN] ",
      placeholders: { booking_link: `${base}/termin/buchen/DRY-RUN-TOKEN` },
    }),
  },
  {
    key: "ai_acceptance_invitation",
    group: "applicant",
    label: "Interview-Einladung",
    build: ({ tenantId, to, base }) => ({
      to,
      fullName: "[DRY-RUN] Max Mustermann",
      firstName: "Max",
      registrationLink: `${base}/interview/DRY-RUN-TOKEN`,
      tenantId,
      templateName: "ai_acceptance_invitation",
      subjectPrefix: "[DRY-RUN] ",
      placeholders: { interview_link: `${base}/interview/DRY-RUN-TOKEN` },
    }),
  },
  {
    key: "app_registration",
    group: "employee",
    label: "Registrierungs-Link",
    build: ({ tenantId, to, base }) => ({
      to,
      fullName: "[DRY-RUN] Max Mustermann",
      firstName: "Max",
      registrationLink: `${base}/register/DRY-RUN-TOKEN`,
      tenantId,
      templateName: "app_registration",
      subjectPrefix: "[DRY-RUN] ",
    }),
  },
  {
    key: "invitation",
    group: "employee",
    label: "Willkommen (nach KYC)",
    build: ({ tenantId, to, base }) => ({
      to,
      fullName: "[DRY-RUN] Max Mustermann",
      firstName: "Max",
      registrationLink: `${base}/dashboard`,
      tenantId,
      templateName: "invitation",
      subjectPrefix: "[DRY-RUN] ",
    }),
  },
  {
    key: "password_reset",
    group: "employee",
    label: "Passwort-Reset",
    build: ({ tenantId, to, base }) => ({
      to,
      fullName: "[DRY-RUN] Max Mustermann",
      firstName: "Max",
      registrationLink: `${base}/reset-password?token=DRY-RUN-TOKEN`,
      tenantId,
      templateName: "password_reset",
      subjectPrefix: "[DRY-RUN] ",
    }),
  },
  {
    key: "signup_confirmation",
    group: "employee",
    label: "Signup-Bestätigung",
    build: ({ tenantId, to, base }) => ({
      to,
      fullName: "[DRY-RUN] Max Mustermann",
      firstName: "Max",
      registrationLink: `${base}/auth/confirm?token=DRY-RUN-TOKEN`,
      tenantId,
      templateName: "signup_confirmation",
      subjectPrefix: "[DRY-RUN] ",
    }),
  },
  {
    key: "chat_reminder",
    group: "system",
    label: "Chat-Erinnerung",
    build: ({ tenantId, to, base }) => ({
      to,
      fullName: "[DRY-RUN] Max Mustermann",
      firstName: "Max",
      registrationLink: `${base}/chat`,
      tenantId,
      templateName: "chat_reminder",
      subjectPrefix: "[DRY-RUN] ",
      placeholders: { leader_name: "Sabine Schneider" },
    }),
  },
];

export const listAllFlows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    return { flows: FLOWS.map((f) => ({ key: f.key, group: f.group, label: f.label })) };
  });

const RunInput = Input.extend({
  flow_keys: z.array(z.string()).min(1),
});

export const dryRunFlows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RunInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; steps: FlowStep[]; summary: string }> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Landing + Tenant einmal laden
    const { data: lp } = await supabaseAdmin
      .from("landing_pages")
      .select("id, slug, source_slug, tenant_id, calendly_url, intermediate_company_name, booking_mode, domain")
      .eq("id", data.landing_page_id)
      .maybeSingle();
    if (!lp) {
      return { ok: false, steps: [], summary: "Landing Page nicht gefunden" };
    }
    if (!lp.tenant_id) {
      return { ok: false, steps: [], summary: "Landing hat keine tenant_id" };
    }

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("id, name, domain, primary_domain, smtp_host, smtp_port, smtp_username, smtp_password, is_active, emails_paused, emails_paused_reason, smtp_health_status")
      .eq("id", lp.tenant_id)
      .maybeSingle();
    if (!tenant) {
      return { ok: false, steps: [], summary: "Tenant nicht gefunden" };
    }
    if (tenant.emails_paused) {
      return { ok: false, steps: [], summary: `Tenant emails_paused: ${tenant.emails_paused_reason ?? "unbekannt"}` };
    }
    if (!tenant.smtp_host || !tenant.smtp_port || !tenant.smtp_username || !tenant.smtp_password) {
      return { ok: false, steps: [], summary: "Tenant SMTP nicht konfiguriert" };
    }

    // Suppression einmal prüfen
    const { data: suppressed } = await supabaseAdmin
      .from("suppressed_emails")
      .select("email, bounce_type")
      .eq("email", data.test_email.toLowerCase())
      .maybeSingle();
    if (suppressed) {
      return { ok: false, steps: [], summary: `Empfänger ${data.test_email} ist suppressed` };
    }

    const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.API_EXTERNAL_URL ?? "").replace(/\/+$/, "");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? "";
    if (!supabaseUrl || !serviceKey) {
      return { ok: false, steps: [], summary: "Server-Env unvollständig (SUPABASE_URL / SERVICE_ROLE_KEY fehlen)" };
    }
    const isOpaque = serviceKey.startsWith("sb_publishable_") || serviceKey.startsWith("sb_secret_");
    const headers: Record<string, string> = { "Content-Type": "application/json", apikey: serviceKey };
    if (!isOpaque) headers.Authorization = `Bearer ${serviceKey}`;

    const base = portalBase(tenant);
    const steps: FlowStep[] = [];
    const selected = FLOWS.filter((f) => data.flow_keys.includes(f.key));

    for (const flow of selected) {
      const started = Date.now();
      try {
        const body = flow.build({
          tenantId: tenant.id,
          tenant,
          landing: lp,
          to: data.test_email,
          base,
        });
        const res = await fetch(`${supabaseUrl}/functions/v1/send-invitation-email`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        const text = await res.text();
        let payload: any = null;
        if (text) { try { payload = JSON.parse(text); } catch { payload = text; } }
        const errMsg = payload && typeof payload === "object" ? payload.error : null;
        const ok = res.ok && !errMsg;
        steps.push({
          key: flow.key,
          group: flow.group,
          label: flow.label,
          ok,
          ms: Date.now() - started,
          reason: ok ? undefined : (errMsg || `HTTP ${res.status}`),
          detail: ok
            ? `HTTP ${res.status} · message_id=${(payload && typeof payload === "object" && payload.messageId) || "n/a"}`
            : `HTTP ${res.status} · ${typeof payload === "string" ? payload : JSON.stringify(payload)}`,
        });
      } catch (e: any) {
        steps.push({
          key: flow.key,
          group: flow.group,
          label: flow.label,
          ok: false,
          ms: Date.now() - started,
          reason: e?.message ?? "network_error",
          detail: String(e),
        });
      }
    }

    const failed = steps.filter((s) => !s.ok).length;
    return {
      ok: failed === 0,
      steps,
      summary: failed === 0
        ? `✅ Alle ${steps.length} Flows grün — Testmails an ${data.test_email} versendet`
        : `❌ ${failed}/${steps.length} Flows fehlgeschlagen`,
    };
  });
