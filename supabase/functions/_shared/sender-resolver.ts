// Zentraler Absender-Resolver für alle Edge Functions.
//
// Regel (Single Source of Truth):
//
//   broker_*     → applications.broker_tenant_id       (Vermittlungs-SMTP)
//   fasttrack_*  → applications.fasttrack_tenant_id    (Portal-/Fast-Track-SMTP)
//
// Bei fehlendem/inkomplettem SMTP wird nicht auf einen anderen Tenant zurückgefallen —
// die Mail wird geskippt und in email_send_log als 'failed' mit reason='routing_*' geloggt.
// Damit werden falsche Absender („Registrierung von Vermittlungs-SMTP") strukturell verhindert.
//
// Nutzung:
//   const { tenant, kind, reason } = await resolveSender(admin, applicationId, "broker_booking_confirmation");
//   if (!tenant) { skip(reason); continue; }

export type EmailKind =
  | "broker_confirmation"          // Bewerbungsbestätigung / kein Termin
  | "broker_no_booking"            // Reminder 24h/72h ohne Termin
  | "broker_no_show"               // Reminder nach No-Show
  | "broker_interview_invite"      // Termin-/Interview-Einladung mit Link
  | "broker_booking_confirmation"  // Terminbestätigung + ICS
  | "fasttrack_email_verify"       // Double-Opt-In
  | "fasttrack_registration_complete" // Ausweis/Vertrag/Portal-Onboarding
  | "fasttrack_no_order_7d"        // 7 Tage kein gebuchter Auftrag
  | "fasttrack_chat_reminder";     // Chat-Reminder

export interface ResolvedSender {
  tenant: any | null;
  kind: EmailKind;
  side: "broker" | "fasttrack";
  reason: string | null;   // null = ok, sonst z.B. 'missing_fasttrack_tenant' oder 'smtp_incomplete'
  /** true = Ersatzabsender genutzt, weil der zuständige Mandant nicht senden konnte. */
  fallbackUsed?: boolean;
  /** Ursprünglich zuständiger Mandant (kann null sein) — für Diagnose im Log. */
  intendedTenantId?: string | null;
  /** Warum der zuständige Mandant ausgefallen ist (nur bei fallbackUsed). */
  fallbackReason?: string | null;
}

const SIDE: Record<EmailKind, "broker" | "fasttrack"> = {
  broker_confirmation: "broker",
  broker_no_booking: "broker",
  broker_no_show: "broker",
  broker_interview_invite: "broker",
  broker_booking_confirmation: "broker",
  fasttrack_email_verify: "fasttrack",
  fasttrack_registration_complete: "fasttrack",
  fasttrack_no_order_7d: "fasttrack",
  fasttrack_chat_reminder: "fasttrack",
};

// Kritische Mails: ohne sie kann der Bewerber nicht weitermachen.
// Eine Mandanten-Pause darf diese Mails NICHT verhindern — sonst steht der
// Bewerber ohne Terminbestätigung bzw. ohne Interview-Link da.
const CRITICAL_KINDS = new Set<EmailKind>([
  "broker_booking_confirmation",
  "broker_interview_invite",
]);

export function isCriticalKind(kind: EmailKind): boolean {
  return CRITICAL_KINDS.has(kind);
}

const TENANT_SELECT =
  "id,name,domain,primary_domain,logo_url,primary_color,sender_email,sender_name,reply_to_email," +
  "smtp_host,smtp_port,smtp_username,smtp_password,email_signature,emails_paused,emails_paused_by," +
  "emails_paused_reason,is_active," +
  "welcome_email_subject,welcome_email_body,application_received_subject,application_received_body,application_received_button_label," +
  "booking_confirmation_subject,booking_confirmation_body,booking_confirmation_button," +
  "reminder_app_no_booking_subject,reminder_app_no_booking_body,reminder_app_no_show_subject,reminder_app_no_show_body," +
  "reminder_app_registration_subject,reminder_app_registration_body,reminder_app_rebook_subject,reminder_app_rebook_body," +
  "team_leader_name,reminder_chat_subject,reminder_chat_body";

function smtpOk(t: any): boolean {
  return !!(t?.smtp_host && t?.smtp_port && t?.smtp_username && t?.smtp_password);
}

function pauseBlocks(t: any, kind?: EmailKind): string | null {
  if (!t) return null;
  // Kritische Mails ignorieren jede Pause (siehe CRITICAL_KINDS).
  if (kind && CRITICAL_KINDS.has(kind)) return null;
  if (t.is_active === false) return "tenant_inactive";
  // Nur MANUELLE Pausen blockieren (siehe applications.ts::tenantMailBlockReason).
  if (t.emails_paused && t.emails_paused_by && t.emails_paused_by !== "auto:smtp_verify") {
    return `tenant_emails_paused${t.emails_paused_reason ? `: ${t.emails_paused_reason}` : ""}`;
  }
  return null;
}

export async function resolveSender(
  admin: any,
  applicationId: string | null | undefined,
  kind: EmailKind,
): Promise<ResolvedSender> {
  const side = SIDE[kind];
  const critical = CRITICAL_KINDS.has(kind);

  if (!applicationId) {
    return critical
      ? await criticalFallback(admin, kind, side, null, "application_id_missing")
      : { tenant: null, kind, side, reason: "application_id_missing" };
  }

  const { data: app, error: appErr } = await admin
    .from("applications")
    .select("id, tenant_id, broker_tenant_id, fasttrack_tenant_id, source_landing_id, target_landing_id")
    .eq("id", applicationId)
    .maybeSingle();

  if (appErr || !app) {
    const r = `application_not_found${appErr ? `: ${appErr.message}` : ""}`;
    return critical ? await criticalFallback(admin, kind, side, null, r) : { tenant: null, kind, side, reason: r };
  }

  let tenantId: string | null = side === "broker" ? (app.broker_tenant_id ?? null) : (app.fasttrack_tenant_id ?? null);

  // Legacy-Fallback: alte Rows ohne broker_/fasttrack_tenant_id → live nachziehen.
  if (!tenantId) {
    if (side === "broker" && app.source_landing_id) {
      const { data: lp } = await admin.from("landing_pages")
        .select("tenant_id").eq("id", app.source_landing_id).maybeSingle();
      tenantId = (lp as any)?.tenant_id ?? null;
    } else if (side === "fasttrack") {
      if (app.target_landing_id) {
        const { data: lp } = await admin.from("landing_pages")
          .select("tenant_id, flow_type").eq("id", app.target_landing_id).maybeSingle();
        if ((lp as any)?.flow_type !== "broker") tenantId = (lp as any)?.tenant_id ?? null;
      }
      if (!tenantId && app.source_landing_id) {
        const { data: src } = await admin.from("landing_pages")
          .select("linked_fasttrack_landing_id").eq("id", app.source_landing_id).maybeSingle();
        const linked = (src as any)?.linked_fasttrack_landing_id;
        if (linked) {
          const { data: ft } = await admin.from("landing_pages")
            .select("tenant_id, flow_type").eq("id", linked).maybeSingle();
          if ((ft as any)?.flow_type !== "broker") tenantId = (ft as any)?.tenant_id ?? null;
        }
      }
    }
  }

  // Letzter Legacy-Fallback nur für Broker-Mails: alte Bewerbungen hatten häufig
  // applications.tenant_id = Vermittlungs-Tenant. Fast-Track-Mails fallen bewusst
  // NICHT darauf zurück, weil genau dadurch falsche Absender entstanden sind.
  if (!tenantId && side === "broker") tenantId = app.tenant_id ?? null;

  if (!tenantId) {
    const r = side === "fasttrack" ? "missing_fasttrack_tenant" : "missing_broker_tenant";
    return critical
      ? await criticalFallback(admin, kind, side, app, r)
      : { tenant: null, kind, side, reason: r };
  }

  const { data: tenant, error: tErr } = await admin
    .from("tenants").select(TENANT_SELECT).eq("id", tenantId).maybeSingle();
  if (tErr || !tenant) {
    const r = `tenant_not_found${tErr ? `: ${tErr.message}` : ""}`;
    return critical
      ? await criticalFallback(admin, kind, side, app, r, tenantId)
      : { tenant: null, kind, side, reason: r };
  }

  const paused = pauseBlocks(tenant, kind);
  if (paused) {
    return critical
      ? await criticalFallback(admin, kind, side, app, paused, tenantId)
      : { tenant: null, kind, side, reason: paused };
  }
  if (!smtpOk(tenant)) {
    return critical
      ? await criticalFallback(admin, kind, side, app, "smtp_incomplete", tenantId)
      : { tenant: null, kind, side, reason: "smtp_incomplete" };
  }

  return { tenant, kind, side, reason: null };
}

/**
 * KEIN Ersatzabsender mehr.
 *
 * Eine Mail darf niemals über einen fremden Mandanten rausgehen — sonst
 * werden Firmen/Marken vertauscht. Wenn der zuständige Mandant nicht senden
 * kann (SMTP unvollständig, Tenant fehlt/inaktiv), wird die Mail bewusst
 * NICHT versendet, sondern als blockiert geloggt und im E-Mail-Center
 * angezeigt, damit die SMTP-Daten korrigiert werden.
 */
async function criticalFallback(
  _admin: any,
  kind: EmailKind,
  side: "broker" | "fasttrack",
  _app: any | null,
  reason: string,
  intendedTenantId: string | null = null,
): Promise<ResolvedSender> {
  console.warn("[sender-resolver] critical mail blocked (kein Ersatzabsender)", { kind, reason, tenant: intendedTenantId });
  return { tenant: null, kind, side, reason, intendedTenantId };
}

// Convenience: direkter Tenant-Fetch (für Cron-Fälle, wo keine application vorliegt).
export async function loadTenantForSend(admin: any, tenantId: string, kind: EmailKind = "broker_confirmation"): Promise<ResolvedSender> {
  const side = SIDE[kind];
  const { data: tenant } = await admin.from("tenants").select(TENANT_SELECT).eq("id", tenantId).maybeSingle();
  if (!tenant) return { tenant: null, kind, side, reason: "tenant_not_found" };
  const paused = pauseBlocks(tenant, kind);
  if (paused) return { tenant: null, kind, side, reason: paused };
  if (!smtpOk(tenant)) return { tenant: null, kind, side, reason: "smtp_incomplete" };
  return { tenant, kind, side, reason: null };
}
