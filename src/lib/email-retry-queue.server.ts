// Server-seitiger Aufruf der Nachversand-Warteschlange (Modus der bestehenden
// Edge Function `email-resend`).

const isOpaqueKey = (key: string) => key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");

export async function callRetryQueue(payload: Record<string, unknown>) {
  const supabaseUrl = (process.env["SUPABASE_URL"] ?? process.env["API_EXTERNAL_URL"] ?? "").replace(/\/+$/, "");
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["SERVICE_ROLE_KEY"] ?? "";
  if (!supabaseUrl || !serviceKey) {
    return { ok: false as const, error: "Mail-Dienst ist nicht konfiguriert" };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: serviceKey };
  if (!isOpaqueKey(serviceKey)) headers.Authorization = `Bearer ${serviceKey}`;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/email-resend`, {
      method: "POST",
      headers,
      body: JSON.stringify({ retry_queue: true, ...payload }),
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok || data?.error) {
      return { ok: false as const, error: String(data?.error ?? `Mail-Dienst antwortete mit ${res.status}`).slice(0, 300) };
    }
    return { ok: true as const, summary: data };
  } catch (cause) {
    return { ok: false as const, error: String(cause instanceof Error ? cause.message : cause).slice(0, 300) };
  }
}