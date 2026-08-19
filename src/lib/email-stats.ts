// ── Shared email log types, status config ──

export interface EmailLog {
  id: string;
  message_id: string | null;
  template_name: string;
  recipient_email: string;
  status: string;
  error_message: string | null;
  metadata: any;
  created_at: string;
  acknowledged_at?: string | null;
  rendered_html?: string | null;
  rendered_subject?: string | null;

}

export const EMAIL_STATUS_COLORS: Record<string, string> = {
  sent: "bg-accent text-accent-foreground border border-accent font-semibold",
  failed: "bg-destructive text-destructive-foreground border border-destructive font-semibold",
  dlq: "bg-destructive text-destructive-foreground border border-destructive font-semibold",
  bounced: "bg-destructive text-destructive-foreground border border-destructive font-semibold",
  complained: "bg-status-pending/20 text-status-pending border border-status-pending/30 font-medium",
  suppressed: "bg-status-pending/20 text-status-pending border border-status-pending/30 font-medium",
  skipped: "bg-muted text-muted-foreground border border-border font-medium",
  duplicate: "bg-muted text-muted-foreground border border-border font-medium",
};

export const EMAIL_STATUS_LABELS: Record<string, string> = {
  sent: "Gesendet",
  failed: "Fehlgeschlagen",
  dlq: "Endgültig fehlgeschlagen",
  bounced: "Gebounced",
  complained: "Beschwerde",
  suppressed: "Unterdrückt",
  skipped: "Übersprungen",
  duplicate: "Doppelversand bereinigt",
};

// ── Vereinfachte Statusanzeige ──
// Intern gibt es viele Feinstatus (pending, superseded, dlq, acked …). Für die
// Fehlersuche zählt aber nur: Ist die Mail raus, ist sie nicht raus, oder läuft
// sie noch? Der Feinstatus bleibt in der Detailansicht sichtbar.
export type SimpleEmailStatus = "delivered" | "not_delivered" | "in_progress";

export const SIMPLE_STATUS_LABELS: Record<SimpleEmailStatus, string> = {
  delivered: "Angekommen",
  not_delivered: "Nicht angekommen",
  in_progress: "Läuft noch",
};

export const SIMPLE_STATUS_COLORS: Record<SimpleEmailStatus, string> = {
  delivered: "bg-accent text-accent-foreground border border-accent font-semibold",
  not_delivered: "bg-destructive text-destructive-foreground border border-destructive font-semibold",
  in_progress: "bg-muted text-muted-foreground border border-border font-medium",
};

export function simpleEmailStatus(status: string): SimpleEmailStatus {
  switch (status) {
    case "sent":
    case "acked":
      return "delivered";
    case "failed":
    case "dlq":
    case "bounced":
    case "complained":
    case "suppressed":
      return "not_delivered";
    default:
      // pending, superseded, skipped, duplicate, unbekannt
      return "in_progress";
  }
}

export const EMAIL_TYPE_LABELS: Record<string, string> = {
  invitation: "Einladung",
  test_email: "Test",
  auth_emails: "Auth / Reset",
  password_reset: "Passwort-Reset",
  "contact-confirmation": "Kontakt",
  auth_recovery: "Passwort-Reset",
  auth_signup: "Bestätigung",
  auth_confirmation: "Bestätigung",
  auth_invite: "Einladung",
  auth_magiclink: "Magic Link",
  reminder_invite: "Reminder · Einladung",
  reminder_confirm_email: "Reminder · E-Mail bestätigen",
  reminder_complete_registration: "Reminder · Onboarding",
  reminder_no_recent_booking: "Reminder · Keine Buchung",
  reminder_domain_recovery: "Reminder · Domain-Recovery",
  domain_recovery: "Reminder · Domain-Recovery",
  bewerbung_magic_link: "Vermittlung · Interview-Einladung",
  booking_confirmation: "Vermittlung · Terminbestätigung",
  signup_confirmation: "E-Mail bestätigen",
  signup_confirmation_resend: "E-Mail bestätigen · erneut gesendet",
  interview_invite_30min: "Vermittlung · Interview-Einladung (30 Min)",

  chat_reminder: "Chat-Reminder",
  vermittlung_no_booking_24h: "Vermittlung · Kein Termin 24h",
  vermittlung_no_booking_72h: "Vermittlung · Kein Termin 72h",
  vermittlung_no_show_24h: "Vermittlung · No-Show 24h",
  vermittlung_no_show_30min: "Vermittlung · No-Show 30 Min",
  vermittlung_interview_abandoned: "Vermittlung · Interview fortsetzen",
  interview_reminder_24h: "Vermittlung · Termin-Erinnerung (24h)",
  vermittlung_registration_pending_2h: "Vermittlung · Registrierung offen 2h",
  fasttrack_registration_pending_2h: "Fast-Track · Registrierung offen 2h",
  vermittlung_registration_pending_24h: "Vermittlung · Registrierung offen 24h",
  vermittlung_registration_pending_72h: "Vermittlung · Registrierung offen 72h",
  fasttrack_registration_pending_24h: "Fast-Track · Registrierung offen 24h",
  fasttrack_registration_pending_72h: "Fast-Track · Registrierung offen 72h",
  vermittlung_rebook_after_cancel_24h: "Vermittlung · Neuer Termin nach Absage 24h",
  vermittlung_rebook_after_cancel_72h: "Vermittlung · Neuer Termin nach Absage 72h",
  fasttrack_rebook_after_cancel_24h: "Fast-Track · Neuer Termin nach Absage 24h",
  fasttrack_rebook_after_cancel_72h: "Fast-Track · Neuer Termin nach Absage 72h",
  application_received: "Vermittlung · Bewerbung eingegangen",
  registration_invitation: "Zusage · Registrierungs-Einladung",
};

export interface EmailStats {
  total: number;
  sent: number;
  failed: number;
  bounced: number;
  suppressed: number;
  /** Mails, deren letzter Zustand "pending" (Retry offen) ist */
  pending: number;
  /** Pending-Mails, die seit > 6h hängen */
  stalePending: number;
  successRate: number;
  /** Unbearbeitete Fails der letzten 24h (treibt den "Aktion erforderlich"-Banner) */
  openFailures24h: number;
  actionRequired: boolean;
}

/** Höhere Priorität = "finalerer" Zustand. Pending verliert immer gegen finale Zustände. */
const STATUS_PRIORITY: Record<string, number> = {
  sent: 6,
  bounced: 5,
  complained: 5,
  suppressed: 4,
  skipped: 1,
  dlq: 3,
  failed: 2,
  superseded: 1,
  duplicate: 1,
  pending: 0,
};

const FINAL_STATUSES = new Set(["sent", "failed", "dlq", "bounced", "complained", "suppressed", "skipped", "duplicate"]);

/**
 * Technische Zeilen, die nirgends in Listen oder Statistiken auftauchen:
 * "superseded" = durch einen Retry abgelöst,
 * "duplicate"  = vom Aufräum-Skript bereinigter Doppelversand.
 */
export const HIDDEN_EMAIL_STATUS = ["superseded", "duplicate"];

/**
 * Logischer Schlüssel eines Versands: Tenant + Template + Empfänger + Tag.
 * Retries (pending -> sent/failed) haben unterschiedliche message_ids, fallen
 * über diesen Schlüssel aber korrekt zusammen — sonst zählt derselbe Versand doppelt.
 */
export function emailLogKey(log: EmailLog): string {
  const tenant = log.metadata?.tenant_id || log.metadata?.tenant_name || "global";
  const eventKey = log.metadata?.event_key;
  if (eventKey) return `event|${eventKey}`;
  const requestId = log.metadata?.request_id;
  if (requestId) return ["request", tenant, log.template_name, requestId].join("|");
  const sentDay = new Date(log.created_at).toISOString().slice(0, 10);
  return ["logical", tenant, log.template_name, (log.recipient_email ?? "").toLowerCase(), sentDay].join("|");
}

export function dedupeEmailLogs<T extends EmailLog>(logs: T[]): T[] {
  const latest = new Map<string, T>();
  for (const log of logs) {
    const key = emailLogKey(log);
    const current = latest.get(key);
    if (!current) {
      latest.set(key, log);
      continue;
    }
    if (winsOver(log, current)) latest.set(key, log);
  }
  return Array.from(latest.values()).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/** Finaler Zustand schlägt pending; unter Gleichen gewinnt der neuere Eintrag. */
function winsOver(candidate: EmailLog, current: EmailLog): boolean {
  const candFinal = FINAL_STATUSES.has(candidate.status);
  const curFinal = FINAL_STATUSES.has(current.status);
  if (candFinal !== curFinal) return candFinal;
  const candTime = new Date(candidate.created_at).getTime();
  const curTime = new Date(current.created_at).getTime();
  if (candTime !== curTime) return candTime > curTime;
  return (STATUS_PRIORITY[candidate.status] ?? 0) > (STATUS_PRIORITY[current.status] ?? 0);
}

/**
 * Compute email stats from the latest state per logical email.
 * `actionRequired` zählt nur nicht-acknowledgte Fails der letzten 24h —
 * alte permanente Fehler verschwinden nach Ack aus dem Banner.
 */
export function computeEmailStats(logs: EmailLog[]): EmailStats {
  const finalLogs = dedupeEmailLogs(logs).filter(l => !HIDDEN_EMAIL_STATUS.includes(l.status));
  const total = finalLogs.length;
  const sent = finalLogs.filter(l => l.status === "sent").length;
  const failed = finalLogs.filter(l => ["failed", "dlq"].includes(l.status)).length;
  const bounced = finalLogs.filter(l => l.status === "bounced").length;
  const suppressed = finalLogs.filter(l => l.status === "suppressed").length;
  const pendingLogs = finalLogs.filter(l => l.status === "pending");
  const staleCutoff = Date.now() - 6 * 3600_000;
  const stalePending = pendingLogs.filter(l => new Date(l.created_at).getTime() < staleCutoff).length;

  // Erfolgsquote nur über abgeschlossene Versände — pending zählt nicht dagegen.
  const finished = sent + failed + bounced;
  const successRate = finished > 0 ? Math.round((sent / finished) * 100) : 100;

  const cutoff = Date.now() - 24 * 3600_000;
  const openFailures24h = finalLogs.filter(l =>
    ["failed", "dlq", "bounced"].includes(l.status)
    && !l.acknowledged_at
    && new Date(l.created_at).getTime() >= cutoff
  ).length;

  return {
    total,
    sent,
    failed,
    bounced,
    suppressed,
    pending: pendingLogs.length,
    stalePending,
    openFailures24h,
    actionRequired: openFailures24h > 0,
    successRate,
  };
}

