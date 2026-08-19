// Automatische Auftragszuweisung für Termine.
// Regel: ein Mitarbeiter erhält dieselbe Auftragsvorlage NIE doppelt.
// Diese Datei enthält die reine Planungslogik (Client + Cron nutzen sie gemeinsam).
import { supabase } from "@/integrations/supabase/client";

export interface AutoAssignSlot {
  id: string;
  userId: string | null;
  assignmentId: string | null;
  dateStr: string;
  timeStr: string;
}

export interface AutoAssignment { user_id: string; task_template_id: string }
export interface AutoTemplate { id: string; is_active: boolean; assignment_mode?: string | null }

/** Nur Vorlagen, die automatisch verteilt werden dürfen. */
export function autoEligibleTemplates(templates: AutoTemplate[]): AutoTemplate[] {
  return templates.filter((t) => t.is_active && (t.assignment_mode ?? "auto") !== "manuell");
}

/** Schlüssel für den Dubletten-Schutz. */
export function assignmentKey(userId: string, templateId: string) {
  return `${userId}::${templateId}`;
}

/** Plant, welche Vorlage welchem Termin zugewiesen würde – ohne Dubletten. */
export function planAutoAssignments(
  slots: AutoAssignSlot[],
  assignments: AutoAssignment[],
  templates: AutoTemplate[],
): { slot: AutoAssignSlot; templateId: string }[] {
  const active = autoEligibleTemplates(templates);
  // Zählt ALLE bestehenden Zuweisungen des Mitarbeiters – auch aus vergangenen
  // Terminen und manuell angelegte.
  const taken = new Set(assignments.map((a) => assignmentKey(a.user_id, a.task_template_id)));
  const plan: { slot: AutoAssignSlot; templateId: string }[] = [];

  for (const slot of slots) {
    if (!slot.userId || slot.assignmentId) continue;
    const next = active.find((t) => !taken.has(assignmentKey(slot.userId!, t.id)));
    if (!next) continue;
    taken.add(assignmentKey(slot.userId, next.id));
    plan.push({ slot, templateId: next.id });
  }
  return plan;
}

/** Führt den Plan aus: Zuweisung anlegen + Termin verknüpfen. */
export async function runAutoAssignments(
  plan: { slot: AutoAssignSlot; templateId: string }[],
): Promise<{ created: number; failed: number }> {
  let created = 0;
  let failed = 0;

  for (const { slot, templateId } of plan) {
    const releaseAt = slot.dateStr
      ? new Date(`${slot.dateStr}T${slot.timeStr || "09:00"}`).toISOString()
      : null;

    const { data, error } = await supabase
      .from("task_assignments")
      .insert({
        user_id: slot.userId!,
        task_template_id: templateId,
        status: "zugewiesen",
        release_at: releaseAt,
        assignment_group: "automatisch",
        auto_assigned_at: new Date().toISOString(),
      } as any)
      .select("id")
      .single();

    if (error || !data) { failed++; continue; }
    created++;
    await supabase.from("bookings").update({ assignment_id: data.id }).eq("id", slot.id);
  }

  return { created, failed };
}
