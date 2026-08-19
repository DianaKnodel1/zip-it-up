// Automatischer Nachversand ("Retry-Warteschlange").
//
// Wird von der bestehenden Function `email-resend` im Modus
// { retry_queue: true } ausgeführt (Cron alle 10 Minuten) — dadurch braucht es
// keine zusätzliche Edge Function und der Versandweg bleibt identisch mit dem
// manuellen "Erneut senden".
//
// Wiederholt werden ausschließlich Mails, deren Ursache VORÜBERGEHEND war:
// SMTP-Timeout/Verbindung, Stundenlimit, damals aktive Mail-Pause, Sendefenster.
// Grundlage ist das gespeicherte rendered_html/rendered_subject im email_send_log.

import { sendMailWithRetry, describeSmtpError } from "./smtp.ts";
import { loadTenantForSend } from "./sender-resolver.ts";
import { guardSend, type SendKind } from "./send-guard.ts";

/** Mails mit ablaufendem Link dürfen nie blind wiederholt werden. */
const TOKEN_TEMPLATES = new Set([
  "signup_confirmation",
  "signup_confirmation_resend",
  "password_reset",
  "reminder_confirm_email",
  "bewerbung_magic_link",
]);

const REMINDER_PREFIXES = ["reminder_", "vermittlung_", "fasttrack_"];

export const MAX_ATTEMPTS = 5;
/** Backoff je Versuch in Minuten. */
const BACKOFF_MIN = [10, 30, 120, 360, 720];
export const MAX_AGE_HOURS = 72;
const DEFAULT_LIMIT = 40;
/**
 * Karenzzeit für `pending`: eine gerade erst beanspruchte Mail (Claim vor dem
 * SMTP-Versand) darf nicht sofort wiederholt werden — sonst geht sie doppelt
 * raus, während der Erstversand noch läuft.
 */
const PENDING_GRACE_MIN = 30;

export interface RetryRow {
  id: string;
  tenant_id: string | null;
  template_name: string;
  recipient_email: string | null;
  rendered_subject: string | null;
  rendered_html: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
  error_message: string | null;
  created_at: string;
  retry_count: number | null;
  next_retry_at: string | null;
  retry_locked_until: string | null;
}

export const RETRY_SELECT =
  "id, tenant_id, template_name, recipient_email, rendered_subject, rendered_html, metadata, status, error_message, created_at, retry_count, next_retry_at, retry_locked_until, acknowledged_at";

function sendKindFor(template: string): SendKind {
  if (template.startsWith("interview_") || template.includes("appointment")) return "appointment";
  if (REMINDER_PREFIXES.some((p) => template.startsWith(p)) && !template.includes("booking_confirmation")) {
    return "reminder";
  }
  return "transactional";
}

/**
 * Entscheidet, ob eine Log-Zeile automatisch wiederholt werden darf.
 * Dauerhafte Fehler (Adresse ungültig, Anmeldung abgelehnt) bleiben bewusst
 * als manuelle Aufgabe stehen.
 */
export function retryDecision(row: {
  status: string;
  template_name: string;
  error_message?: string | null;
  metadata?: Record<string, unknown> | null;
}): { retryable: boolean; reason: string } {
  const tpl = row.template_name ?? "";
  if (TOKEN_TEMPLATES.has(tpl)) return { retryable: false, reason: "token_template" };

  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  if (meta.is_test === true) return { retryable: false, reason: "test_mail" };

  const skip = String(meta.skip_reason ?? "");
  const err = `${row.error_message ?? ""}`.toLowerCase();

  const permanent = [
    "invalid login", "535", "eauth", "authentication failed",
    "550", "553", "mailbox unavailable", "user unknown", "no such user",
    "recipient address rejected", "does not exist", "gesperrt",
  ];
  if (permanent.some((p) => err.includes(p))) return { retryable: false, reason: "permanent_error" };

  if (skip) {
    const transientSkips = [
      "tenant_1h_cap", "tenant_24h_cap", "outside_send_window",
      "tenant_emails_paused", "smtp_incomplete", "tenant_inactive",
    ];
    if (transientSkips.some((s) => skip.startsWith(s))) return { retryable: true, reason: skip };
    return { retryable: false, reason: `skip:${skip}` };
  }

  if (row.status === "pending") return { retryable: true, reason: "smtp_hourly_rate_limit" };

  const transient = [
    "timeout", "etimedout", "greeting", "econnrefused", "econnreset", "esocket",
    "enotfound", "socket close", "connection closed", "451", "rate limit",
    "too many messages", "try again later", "pausiert", "blockiert",
  ];
  if (transient.some((p) => err.includes(p))) return { retryable: true, reason: "transient_smtp" };

  if (row.status === "failed" && !err) return { retryable: true, reason: "unknown_transient" };
  return { retryable: false, reason: "not_retryable" };
}

export interface RetryRunOptions {
  dryRun?: boolean;
  limit?: number;
  tenantId?: string | null;
  logId?: string | null;
}

/** Stabile Kennung eines Nachversands — bewusst OHNE Zeitstempel, damit der
 *  Unique-Index in der Datenbank einen zweiten identischen Versand ablehnt. */
function retryKey(rowId: string): string {
  return `retry:${rowId}`;
}

/**
 * Prüft, ob dieselbe Mail (Empfänger + Vorlage) nachweislich schon zugestellt
 * wurde — z. B. wenn der SMTP-Versand geklappt hat, das Ergebnis aber nicht
 * mehr ins Log geschrieben werden konnte und die Zeile auf `pending` stehen
 * blieb.
 */
async function alreadyDelivered(admin: any, row: RetryRow): Promise<boolean> {
  const to = String(row.recipient_email ?? "").toLowerCase();
  if (!to) return false;
  const { data, error } = await admin
    .from("email_send_log")
    .select("id")
    .eq("status", "sent")
    .eq("template_name", row.template_name)
    .ilike("recipient_email", to)
    .gte("created_at", row.created_at)
    .neq("id", row.id)
    .limit(1);
  if (error) return false; // fail-open: lieber prüfen als blockieren
  return (data ?? []).length > 0;
}

function isUniqueViolation(err: any): boolean {
  const code = String(err?.code ?? "");
  const msg = `${err?.message ?? ""}`.toLowerCase();
  return code === "23505" || msg.includes("duplicate key") || msg.includes("unique constraint");
}

export async function runRetryQueue(admin: any, opts: RetryRunOptions = {}) {
  const dryRun = opts.dryRun === true;
  const limit = Math.min(Number(opts.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 200);
  const logId = opts.logId ?? null;
  const nowIso = new Date().toISOString();
  const sinceIso = new Date(Date.now() - MAX_AGE_HOURS * 3600_000).toISOString();

  let q = admin
    .from("email_send_log")
    .select(RETRY_SELECT)
    .in("status", ["pending", "failed", "skipped"])
    .is("acknowledged_at", null)
    .gte("created_at", sinceIso)
    .lt("retry_count", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(logId ? 1 : limit * 3);

  if (logId) q = q.eq("id", logId);
  if (opts.tenantId) q = q.eq("tenant_id", opts.tenantId);

  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);

  const results: Record<string, unknown>[] = [];
  let sent = 0, failed = 0, waiting = 0, considered = 0;

  for (const row of ((rows ?? []) as RetryRow[])) {
    if (results.length >= limit) break;

    if (!logId) {
      if (row.next_retry_at && row.next_retry_at > nowIso) continue;
      if (row.retry_locked_until && row.retry_locked_until > nowIso) continue;
    }

    const decision = retryDecision(row);
    if (!decision.retryable) continue;
    if (!row.rendered_html || !row.rendered_subject || !row.recipient_email) continue;

    // `pending` = Anspruch vor dem Versand. Erst nach Karenzzeit und nur, wenn
    // die Mail nachweislich nicht doch schon rausging.
    if (row.status === "pending" && !logId) {
      const ageMin = (Date.now() - new Date(row.created_at).getTime()) / 60_000;
      if (ageMin < PENDING_GRACE_MIN) continue;
    }
    if (!dryRun && (await alreadyDelivered(admin, row))) {
      await admin.from("email_send_log").update({
        status: row.status === "pending" ? "superseded" : row.status,
        acknowledged_at: new Date().toISOString(),
        retry_locked_until: null,
        next_retry_at: null,
        retry_reason: "already_delivered",
      }).eq("id", row.id);
      results.push({ id: row.id, to: row.recipient_email, status: "already_delivered" });
      continue;
    }

    considered++;
    if (dryRun) {
      results.push({ id: row.id, to: row.recipient_email, template: row.template_name, reason: decision.reason, status: "would_retry" });
      continue;
    }

    // Laufsperre — verhindert Doppelversand bei überlappenden Läufen.
    const lockUntil = new Date(Date.now() + 5 * 60_000).toISOString();
    const { data: locked } = await admin
      .from("email_send_log")
      .update({ retry_locked_until: lockUntil, retry_reason: decision.reason })
      .eq("id", row.id)
      .or(`retry_locked_until.is.null,retry_locked_until.lt.${nowIso}`)
      .select("id")
      .maybeSingle();
    if (!locked) continue;

    const markFailed = async (msg: string, hard = false) => {
      const attempts = (row.retry_count ?? 0) + 1;
      const dead = hard || attempts >= MAX_ATTEMPTS;
      const wait = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
      await admin.from("email_send_log").update({
        retry_count: attempts,
        retry_locked_until: null,
        retry_reason: decision.reason,
        next_retry_at: dead ? null : new Date(Date.now() + wait * 60_000).toISOString(),
        error_message: msg.slice(0, 500),
        ...(dead ? { status: "dlq" } : {}),
      }).eq("id", row.id);
      failed++;
      results.push({ id: row.id, to: row.recipient_email, status: dead ? "dlq" : "retry_scheduled", attempts, error: msg.slice(0, 200) });
    };

    const postpone = async (reason: string, waitMin: number) => {
      await admin.from("email_send_log").update({
        retry_locked_until: null,
        retry_reason: reason,
        next_retry_at: new Date(Date.now() + waitMin * 60_000).toISOString(),
      }).eq("id", row.id);
      waiting++;
      results.push({ id: row.id, to: row.recipient_email, status: "waiting", reason });
    };

    const tenantId: string | null =
      row.tenant_id ?? ((row.metadata as any)?.resolved_tenant_id ?? (row.metadata as any)?.tenant_id ?? null);
    if (!tenantId) { await markFailed("Kein Mandant am Log-Eintrag hinterlegt", true); continue; }

    const to = String(row.recipient_email).toLowerCase();
    const [{ data: suppressed }, { data: recFail }] = await Promise.all([
      admin.from("suppressed_emails").select("email").ilike("email", to).maybeSingle(),
      admin.from("email_recipient_failures").select("suppressed_at").eq("recipient_email", to).maybeSingle(),
    ]);
    if (suppressed || (recFail as any)?.suppressed_at) {
      await markFailed("Empfänger ist gesperrt — kein automatischer Nachversand", true);
      continue;
    }

    const { tenant, reason } = await loadTenantForSend(admin, tenantId);
    if (!tenant) { await postpone(`tenant_blocked:${reason}`, 30); continue; }

    const allowance = await guardSend({
      admin,
      tenantId,
      templateName: row.template_name,
      recipient: row.recipient_email,
      kind: sendKindFor(row.template_name ?? ""),
      metadata: { source: "email-retry-queue", retried_from: row.id },
    });
    if (!allowance.allowed) {
      await postpone(`allowance:${allowance.reason}`, allowance.reason === "outside_send_window" ? 60 : 20);
      continue;
    }

    const senderName = tenant.sender_name ?? tenant.name;
    const senderEmail = tenant.sender_email ?? tenant.smtp_username;

    try {
      await sendMailWithRetry(tenant as any, {
        from: `"${senderName}" <${senderEmail}>`,
        to: row.recipient_email,
        replyTo: tenant.reply_to_email ?? senderEmail,
        subject: row.rendered_subject,
        html: row.rendered_html,
      }, { label: "email-retry-queue" });
    } catch (e) {
      await markFailed(describeSmtpError(e));
      continue;
    }

    const { error: insertErr } = await admin.from("email_send_log").insert({
      tenant_id: tenantId,
      template_name: row.template_name,
      recipient_email: row.recipient_email,
      status: "sent",
      rendered_subject: row.rendered_subject,
      rendered_html: row.rendered_html,
      sender_email: senderEmail,
      metadata: {
        ...((row.metadata as any) ?? {}),
        // Eigener, stabiler Ereignis-Schlüssel: der Schlüssel des Originals
        // darf nicht kopiert werden (Unique-Index), ein Zeitstempel würde den
        // Schutz aushebeln.
        event_key: retryKey(row.id),
        source: "email-retry-queue",
        retried_from: row.id,
        retry_reason: decision.reason,
        resend_nonce: retryKey(row.id),
      },
    });
    if (insertErr && !isUniqueViolation(insertErr)) {
      console.warn("[retry-queue] Log-Eintrag fehlgeschlagen:", insertErr.message);
    }

    await admin.from("email_send_log").update({
      status: row.status === "pending" ? "superseded" : row.status,
      acknowledged_at: new Date().toISOString(),
      retry_locked_until: null,
      next_retry_at: null,
      retry_count: (row.retry_count ?? 0) + 1,
      retry_reason: decision.reason,
    }).eq("id", row.id);

    sent++;
    results.push({ id: row.id, to: row.recipient_email, template: row.template_name, status: "sent" });
  }

  return { candidates: (rows ?? []).length, considered, sent, failed, waiting, dry_run: dryRun, results };
}