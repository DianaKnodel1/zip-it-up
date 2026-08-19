// Auftrags-Vorbereitung: erzeugt die Anleitung für den Mitarbeiter und legt
// bei Bank-Aufträgen einen echten Bot-Lauf an. Vorgangsnummern werden NIE
// erfunden – sie stammen aus dem Lauf oder werden manuell eingetragen.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const createAssignmentAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({
    assignmentId: z.string().uuid(),
    userId: z.string().uuid(),
    templateId: z.string().uuid(),
    autoRun: z.boolean().optional(),
  }).parse(data))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;

    const { data: roleData } = await db
      .from("user_roles").select("role")
      .eq("user_id", context.userId).eq("role", "admin").maybeSingle();
    if (!roleData) return { success: false, error: "Nicht autorisiert" };

    const [assignmentRes, profileRes, templateRes] = await Promise.all([
      db.from("task_assignments").select("*").eq("id", data.assignmentId).single(),
      db.from("profiles").select("*").eq("user_id", data.userId).single(),
      db.from("task_templates").select("title").eq("id", data.templateId).maybeSingle(),
    ]);

    const assignment = assignmentRes.data as any;
    const profile = profileRes.data as any;
    const template = templateRes.data as any;
    if (!assignment || !profile) return { success: false, error: "Daten nicht gefunden" };

    const email = assignment.individual_email || profile.email || "";
    const phone = assignment.individual_phone || profile.phone || "";
    const title = template?.title || "Auftrag";

    const prompt = `Erstelle die Auftrags-Anleitung für einen Mitarbeiter.

Auftrag: ${title}
Mitarbeiter: ${profile.full_name}
Zu verwendende E-Mail: ${email}
Zu verwendende Telefonnummer: ${phone || "(keine hinterlegt)"}

REGELN:
- Sprich den Mitarbeiter direkt und freundlich mit "Du" an.
- Nenne die Schritte konkret und knapp (max. 8 Schritte).
- Erwähne KEINE technischen Hintergründe, keine Automatisierung, keine IP- oder Netzwerkthemen (keine Proxys).
- Falls ein Ausweis-Check nötig ist (z. B. Deutsche Bank): Erwähne, dass er diesen selbst hochladen oder per App durchführen muss.
- Erfinde KEINE Vorgangsnummer. Diese wird im System hinterlegt, sobald der Antrag vorbereitet ist.

Antworte NUR mit JSON:
{"individual_instructions":"…","individual_hint":"…","webid_client_name":"${title}"}`;

    let generated: any = {};
    try {
      const { callGateway } = await import("./interview-engine.server");
      const raw = await callGateway([
        { role: "system", content: "Du formulierst klare, freundliche Arbeitsanweisungen auf Deutsch. Antworte in JSON." },
        { role: "user", content: prompt },
      ], { jsonMode: true });
      generated = JSON.parse(raw);
    } catch (e: any) {
      console.error("[Auftrags-Vorbereitung] KI-Fehler:", e?.message ?? e);
      return { success: false, error: "Anleitung konnte nicht erstellt werden." };
    }

    const update: Record<string, unknown> = {
      individual_instructions: generated.individual_instructions ?? assignment.individual_instructions,
      individual_hint: generated.individual_hint ?? assignment.individual_hint,
      webid_client_name: generated.webid_client_name || assignment.webid_client_name || title,
      updated_at: new Date().toISOString(),
    };

    // Bank-Aufträge starten vollautomatisch einen Lauf und bleiben bis zur
    // Freigabe im Entwurf – der Mitarbeiter sieht sie also noch nicht.
    let runId: string | null = null;
    let runNote: string | null = null;
    if (data.autoRun) {
      const { startRunForAssignmentServer } = await import("./bots.server");
      try {
        const res = await startRunForAssignmentServer(db, context.userId, data.assignmentId);
        if (res?.ok) { runId = res.run_id ?? null; update["status"] = "entwurf"; }
        else runNote = res?.error ?? null;
      } catch (e: any) {
        runNote = e?.message ?? "Bot-Lauf konnte nicht gestartet werden.";
      }
    }

    const { error: updateError } = await db
      .from("task_assignments").update(update).eq("id", data.assignmentId);
    if (updateError) return { success: false, error: updateError.message };

    return { success: true, data: { ...generated, run_id: runId, run_note: runNote } };
  });
