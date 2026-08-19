// Atomare Reservierung eines konkreten E-Mail-Ereignisses.
//
// Zwei parallele Cron-/Browser-Aufrufe dürfen dieselbe Mail nicht gleichzeitig
// übernehmen. Die Datenbank erzwingt deshalb einen eindeutigen event_key für
// status pending/sent/failed (Migration 20260808000000_email_event_claims.sql).

export type EmailClaim = {
  id: string;
  eventKey: string;
};

export async function claimEmailEvent(admin: any, input: {
  eventKey: string;
  templateName: string;
  recipient: string;
  tenantId?: string | null;
  senderEmail?: string | null;
  subject?: string | null;
  html?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<EmailClaim | null> {
  const messageId = `${input.templateName}:${input.eventKey}`;
  const { data, error } = await admin
    .from("email_send_log")
    .insert({
      message_id: messageId,
      tenant_id: input.tenantId ?? null,
      template_name: input.templateName,
      recipient_email: input.recipient,
      status: "pending",
      rendered_subject: input.subject ?? null,
      rendered_html: input.html ?? null,
      sender_email: input.senderEmail ?? null,
      metadata: { ...(input.metadata ?? {}), event_key: input.eventKey, claim: true },
    })
    .select("id")
    .maybeSingle();

  if (error || !data?.id) {
    if (error && error.code !== "23505") {
      console.warn("[send-claim] claim failed:", error.message);
    }
    return null;
  }
  return { id: data.id, eventKey: input.eventKey };
}

export async function finishEmailClaim(admin: any, claim: EmailClaim, input: {
  status: "sent" | "failed";
  error?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await admin
    .from("email_send_log")
    .update({
      status: input.status,
      error_message: input.error ?? null,
      metadata: {
        ...(input.metadata ?? {}),
        event_key: claim.eventKey,
        claim: false,
      },
    })
    .eq("id", claim.id);
  if (error) console.warn("[send-claim] finalize failed:", error.message);
}

export async function retryFailedEmailClaim(admin: any, input: {
  eventKey: string;
  metadata?: Record<string, unknown>;
}): Promise<EmailClaim | null> {
  const { data, error } = await admin
    .from("email_send_log")
    .update({
      status: "pending",
      error_message: null,
      metadata: { ...(input.metadata ?? {}), event_key: input.eventKey, claim: true },
    })
    .eq("metadata->>event_key", input.eventKey)
    .eq("status", "failed")
    .select("id")
    .maybeSingle();
  if (error) console.warn("[send-claim] retry claim failed:", error.message);
  return data?.id ? { id: data.id, eventKey: input.eventKey } : null;
}

// Reservierung wieder freigeben, wenn die Mail NICHT verschickt wurde und ein
// späterer Lauf sie erneut versuchen soll (z.B. Stundenlimit des Providers).
// 'superseded' fällt aus dem eindeutigen Index heraus, die Zeile bleibt als
// Historie erhalten.
export async function releaseEmailClaim(admin: any, claim: EmailClaim, input: {
  reason: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { data, error } = await admin
    .from("email_send_log")
    .update({
      status: "superseded",
      error_message: input.reason,
      metadata: {
        ...(input.metadata ?? {}),
        event_key: claim.eventKey,
        claim: false,
        released: true,
        release_reason: input.reason,
      },
    })
    .eq("id", claim.id)
    .select("id")
    .maybeSingle();
  if (error || !data) console.warn("[send-claim] release failed:", error?.message ?? "no row");
}

export function actionBucketEventKey(kind: string, recipient: string, now = Date.now()): string {
  const fiveMinuteBucket = Math.floor(now / (5 * 60_000));
  return `${kind}:${recipient.trim().toLowerCase()}:${fiveMinuteBucket}`;
}