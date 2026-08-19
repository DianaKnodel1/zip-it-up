type Result = { ok: boolean; reason?: string; to?: string };

const isOpaqueKey = (key: string) => key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");

export async function resendBookingConfirmationMail(applicationId: string): Promise<Result> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: appointment, error } = await supabaseAdmin
    .from("interview_appointments")
    .select("id, application_id")
    .eq("application_id", applicationId)
    .eq("status", "scheduled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !appointment) {
    return { ok: false, reason: error?.message ?? "Kein aktiver Termin gefunden" };
  }

  const { data: application } = await supabaseAdmin
    .from("applications")
    .select("email")
    .eq("id", appointment.application_id)
    .maybeSingle();

  const supabaseUrl = (process.env["SUPABASE_URL"] ?? process.env["API_EXTERNAL_URL"] ?? "").replace(/\/+$/, "");
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["SERVICE_ROLE_KEY"] ?? "";
  if (!supabaseUrl || !serviceKey) return { ok: false, reason: "Mail-Dienst ist nicht konfiguriert" };

  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: serviceKey };
  if (!isOpaqueKey(serviceKey)) headers.Authorization = `Bearer ${serviceKey}`;

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-booking-confirmation`, {
      method: "POST",
      headers,
      body: JSON.stringify({ appointment_id: appointment.id, force_resend: true }),
    });
    const text = await response.text();
    let payload: any = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    if (!response.ok || payload?.error) {
      return { ok: false, reason: String(payload?.error ?? `Mail-Dienst antwortete mit ${response.status}`).slice(0, 300) };
    }
    if ((payload?.sent ?? 0) < 1) {
      const first = Array.isArray(payload?.results) ? payload.results[0] : null;
      return { ok: false, reason: String(first?.error ?? first?.reason ?? "Terminbestätigung wurde nicht versendet") };
    }
    return { ok: true, to: application?.email ?? undefined };
  } catch (cause) {
    return { ok: false, reason: String(cause instanceof Error ? cause.message : cause).slice(0, 300) };
  }
}