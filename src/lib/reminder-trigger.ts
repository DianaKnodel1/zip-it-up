import { supabase } from "@/integrations/supabase/client";
import { reasonLabel } from "./mail-chain";

/** Reminder-Arten, die sich aus dem Admin heraus sofort auslösen lassen. */
export type ReminderKind =
  | "interview_invite_30min"
  | "no_booking_24h"
  | "no_booking_72h"
  | "no_show_24h"
  | "registration_pending_24h"
  | "registration_pending_72h"
  | "rebook_after_cancel_24h"
  | "rebook_after_cancel_72h";

export type TriggerResult = { ok: true } | { ok: false; message: string };

/**
 * Löst eine geplante Erinnerungs-Mail sofort aus — statt auf den Cron zu warten.
 * Zeitfenster und Dedupe werden dabei bewusst übergangen (Admin-Entscheidung),
 * protokolliert wird wie bei jedem automatischen Versand.
 */
export async function triggerReminderNow(
  applicationId: string,
  kind: ReminderKind,
): Promise<TriggerResult> {
  const isAppointment = kind === "interview_invite_30min";
  const fn = isAppointment ? "send-appointment-reminders" : "send-application-reminders";
  const body = isAppointment
    ? { application_id: applicationId, force: true }
    : { application_id: applicationId, force_kind: kind };

  try {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error) return { ok: false, message: error.message };
    if (data?.error) return { ok: false, message: String(data.error) };
    if ((data?.sent ?? 0) > 0) return { ok: true };
    const first = Array.isArray(data?.results) ? data.results[0] : null;
    return { ok: false, message: first?.reason ? reasonLabel(first.reason) : "Es wurde keine Mail versendet." };
  } catch (e: any) {
    return { ok: false, message: String(e?.message ?? e) };
  }
}
