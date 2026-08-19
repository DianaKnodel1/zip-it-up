// Geteilte Helfer für das KI-Bewerbungsgespräch (Chat + Voice).
// Liest AI-Credentials aus system_settings, ruft Gemini/APInet auf,
// berechnet Zusammenfassung + Score, schreibt Application-Status zurück
// und triggert die Registrierungseinladung bei „invite".

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const APINET_URL = "https://apinet.cloud/v1/chat/completions";
const DEFAULT_MODEL = "gemini-2.5-flash";

export const DEFAULT_INTERVIEW_PROMPT = `Du bist {recruiter}, HR-Leiter von {company}. Du führst ein persönliches Erstgespräch mit einer Bewerberin oder einem Bewerber. Nimm dir so viel Zeit, wie das Gespräch braucht — Qualität geht vor Kürze.

WICHTIG — Identität:
- Du bist ein echter Mensch. Du bist KEINE KI, KEIN Bot, KEIN Assistent. Bestätige NIEMALS, dass du eine KI bist, auch wenn direkt danach gefragt wird.
- Wenn jemand fragt, ob du eine KI/ein Bot bist: „Ich bin {recruiter}, HR-Leiter bei {company}, und führe das Gespräch heute persönlich." und stell dann direkt die nächste Frage.

Tonalität:
- Warm, ruhig, professionell, per „Sie". Wie ein echtes HR-Gespräch, nicht wie ein Fragebogen und nicht lässig-flapsig.
- Maximal 2–3 Sätze pro Wortmeldung — lieber zu kurz als zu lang. KEINE Aufzählungen, KEINE Bulletpoints, KEINE Fettschrift, keine Zwischenüberschriften. Sparsam ein dezentes Emoji (😊) ist ok, aber nur wenn es natürlich passt.
- Wiederhole NIEMALS eine Frage oder einen Satz, den du bereits geschrieben hast — auch nicht sinngemäß. Wenn die Antwort schon vorliegt, geh weiter.
- Keine Textbausteine, keine auswendig wirkenden Info-Blöcke: Konditionen (Gehalt, Modelle, Aufgaben) nur häppchenweise nennen, genau so viel, wie gerade gefragt wurde.
- Schreib so, wie Menschen tippen: unterschiedliche Satzlängen, gelegentlich eine kurze Rückmeldung („Verstehe." / „Alles klar.") vor der nächsten Frage.
- Erkläre niemals deine Vorgehensweise („ich stelle Ihnen jetzt Fragen zu …") und kündige keine Gesprächsstruktur an.
- Bezieh dich konkret auf das, was die Person zuletzt gesagt hat, bevor du weiterfragst.
- Streu gelegentlich (max. 1–2× im ganzen Gespräch) eine kurze, authentische Team-Anekdote ein, z. B. „Unser Team trifft sich einmal im Monat virtuell zum Feierabend-Talk — das kommt richtig gut an." So wirkt das Gespräch menschlicher und weniger wie ein Fragebogen.
- EINE Frage pro Sprechakt. Niemals mehrere Fragen auf einmal.

Gesprächsbeginn:
- Erste Nachricht: „Guten Tag, mein Name ist {recruiter}, HR-Leiter bei {company} — vielen Dank, dass Sie sich Zeit für unser Gespräch nehmen. Erzählen Sie mir zu Beginn kurz, was Sie aktuell beruflich machen."

Bezahlung — bitte auswendig, nennen wenn die Person fragt:
- Vollzeit angestellt: 21 € pro Stunde
- Teilzeit angestellt: 19 € pro Stunde
- Minijob: 538 € im Monat (gesetzlicher Maximalbetrag, ca. 12,41 € / h)

Beschäftigungsmodell — WICHTIG:
- {company} ist Arbeitgeber und stellt fest an: Minijob, Teilzeit oder Vollzeit. KEINE Selbstständigkeit, kein Freelancing, keine Provision, kein Gewerbe.
- Frage neutral, welches Modell die Person sich vorstellt, und passe die Folgefragen an.

Themen (locker im Verlauf abdecken, nicht mechanisch abhaken):
1) Aktuelle berufliche Situation + relevante Erfahrung (Vertrieb, Beratung, Kundenkontakt, Service)
2) Beruflicher Hintergrund und Werdegang
3) Motivation für Wechsel oder Zusatzjob
4) Welches Modell (Minijob/Teilzeit/Vollzeit) und Stundenumfang
5) Arbeitsweise, Verfügbarkeit, möglicher Startzeitpunkt
6) Rückfragen des Bewerbers — aktiv anbieten und ausführlich beantworten

Regeln:
- Immer Deutsch, immer „Sie".
- Bei ausweichenden oder sehr kurzen Antworten freundlich nachhaken, auch mehrfach, wenn es zum Verständnis beiträgt.
- Rückfragen des Bewerbers sind zentral — nimm dir dafür Zeit, beantworte sie ehrlich und ausführlich, und frag danach aktiv, ob noch etwas offen ist.
- KEINE Countdown- oder Timer-Hinweise, kein starres Runden-Limit.
- Beende das Gespräch erst, wenn Situation, Motivation, Modell und Verfügbarkeit geklärt sind UND der Bewerber Gelegenheit hatte, alle eigenen Fragen zu stellen. Frag vor dem Abschluss explizit: „Bevor wir zum Abschluss kommen — haben Sie noch Fragen an mich?"
- Abschluss dann sachlich: „Vielen Dank für das offene und ausführliche Gespräch — damit habe ich alles, was ich brauche. Den Status Ihrer Bewerbung und alle weiteren Schritte finden Sie direkt hier in Ihrem Portal-Bereich."
- Nenne NIEMALS E-Mail als Kommunikationsweg für Ergebnisse. Alles läuft über das Portal.
- Nenne NIEMALS Wartezeiten wie „innerhalb von 48 Stunden", „in den nächsten Tagen" oder „wir melden uns die Woche" — die Entscheidung steht unmittelbar nach dem Gespräch fest.`;


const SUMMARY_PROMPT = `Du bist ein erfahrener Personalleiter. Bewerte das folgende Bewerbungsgespräch und triff eine klare Entscheidung.

WICHTIG — Entscheidungsregel:
- Ablehnen ("reject") NUR wenn der Bewerber KEINE Zeit hat, KEIN echtes Interesse an einer Mitarbeit zeigt oder das Gespräch nicht ernst nimmt (patzige, respektlose oder offensichtlich unsinnige Antworten).
- In ALLEN anderen Fällen: einladen ("invite"). Fehlende Erfahrung, Nervosität, kurze Antworten oder Rechtschreibfehler sind KEIN Ablehnungsgrund.
- "unsure" ist NICHT erlaubt. Es gibt nur "invite" oder "reject".

Antworte AUSSCHLIESSLICH als gültiges JSON-Objekt (keine Markdown-Codeblöcke), mit folgenden Feldern:
{
  "summary": "string (3–6 Sätze, Deutsch, neutral, fasse die Antworten zusammen + nenne Stärken/Schwächen)",
  "score": number,
  "recommendation": "invite" | "reject"
}

score = 0–100 Eignung. invite = annehmen, reject = ablehnen.`;

/** Ausgang der KI-Auswertung. Nach einem geführten Gespräch immer eindeutig. */
export type Recommendation = "invite" | "reject";

export type Msg = { role: "user" | "assistant"; text: string; ts: string };

export type ApplicationRow = {
  id: string;
  full_name: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  tenant_id?: string | null;
  status?: string | null;
  source_slug?: string | null;
  source_landing_id?: string | null;
  target_landing_id?: string | null;
  interview_messages?: unknown;
  interview_status?: string | null;
  interview_mode?: string | null;
  interview_started_at?: string | null;
};

export type InterviewContext = {
  systemPrompt: string;
  companyName: string;
  recruiterName: string;
  recruiterAvatarUrl: string | null;
  voiceId: string | null;
  interviewMode: "chat" | "voice" | "both";
  landingSlug: string | null;
  brandingFirstName: string;
};

async function loadAiCreds(): Promise<{ apiKey: string; model: string; url: string; provider: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("system_settings")
    .select("gemini_api_key, gemini_model, apinet_api_key, apinet_model")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`system_settings: ${error.message}`);
  const apinetKey = (data as any)?.apinet_api_key?.trim();
  const geminiKey = (data as any)?.gemini_api_key?.trim();
  if (apinetKey) {
    return { apiKey: apinetKey, model: (data as any)?.apinet_model?.trim() || DEFAULT_MODEL, url: APINET_URL, provider: "apinet" };
  }
  if (geminiKey) {
    return { apiKey: geminiKey, model: (data as any)?.gemini_model?.trim() || DEFAULT_MODEL, url: GEMINI_URL, provider: "gemini" };
  }
  throw new Error("Kein AI API Key gesetzt (Admin → AI Settings).");
}

export async function callGateway(
  messages: Array<{ role: string; content: string }>,
  opts?: { jsonMode?: boolean },
): Promise<string> {
  const { apiKey, model, url, provider } = await loadAiCreds();
  const isApinetNativeGemini = provider === "apinet" && /^gemini-/i.test(model);

  if (isApinetNativeGemini) {
    const systemMsgs = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    if (contents.length === 0) {
      contents.push({ role: "user", parts: [{ text: "Bitte beginne nun." }] });
    }
    const nativeUrl = `https://apinet.cloud/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const body: any = { contents };
    if (systemMsgs) body.system_instruction = { parts: [{ text: systemMsgs }] };
    if (opts?.jsonMode) body.generationConfig = { responseMimeType: "application/json" };
    const res = await fetch(nativeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey, Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`apinet-gemini ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const data = (await res.json()) as any;
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.map((p: any) => p?.text ?? "").join("") : "";
    if (!text) throw new Error("Keine AI-Antwort (apinet-gemini)");
    return text;
  }

  const body: any = { model, messages };
  if (opts?.jsonMode) body.response_format = { type: "json_object" };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${provider} ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = (await res.json()) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Keine AI-Antwort");
  return content;
}

/** Holt das JSON-Objekt aus einer Modellantwort (Codeblöcke/Vortext tolerant). */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body.trim();
}

/**
 * Notauswertung, wenn das Modell mehrfach unlesbar antwortet.
 * Es MUSS eine Entscheidung fallen — "keine Bewertung" gibt es nicht.
 * Absage nur bei klarer Ablehnung/Verweigerung, sonst Zusage.
 */
function fallbackDecision(messages: Msg[]): { summary: string; score: number; recommendation: Recommendation } {
  const answers = messages.filter((m) => m.role !== "assistant").map((m) => m.text.trim()).filter(Boolean);
  const text = answers.join(" ").toLowerCase();
  const substantial = answers.filter((a) => a.length >= 8).length;
  const refuses = /(kein interesse|keine lust|nicht interessiert|will nicht|möchte nicht|abbrechen|absage|doch nicht|keine zeit)/.test(text);
  const rec: Recommendation = refuses || substantial < 2 ? "reject" : "invite";
  return {
    summary:
      `Automatische Entscheidung ohne KI-Auswertung (Modellantwort war technisch unlesbar). ` +
      `Grundlage: ${answers.length} Antworten des Bewerbers, davon ${substantial} inhaltlich. ` +
      (rec === "reject"
        ? "Es wurde kein ernsthaftes Interesse erkennbar — Absage."
        : "Der Bewerber hat mitgewirkt und Interesse gezeigt — Zusage."),
    score: rec === "invite" ? 60 : 20,
    recommendation: rec,
  };
}

export async function runSummary(messages: Msg[]): Promise<{ summary: string; score: number; recommendation: Recommendation }> {
  const transcript = messages
    .map((m) => `${m.role === "assistant" ? "Recruiter" : "Bewerber"}: ${m.text}`)
    .join("\n");

  // Bis zu 3 Versuche: eine unlesbare Antwort darf niemals dazu führen,
  // dass ein geführtes Gespräch ohne Entscheidung bleibt.
  let lastRaw = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const strict =
        attempt === 1
          ? SUMMARY_PROMPT
          : `${SUMMARY_PROMPT}\n\nDEIN LETZTER VERSUCH WAR UNGÜLTIG. Antworte NUR mit dem reinen JSON-Objekt — kein Text davor oder danach, keine Markdown-Codeblöcke.`;
      lastRaw = await callGateway(
        [
          { role: "system", content: strict },
          { role: "user", content: `Transcript:\n\n${transcript}` },
        ],
        { jsonMode: true },
      );
      const parsed = JSON.parse(extractJson(lastRaw));
      return {
        summary: String(parsed.summary ?? "").trim() || lastRaw.slice(0, 2000),
        score: Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0))),
        // Nur eine ausdrückliche Absage lehnt ab; alles andere gilt als Zusage.
        recommendation: parsed.recommendation === "reject" ? "reject" : "invite",
      };
    } catch (e) {
      console.error(`[interview] Auswertung Versuch ${attempt} fehlgeschlagen:`, (e as any)?.message, lastRaw.slice(0, 300));
    }
  }
  return fallbackDecision(messages);
}

export const toAiDecision = (rec: Recommendation) => (rec === "reject" ? "absage" : "zusage");

export const toApplicationStatus = (rec: Recommendation) => (rec === "reject" ? "abgelehnt" : "akzeptiert");

// Manche Landing-Pages tragen als Firmenname nur die Domain („personalservice-gmbh.de").
// Im Gespräch soll trotzdem ein lesbarer Firmenname erscheinen.
export function prettifyCompanyName(raw: string): string {
  const v = raw.trim();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) || v.includes(" ")) return v;
  const base = v.replace(/^www\./i, "").replace(/\.[a-z]{2,}$/i, "");
  return base
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => (/^(gmbh|ug|ag|kg|ohg|mbh)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export async function loadInterviewContext(app: ApplicationRow): Promise<InterviewContext> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let systemPrompt = DEFAULT_INTERVIEW_PROMPT;
  let companyName = "unserem Unternehmen";
  // Universeller HR-Leiter, der die Gespräche führt.
  let recruiterName = "Martin Schneider";
  let voiceId: string | null = null;
  let interviewMode: "chat" | "voice" | "both" = "chat";
  let landingSlug: string | null = app.source_slug ?? null;
  let recruiterAvatarUrl: string | null = null;

  const sel = "id, slug, source_slug, interview_system_prompt, recruiter_avatar_url, recruiter_name, branding, interview_mode, interview_voice_id, linked_fasttrack_landing_id";
  let landing: any = null;
  if (app.source_landing_id) {
    const { data: byId } = await supabaseAdmin
      .from("landing_pages").select(sel).eq("id", app.source_landing_id).maybeSingle();
    landing = byId ?? null;
  }
  if (!landing && app.source_slug) {
    const { data: bySource } = await supabaseAdmin
      .from("landing_pages").select(sel).eq("source_slug", app.source_slug).maybeSingle();
    landing = bySource ?? null;
    if (!landing) {
      const { data: bySlug } = await supabaseAdmin
        .from("landing_pages").select(sel).eq("slug", app.source_slug).maybeSingle();
      landing = bySlug ?? null;
    }
  }

  let fasttrack: any = null;
  if (landing?.linked_fasttrack_landing_id) {
    const { data: ft } = await supabaseAdmin
      .from("landing_pages").select(sel).eq("id", landing.linked_fasttrack_landing_id).maybeSingle();
    fasttrack = ft ?? null;
  }
  if (!landing && app.target_landing_id) {
    const { data: ft } = await supabaseAdmin
      .from("landing_pages").select(sel).eq("id", app.target_landing_id).maybeSingle();
    fasttrack = ft ?? null;
  }
  // Das Gespräch führt IMMER die Fast-Track-Firma: Ist eine verknüpfte
  // Fast-Track-Landing vorhanden, hat DIESE Vorrang. Die Quell-/Vermittlungs-
  // Landing dient nur noch als Ersatz für dort nicht gepflegte Felder.
  if (landing || fasttrack) {
    const custom = fasttrack?.interview_system_prompt?.trim?.() || landing?.interview_system_prompt?.trim?.();
    if (custom) systemPrompt = custom;
    const fn = fasttrack?.branding?.firmenname?.trim?.() || landing?.branding?.firmenname?.trim?.();
    if (fn) companyName = prettifyCompanyName(fn);
    const rn =
      fasttrack?.branding?.recruiter_name?.trim?.() ||
      fasttrack?.recruiter_name?.trim?.() ||
      landing?.branding?.recruiter_name?.trim?.() ||
      landing?.recruiter_name?.trim?.();
    if (rn) recruiterName = rn;
    recruiterAvatarUrl =
      fasttrack?.recruiter_avatar_url ||
      fasttrack?.branding?.recruiter_avatar_url ||
      landing?.recruiter_avatar_url ||
      landing?.branding?.recruiter_avatar_url ||
      null;
    voiceId = fasttrack?.interview_voice_id || landing?.interview_voice_id || null;
    const mode = fasttrack?.interview_mode || landing?.interview_mode;
    if (mode === "voice" || mode === "both" || mode === "chat") interviewMode = mode;
    landingSlug = fasttrack?.slug || fasttrack?.source_slug || landing?.slug || landing?.source_slug || landingSlug;
  }

  const recruiterFirst = recruiterName.trim().split(/\s+/)[0] || recruiterName;
  const fullName = (app.full_name || "").trim();
  const brandingFirstName = app.first_name?.trim() || fullName.split(/\s+/)[0] || "";
  const candidateFirst = brandingFirstName || "";

  systemPrompt = systemPrompt
    .replace(/\{company\}/g, companyName)
    .replace(/\{recruiter\}/g, recruiterName)
    .replace(/\{firstName\}/g, candidateFirst)
    // Alte/custom Landing-Prompts enthielten Sabine teils hartcodiert statt als {recruiter}.
    .replace(/Sabine Schneider/g, recruiterName)
    .replace(/\bSabine\b/g, recruiterFirst);

  // Zusatz-Regeln: persönliche Anrede + Pacing + Support-Hinweis bei Problemen.
  const addendum = `\n\nZUSÄTZLICHE REGELN (immer beachten, überschreiben ggf. den obigen Text):\n- Beginne die ERSTE Nachricht mit „Hallo${candidateFirst ? " " + candidateFirst : ""}, schön dass Sie sich Zeit nehmen! Mein Name ist ${recruiterName}, HR-Leiter bei ${companyName}." und stelle danach genau EINE offene Frage zur aktuellen beruflichen Situation.\n- Nenne dich AUSSCHLIESSLICH ${recruiterName} und bezeichne dich als HR-Leiter (männlich). Verwende niemals einen anderen Namen (insbesondere nicht „Sabine"), auch wenn das im übrigen Text stünde.\n- Nach ca. 3–4 Fragen streue EIN kurzes Zwischen-Feedback ein, z. B. „Danke, das klingt schon sehr passend — noch 2–3 Fragen, dann sind wir durch." So weiß die Person, wo sie steht.\n- Bei technischen Problemen im Chat oder wenn Rückfragen dein Wissen übersteigen: verweise freundlich an die Personalabteilung per E-Mail (Adresse steht im Bewerber-Portal / in der Bestätigungs-E-Mail).`;
  systemPrompt = systemPrompt + addendum;

  return { systemPrompt, companyName, recruiterName, recruiterAvatarUrl, voiceId, interviewMode, landingSlug, brandingFirstName };
}

export async function sendRegistrationInviteAfterAiAccept(
  app: ApplicationRow,
  request: Request,
  opts?: { force?: boolean; source?: "ai_accept_invite" | "admin_stage_change" | "manual_resend" },
) {
  return await sendInviteInternal(app, request, opts);
}

/**
 * Portal-Basis-URL für eine Bewerbung auflösen — ausschliesslich über die
 * Fast-Track-Kette (siehe src/lib/portal-base.server.ts). Kein Fallback auf
 * den Vermittlungs-Tenant: lieber keinen Link als einen falschen.
 * `request` bleibt in der Signatur, wird aber nicht mehr als Quelle genutzt.
 */
export async function resolvePortalBase(app: ApplicationRow, _request?: Request): Promise<string | null> {
  const { resolveFasttrackPortalBase } = await import("@/lib/portal-base.server");
  const res = await resolveFasttrackPortalBase(app.id);
  if (!res.base) {
    console.warn("[interview-engine] portal_base_unresolved", { application_id: app.id, reason: res.reason });
    return null;
  }
  return res.base;
}

/** Registrierungs-Link aus einem vorhandenen Token bauen (identisch zur Mail). */
export function buildRegistrationLink(base: string, token: string, applicationId: string): string {
  return `${base.replace(/\/+$/, "")}/register?token=${encodeURIComponent(token)}&ref=${encodeURIComponent(applicationId)}`;
}

/**
 * Bereits erzeugten Registrierungs-Link einer Bewerbung nachschlagen —
 * damit der Zusage-Screen den Button auch nach einem Reload zeigen kann.
 */
export async function getExistingRegistrationLink(
  app: ApplicationRow,
  request: Request,
): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("invitation_tokens")
    .select("token, created_at")
    .eq("application_id", app.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const token = (data as any[] | null)?.[0]?.token;
  if (!token) return null;
  const base = await resolvePortalBase(app, request);
  if (!base) return null;
  return buildRegistrationLink(base, String(token), app.id);
}

/**
 * Ergebnis eines Einladungs-Versuchs protokollieren — an der Bewerbung UND
 * (bei Fehlschlag/Übersprungen) im zentralen E-Mail-Protokoll. Öffentlich,
 * damit auch Abbrüche ausserhalb dieser Datei (z. B. „bereits eingeladen")
 * lückenlos in der Mail-Kette auftauchen.
 */
export async function recordInviteAttempt(
  app: { id: string; tenant_id?: string | null; email?: string | null },
  status: "sent" | "failed" | "skipped",
  error: string | null,
  source: "ai_accept_invite" | "admin_stage_change" | "manual_resend" = "ai_accept_invite",
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Einen bereits erfolgreichen Versand NIE zu "übersprungen" herabstufen —
  // sonst behaupten Diagnose und Oberfläche später fälschlich, es sei nichts
  // rausgegangen. Fehlschläge dürfen den Status weiterhin überschreiben.
  let allowed = true;
  if (status === "skipped") {
    const { data: cur } = await supabaseAdmin
      .from("applications")
      .select("invite_mail_status")
      .eq("id", app.id)
      .maybeSingle();
    if ((cur as any)?.invite_mail_status === "sent") allowed = false;
  }
  if (allowed) {
    await supabaseAdmin
      .from("applications")
      .update({ invite_mail_status: status, invite_mail_error: error, invite_mail_at: new Date().toISOString() } as any)
      .eq("id", app.id)
      .then(() => {}, (e: any) => console.warn("[interview-engine] invite status update:", e?.message ?? e));
  }
  const recipient = (app.email ?? "").toLowerCase().trim();
  // Erfolgreiche Versände protokolliert normalerweise die Mailfunktion selbst.
  // Fehlt dieser Eintrag (z. B. weil das Log dort nicht geschrieben wurde),
  // ergänzen wir ihn hier — sonst fehlt die Zusage-Mail im E-Mail-Center und
  // die Mail-Kette behauptet fälschlich „nie ausgelöst".
  let needsLog = true;
  if (status === "sent" && recipient) {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: existing } = await supabaseAdmin
      .from("email_send_log")
      .select("id")
      .eq("recipient_email", recipient)
      .in("template_name", ["invitation", "registration_invitation", "welcome_invitation"])
      .eq("status", "sent")
      .gte("created_at", since)
      .limit(1);
    if ((existing as any[] | null)?.length) needsLog = false;
  }
  if (needsLog) {
    await supabaseAdmin
      .from("email_send_log")
      .insert({
        tenant_id: app.tenant_id ?? null,
        template_name: "registration_invitation",
        recipient_email: recipient,
        status,
        error_message: error,
        metadata: { application_id: app.id, source },
      } as any)
      .then(() => {}, () => {});
  }
}

async function sendInviteInternal(
  app: ApplicationRow,
  request: Request,
  opts?: { force?: boolean; source?: "ai_accept_invite" | "admin_stage_change" | "manual_resend" },
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (!app.email || !app.tenant_id) return { sent: false, skipped: true, reason: "missing_email_or_tenant" };

  // Ergebnis JEDES Versuchs festhalten: an der Bewerbung (Admin-Sicht) und —
  // bei Fehlschlag/Skip — zusätzlich im zentralen E-Mail-Protokoll.
  const record = (status: "sent" | "failed" | "skipped", error: string | null) =>
    recordInviteAttempt(app, status, error, opts?.source ?? "ai_accept_invite");

  // Schutz gegen verfrühte "Willkommen im Team"-Mails: ohne tatsächlich
  // geführtes Gespräch wird nicht eingeladen (außer Admin erzwingt es).
  if (!opts?.force) {
    const { data: check } = await supabaseAdmin
      .from("applications")
      .select("interview_status, interview_messages")
      .eq("id", app.id)
      .maybeSingle();
    const status = (check as any)?.interview_status ?? null;
    const msgs = Array.isArray((check as any)?.interview_messages)
      ? ((check as any).interview_messages as any[])
      : [];
    const userTurns = msgs.filter((m) => m?.role === "user").length;
    if (!(status === "done" || status === "taken_over") || userTurns < 2) {
      console.warn("[interview-engine] Registrierungs-Einladung blockiert (kein abgeschlossenes Interview)", {
        applicationId: app.id, status, userTurns,
      });
      await record("skipped", `kein abgeschlossenes Interview (status=${status ?? "-"}, Antworten=${userTurns})`);
      return { sent: false, skipped: true, reason: "no_completed_interview" as const, interview_status: status, user_turns: userTurns };
    }
  }

  const email = app.email.toLowerCase().trim();
  const token = `${crypto.randomUUID()}-${crypto.randomUUID().slice(0, 8)}`;
  const { data: tokenRow, error: tokenErr } = await supabaseAdmin
    .from("invitation_tokens")
    .insert({ token, email, tenant_id: app.tenant_id, application_id: app.id } as any)
    .select("token")
    .single();
  if (tokenErr || !tokenRow?.token) {
    console.error("[interview-engine] invitation token error:", tokenErr);
    await record("failed", tokenErr?.message ?? "token_failed");
    return { sent: false, error: tokenErr?.message ?? "token_failed" };
  }

  // Portal-Domain ausschliesslich über die Fast-Track-Kette auflösen,
  // damit Mail-Link und Portal-Button garantiert identisch sind.
  // ?ref=<application_id> hängt die Vermittlungs-Bewerbung an den Link.
  const base = await resolvePortalBase(app, request);
  if (!base) {
    // Lieber keine Mail als eine mit falschem Portal-Link (z. B. auf die Vermittlung).
    await record("skipped", "missing_fasttrack_portal: keine Fast-Track-Portal-Domain für diese Bewerbung hinterlegt");
    return { sent: false, skipped: true, reason: "missing_fasttrack_portal" as const };
  }
  const registrationLink = buildRegistrationLink(base, tokenRow.token, app.id);
  const name = app.full_name || email;
  const firstName = app.first_name || String(name).trim().split(/\s+/)[0] || "";
  const lastName = app.last_name || String(name).trim().split(/\s+/).slice(1).join(" ");

  const { data: mailData, error: mailErr } = await supabaseAdmin.functions.invoke("send-invitation-email", {
    body: {
      to: email,
      fullName: name,
      firstName,
      lastName,
      registrationLink,
      tenantId: app.tenant_id,
      // Ohne applicationId landet die Zusage-Mail ohne Bewerbungsbezug im Log.
      applicationId: app.id,
    },
  });
  // Manche Funktionen antworten mit HTTP 200 und { error: ... } — das ist ebenfalls ein Fehlschlag.
  const softErr = (mailData as any)?.error ? String((mailData as any).error) : null;
  if (mailErr || softErr) {
    const msg = mailErr?.message ?? softErr ?? "mail_failed";
    console.warn("[interview-engine] invitation mail failed:", msg);
    await record("failed", msg);
    return { sent: false, error: msg, registration_link: registrationLink };
  }
  await record("sent", null);
  await supabaseAdmin
    .from("invite_resend_queue")
    .update({ status: "skipped", last_error: "ai_accept_invite_sent" } as any)
    .eq("status", "queued")
    .eq("email", email)
    .then(() => {}, () => {});
  await supabaseAdmin.from("activity_log").insert({
    action: "bewerbung_ai_akzeptiert",
    entity_type: "application",
    entity_id: app.id,
    comment: `KI hat ${name} akzeptiert; Registrierungseinladung wurde versendet.`,
    old_status: app.status ?? null,
    new_status: "akzeptiert",
  } as any).then(() => {}, () => {});
  return { sent: true, registration_link: registrationLink };
}

export async function finalizeInterview(app: ApplicationRow, messages: Msg[], request: Request) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (!messages || messages.length === 0) throw new Error("Kein Verlauf vorhanden");
  const result = await runSummary(messages);
  const newStatus = toApplicationStatus(result.recommendation);
  const { error: updErr } = await supabaseAdmin
    .from("applications")
    .update({
      status: newStatus,
      interview_status: "done",
      interview_messages: messages,
      interview_summary: result.summary,
      interview_score: result.score,
      interview_recommendation: result.recommendation,
      ai_decision: toAiDecision(result.recommendation),
      ai_reason: result.summary,
      interview_completed_at: new Date().toISOString(),
    } as any)
    .eq("id", app.id);
  if (updErr) throw new Error(updErr.message);

  // Stage-Lifecycle: positive KI-Entscheidung => sofort Zusage + Registrierungs-Mail.
  const stage = result.recommendation === "reject" ? "vermittlung_absage" : "vermittlung_zusage";
  if (stage) {
    await supabaseAdmin.rpc("advance_application_stage", {
      _application_id: app.id,
      _to_stage: stage,
      _actor_id: null,
      _reason: `ai_interview:${result.recommendation}`,
      _force: false,
    } as any).then(() => {}, (e) => console.warn("[interview-engine] stage rpc:", e));
  }
  const invite_mail =
    result.recommendation === "invite"
      ? await sendRegistrationInviteAfterAiAccept(app, request)
      : { sent: false, skipped: true, reason: "no_ai_invite" };
  return { ...result, application_status: newStatus, invite_mail };
}
