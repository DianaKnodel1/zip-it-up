import { supabase } from "@/integrations/supabase/client";

export type ResendResult =
  | { ok: true; to: string }
  | { ok: false; message: string; code?: string };

/**
 * Generischer Resend: sendet das im email_send_log gespeicherte
 * rendered_html/rendered_subject erneut über das Tenant-SMTP.
 * Funktioniert für alle Mail-Typen (Edge Function `email-resend`).
 */
export async function resendEmailLog(
  logId: string,
  opts: { to?: string; isTest?: boolean; force?: boolean } = {},
): Promise<ResendResult> {
  try {
    const { data, error } = await supabase.functions.invoke("email-resend", {
      body: { log_id: logId, to: opts.to, is_test: opts.isTest, force: opts.force },
    });
    if (error) return { ok: false, message: error.message };
    if (data?.error) return { ok: false, message: String(data.error), code: data?.code };
    return { ok: true, to: String(data?.to ?? "") };
  } catch (e: any) {
    return { ok: false, message: String(e?.message ?? e) };
  }
}

/** Templates mit ablaufenden Links — Resend schickt den ALTEN Link. */
export const TOKEN_TEMPLATES = new Set([
  "signup_confirmation",
  "signup_confirmation_resend",
  "password_reset",
  "reminder_confirm_email",
]);

export function isTokenTemplate(templateName?: string | null): boolean {
  return !!templateName && TOKEN_TEMPLATES.has(templateName);
}
