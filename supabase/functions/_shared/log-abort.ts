// Zentraler Abbruch-Logger: JEDE nicht versendete Mail muss im Mail-Center
// (Tabelle email_send_log) sichtbar sein — auch wenn der Versand schon vor
// dem SMTP-Aufbau abgebrochen wurde (Routing, Tenant, SMTP-Konfig, Pause …).
//
// status:  "skipped" = bewusst unterdrückt, "failed" = technischer/Konfig-Fehler
export async function logMailAbort(
  admin: any,
  p: {
    source: string;
    templateName: string;
    recipient: string;
    tenantId?: string | null;
    status: "failed" | "skipped";
    reason: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await admin.from("email_send_log").insert({
      message_id: `${p.source}:${crypto.randomUUID()}:${p.templateName}`,
      tenant_id: p.tenantId ?? null,
      template_name: p.templateName,
      recipient_email: p.recipient || "(unbekannt)",
      status: p.status,
      error_message: String(p.reason).slice(0, 1000),
      metadata: {
        source: p.source,
        skip_reason: p.status === "skipped" ? p.reason : null,
        ...(p.metadata ?? {}),
      },
    });
  } catch (e) {
    console.warn(`[${p.source}] abort_log_failed:`, (e as any)?.message ?? e);
  }
}
