// KI-Antwortvorschlag für den Admin-Chat.
// Der Schreibstil wird automatisch aus den eigenen bisherigen Nachrichten
// erkannt – es muss nichts eingestellt oder gespeichert werden.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getAiSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({
    userId: z.string(),
    lastMessage: z.string().max(4000),
    context: z.array(z.object({ role: z.string(), content: z.string() })).optional(),
    teamLeaderName: z.string().optional(),
  }).parse(data))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { callGateway } = await import("./interview-engine.server");
    const { analyzeStyle } = await import("./chat-style.server");

    const recruiterName = data.teamLeaderName || "Teamleiter";

    // Eigene bisherige Nachrichten an genau diesen Mitarbeiter (Stilquelle).
    const { data: own } = await db
      .from("chat_messages")
      .select("message, created_at")
      .eq("sender_id", context.userId)
      .eq("receiver_id", data.userId)
      .order("created_at", { ascending: false })
      .limit(30);

    let samples: string[] = ((own ?? []) as any[]).map((m) => String(m.message ?? "")).filter(Boolean);

    // Neuer Mitarbeiter → allgemeiner Stil aus anderen Chats.
    if (samples.length < 3) {
      const { data: general } = await db
        .from("chat_messages")
        .select("message")
        .eq("sender_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(30);
      samples = [...samples, ...((general ?? []) as any[]).map((m) => String(m.message ?? ""))].filter(Boolean);
    }

    const style = analyzeStyle(samples);

    // Konkreter Kontext des Mitarbeiters, damit der Vorschlag echte Fragen
    // beantworten kann statt allgemein zu bleiben.
    const contextLines: string[] = [];
    try {
      const { data: prof } = await db
        .from("profiles")
        .select("full_name, onboarding_status, status, contract_signed_at, tenant_id")
        .eq("user_id", data.userId)
        .maybeSingle();
      if (prof) {
        contextLines.push(`Name: ${prof.full_name ?? "unbekannt"}`);
        contextLines.push(`Onboarding: ${prof.onboarding_status ?? "offen"} · Status: ${prof.status ?? "offen"}`);
        contextLines.push(`Vertrag unterschrieben: ${prof.contract_signed_at ? "ja" : "nein"}`);
      }

      const { data: assignments } = await db
        .from("task_assignments")
        .select("status, created_at, release_at, task_templates(title)")
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(5);
      for (const a of (assignments ?? []) as any[]) {
        const title = a?.task_templates?.title ?? "Auftrag";
        contextLines.push(`Auftrag "${title}": Status ${a.status}${a.release_at ? `, freigeschaltet ab ${a.release_at}` : ""}`);
      }

      const { data: booking } = await db
        .from("bookings")
        .select("booking_date, booking_time, status")
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(1);
      const b = ((booking ?? []) as any[])[0];
      if (b) contextLines.push(`Nächster Termin: ${b.booking_date ?? "?"} ${b.booking_time ?? ""} (${b.status})`);
    } catch (e) {
      console.warn("[AI Suggestion] Kontext unvollständig", e);
    }

    // Gepflegte Wissensbasis (FAQ) – nur aktive Einträge.
    let faqBlock = "";
    try {
      const { data: faq } = await db
        .from("chat_faq")
        .select("question, answer")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .limit(15);
      faqBlock = ((faq ?? []) as any[])
        .map((f) => `F: ${String(f.question).slice(0, 200)}\nA: ${String(f.answer).slice(0, 500)}`)
        .join("\n---\n");

    } catch {
      faqBlock = "";
    }

    // Frühere Korrekturen als Lernbeispiele.
    const { data: corrections } = await db
      .from("ai_style_corrections")
      .select("suggestion, final_text")
      .eq("author_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(5);

    const correctionBlock = ((corrections ?? []) as any[])
      .map((c) => `Vorschlag: ${String(c.suggestion).slice(0, 400)}\nDeine Fassung: ${String(c.final_text).slice(0, 400)}`)
      .join("\n---\n");

    const systemPrompt = `Du formulierst einen Antwortvorschlag für den Teamleiter im Mitarbeiterportal.

DEINE AUFGABE:
- Unterstütze den Teamleiter dabei, auf die letzte Nachricht des Mitarbeiters zu reagieren.
- Analysiere die Nachricht des Mitarbeiters und schlage eine passende, hilfreiche Antwort im Stil des Teamleiters vor.

ERKANNTER SCHREIBSTIL (automatisch aus bisherigen Nachrichten abgeleitet):
- Anrede: ${style.anrede}
- Durchschnittliche Länge: ${style.avgLength} Zeichen, typisch ${style.sentenceStyle}
- Begrüßung: ${style.greeting}
- Grußformel: ${style.closing}
- Emojis: ${style.emojis ? "werden sparsam verwendet" : "werden nicht verwendet"}

STILBEISPIELE (so schreibt der Teamleiter wirklich):
${style.examples.map((e) => `- ${e}`).join("\n") || "- (noch keine Beispiele vorhanden)"}

${contextLines.length ? `AKTUELLER STAND DES MITARBEITERS (nur nutzen, wenn es zur Frage passt):\n${contextLines.join("\n")}\n` : ""}
${faqBlock ? `WISSENSBASIS (verbindliche Antworten des Teamleiters):\n${faqBlock}\n` : ""}
${correctionBlock ? `FRÜHERE KORREKTUREN – lerne daraus:\n${correctionBlock}\n` : ""}
REGELN:
- Übernimm Anrede, Ton und Länge exakt aus dem erkannten Stil.
- Bleibe sachlich hilfreich; bei Bank-Aufträgen (Consorsbank, DKB, Deutsche Bank, Santander, comdirect) nur fachliche Hinweise.
- Erwähne NIEMALS technische Hintergründe, Automatisierung, IP-Adressen oder Netzwerkthemen.
- Der Text wird vom Teamleiter persönlich gesendet: schreibe in der Ich-Form des Teamleiters.
- Bezeichne dich NIEMALS als KI, Assistent oder Bot und erwähne keine automatische Erstellung.
- Nutze die Wissensbasis wörtlich sinngemäß, wenn die Frage dazu passt; erfinde keine Fakten.
- Antworte NUR mit dem Antworttext, ohne Einleitung oder Kommentar.`;

    const msgs = [
      { role: "system", content: systemPrompt },
      ...(data.context || []),
      { role: "user", content: data.lastMessage },
    ];

    try {
      const suggestion = await callGateway(msgs);
      return { suggestion: suggestion.trim(), style: style.anrede };
    } catch (e: any) {
      console.error("[AI Suggestion] Error:", e);
      return { suggestion: "", style: style.anrede, error: "Vorschlag konnte nicht erstellt werden." };
    }
  });

/** Merkt sich still, wie du den Vorschlag angepasst hast. */
export const logAiCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({
    targetUserId: z.string(),
    suggestion: z.string().max(4000),
    finalText: z.string().max(4000),
  }).parse(data))
  .handler(async ({ data, context }) => {
    const a = data.suggestion.trim();
    const b = data.finalText.trim();
    if (!a || !b || a === b) return { ok: true, stored: false };
    const db = context.supabase as any;
    await db.from("ai_style_corrections").insert({
      author_id: context.userId,
      target_user_id: data.targetUserId,
      suggestion: a,
      final_text: b,
    });
    return { ok: true, stored: true };
  });
