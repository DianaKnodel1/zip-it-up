// Routing-Audit: prüft READ-ONLY, welche Bewerber/Mitarbeiter aktuell von
// welchem Trigger (Cron/Reminder) erfasst würden. Kein Versand — nutzt den
// dry_run-Modus der Edge Functions bzw. reine DB-Queries.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Candidate = {
  application_id?: string;
  profile_id?: string;
  to?: string;
  reason?: string;
  extra?: Record<string, any>;
};

type TriggerReport = {
  key: string;
  label: string;
  source: string;
  ok: boolean;
  candidates: Candidate[];
  note?: string;
  error?: string;
};

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase
    .from("user_roles").select("role")
    .eq("user_id", ctx.userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Nicht autorisiert");
}

function envUrlKey() {
  const url = (process.env.SUPABASE_URL ?? process.env.API_EXTERNAL_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? "";
  return { url, key };
}

async function callEdge(fn: string, body: any): Promise<{ ok: boolean; status: number; payload: any; error?: string }> {
  const { url, key } = envUrlKey();
  if (!url || !key) return { ok: false, status: 0, payload: null, error: "SUPABASE_URL/SERVICE_ROLE_KEY fehlen" };
  const isOpaque = key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: key };
  if (!isOpaque) headers.Authorization = `Bearer ${key}`;
  try {
    const res = await fetch(`${url}/functions/v1/${fn}`, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await res.text();
    let payload: any = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    return { ok: res.ok, status: res.status, payload };
  } catch (e: any) {
    return { ok: false, status: 0, payload: null, error: e?.message ?? String(e) };
  }
}

export const runRoutingAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ reports: TriggerReport[]; generated_at: string }> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const reports: TriggerReport[] = [];

    // ── 1) send-application-reminders (dry) → deckt no_booking / no_show /
    //    registration_pending / rebook_after_cancel für Vermittlungs-Bewerber ab.
    {
      const r = await callEdge("send-application-reminders", { dry_run: true });
      const results: any[] = Array.isArray(r.payload?.results) ? r.payload.results : [];
      const byKind = new Map<string, Candidate[]>();
      for (const row of results) {
        const kind = row.kind ?? "unknown";
        if (!byKind.has(kind)) byKind.set(kind, []);
        byKind.get(kind)!.push({
          application_id: row.app ?? row.application_id,
          to: row.to,
          reason: row.status,
          extra: { skipped_reason: row.reason },
        });
      }
      const kinds: Array<[string, string]> = [
        ["no_booking_24h", "Vermittlung: Kein Termin (24h)"],
        ["no_booking_72h", "Vermittlung: Kein Termin (72h)"],
        ["no_show_24h", "Vermittlung: No-Show (24h)"],
        ["registration_pending_24h", "Vermittlung: Registrierung offen (24h)"],
        ["registration_pending_72h", "Vermittlung: Registrierung offen (72h)"],
        ["rebook_after_cancel_24h", "Rebook nach Absage (24h)"],
        ["rebook_after_cancel_72h", "Rebook nach Absage (72h)"],
      ];
      for (const [key, label] of kinds) {
        reports.push({
          key, label,
          source: "cron: send-application-reminders",
          ok: r.ok,
          candidates: byKind.get(key) ?? [],
          note: r.ok ? undefined : `HTTP ${r.status}`,
          error: r.error,
        });
      }
    }

    // ── 2) send-appointment-reminders (dry) → Interview-Einladung 30 Min vor Termin
    {
      const r = await callEdge("send-appointment-reminders", { dry_run: true });
      const results: any[] = Array.isArray(r.payload?.results) ? r.payload.results : [];
      reports.push({
        key: "interview_invite_30min",
        label: "Vermittlung: Interview-Einladung (30 Min vor Termin)",
        source: "cron: send-appointment-reminders",
        ok: r.ok,
        candidates: results
          .filter((x) => x.status === "would_send" || x.status === "sent")
          .map((x) => ({ application_id: x.application_id, to: x.to, extra: { magic_link: x.magic_link } })),
        note: r.ok
          ? `Kandidaten gesamt: ${r.payload?.candidates ?? 0}, skipped: ${(results.filter((x) => x.status === "skipped").length)}`
          : `HTTP ${r.status}`,
        error: r.error,
      });
    }

    // ── 3) send-booking-confirmation (dry) → Terminbestätigung nach Buchung
    {
      const r = await callEdge("send-booking-confirmation", { dry_run: true });
      const results: any[] = Array.isArray(r.payload?.results) ? r.payload.results : [];
      reports.push({
        key: "booking_confirmation",
        label: "Terminbestätigung (nach Buchung)",
        source: "cron: send-booking-confirmation",
        ok: r.ok,
        candidates: results
          .filter((x) => x.status === "would_send")
          .map((x) => ({ application_id: x.application_id ?? x.id, to: x.to })),
        note: r.ok ? `Termine gesamt: ${r.payload?.candidates ?? 0}` : `HTTP ${r.status}`,
        error: r.error,
      });
    }

    // ── 4) Chat-Reminder: manuelle Prüfung per DB — findet Profile mit
    //      ungelesenen Nachrichten, die in den letzten 24h keinen Reminder erhielten.
    {
      try {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: unread } = await supabaseAdmin
          .from("chat_messages")
          .select("receiver_id")
          .eq("read", false);
        const receivers = Array.from(new Set((unread ?? []).map((r: any) => r.receiver_id).filter(Boolean)));
        const cand: Candidate[] = [];
        if (receivers.length) {
          const { data: recentLogs } = await supabaseAdmin
            .from("email_send_log")
            .select("recipient_email, created_at, template_name, status")
            .eq("template_name", "chat_reminder")
            .eq("status", "sent")
            .gte("created_at", cutoff);
          const recentEmails = new Set((recentLogs ?? []).map((l: any) => String(l.recipient_email).toLowerCase()));
          const { data: profs } = await supabaseAdmin
            .from("profiles")
            .select("user_id, email, tenant_id, full_name")
            .in("user_id", receivers);
          for (const p of (profs ?? []) as any[]) {
            if (!p.email || !p.tenant_id) continue;
            if (recentEmails.has(String(p.email).toLowerCase())) continue;
            cand.push({ profile_id: p.user_id, to: p.email, extra: { name: p.full_name } });
          }
        }
        reports.push({
          key: "chat_reminder",
          label: "Chat-Reminder (ungelesene Nachrichten, kein Reminder in 24h)",
          source: "manuell/hook: /admin/chat → Erinnerung senden",
          ok: true,
          candidates: cand,
          note: "Wird pro Konversation manuell vom Team-Lead ausgelöst (kein Cron).",
        });
      } catch (e: any) {
        reports.push({ key: "chat_reminder", label: "Chat-Reminder", source: "db", ok: false, candidates: [], error: e?.message });
      }
    }

    // ── 5) Registrierungs-/Passwort-Mails (event-getrieben, kein Cron) →
    //      Diagnose zeigt, welche Bewerber technisch eine Zusage haben, aber
    //      noch kein Profil.
    {
      try {
        const { data: apps } = await supabaseAdmin
          .from("applications")
          .select("id, email, tenant_id, status, created_at")
          .in("status", ["akzeptiert", "vermittlung_zusage", "fasttrack_angenommen"])
          .order("created_at", { ascending: false })
          .limit(500);
        const emails = Array.from(new Set((apps ?? []).map((a: any) => String(a.email ?? "").toLowerCase()).filter(Boolean)));
        const tenantIds = Array.from(new Set((apps ?? []).map((a: any) => a.tenant_id).filter(Boolean)));
        const registered = new Set<string>();
        if (emails.length && tenantIds.length) {
          const { data: profs } = await supabaseAdmin
            .from("profiles").select("email, tenant_id")
            .in("email", emails).in("tenant_id", tenantIds);
          for (const p of (profs ?? []) as any[]) {
            if (p.email) registered.add(`${p.tenant_id}|${String(p.email).toLowerCase()}`);
          }
        }
        const cand: Candidate[] = (apps ?? [])
          .filter((a: any) => a.email && a.tenant_id && !registered.has(`${a.tenant_id}|${String(a.email).toLowerCase()}`))
          .slice(0, 100)
          .map((a: any) => ({ application_id: a.id, to: a.email, reason: a.status }));
        reports.push({
          key: "registration_open",
          label: "Registrierung offen (Zusage ohne Profil)",
          source: "diagnose (view)",
          ok: true,
          candidates: cand,
          note: cand.length ? `${cand.length} Bewerber mit Zusage, aber noch nicht registriert.` : "Alle Zusagen sind registriert.",
        });
      } catch (e: any) {
        reports.push({ key: "registration_open", label: "Registrierung offen", source: "db", ok: false, candidates: [], error: e?.message });
      }
    }

    // ── 6) Domain-Wechsel-Recovery: zeigt Tenants mit kürzlichem Primary-Domain-Wechsel
    {
      try {
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: tenants } = await supabaseAdmin
          .from("tenants")
          .select("id, name, primary_domain, primary_domain_changed_at")
          .gte("primary_domain_changed_at", cutoff);
        reports.push({
          key: "domain_recovery",
          label: "Domain-Wechsel Recovery (letzte 30 Tage)",
          source: "cron: send-reminders (recovery)",
          ok: true,
          candidates: (tenants ?? []).map((t: any) => ({
            reason: `Tenant ${t.name}`,
            extra: { domain: t.primary_domain, changed_at: t.primary_domain_changed_at },
          })),
          note: "Recovery-Mail geht an alle Profile des Tenants, sobald eine Domain gewechselt wurde.",
        });
      } catch (e: any) {
        reports.push({ key: "domain_recovery", label: "Domain-Wechsel", source: "db", ok: false, candidates: [], error: e?.message });
      }
    }

    return { reports, generated_at: new Date().toISOString() };
  });
