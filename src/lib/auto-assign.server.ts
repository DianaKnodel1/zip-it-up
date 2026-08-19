// Server-only: automatische Auftragszuweisung 15 Minuten vor Termin.
// Wird minütlich über /api/public/auto-assign-cron aufgerufen.
import { planAutoAssignments, type AutoAssignSlot } from "@/lib/auto-assign";

const WINDOW_MINUTES = 15;
const TZ = "Europe/Berlin";

/** Wandelt "YYYY-MM-DD" + "HH:mm" (Berliner Zeit) in einen echten Zeitpunkt um. */
export function berlinToUtc(dateStr: string, timeStr: string): Date {
  const naive = new Date(`${dateStr}T${(timeStr || "00:00").slice(0, 5)}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(naive);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  const offset = asUtc - naive.getTime();
  return new Date(naive.getTime() - offset);
}

function berlinDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

export async function runAutoAssignCycle(): Promise<{
  checked: number; created: number; skipped: number; failed: number;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;

  const now = new Date();
  const until = new Date(now.getTime() + WINDOW_MINUTES * 60_000);
  const days = Array.from(new Set([berlinDateStr(now), berlinDateStr(until)]));

  const { data: bookings, error } = await db
    .from("bookings")
    .select("id, user_id, assignment_id, status, booking_date, booking_time")
    .in("booking_date", days)
    .is("assignment_id", null)
    .not("user_id", "is", null);

  if (error) throw new Error(error.message);

  const candidates = (bookings ?? []).filter((b: any) => {
    if (b.status === "cancelled" || b.status === "no_show") return false;
    if (!b.booking_date) return false;
    const ts = berlinToUtc(b.booking_date, b.booking_time ?? "00:00").getTime();
    // Nur anstehende Termine im 15-Minuten-Fenster – vergangene bleiben manuell.
    return ts >= now.getTime() && ts <= until.getTime();
  });

  if (candidates.length === 0) return { checked: 0, created: 0, skipped: 0, failed: 0 };

  const userIds = Array.from(new Set(candidates.map((b: any) => b.user_id)));
  const [{ data: assignments }, { data: templates }] = await Promise.all([
    db.from("task_assignments").select("user_id, task_template_id").in("user_id", userIds),
    db.from("task_templates").select("id, is_active, assignment_mode").order("created_at", { ascending: true }),
  ]);

  const slots: AutoAssignSlot[] = candidates.map((b: any) => ({
    id: b.id,
    userId: b.user_id,
    assignmentId: null,
    dateStr: b.booking_date,
    timeStr: (b.booking_time ?? "09:00").slice(0, 5),
  }));

  const plan = planAutoAssignments(slots, (assignments ?? []) as any, (templates ?? []) as any);

  let created = 0;
  let failed = 0;

  for (const { slot, templateId } of plan) {
    // Idempotenz: kurz vor dem Insert erneut prüfen, ob inzwischen manuell
    // zugewiesen wurde – dein Plan gewinnt immer.
    const { data: fresh } = await db
      .from("bookings").select("assignment_id").eq("id", slot.id).maybeSingle();
    if (!fresh || fresh.assignment_id) continue;

    const releaseAt = berlinToUtc(slot.dateStr, slot.timeStr).toISOString();
    const { data: ins, error: insErr } = await db
      .from("task_assignments")
      .insert({
        user_id: slot.userId,
        task_template_id: templateId,
        status: "zugewiesen",
        release_at: releaseAt,
        assignment_group: "automatisch",
        auto_assigned_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insErr || !ins) { failed++; continue; }

    const { error: linkErr } = await db
      .from("bookings").update({ assignment_id: ins.id })
      .eq("id", slot.id).is("assignment_id", null);
    if (linkErr) { failed++; continue; }
    created++;
  }

  return {
    checked: candidates.length,
    created,
    skipped: candidates.length - plan.length,
    failed,
  };
}
