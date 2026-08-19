// Gemeinsamer SMTP-Transport für alle Mailfunktionen.
//
// Warum: "Greeting never received" bedeutet, dass der Mailserver nach dem
// Verbindungsaufbau nicht innerhalb des Timeouts geantwortet hat (überlasteter
// Server, kurze Netzstörung, gedrosselter Port). Die Mail wurde in diesem Fall
// NICHT angenommen – ein erneuter Versuch erzeugt also keinen Doppelversand.
//
// Wiederholt wird ausschließlich bei reinen Verbindungsfehlern. Auth-Fehler
// (535), abgelehnte Empfänger oder Vorlagenfehler werden sofort durchgereicht.

import nodemailer from "https://esm.sh/nodemailer@6.9.14";

export interface SmtpTenantLike {
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_username?: string | null;
  smtp_password?: string | null;
}

/**
 * Transport mit robusten Timeouts + TLS-Einstellungen je nach Port.
 *
 * `timeouts` kürzt die Wartezeiten für den reinen Verbindungstest: die
 * Edge-Runtime bricht lange Aufrufe hart ab (HTTP 502 ohne JSON), dann geht
 * die eigentliche Fehlerursache verloren. Für den Versand bleiben die
 * großzügigen Standardwerte.
 */
export function createSmtpTransport(
  tenant: SmtpTenantLike,
  timeouts?: { connectionTimeout?: number; greetingTimeout?: number; socketTimeout?: number },
) {
  const port = Number(tenant.smtp_port);
  return nodemailer.createTransport({
    host: String(tenant.smtp_host),
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user: String(tenant.smtp_username), pass: String(tenant.smtp_password) },
    connectionTimeout: timeouts?.connectionTimeout ?? 20000,
    greetingTimeout: timeouts?.greetingTimeout ?? 20000,
    socketTimeout: timeouts?.socketTimeout ?? 30000,
    tls: { servername: String(tenant.smtp_host) },
  });
}

const TRANSIENT_PATTERNS = [
  "greeting never received",
  "etimedout",
  "econnection",
  "esocket",
  "econnreset",
  "econnrefused",
  "ehostunreach",
  "enotfound",
  "socket close",
  "connection closed",
  "timeout",
];

/** Nur Verbindungsprobleme sind wiederholbar – niemals Auth/Empfängerfehler. */
export function isTransientSmtpError(err: unknown): boolean {
  const raw = `${(err as any)?.code ?? ""} ${(err as any)?.message ?? err ?? ""}`.toLowerCase();
  if (raw.includes("invalid login") || raw.includes("535") || raw.includes("eauth")) return false;
  if (raw.includes("550") || raw.includes("553") || raw.includes("recipient")) return false;
  return TRANSIENT_PATTERNS.some((p) => raw.includes(p));
}

/** Technische SMTP-Meldung in verständlichen Klartext übersetzen. */
export function describeSmtpError(err: unknown): string {
  const raw = String((err as any)?.message ?? err ?? "Unbekannter Mailfehler");
  const low = raw.toLowerCase();
  if (low.includes("greeting never received")) {
    return "SMTP-Server hat nicht geantwortet (Begrüßung ausgeblieben) – Server überlastet oder Port blockiert";
  }
  if (low.includes("invalid login") || low.includes("535") || low.includes("eauth")) {
    return "SMTP-Anmeldung fehlgeschlagen – Benutzername/Passwort prüfen";
  }
  if (low.includes("etimedout") || low.includes("timeout")) {
    return "Zeitüberschreitung beim SMTP-Server – keine Antwort erhalten";
  }
  if (low.includes("econnrefused")) return "SMTP-Verbindung abgelehnt – Host/Port prüfen";
  if (low.includes("enotfound")) return "SMTP-Host nicht gefunden – Hostname prüfen";
  if (low.includes("self signed") || low.includes("certificate")) return "TLS-Zertifikat des SMTP-Servers wurde abgelehnt";
  return raw;
}

const RETRY_DELAYS_MS = [5000, 15000];

/**
 * Versendet eine Mail und wiederholt sie bei reinen Verbindungsfehlern.
 * Läuft innerhalb einer bereits gesetzten Versand-Sperre (Claim) – es entsteht
 * dadurch kein zweiter Versand derselben Mail.
 */
export async function sendMailWithRetry(
  tenant: SmtpTenantLike,
  message: Record<string, unknown>,
  opts?: { label?: string },
): Promise<{ attempts: number; messageId?: string; accepted?: unknown; response?: string }> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const transporter = createSmtpTransport(tenant);
    try {
      const info: any = await transporter.sendMail(message as any);
      if (attempt > 0) {
        console.log(`[smtp] erfolgreich nach Wiederholung${opts?.label ? ` (${opts.label})` : ""}`, { attempt: attempt + 1 });
      }
      return {
        attempts: attempt + 1,
        messageId: info?.messageId,
        accepted: info?.accepted,
        response: info?.response,
      };
    } catch (err) {
      lastErr = err;
      const retryable = isTransientSmtpError(err) && attempt < RETRY_DELAYS_MS.length;
      console.warn(`[smtp] Versand fehlgeschlagen${opts?.label ? ` (${opts.label})` : ""}`, {
        attempt: attempt + 1,
        retry: retryable,
        reason: describeSmtpError(err),
      });
      if (!retryable) break;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    } finally {
      try { (transporter as any)?.close?.(); } catch { /* ignore */ }
    }
  }
  const wrapped = new Error(describeSmtpError(lastErr));
  (wrapped as any).cause = lastErr;
  (wrapped as any).code = (lastErr as any)?.code;
  throw wrapped;
}
