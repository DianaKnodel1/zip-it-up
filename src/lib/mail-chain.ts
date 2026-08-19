// Fester Mail-Status pro Bewerber: JEDER Bewerber bekommt dieselben vier
// Punkte, damit über alle Zeilen hinweg vergleichbar ist, wo etwas fehlt.
import { EMAIL_TYPE_LABELS } from "./email-stats";

export type MailStepState = "sent" | "failed" | "skipped" | "pending" | "na" | "duplicate";

export type MailEvent = {
  /** Technischer Vorlagen-/Reminder-Name */
  key: string;
  /** Deutscher Klarname */
  label: string;
  status: string;
  at: string;
  error: string | null;
  source: "email_send_log" | "reminder_log";
  /** ID im email_send_log — nur dann ist ein Einzel-Resend möglich. */
  logId?: string | null;
};

export type MailStep = {
  id: "bewerbung" | "termin" | "erinnerung" | "zusage";
  label: string;
  state: MailStepState;
  /** Letztes Ereignis dieses Schritts (falls vorhanden) */
  event: MailEvent | null;
};

/** Klarname einer Vorlage — nie technische Namen in der Oberfläche zeigen. */
export function mailLabel(key: string | null | undefined): string {
  if (!key) return "E-Mail";
  return EMAIL_TYPE_LABELS[key] ?? REMINDER_LABELS[key] ?? key.replace(/_/g, " ");
}

export const REMINDER_LABELS: Record<string, string> = {
  no_booking_24h: "Erinnerung · Kein Termin (24 h)",
  no_booking_72h: "Erinnerung · Kein Termin (72 h)",
  no_show_24h: "Erinnerung · Nicht erschienen",
  interview_invite_30min: "Erinnerung · Interview in 30 Min",
  booking_confirmation: "Terminbestätigung",
  registration_pending_24h: "Erinnerung · Registrierung offen (24 h)",
  registration_pending_72h: "Erinnerung · Registrierung offen (72 h)",
  rebook_after_cancel_24h: "Erinnerung · Neuer Termin (24 h)",
  rebook_after_cancel_72h: "Erinnerung · Neuer Termin (72 h)",
  welcome_invitation: "Zusage · Registrierungseinladung",
  reminder_invite: "Erinnerung · Registrierungseinladung",
};

/**
 * Technische Skip-/Fehlergründe in verständliches Deutsch übersetzen.
 * In der Oberfläche darf nie ein Code wie `duplicate_application` stehen.
 */
const REASON_LABELS: Record<string, string> = {
  duplicate_application: "Doppelte Bewerbung – die Mail war bereits verschickt",
  already_sent: "Bereits versendet – kein zweiter Versand nötig",
  duplicate_within_20h: "Gleiche Mail ging in den letzten 20 Stunden schon raus",
  duplicate_recipient_template: "Gleiche Mail ging an diesen Empfänger bereits raus",
  tenant_paused: "Mailversand für diesen Mandanten ist pausiert",
  tenant_rate_limited_retry_later: "Sendelimit erreicht – wird automatisch nachgeholt",
  tenant_run_cap: "Sendelimit für diesen Lauf erreicht – wird nachgeholt",
  tenant_1h_cap: "Stundenlimit erreicht – wird automatisch nachgeholt",
  tenant_12h_cap: "Tageslimit erreicht – wird automatisch nachgeholt",
  smtp_incomplete: "Keine SMTP-Zugangsdaten hinterlegt",
  no_email_or_tenant: "Keine E-Mail-Adresse oder kein Mandant hinterlegt",
  no_magic_token: "Kein persönlicher Link vorhanden",
  no_invite_token: "Keine Registrierungseinladung vorhanden",
  tenant_missing: "Mandant nicht gefunden",
  no_domain: "Keine Domain hinterlegt",
  no_tenant_domain: "Keine Domain für den Mandanten hinterlegt",
  no_calendly_link: "Kein Terminbuchungs-Link hinterlegt",
  recent_invite: "Einladung wurde vor Kurzem schon versendet",
  outside_send_window: "Außerhalb der Versandzeit (06–22 Uhr) – wird nachgeholt",
  recipient_suppressed: "Empfänger gesperrt (frühere Zustellfehler)",
  routing_failed: "Absender konnte nicht ermittelt werden",
};

/** Gründe, die kein Problem sind – die werden dezent (grau) dargestellt. */
const HARMLESS_REASONS = new Set([
  "duplicate_application", "already_sent", "duplicate_within_20h",
  "duplicate_recipient_template", "recent_invite",
]);

export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return "";
  const key = String(reason).trim();
  // Rohe Gateway-Fehlerseiten (Cloudflare-HTML) nie ungefiltert anzeigen.
  if (/^<|<!doctype|<html|cf-wrapper|cloudflare/i.test(key)) {
    const status = key.match(/\b(50[024]|52[0124])\b/)?.[1] ?? null;
    return `Mail-Dienst war kurzzeitig nicht erreichbar${status ? ` (Gateway ${status})` : ""} – Nachversand möglich`;
  }
  return REASON_LABELS[key] ?? REASON_LABELS[key.replace(/^routing_/, "routing_")] ?? key.replace(/_/g, " ");
}

export function isHarmlessReason(reason: string | null | undefined): boolean {
  return !!reason && HARMLESS_REASONS.has(String(reason).trim());
}

const STEP_KEYS: Record<MailStep["id"], string[]> = {
  bewerbung: ["application_received"],
  termin: ["booking_confirmation"],
  erinnerung: [
    "no_booking_24h", "no_booking_72h", "no_show_24h", "interview_invite_30min",
    "registration_pending_24h", "registration_pending_72h",
    "rebook_after_cancel_24h", "rebook_after_cancel_72h",
    "vermittlung_no_booking_24h", "vermittlung_no_booking_72h", "vermittlung_no_show_24h",
    "vermittlung_registration_pending_24h", "vermittlung_registration_pending_72h",
    "fasttrack_registration_pending_24h", "fasttrack_registration_pending_72h",
    "vermittlung_rebook_after_cancel_24h", "vermittlung_rebook_after_cancel_72h",
    "fasttrack_rebook_after_cancel_24h", "fasttrack_rebook_after_cancel_72h",
  ],
  zusage: [
    "invitation", "registration_invitation", "welcome_invitation",
    "bewerbung_magic_link", "reminder_invite",
  ],
};

const STEP_LABELS: Record<MailStep["id"], string> = {
  bewerbung: "Eingangs-Mail",
  termin: "Termin-Mail",
  erinnerung: "Reminder-Mail",
  zusage: "Zusage-Mail",
};

function normalize(status: string): MailStepState {
  if (status === "sent") return "sent";
  if (status === "duplicate") return "duplicate";
  if (["failed", "dlq", "bounced", "complained"].includes(status)) return "failed";
  if (["skipped", "suppressed"].includes(status)) return "skipped";
  return "pending";
}

/**
 * Baut die feste 4er-Kette. `expected` sagt je Schritt, ob eine Mail in
 * diesem Fall überhaupt vorgesehen ist — sonst bleibt der Punkt grau ("–").
 */
export function buildMailChain(
  events: MailEvent[],
  expected: { termin: boolean; zusage: boolean },
): MailStep[] {
  const sorted = [...events].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  const ids: MailStep["id"][] = ["bewerbung", "termin", "erinnerung", "zusage"];
  return ids.map((id) => {
    const keys = STEP_KEYS[id];
    // Bereinigte Doppelversände dürfen den echten Versand nicht verdecken:
    // das Aufräum-Skript behält die ÄLTESTE Zeile als "gesendet" und markiert
    // die späteren — ohne diesen Vorzug würde aus ✓ ein graues ⧉.
    const matches = sorted.filter((e) => keys.includes(e.key));
    // Ein erfolgreicher Versand ist der fachlich finale Zustand. Frühere oder
    // spätere fehlgeschlagene Versuche dürfen eine tatsächlich zugestellte Mail
    // in der kompakten Kette nicht wieder rot darstellen.
    const ev = matches.find((e) => e.status === "sent")
      ?? matches.find((e) => e.status !== "duplicate")
      ?? matches[0]
      ?? null;
    const isExpected = id === "bewerbung" ? true : id === "termin" ? expected.termin : id === "zusage" ? expected.zusage : false;
    const state: MailStepState = ev ? normalize(ev.status) : isExpected ? "pending" : "na";
    return { id, label: STEP_LABELS[id], state, event: ev };
  });
}

export const STEP_STATE_STYLE: Record<MailStepState, { icon: string; cls: string; text: string }> = {
  sent: { icon: "✓", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300", text: "gesendet" },
  failed: { icon: "⚠", cls: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300", text: "fehlgeschlagen" },
  skipped: { icon: "⏭", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300", text: "übersprungen" },
  pending: { icon: "⏱", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300", text: "noch kein Ergebnis" },
  na: { icon: "–", cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400", text: "nicht vorgesehen" },
  duplicate: { icon: "⧉", cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400", text: "Doppelversand (bereinigt)" },
};

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

/** Anzeige-Stil für einen einzelnen Log-Eintrag (inkl. „hängen geblieben"). */
export function statusStyle(status: string): { icon: string; cls: string; text: string } {
  if (status === "stuck") {
    return {
      icon: "⏸",
      cls: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
      text: "hängen geblieben",
    };
  }
  return STEP_STATE_STYLE[normalize(status)];
}

/** Präfixe der Flow-Varianten entfernen, damit gleiche Schritte gepaart werden. */
export function normalizeMailKey(key: string | null | undefined): string {
  const k = String(key ?? "").toLowerCase();
  return k.replace(/^(vermittlung|fasttrack|broker)_/, "");
}

const PAIR_WINDOW_MS = 10 * 60 * 1000;

/**
 * Dieselbe Mail wird zweimal protokolliert: einmal im Versand-Log
 * (email_send_log) und einmal im Reminder-Log (application_reminder_log).
 * Hier werden beide zu EINEM Eintrag zusammengeführt — der Versand-Log
 * gewinnt, weil er Status, Fehlertext und die ID für den Resend kennt.
 * Reminder-Einträge ohne passenden Versand bleiben stehen: genau die
 * bedeuten „ausgelöst, aber nie versendet".
 */
export function mergeMailEvents(events: MailEvent[]): MailEvent[] {
  const sends = events.filter((e) => e.source === "email_send_log");
  const reminders = events.filter((e) => e.source !== "email_send_log");
  const used = new Set<number>();
  // Reservierungen, die nachweislich versendet wurden ("pending" im Versand-Log,
  // aber "sent" im Reminder-Protokoll). Das passiert, wenn der Versand-Aufruf
  // nach dem SMTP-Versand abbricht, bevor der Endstatus geschrieben wird.
  const proven = new Set<number>();

  const orphanReminders = reminders.filter((r) => {
    const rk = normalizeMailKey(r.key);
    const rt = new Date(r.at || 0).getTime();
    const idx = sends.findIndex(
      (s, i) =>
        !used.has(i) &&
        normalizeMailKey(s.key) === rk &&
        Math.abs(new Date(s.at || 0).getTime() - rt) <= PAIR_WINDOW_MS,
    );
    if (idx >= 0) {
      used.add(idx);
      const send = sends[idx]!;
      if (r.status === "sent" && normalize(send.status) === "pending") proven.add(idx);
      return false;
    }
    return true;
  });

  // Reminder ohne Versand => "hängen geblieben"
  const stuck = orphanReminders.map((r) =>
    r.status === "sent" ? { ...r, status: "stuck" } : r,
  );

  const STALE_CLAIM_MS = 30 * 60 * 1000;
  const now = Date.now();
  const resolvedSends = sends.map((s, i) => {
    if (proven.has(i)) return { ...s, status: "sent" };
    // Reservierung ohne jedes Ergebnis: nach 30 Minuten ist sie nicht mehr
    // "läuft gerade", sondern hängen geblieben.
    if (normalize(s.status) === "pending" && now - new Date(s.at || 0).getTime() > STALE_CLAIM_MS) {
      return { ...s, status: "stuck" };
    }
    return s;
  });

  return [...resolvedSends, ...stuck].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}
