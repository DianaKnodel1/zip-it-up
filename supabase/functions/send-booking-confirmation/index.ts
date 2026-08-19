// Deno Edge Function: send-booking-confirmation
// Scannt frisch gebuchte interview_appointments (created_at > now()-15min) und
// sendet Bewerber-Bestätigungsmail (professioneller Wrapper: Logo, Preheader,
// Spam-Hinweis, Recruiter-Karte, ICS-Anhang + Plain-Text-Alternative).
// Idempotent via application_reminder_log kind='booking_confirmation'.
//
// Trigger: pg_cron alle 2 Min (siehe Migration 20260717000000_...).
// Auth: x-cron-secret Header/?key=<CRON_SECRET> oder Service-Role via Authorization/apikey.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createSmtpTransport, sendMailWithRetry } from "../_shared/smtp.ts";
import { renderEmail } from "../_shared/email-wrapper.ts";
import { resolveSender } from "../_shared/sender-resolver.ts";
import { pickLandingLogo, resolveEmailLogo, type LogoResolution } from "../_shared/email-logo.ts";
import { guardSend } from "../_shared/send-guard.ts";
import { isDuplicateSend } from "../_shared/dedupe.ts";
import { claimEmailEvent, finishEmailClaim } from "../_shared/send-claim.ts";
import { APP_TZ, formatAppointmentDate, formatAppointmentTime, icsLocalBerlin } from "../_shared/format-datetime.ts";


const FUNCTION_VERSION = "2026-08-10-booking-confirmation-v4-manual-resend";
const REMINDER_KIND = "booking_confirmation";
const LOOKBACK_MIN = 4320; // 72h – überbrückt längere Cron-Ausfälle; Idempotenz via reminder_log

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_SUBJECT = "Termin bestätigt: {{appointment_date}}, {{appointment_time}} Uhr – so geht es weiter";
const DEFAULT_PREHEADER = "Ihr Online-Interview am {{appointment_date}} um {{appointment_time}} Uhr – Teilnahme über Ihren persönlichen Zugangslink in dieser E-Mail.";
const DEFAULT_BODY = `Hallo {{first_name}},

Ihr Interview bei {{tenant_name}} ist fest reserviert:

Datum: {{appointment_date}}
Uhrzeit: {{appointment_time}} Uhr
Dauer: ca. {{duration_minutes}} Minuten

Ihr Interview findet online statt. Die Teilnahme erfolgt über Ihren persönlichen Zugangslink in dieser E-Mail; ein Telefonanruf erfolgt nicht. Bitte halten Sie diese E-Mail zum Termin bereit.

{{cta:{{button_label}}|{{magic_link}}}}

Der Link bleibt dauerhaft gültig und funktioniert am Handy genauso wie am Computer.

So läuft es ab:
1. Am {{appointment_date}} um {{appointment_time}} Uhr Ihren Zugangslink öffnen.
2. Das Interview dauert ca. {{duration_minutes}} Minuten – Sie beantworten ein paar Fragen zu Ihrer Person und Ihren Wünschen.
3. Bei einer Zusage direkt im Interview erhalten Sie im Anschluss eine E-Mail, mit der Sie sich im Mitarbeiter-Portal registrieren.
4. Erst nach der Registrierung im Portal können wir Sie einsetzen – bitte schließen Sie diesen Schritt gleich mit ab.

Der Termin liegt zusätzlich als Kalendereintrag (.ics) im Anhang – einfach öffnen und in Outlook, Google oder Apple-Kalender speichern.

Sie können den Termin nicht wahrnehmen? Dann sagen Sie ihn bitte kurz ab oder verschieben Sie ihn – das dauert 10 Sekunden: {{cancel_url}}

Wir freuen uns auf Ihr Interview!

Herzliche Grüße
{{recruiter_name}}`;
const DEFAULT_BUTTON = "Zum Interview";

function cleanHost(domain: unknown): string {
  return String(domain ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function portalHost(domain: unknown): string {
  const clean = cleanHost(domain).replace(/^portal\./, "");
  return clean ? `portal.${clean}` : "";
}

function resolveBookingLogo(tenant: TenantRow, sourceLanding: any, targetLanding: any, fastTrackLanding: any): LogoResolution {
  // Source-Landing zuerst: sie hostet das Logo garantiert öffentlich (Bewerber hat sie eben gesehen).
  // tenant.logo_url danach — und NUR wenn absolut https://, sonst zeigt der Mail-Client das kaputte Bild-Icon.
  const tenantLogoAbsolute = tenant.logo_url && /^https:\/\//i.test(String(tenant.logo_url).trim())
    ? tenant.logo_url
    : null;
  if (tenant.logo_url && !tenantLogoAbsolute) {
    console.warn("[send-booking-confirmation] tenant.logo_url ist nicht absolut https:// — wird übersprungen", { tenant_id: tenant.id, logo_url: tenant.logo_url });
  }
  return resolveEmailLogo([
    { source: "source_landing.logo", url: pickLandingLogo(sourceLanding), domain: sourceLanding?.domain },
    { source: "tenant.logo_url", url: tenantLogoAbsolute, domain: tenant.primary_domain || tenant.domain },
    { source: "fasttrack_landing.logo", url: pickLandingLogo(fastTrackLanding), domain: fastTrackLanding?.domain },
    { source: "target_landing.logo", url: pickLandingLogo(targetLanding), domain: targetLanding?.domain },
  ]);
}

interface TenantRow {
  id: string; name: string; domain: string | null; primary_domain: string | null;
  logo_url: string | null; primary_color: string | null;
  sender_email: string | null; sender_name: string | null; reply_to_email: string | null;
  smtp_host: string | null; smtp_port: number | null; smtp_username: string | null; smtp_password: string | null;
  email_signature: string | null; emails_paused: boolean | null;
  booking_confirmation_subject: string | null; booking_confirmation_body: string | null; booking_confirmation_button: string | null;
}

function hasValidSmtp(t: any): boolean {
  return !!(t?.smtp_host && t?.smtp_port && t?.smtp_username && t?.smtp_password && t?.sender_email);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

async function authorize(req: Request) {
  const secret = Deno.env.get("CRON_SECRET");
  const url = new URL(req.url);
  const provided = (req.headers.get("x-cron-secret") ?? url.searchParams.get("key") ?? "").trim();
  if (secret?.trim() && provided && provided === secret.trim()) return true;

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const apiKey = (req.headers.get("apikey") ?? req.headers.get("x-api-key") ?? "").trim();

  return !!(serviceRoleKey && (bearer === serviceRoleKey || apiKey === serviceRoleKey));
}

function pad(n: number) { return n.toString().padStart(2, "0"); }
function icsDate(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
function icsEscape(s: string): string {
  return s.replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");
}
function buildIcs(opts: { uid: string; title: string; description: string; start: Date; end: Date; url: string; organizerName: string; organizerEmail: string; attendeeEmail: string; }): string {
  const lines = [
    "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//MB Portal//Bewerbung//DE","CALSCALE:GREGORIAN","METHOD:REQUEST",
    // VTIMEZONE, damit Outlook/Apple die Ortszeit auch ohne eigene Zeitzonen-DB korrekt anzeigen.
    `BEGIN:VTIMEZONE`, `TZID:${APP_TZ}`,
    "BEGIN:DAYLIGHT","TZOFFSETFROM:+0100","TZOFFSETTO:+0200","TZNAME:CEST","DTSTART:19700329T020000","RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU","END:DAYLIGHT",
    "BEGIN:STANDARD","TZOFFSETFROM:+0200","TZOFFSETTO:+0100","TZNAME:CET","DTSTART:19701025T030000","RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU","END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART;TZID=${APP_TZ}:${icsLocalBerlin(opts.start)}`,
    `DTEND;TZID=${APP_TZ}:${icsLocalBerlin(opts.end)}`,
    `SUMMARY:${icsEscape(opts.title)}`,
    `DESCRIPTION:${icsEscape(opts.description)}`,
    `URL:${opts.url}`,
    `ORGANIZER;CN=${icsEscape(opts.organizerName)}:mailto:${opts.organizerEmail}`,
    `ATTENDEE;RSVP=TRUE:mailto:${opts.attendeeEmail}`,
    "STATUS:CONFIRMED","TRANSP:OPAQUE",
    "END:VEVENT","END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

async function logEmailSend(
  admin: any,
  tenant: TenantRow,
  appt: any,
  app: any,
  subject: string,
  html: string | null,
  status: "sent" | "failed",
  error?: string,
  extraMetadata?: Record<string, unknown>,
) {
  try {
    await admin.from("email_send_log").insert({
      message_id: `${REMINDER_KIND}-${appt.id}`,
      tenant_id: tenant.id,
      template_name: REMINDER_KIND,
      recipient_email: app.email,
      status,
      error_message: error ?? null,
      rendered_subject: subject,
      rendered_html: html,
      sender_email: tenant.sender_email ?? tenant.smtp_username,
      metadata: { appointment_id: appt.id, application_id: app.id, source: "send-booking-confirmation", sender_kind: "broker_booking_confirmation", resolved_tenant_id: tenant.id, ...(extraMetadata ?? {}) },
    });
  } catch (e) {
    console.warn("email_send_log insert skipped:", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!(await authorize(req))) return json({ error: "Unauthorized", version: FUNCTION_VERSION }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } });

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body?.dry_run === true;
    const forceResend = body?.force_resend === true && typeof body?.appointment_id === "string";
    const appointmentId = forceResend ? body.appointment_id : null;

    const since = new Date(Date.now() - LOOKBACK_MIN * 60_000).toISOString();

    let appointmentQuery = admin.from("interview_appointments")
      .select("id, application_id, tenant_id, starts_at, ends_at, cancel_token, status, created_at")
      .eq("status", "scheduled")
      .limit(200);
    appointmentQuery = appointmentId
      ? appointmentQuery.eq("id", appointmentId)
      : appointmentQuery.gte("created_at", since);
    const { data: appts, error: aErr } = await appointmentQuery;
    if (aErr) return json({ error: aErr.message, version: FUNCTION_VERSION }, 500);
    if (!appts || appts.length === 0) return json({ success: true, version: FUNCTION_VERSION, candidates: 0, sent: 0 });

    const appIds = Array.from(new Set(appts.map((a: any) => a.application_id)));
    const apptIds = appts.map((a: any) => a.id);
    // WICHTIG: pro Termin gezielt zählen statt "alle jemals gesendeten laden".
    // Das frühere Laden war bei 1.000 Zeilen gekappt — ältere Termine fielen
    // heraus und die Bestätigung ging erneut raus.
    // EINE Abfrage je Status für ALLE Termine dieses Laufs (statt 2 Abfragen
    // pro Termin) — sonst wären es bis zu 400 sequentielle Roundtrips.
    const doneAppts = new Set<string>();
    const capped = new Set<string>();
    {
      const [{ data: sentRows }, { data: failRows }] = await Promise.all([
        admin.from("email_send_log")
          .select("metadata,error_message")
          .eq("template_name", REMINDER_KIND)
          .eq("status", "sent")
          .in("metadata->>appointment_id", apptIds),
        admin.from("email_send_log")
          .select("metadata")
          .eq("template_name", REMINDER_KIND)
          .eq("status", "failed")
          .in("metadata->>appointment_id", apptIds),
      ]);
      for (const r of (sentRows ?? []) as any[]) {
        const aid = r?.metadata?.appointment_id;
        if (aid) doneAppts.add(aid);
      }
      // Retry-Cap: pro Termin max. 3 Fehlversuche → dann aussetzen.
      const failCount = new Map<string, number>();
      const terminalConfigFailure = new Set<string>();
      for (const r of (failRows ?? []) as any[]) {
        const aid = r?.metadata?.appointment_id;
        if (aid) {
          failCount.set(aid, (failCount.get(aid) ?? 0) + 1);
          const error = String(r?.error_message ?? "").toLowerCase();
          if (/invalid login|\b535\b|eauth|authentication failed|smtp_anmeldung fehlgeschlagen/.test(error)) {
            terminalConfigFailure.add(aid);
          }
        }
      }
      for (const [aid, n] of failCount) {
        if ((n >= 3 || terminalConfigFailure.has(aid)) && !doneAppts.has(aid)) capped.add(aid);
      }
    }

    const todo = appts.filter((a: any) => forceResend || (!doneAppts.has(a.id) && !capped.has(a.id)));
    if (todo.length === 0) return json({ success: true, version: FUNCTION_VERSION, candidates: appts.length, sent: 0, skipped_already_sent: doneAppts.size, skipped_retry_cap: capped.size });

    const { data: apps } = await admin.from("applications")
      .select("id, email, first_name, last_name, full_name, tenant_id, target_landing_id, source_landing_id, magic_token")
      .in("id", todo.map((t: any) => t.application_id));
    const appMap = new Map<string, any>((apps ?? []).map((a: any) => [a.id, a]));

    const lps = Array.from(new Set([
      ...todo.map((a: any) => appMap.get(a.application_id)?.target_landing_id).filter(Boolean),
      ...todo.map((a: any) => appMap.get(a.application_id)?.source_landing_id).filter(Boolean),
    ]));
    const { data: lpList } = lps.length
      ? await admin.from("landing_pages").select("id, domain, logo_url, branding, slots, intermediate_logo_url, recruiter_name, recruiter_avatar_url, linked_fasttrack_landing_id, flow_type, booking_mode").in("id", lps)
      : { data: [] as any[] };
    const lpMap = new Map<string, any>((lpList ?? []).map((l: any) => [l.id, l]));

    // Verlinkte Fast-Track-Landings nachziehen (Broker-Flow zeigt via linked_fasttrack_landing_id auf die Fast-Track-Landing).
    const extraIds = Array.from(new Set(
      Array.from(lpMap.values()).map((l: any) => l.linked_fasttrack_landing_id).filter(Boolean) as string[],
    )).filter((id) => !lpMap.has(id));
    if (extraIds.length) {
      const { data: extraLps } = await admin.from("landing_pages")
        .select("id, domain, logo_url, branding, slots, intermediate_logo_url, recruiter_name, recruiter_avatar_url, linked_fasttrack_landing_id, flow_type, booking_mode").in("id", extraIds);
      for (const l of (extraLps ?? []) as any[]) lpMap.set(l.id, l);
    }

    let sent = 0, skipped = 0, failed = 0;
    const results: any[] = [];

    for (const appt of todo as any[]) {
      const app = appMap.get(appt.application_id);
      if (!app?.email) { skipped++; results.push({ id: appt.id, reason: "no_email" }); continue; }

      // Calendly-Modus: Bestätigung + Erinnerungen + Kalendereintrag kommen von
      // Calendly selbst. Keine eigene Terminbestätigung (A/B gegen intern).
      {
        const src = app.source_landing_id ? lpMap.get(app.source_landing_id) : null;
        const tgt = app.target_landing_id ? lpMap.get(app.target_landing_id) : null;
        const mode = (l: any) => String(l?.booking_mode || "").toLowerCase();
        const isCalendly = [src, tgt].some((l) => l && mode(l) === "calendly");
        const isInternal = [src, tgt].some((l) => l && mode(l) === "internal");
        if (!forceResend && isCalendly && !isInternal) {
          skipped++;
          results.push({ id: appt.id, reason: "calendly_handles_mail" });
          await admin.from("application_reminder_log").upsert({
            application_id: app.id, tenant_id: app.tenant_id ?? appt.tenant_id ?? null,
            reminder_kind: REMINDER_KIND, recipient_email: app.email,
            status: "skipped", error: "calendly_handles_mail",
          }, { onConflict: "application_id,reminder_kind" });
          continue;
        }
      }
      const resolved = await resolveSender(admin, app.id, "broker_booking_confirmation");
      const tenant = resolved.tenant as TenantRow | null;
      if (!tenant) {
        skipped++; results.push({ id: appt.id, reason: resolved.reason || "routing_failed", sender_kind: resolved.kind });
        await admin.from("application_reminder_log").upsert({
          application_id: app.id, tenant_id: app.tenant_id ?? appt.tenant_id ?? null, reminder_kind: REMINDER_KIND,
          recipient_email: app.email, status: "skipped", error: `routing_${resolved.reason || "failed"}`,
        }, { onConflict: "application_id,reminder_kind" });
        // Konfigurationsfehler MUSS im E-Mail-Center sichtbar sein — sonst
        // scheitert die Bestätigung dauerhaft still und der Bewerber hat
        // weder Termin-Mail noch Interview-Link.
        await logMailAbort(admin, {
          source: "send-booking-confirmation",
          templateName: REMINDER_KIND,
          recipient: app.email,
          tenantId: app.tenant_id ?? appt.tenant_id ?? null,
          status: "failed",
          reason: `routing_${resolved.reason || "failed"}`,
          metadata: {
            appointment_id: appt.id, application_id: app.id,
            config_blocked: true, blocked_reason: resolved.reason || "routing_failed",
          },
        });
        continue;
      }
      if (!hasValidSmtp(tenant)) { skipped++; results.push({ id: appt.id, reason: "no_smtp" }); continue; }
      // Ersatzabsender-Hinweis: geht mit ins Log, damit im E-Mail-Center sichtbar
      // bleibt, welcher Mandant seine SMTP-Daten nachziehen muss.
      const fallbackMeta = resolved.fallbackUsed
        ? {
            sender_fallback: true,
            sender_fallback_reason: resolved.fallbackReason ?? null,
            sender_intended_tenant_id: resolved.intendedTenantId ?? null,
            sender_used_tenant_id: tenant.id,
          }
        : {};

      const sourceLanding = app.source_landing_id ? lpMap.get(app.source_landing_id) : null;
      const targetLanding = app.target_landing_id ? lpMap.get(app.target_landing_id) : null;
      // Fast-Track-Landing (Portal + Interview) bevorzugt: aktuelle source.linked_fasttrack
      // vor gespeicherten target_landing_id, weil Admins die Vermittlungs-Zuordnung ändern können.
      // Broker-Landings (flow_type='broker') haben KEIN eigenes Portal — niemals als
      // Fallback nehmen, sonst zeigt der Cancel-/Rebook-Link auf die Vermittler-Domain.
      const isBrokerLp = (l: any) => l && l.flow_type === "broker";
      let fastTrackLanding = (sourceLanding?.linked_fasttrack_landing_id ? lpMap.get(sourceLanding.linked_fasttrack_landing_id) : null)
        || targetLanding
        || (isBrokerLp(sourceLanding) ? null : sourceLanding);
      if (isBrokerLp(fastTrackLanding)) fastTrackLanding = null;
      const landing = sourceLanding || targetLanding;
      // Wichtig: niemals auf Broker-/Vermittlungs-Domain zurückfallen.
      // Wenn keine Fast-Track-Landing verknüpft ist, wird die Mail geskippt,
      // statt einen falschen portal.<vermittlungs-domain>-Link zu versenden.
      const fastTrackDomain = fastTrackLanding?.domain || "";
      const fastTrackHost = portalHost(fastTrackDomain);

      if (!fastTrackHost) {
        skipped++;
        results.push({ id: appt.id, status: "skipped", reason: "missing_fasttrack_portal_domain" });
        await admin.from("application_reminder_log").upsert({
          application_id: app.id, tenant_id: tenant.id, reminder_kind: REMINDER_KIND,
          recipient_email: app.email, status: "skipped", error: "missing_fasttrack_portal_domain",
        }, { onConflict: "application_id,reminder_kind" });
        await logEmailSend(admin, tenant, appt, app, "(nicht gesendet)", null, "failed", "missing_fasttrack_portal_domain", {
          config_blocked: true, blocked_reason: "missing_fasttrack_portal_domain",
        });
        continue;
      }

      const recruiterName = landing?.recruiter_name || tenant.name;
      const recruiterAvatar = landing?.recruiter_avatar_url || null;
      // Cancel-/Rebook-Link: immer auf portal.<fast-track-domain>, dort läuft das Buchungssystem.
      const cancelUrl = `https://${fastTrackHost}/termin/${appt.cancel_token}`;
      // Direkter Interview-Link (dauerhaft gueltig). Ohne ihn haengt die Teilnahme
      // allein an der 30-Minuten-Mail — faellt die aus, kann der Bewerber nicht starten.
      const magicLink = app.magic_token
        ? `https://${fastTrackHost}/bewerbung?token=${encodeURIComponent(app.magic_token)}`
        : cancelUrl;

      const starts = new Date(appt.starts_at);
      const ends = new Date(appt.ends_at);
      const firstName = app.first_name || (app.full_name?.split(" ")[0] ?? "");
      const duration = Math.round((ends.getTime() - starts.getTime()) / 60_000);

      const vars: Record<string, string> = {
        first_name: firstName,
        last_name: app.last_name || "",
        full_name: app.full_name || `${firstName} ${app.last_name || ""}`.trim(),
        tenant_name: tenant.name,
        recruiter_name: recruiterName,
        appointment_date: formatAppointmentDate(starts),
        appointment_time: formatAppointmentTime(starts),
        duration_minutes: String(duration),
        cancel_url: cancelUrl,
        magic_link: magicLink,
        // Portal-URL: Fast-Track-Portal (portal.<fast-track-domain>), dort läuft das KI-Interview.
        portal_url: fastTrackHost ? `https://${fastTrackHost}` : "",
        button_label: DEFAULT_BUTTON,
      };

      const logo = resolveBookingLogo(tenant, sourceLanding, targetLanding, fastTrackLanding);
      const logoMetadata = { email_logo_url: logo.url, email_logo_source: logo.source, email_logo_reason: logo.reason, email_logo_candidates: logo.candidates };

      const { html, text, subject } = renderEmail({
        subject: DEFAULT_SUBJECT,
        body: DEFAULT_BODY,
        preheader: DEFAULT_PREHEADER,
        spamHint: true,
        tenant: { ...tenant, logo_url: logo.url },
        recruiter: { name: recruiterName, avatar_url: recruiterAvatar, role_label: "Personalabteilung" },
        vars,
      });

      const ics = buildIcs({
        uid: `${appt.id}@${fastTrackDomain || "mb-portal"}`,
        title: `Bewerbungsgespräch – ${tenant.name}`,
        description: `Online-Bewerbungsgespräch mit ${recruiterName}. Die Teilnahme erfolgt über Ihren persönlichen Zugangslink: ${magicLink}\n\nTermin absagen oder verschieben: ${cancelUrl}`,
        start: starts, end: ends, url: magicLink,
        organizerName: recruiterName, organizerEmail: tenant.sender_email || tenant.smtp_username!,
        attendeeEmail: app.email,
      });

      if (dryRun) { sent++; results.push({ id: appt.id, status: "would_send", to: app.email }); continue; }

      // Letzte Sicherung gegen Doppelversand für genau DIESEN Termin.
      // Bewusst NICHT auf Bewerbungsebene sperren: nach einer Umbuchung muss
      // die Bestätigung für den neuen Termin rausgehen dürfen.
      // Zusätzlich eine kurze Empfängersperre (2 h): sie fängt den Fall ab,
      // dass derselbe Mensch über zwei Vorgänge parallel bestätigt wird —
      // eine echte Umbuchung Stunden später bleibt möglich.
      if (!forceResend) {
        const dup = await isDuplicateSend(admin, {
          recipient: app.email, templateName: REMINDER_KIND,
          metadataKey: "appointment_id", metadataValue: appt.id,
          windowHours: 2,
        });
        if (dup.duplicate) { skipped++; results.push({ id: appt.id, status: "skipped", reason: dup.reason }); continue; }
      }

      // Terminbestätigung ist kritisch: sie wird nie durch Pause/Kontingent
      // blockiert (nur protokolliert), sonst hat der Bewerber keinen Termin.
      const allowance = await guardSend({
        admin, tenantId: tenant.id, templateName: REMINDER_KIND, recipient: app.email,
        kind: "critical", senderEmail: tenant.sender_email ?? tenant.smtp_username,
        metadata: { appointment_id: appt.id, application_id: app.id, source: "send-booking-confirmation" },
      });
      if (!allowance.allowed) { skipped++; results.push({ id: appt.id, reason: allowance.reason }); continue; }

      const claimInput = {
        eventKey: forceResend
          ? `booking_confirmation:${appt.id}:manual:${crypto.randomUUID()}`
          : `booking_confirmation:${appt.id}`,
        templateName: REMINDER_KIND,
        recipient: app.email,
        tenantId: tenant.id,
        senderEmail: tenant.sender_email ?? tenant.smtp_username,
        subject,
        html,
        metadata: { appointment_id: appt.id, application_id: app.id, source: "send-booking-confirmation", manual_resend: forceResend },
      };
      const claim = await claimEmailEvent(admin, claimInput);
      if (!claim) { skipped++; results.push({ id: appt.id, status: "skipped", reason: "duplicate_blocked_by_db" }); continue; }

      try {
        // Versand mit gezielter Wiederholung bei Verbindungsfehlern (kein Doppelversand).
        const transporter = {
      sendMail: (message: Record<string, unknown>) => sendMailWithRetry(tenant as any, message, { label: "send-booking-confirmation" }),
      verify: () => createSmtpTransport(tenant as any).verify(),
    };
        await transporter.sendMail({
          from: `"${tenant.sender_name || tenant.name}" <${tenant.sender_email || tenant.smtp_username!}>`,
          to: app.email,
          replyTo: tenant.reply_to_email ?? tenant.sender_email ?? undefined,
          subject, html, text,
          icalEvent: { filename: "termin.ics", method: "REQUEST", content: ics },
          attachments: [{ filename: "termin.ics", content: ics, contentType: "text/calendar; charset=utf-8; method=REQUEST" }],
        });
        await admin.from("application_reminder_log").upsert({
          application_id: app.id, tenant_id: tenant.id, reminder_kind: REMINDER_KIND,
          recipient_email: app.email, status: "sent",
        }, { onConflict: "application_id,reminder_kind" });
        await finishEmailClaim(admin, claim, { status: "sent", metadata: { appointment_id: appt.id, application_id: app.id, source: "send-booking-confirmation", ...logoMetadata, ...fallbackMeta } });
        sent++; results.push({ id: appt.id, status: "sent" });
        await new Promise((r) => setTimeout(r, 3000));
      } catch (e: any) {
        failed++;
        const err = String(e?.message ?? e).slice(0, 500);
        await admin.from("application_reminder_log").upsert({
          application_id: app.id, tenant_id: tenant.id, reminder_kind: REMINDER_KIND,
          recipient_email: app.email, status: "failed", error: err,
        }, { onConflict: "application_id,reminder_kind" });
        await finishEmailClaim(admin, claim, { status: "failed", error: err, metadata: { appointment_id: appt.id, application_id: app.id, source: "send-booking-confirmation", ...logoMetadata, ...fallbackMeta } });
        results.push({ id: appt.id, status: "failed", error: err });
      }
    }

    return json({ success: true, version: FUNCTION_VERSION, dry_run: dryRun, candidates: appts.length, todo: todo.length, sent, skipped, failed, results: dryRun ? results : undefined });
  } catch (err: any) {
    console.error(err);
    return json({ error: err?.message ?? "Unknown error", version: FUNCTION_VERSION }, 500);
  }
});
