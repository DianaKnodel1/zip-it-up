// Zentrale Versand-Kontrolle für ALLE E-Mail-Funktionen.
//
// Ziel: kein Versand darf die SMTP-Grenzen des Vertrags reißen (150/h, 2.400/Tag
// pro Tenant) und jede Entscheidung muss im zentralen Log `email_send_log`
// sichtbar sein — auch wenn NICHT gesendet wurde ("skipped" mit Grund).
//
// Reminder/Kampagnen: Sendefenster 06–22 Uhr + Stunden-/Tageskontingent.
// Transaktional (Bestätigung, Reset, Terminbestätigung, Einladung): nur
// Stunden-/Tageskontingent — diese Mails erwartet der Empfänger sofort.

import {
  MAX_PER_1H_PER_TENANT,
  MAX_PER_24H_PER_TENANT,
  SEND_WINDOW_END_HOUR,
  SEND_WINDOW_START_HOUR,
} from "./limits.ts";

/** Status-Werte, die als echter Versand gegen die Kontingente zählen. */
const COUNTING_STATUSES = ["sent", "pending", "bounced", "complained"];

// "appointment" = terminbezogene Erinnerung (z.B. 30 Min vor dem Interview).
// Sie gehört zum gebuchten Termin, den der Empfänger genau zu dieser Uhrzeit
// erwartet — deshalb KEIN 06–22-Uhr-Sendefenster, aber weiterhin die
// Stunden-/Tageskontingente.
// "critical" = Mail, ohne die der Bewerber den Prozess nicht fortsetzen kann
// (Terminbestätigung, Interview-Link). Diese Mails werden NIE durch Sendefenster
// oder Kontingente blockiert — ein blockierter Interview-Link bedeutet garantiert
// einen No-Show. Sie werden lediglich mit einem Hinweis protokolliert.
export type SendKind = "transactional" | "reminder" | "appointment" | "critical";

export interface AllowanceResult {
  allowed: boolean;
  /** Maschinenlesbarer Grund, landet als skip_reason im Log. */
  reason?: "outside_send_window" | "tenant_1h_cap" | "tenant_24h_cap" | "mailless_mode";
  count1h: number;
  count24h: number;
  /** true = Limit war erreicht, wurde für eine kritische Mail bewusst ignoriert. */
  overLimit?: boolean;
}

/**
 * Mail-los-Modus: Der Bewerber-Funnel läuft ohne eine einzige Mail
 * (Calendly übernimmt Termin-Mail/SMS, Interview-Zugang über /bewerbung,
 * Registrierung direkt nach der Zusage). Steht der Schalter am Tenant auf
 * true, wird NICHTS verschickt — auch keine als "critical" markierte Mail.
 * Nur Konto-Wiederherstellung (Passwort-Reset) umgeht den Schalter.
 */
export async function isMaillessTenant(admin: any, tenantId: string | null): Promise<boolean> {
  // HARTER RIEGEL: Das Portal verschickt grundsätzlich keine Mails mehr.
  // Terminbestätigung/Erinnerungen übernimmt Calendly, alles andere läuft
  // über /bewerbung. Weder ein Tenant-Schalter noch eine ENV-Variable kann
  // das reaktivieren – bewusst, damit kein Altbestand wieder Mails auslöst.
  return true;
}

/** Aktuelle Stunde in Europe/Berlin (unabhängig von der Server-Zeitzone). */
export function berlinHour(now: Date = new Date()): number {
  const s = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    hour12: false,
  }).format(now);
  return Number.parseInt(s, 10);
}

export function isInsideSendWindow(now: Date = new Date()): boolean {
  const h = berlinHour(now);
  return h >= SEND_WINDOW_START_HOUR && h < SEND_WINDOW_END_HOUR;
}

async function countSince(admin: any, tenantId: string | null, sinceIso: string): Promise<number> {
  let q = admin
    .from("email_send_log")
    .select("id", { count: "exact", head: true })
    .gte("created_at", sinceIso)
    .in("status", COUNTING_STATUSES);
  q = tenantId ? q.eq("tenant_id", tenantId) : q.is("tenant_id", null);
  const { count, error } = await q;
  if (error) {
    console.warn("[send-guard] count failed, treating as 0:", error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Prüft, ob für diesen Tenant jetzt gesendet werden darf.
 * Fehler beim Zählen blockieren nie den Versand (fail-open) — sonst würden
 * transaktionale Mails wegen eines Log-Problems ausfallen.
 */
export async function checkSendAllowance(
  admin: any,
  tenantId: string | null,
  kind: SendKind,
  now: Date = new Date(),
  opts?: { bypassMailless?: boolean },
): Promise<AllowanceResult> {
  // Kein Bypass mehr: auch "critical" und Passwort-Reset senden nichts.
  void opts;
  if (await isMaillessTenant(admin, tenantId)) {
    return { allowed: false, reason: "mailless_mode", count1h: 0, count24h: 0 };
  }
  const count1h = await countSince(admin, tenantId, new Date(now.getTime() - 3600_000).toISOString());
  const count24h = await countSince(admin, tenantId, new Date(now.getTime() - 24 * 3600_000).toISOString());

  if (kind === "critical") {
    const overLimit = count1h >= MAX_PER_1H_PER_TENANT || count24h >= MAX_PER_24H_PER_TENANT;
    if (overLimit) {
      console.warn("[send-guard] critical mail sent despite cap", { tenantId, count1h, count24h });
    }
    return { allowed: true, count1h, count24h, overLimit };
  }

  if (kind === "reminder" && !isInsideSendWindow(now)) {
    return { allowed: false, reason: "outside_send_window", count1h, count24h };
  }
  if (count1h >= MAX_PER_1H_PER_TENANT) {
    return { allowed: false, reason: "tenant_1h_cap", count1h, count24h };
  }
  if (count24h >= MAX_PER_24H_PER_TENANT) {
    return { allowed: false, reason: "tenant_24h_cap", count24h, count1h };
  }
  return { allowed: true, count1h, count24h };
}

export interface LogParams {
  admin: any;
  tenantId: string | null;
  templateName: string;
  recipient: string;
  status: "sent" | "failed" | "skipped";
  subject?: string | null;
  html?: string | null;
  senderEmail?: string | null;
  error?: string | null;
  messageId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Einheitlicher Log-Schreiber. Jede Funktion nutzt ihn für JEDEN Ausgang —
 * gesendet, fehlgeschlagen oder übersprungen. Log-Fehler sind nie fatal.
 */
export async function logEmailEvent(p: LogParams): Promise<void> {
  try {
    await p.admin.from("email_send_log").insert({
      message_id: p.messageId ?? null,
      tenant_id: p.tenantId,
      template_name: p.templateName,
      recipient_email: p.recipient,
      status: p.status,
      error_message: p.error ?? null,
      rendered_subject: p.subject ?? null,
      rendered_html: p.html ?? null,
      sender_email: p.senderEmail ?? null,
      metadata: p.metadata ?? null,
    });
  } catch (e) {
    console.warn("[send-guard] email_send_log insert skipped:", (e as any)?.message ?? e);
  }
}

/**
 * Komfort-Wrapper: prüft das Kontingent und protokolliert eine Blockade
 * direkt als "skipped" inkl. Grund und Zählerstand.
 */
export async function guardSend(opts: {
  admin: any;
  tenantId: string | null;
  templateName: string;
  recipient: string;
  kind: SendKind;
  senderEmail?: string | null;
  metadata?: Record<string, unknown>;
  now?: Date;
  /** Nur für Konto-Wiederherstellung (Passwort-Reset). */
  bypassMailless?: boolean;
}): Promise<AllowanceResult> {
  const res = await checkSendAllowance(opts.admin, opts.tenantId, opts.kind, opts.now ?? new Date(), {
    bypassMailless: opts.bypassMailless,
  });
  if (!res.allowed) {
    await logEmailEvent({
      admin: opts.admin,
      tenantId: opts.tenantId,
      templateName: opts.templateName,
      recipient: opts.recipient,
      status: "skipped",
      senderEmail: opts.senderEmail ?? null,
      error: res.reason === "mailless_mode"
        ? "Mail-los-Modus aktiv – Versand bewusst deaktiviert"
        : `Versand blockiert: ${res.reason}`,
      metadata: {
        ...(opts.metadata ?? {}),
        skip_reason: res.reason,
        count_1h: res.count1h,
        count_24h: res.count24h,
        limit_1h: MAX_PER_1H_PER_TENANT,
        limit_24h: MAX_PER_24H_PER_TENANT,
      },
    });
  }
  return res;
}
