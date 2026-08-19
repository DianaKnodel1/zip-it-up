// Öffentliche Chat-Oberfläche für das Bewerbungsgespräch.
// Aufruf: /interview/<appId>?landing=<slug>&portal=<base>
// Nach Abschluss: Danke-Screen; die Entscheidung/E-Mail läuft serverseitig.

import { createFileRoute, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Send, CheckCircle2 } from "lucide-react";
import { ZusageCard } from "@/components/interview/ZusageCard";

type Msg = { role: "user" | "assistant"; text: string; ts: string };

// Menschlichere Reaktionszeit: erst "lesen/nachdenken", dann erst die Tippblase.
// Bewusst deutlich länger — sofortige Antworten wirken maschinell.
const READ_DELAY_MIN_MS = 3000;
const READ_DELAY_MAX_MS = 7000;
const readDelay = () =>
  READ_DELAY_MIN_MS + Math.random() * (READ_DELAY_MAX_MS - READ_DELAY_MIN_MS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postInterview(body: unknown) {
  const res = await fetch("/api/public/interview-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error(
      res.ok
        ? `Unerwartete Antwort vom Server (kein JSON, Status ${res.status}). Bitte Frontend neu deployen.`
        : `Serverfehler ${res.status}. Bitte erneut versuchen oder Support kontaktieren.`,
    );
  }
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error("Antwort konnte nicht gelesen werden."); }
  // "Noch zu früh" ist kein Fehler — Frontend rendert Wartescreen mit Countdown.
  if (res.status === 425 || data?.not_yet || data?.not_booked)
    return {
      __notYet: true as const,
      scheduled_at: data?.scheduled_at ?? null,
      not_booked: data?.not_booked === true || (!data?.scheduled_at && res.status === 425),
      message: data?.error ?? null,
    };
  if (!res.ok) throw new Error(data?.error ?? `Fehler ${res.status}`);
  return data;
}

export const Route = createFileRoute("/interview/$appId")({
  validateSearch: (s: Record<string, unknown>) => ({
    landing: typeof s.landing === "string" ? s.landing : "",
    portal: typeof s.portal === "string" ? s.portal : "",
  }),
  component: InterviewPage,
});

function InterviewPage() {
  const { appId } = useParams({ from: "/interview/$appId" });
  const { landing, portal } = useSearch({ from: "/interview/$appId" }) as { landing: string; portal: string };

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // Getrennt von `loading`: die Tippblase erscheint erst nach der Lesepause.
  const [typing, setTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [ended, setEnded] = useState(false);
  const [appStatus, setAppStatus] = useState<string | null>(null);
  const [registrationLink, setRegistrationLink] = useState<string | null>(null);
  // E-Mail des Bewerbers: erlaubt die Registrierung direkt nach der Zusage,
  // ohne auf eine Mail mit Token zu warten (Feld ist vorbefüllt).
  const [applicantEmail, setApplicantEmail] = useState<string | null>(null);
  const [inviteMailFailed, setInviteMailFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [scheduledAt, setScheduledAt] = useState<number | null>(null);
  // Kein aktiver Termin (nie gebucht oder storniert) — eigener Screen statt Countdown ins Leere.
  const [notBooked, setNotBooked] = useState(false);
  const [branding, setBranding] = useState<{ firmenname?: string; primary_color?: string; logo_url?: string | null; recruiter_name?: string; recruiter_avatar_url?: string | null } | null>(null);
  // Vom Server aufgelöstes Branding (Fast-Track-Firma). Hat Vorrang vor der
  // direkten Datenbank-Abfrage, die bei unveröffentlichten Seiten leer bleibt.
  const [serverBranding, setServerBranding] = useState<{ recruiter_name?: string; recruiter_avatar_url?: string | null; company_name?: string } | null>(null);
  // Vom Server aufgeloeste Portal-Basis der Partnerfirma (Fast-Track).
  const [serverPortalBase, setServerPortalBase] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const zusageRef = useRef<HTMLDivElement>(null);

  const applyServerBranding = (data: any) => {
    if (data?.branding) setServerBranding(data.branding);
    if (data?.applicant_email) setApplicantEmail(String(data.applicant_email));
    if (data?.portal_base) setServerPortalBase(String(data.portal_base).replace(/\/+$/, ""));
  };


  

  // Branding laden.
  // Wichtig: Das Gespräch führt IMMER die Fast-Track-Firma. Zeigt der Slug auf
  // eine Vermittlungs-/Broker-Landing, wird auf die verknüpfte Fast-Track-Landing
  // aufgelöst — sonst erscheinen Firmenname, Logo und Recruiter:in der Vermittlung.
  useEffect(() => {
    if (!landing) return;
    let cancelled = false;
    const COLS = "logo_url, branding, recruiter_name, recruiter_avatar_url, flow_type, linked_fasttrack_landing_id";
    const apply = (row: any) => {
      if (cancelled || !row) return;
      setBranding({
        ...(row.branding as any),
        logo_url: row.logo_url,
        recruiter_name: row.recruiter_name || undefined,
        recruiter_avatar_url: row.recruiter_avatar_url || null,
      });
    };
    (async () => {
      const { data } = await supabase
        .from("landing_pages")
        .select(COLS)
        .eq("slug", landing)
        .maybeSingle();
      if (!data) return;
      const linkedId = (data as any).linked_fasttrack_landing_id;
      if ((data as any).flow_type !== "fast" && linkedId) {
        const { data: linked } = await supabase
          .from("landing_pages")
          .select(COLS)
          .eq("id", linkedId)
          .maybeSingle();
        if (linked) return apply(linked);
      }
      apply(data);
    })();
    return () => { cancelled = true; };
  }, [landing]);

  // Init: Bewerbung + Verlauf laden — erst NACH Einwilligung
  useEffect(() => {
    if (!consent) return;
    let cancelled = false;
    async function init() {
      try {
        const data = await postInterview({ applicationId: appId, action: "init" });
        if (cancelled) return;
        applyServerBranding(data);
        if ((data as any).__notYet) {
          const sched = (data as any).scheduled_at ? new Date((data as any).scheduled_at).getTime() : null;
          setScheduledAt(sched);
          setNotBooked(!sched && (data as any).not_booked === true);
          setInitializing(false);
          return;
        }
        setScheduledAt(null);
        setNotBooked(false);
        const history = data.history ?? [];
        // Begrüßung nicht abrupt einblenden: kurz "tippen" lassen.
        if (history.length > 0 && history[history.length - 1]?.role === "assistant") {
          setInitializing(false);
          setTyping(true);
          await sleep(readDelay() + 600);
          if (cancelled) return;
          setTyping(false);
        }
        setMessages(history);
        if (data.ended) setEnded(true);
        if (data.application_status) setAppStatus(data.application_status);
        {
          const im = (data as any)?.invite_mail;
          if (im?.registration_link) setRegistrationLink(im.registration_link);
        }
        setStartedAt(data.interview_started_at ? new Date(data.interview_started_at).getTime() : Date.now());
        setInitializing(false);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "Unbekannter Fehler");
        setInitializing(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [appId, consent]);

  // Auto-Retry sobald der Termin (minus 5 Min Vorlauf) erreicht ist.
  useEffect(() => {
    if (!scheduledAt) return;
    const readyAt = scheduledAt - 5 * 60 * 1000;
    const check = async () => {
      if (Date.now() < readyAt) return;
      try {
        const data = await postInterview({ applicationId: appId, action: "init" });
        if ((data as any).__notYet) return;
        applyServerBranding(data);
        setScheduledAt(null);
        setMessages(data.history ?? []);
        if (data.ended) setEnded(true);
        if (data.application_status) setAppStatus(data.application_status);
        {
          const im = (data as any)?.invite_mail;
          if (im?.registration_link) setRegistrationLink(im.registration_link);
        }
        setStartedAt(data.interview_started_at ? new Date(data.interview_started_at).getTime() : Date.now());
      } catch { /* still waiting */ }
    };
    const id = setInterval(check, 5000);
    check();
    return () => clearInterval(id);
  }, [scheduledAt, appId]);

  // Kein hartes Zeitlimit mehr im Frontend.
  // Das Gespräch endet ausschließlich durch:
  //  1. [INTERVIEW_END] von der KI (sauberer Abschluss mit rotem Faden),
  //  2. "Gespräch beenden"-Button des Bewerbers,
  //  3. Server-Auto-Timeout nach 45 Min Inaktivität (Migration 20260715).
  // Grund: Ein starres 15-Min-Limit killte Interviews mitten im Abschluss.


  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  // Zusage darf niemand übersehen: sobald sie steht, direkt in den Blick holen.
  useEffect(() => {
    if (!ended || appStatus !== "akzeptiert") return;
    const t = setTimeout(
      () => zusageRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
      250,
    );
    return () => clearTimeout(t);
  }, [ended, appStatus]);

  // Timer aufräumen
  useEffect(() => () => { if (typingTimerRef.current) clearTimeout(typingTimerRef.current); }, []);

  // KI Chat ist bewusst ein reiner Text-Chat — keine TTS, keine Stimme.
  // Sprachausgabe läuft ausschließlich über /interview/voice/$appId (KI Telefon).


  async function send() {
    const text = input.trim();
    if (!text || loading || ended) return;
    setInput("");
    setLoading(true);
    // optimistic
    setMessages((prev) => [...prev, { role: "user", text, ts: new Date().toISOString() }]);
    const startedAt = Date.now();
    // Lesepause: erst nach 1,2–2,5 s erscheint die Tippblase.
    const readMs = readDelay();
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => setTyping(true), readMs);
    try {
      const data = await postInterview({ applicationId: appId, action: "message", text });
      applyServerBranding(data);
      // Menschlichere Antwortzeit: kurze Denkpause + „Tipp"-Zeit abhängig von Antwortlänge
      const reply = (data.history ?? []).slice(-1)[0]?.text ?? "";
      const chars = reply.length;
      // ~55 ms pro Zeichen "Tippen" (realistische Schreibgeschwindigkeit),
      // plus Denkpause; gedeckelt bei 16 s, damit niemand ewig wartet.
      const targetMs = Math.min(16000, readMs + 1200 + chars * 55);
      // Es wird immer mindestens ~1,5 s sichtbar getippt.
      const minVisible = readMs + 1500;
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, Math.max(targetMs, minVisible) - elapsed);
      if (wait > 0) await sleep(wait);
      setMessages(data.history ?? []);
      if (data.ended) setEnded(true);
      if (data.application_status) setAppStatus(data.application_status);
      const im = (data as any)?.invite_mail;
      if (im?.registration_link) setRegistrationLink(im.registration_link);
      if (im && im.sent === false) setInviteMailFailed(true);
    } catch (e: any) {
      setError(e?.message ?? "Unbekannter Fehler");
    } finally {
      if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
      setTyping(false);
      setLoading(false);
    }
  }

  async function endInterview() {
    if (loading || ended || messages.length === 0) return;
    if (!window.confirm("Möchten Sie das Gespräch wirklich beenden?")) return;
    setLoading(true);
    try {
      const data = await postInterview({ applicationId: appId, action: "end" });
      applyServerBranding(data);
      if (data?.application_status) setAppStatus(data.application_status);
      const im = (data as any)?.invite_mail;
      if (im?.registration_link) setRegistrationLink(im.registration_link);
      if (im && im.sent === false) setInviteMailFailed(true);
      setEnded(true);
    } catch (e: any) {
      setError(e?.message ?? "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  const company = serverBranding?.company_name || branding?.firmenname || "uns";
  // Kein erfundener Name mehr: ohne gepflegten Recruiter zeigt der Chat das HR-Team.
  const recruiterDisplayName = serverBranding?.recruiter_name || branding?.recruiter_name || "Martin Schneider";
  const primary = branding?.primary_color || "#2563eb";
  // Reihenfolge bewusst: serverseitig aufgeloeste Partner-Domain zuerst.
  // NIE window.location.origin — bei Vermittlungs-Bewerbungen waere das die
  // Vermittlungs-Domain und der Bewerber wuerde sich bei der falschen Firma
  // registrieren. Ohne Basis lieber gar kein Link.
  const portalBase = serverPortalBase || (portal || "").replace(/\/+$/, "");
  // Ohne Token (z. B. Mailversand-Fehler) zeigt die Karte den Hinweis auf die E-Mail.
  // Ohne Token (Mailfehler / kein Token gefunden) trotzdem zur Portal-Registrierung
  // führen — der Bewerber landet so in jedem Fall auf der richtigen Seite.
  const registerQuery = applicantEmail ? `?email=${encodeURIComponent(applicantEmail)}` : "";
  const registerFallbackHref: string | null = portalBase
    ? `${portalBase}/register${registerQuery}`
    : null;




  // Consent-Gate (DSGVO + EU AI Act)
  if (!consent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950 p-4">
        <div className="max-w-lg w-full bg-white dark:bg-slate-900 rounded-2xl border border-border p-6 space-y-4 shadow-sm">
          {branding?.logo_url && <img src={branding.logo_url} alt={company} className="h-10 object-contain" />}
          <h1 className="text-xl font-semibold">Bewerbungsgespräch mit {company}</h1>
          <div className="text-sm text-muted-foreground space-y-2">
            <p><strong>Das Gespräch findet digital statt</strong> – Ihre Antworten gehen anschließend direkt an Ihre Ansprechpartnerin bzw. Ihren Ansprechpartner.</p>
            <p>Das Gespräch dauert in der Regel <strong>15 bis 30 Minuten</strong> (max. 45 Min.) und besteht aus einigen Fragen zu Ihrer Person, Motivation und Verfügbarkeit — nehmen Sie sich die Zeit, die Sie brauchen.</p>
          </div>
          <Button
            size="lg"
            className="w-full"
            style={{ background: primary }}
            onClick={() => setConsent(true)}
          >
            Verstanden, Gespräch starten
          </Button>
        </div>
      </div>
    );
  }

  // Kein aktiver Termin: Sackgasse vermeiden, direkt zur Selbstbedienung führen.
  if (notBooked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950 p-4">
        <div className="max-w-lg w-full bg-white dark:bg-slate-900 rounded-2xl border border-border p-8 space-y-5 shadow-lg text-center">
          {branding?.logo_url && <img src={branding.logo_url} alt={company} className="h-10 object-contain mx-auto" />}
          <div className="text-5xl leading-none">📅</div>
          <h1 className="text-2xl font-bold leading-tight">Für Sie ist aktuell kein Termin gebucht</h1>
          <p className="text-sm text-muted-foreground">
            Entweder wurde Ihr Termin storniert oder es wurde noch keiner ausgewählt. Sie können sich in
            wenigen Sekunden einen neuen Termin sichern — Ihre Bewerbung bleibt dabei erhalten.
          </p>
          <Button size="lg" className="w-full" style={{ background: primary }} asChild>
            <a href="/bewerbung">Neuen Termin auswählen</a>
          </Button>
          <p className="text-xs text-muted-foreground">
            Sie geben dort nur Ihre E-Mail-Adresse ein und wählen einen passenden Zeitpunkt für Ihr Interview.
          </p>
        </div>
      </div>
    );
  }

  // Warte-Screen: Termin liegt in der Zukunft (>5 Min Vorlauf noch nicht erreicht).
  if (scheduledAt && Date.now() < scheduledAt - 5 * 60 * 1000) {
    return (
      <WaitingScreen
        scheduledAt={scheduledAt}
        company={company}
        primary={primary}
        logoUrl={branding?.logo_url || null}
        recruiterName={recruiterDisplayName}
      />
    );
  }



  const avatarUrl = serverBranding?.recruiter_avatar_url || branding?.recruiter_avatar_url || null;
  const recruiterName = recruiterDisplayName;
  const initials = recruiterName.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  const status = typing ? `${recruiterName.split(" ")[0]} schreibt …` : ended ? "Gespräch beendet" : "online";

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      {/* Chat-Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-border sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="relative shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt={recruiterName} className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div className="h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-semibold" style={{ background: primary }}>
                {initials}
              </div>
            )}
            {!ended && (
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[15px] font-semibold text-foreground truncate">{recruiterName}</h1>
            <p className="text-xs truncate text-muted-foreground">
              {status} · {company}
            </p>
          </div>
        </div>
      </header>

      {/* Zusage-Hinweis direkt unter dem Header — sichtbar ohne Scrollen. */}
      {ended && appStatus === "akzeptiert" && (
        <div className="sticky top-[64px] z-10 border-b border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/60">
          <div className="max-w-2xl mx-auto px-4 py-2 flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
              🎉 Zusage erhalten — jetzt im Mitarbeiterportal registrieren
            </span>
            <Button
              size="sm"
              style={{ background: primary }}
              className="text-white shrink-0"
              onClick={() => zusageRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
            >
              Zur Registrierung
            </Button>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 pb-4 flex flex-col">
        {error && (
          <div className="my-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Chat-Verlauf — ruhiges Business-Design */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-1.5 py-4 min-h-[200px]">
          {initializing && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" style={{ color: primary }} />
            </div>
          )}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const grouped = prev && prev.role === m.role;
            return (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} ${grouped ? "mt-0.5" : "mt-2"}`}>
                <div
                  className={`max-w-[80%] px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "text-white rounded-2xl rounded-br-sm"
                      : "bg-white dark:bg-slate-900 text-foreground rounded-2xl rounded-bl-sm border border-border"
                  }`}
                  style={m.role === "user" ? { background: primary } : undefined}
                >
                  {m.text}
                </div>
              </div>
            );
          })}
          {typing && !ended && (
            <div className="flex justify-start mt-2">
              <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                <div className="flex items-end gap-1.5 h-4">
                  <span className="typing-dot" style={{ animationDelay: "0ms" }} />
                  <span className="typing-dot" style={{ animationDelay: "180ms" }} />
                  <span className="typing-dot" style={{ animationDelay: "360ms" }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {ended ? (
          appStatus === "akzeptiert" ? (
            <div ref={zusageRef} className="scroll-mt-24">
              <ZusageCard
                className="mt-4 ring-2 ring-offset-2 ring-offset-background rounded-2xl"
                company={company}
                primary={primary}
                recruiter={recruiterName}
                registrationLink={registrationLink ?? registerFallbackHref}
                mailFailed={inviteMailFailed}
                loginHref={`${portalBase}/login`}
              />
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-border p-6 text-center space-y-3">
              <CheckCircle2 className="h-10 w-10 mx-auto" style={{ color: primary }} />
              <h2 className="text-lg font-semibold">Vielen Dank für das Gespräch!</h2>
              <p className="text-sm text-muted-foreground">
                Ihre Antworten wurden gespeichert. Wir melden uns in Kürze bei Ihnen.
              </p>
            </div>
          )
        ) : (
          <div className="sticky bottom-0 bg-transparent pt-2">
            <div className="flex items-end gap-2">
              <div className="flex-1 bg-white dark:bg-slate-900 rounded-full border border-border shadow-sm flex items-center px-4 py-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Nachricht schreiben…"
                  disabled={loading || initializing}
                  className="flex-1 bg-transparent text-[15px] focus:outline-none placeholder:text-muted-foreground"
                />
              </div>
              <button
                onClick={send}
                disabled={loading || initializing || !input.trim()}
                className="h-11 w-11 rounded-full flex items-center justify-center text-white shadow-sm transition disabled:opacity-40"
                style={{ background: primary }}
                aria-label="Senden"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            {messages.length > 2 && (
              <div className="text-center mt-2">
                <button
                  onClick={endInterview}
                  disabled={loading}
                  className="text-xs text-muted-foreground hover:text-destructive underline disabled:opacity-50"
                >
                  Gespräch beenden
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function WaitingScreen({
  scheduledAt,
  company,
  primary,
  logoUrl,
  recruiterName,
}: {
  scheduledAt: number;
  company: string;
  primary: string;
  logoUrl: string | null;
  recruiterName: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const diffMs = Math.max(0, scheduledAt - now);
  const totalMin = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const minutes = totalMin % 60;
  const seconds = Math.floor((diffMs % 60000) / 1000);

  const dateStr = new Date(scheduledAt).toLocaleDateString("de-DE", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Berlin",
  });
  const timeStr = new Date(scheduledAt).toLocaleTimeString("de-DE", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin",
  });

  let humanCountdown: string;
  if (days > 0) humanCountdown = `in ${days} ${days === 1 ? "Tag" : "Tagen"} und ${hours} Std.`;
  else if (hours > 0) humanCountdown = `in ${hours} Std. ${minutes} Min.`;
  else if (minutes > 0) humanCountdown = `in ${minutes} Min. ${seconds.toString().padStart(2, "0")} Sek.`;
  else humanCountdown = `in ${seconds} Sekunden`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950 p-4">
      <div className="max-w-lg w-full bg-white dark:bg-slate-900 rounded-2xl border border-border p-8 space-y-5 shadow-lg text-center">
        {logoUrl && <img src={logoUrl} alt={company} className="h-10 object-contain mx-auto" />}
        <div className="text-5xl leading-none">⏰</div>
        <div>
          <h1 className="text-2xl font-bold leading-tight mb-1">Sie sind etwas zu früh</h1>
          <p className="text-sm text-muted-foreground">
            Ihr Bewerbungsgespräch mit {recruiterName} ist gebucht für:
          </p>
        </div>

        <div className="rounded-xl border-2 p-4" style={{ borderColor: primary }}>
          <p className="text-sm text-muted-foreground">{dateStr}</p>
          <p className="text-3xl font-bold mt-1" style={{ color: primary }}>{timeStr} Uhr</p>
        </div>

        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Ihr Gespräch beginnt</p>
          <p className="text-lg font-semibold">{humanCountdown}</p>
        </div>

        <div className="text-left text-sm text-muted-foreground space-y-2 bg-blue-50 dark:bg-blue-950/30 rounded-lg p-4 border border-blue-100 dark:border-blue-900">
          <p className="font-semibold text-foreground">So bereiten Sie sich optimal vor:</p>
          <ul className="space-y-1.5 list-none">
            <li>✅ Sorgen Sie für eine ruhige Umgebung</li>
            <li>✅ Halten Sie eine stabile Internetverbindung bereit</li>
            <li>✅ Denken Sie kurz über Ihre Motivation und Verfügbarkeit nach</li>
          </ul>
        </div>

        <p className="text-xs text-muted-foreground">
          Diese Seite lädt sich automatisch neu — sobald es losgeht, startet Ihr Gespräch direkt.
          Sie können das Fenster gerne geöffnet lassen.
        </p>
      </div>
    </div>
  );
}


