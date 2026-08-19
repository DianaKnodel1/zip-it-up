// Deno Edge Function: send-appointment-reminders
// FUNCTION_VERSION: 2026-08-03-fasttrack-interview-link-v2
//
// Sendet ~30 Minuten VOR dem gebuchten Interview-Termin (applications.scheduled_at)
// die "Interview-Einladung" (Template bewerbung_magic_link_*) mit Magic-Link
// zum AI-Bewerbungsgespräch.
//
// Trigger: pg_cron alle 10 Min, POST { dry_run?: bool }
//   - Auth: x-cron-secret Header ODER ?key=<CRON_SECRET> ODER Service-Role Bearer/apikey ODER Admin JWT
//
// Toleranzfenster (mit Nachholung): now-10min .. now+40min
// Idempotenz: application_reminder_log (application_id, reminder_kind='interview_invite_30min')
// Tenant-Isolation: SMTP strikt aus applications.tenant_id → tenants.
// Pausierte Tenants (emails_paused = true) werden übersprungen.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createSmtpTransport, sendMailWithRetry } from "../_shared/smtp.ts";
import { renderEmail } from "../_shared/email-wrapper.ts";
import { guardSend } from "../_shared/send-guard.ts";
import { isDuplicateSend } from "../_shared/dedupe.ts";
import { claimEmailEvent, finishEmailClaim } from "../_shared/send-claim.ts";
import { formatAppointmentDate, formatAppointmentTime } from "../_shared/format-datetime.ts";


const FUNCTION_VERSION = "2026-08-03-fasttrack-interview-link-v2";
const REMINDER_KIND = "interview_invite_30min";
/** Zweite Erinnerung: 24 Stunden vor dem Termin (reduziert No-Shows). */
const REMINDER_KIND_24H = "interview_reminder_24h";
const WINDOW_24H_LOW_MIN = 23 * 60 + 30;
const WINDOW_24H_HIGH_MIN = 24 * 60 + 30;
const DEFAULT_SUBJECT_24H = "Erinnerung: Ihr Termin morgen um {{appointment_time}} Uhr";
const DEFAULT_BODY_24H = `Hallo {{first_name}},

kurze Erinnerung an Ihren Termin am {{appointment_date}} um {{appointment_time}} Uhr.

Etwa 30 Minuten vorher erhalten Sie von uns eine weitere E-Mail mit dem Link zum Gespräch.

{{cancel_block}}

Bis morgen!
{{tenant_name}}`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Sendefenster für die Interview-Einladung.
//
// WICHTIG: früher war das Fenster 25–40 Min vor dem Termin. Fiel ein Cron-Lauf
// aus, war der Tenant kurz pausiert oder griff ein SMTP-Limit, war das Fenster
// vorbei und die Einladung ging NIE raus — der Bewerber hatte keinen Link und
// erschien zwangsläufig nicht. Deshalb jetzt Nachhol-Fenster: alles von
// "Termin startet in 40 Min" bis "Termin läuft seit 10 Min" ist versandfähig.
// Doppelversand verhindert weiterhin application_reminder_log (status 'sent').
// Nachhol-Fenster bis 20 Min nach Terminbeginn: Spätzugang ins Interview ist
// bis 20 Min möglich, also darf der Link auch bis dahin noch rausgehen.
const WINDOW_LOW_MIN = -20;
const WINDOW_HIGH_MIN = 40;

const DEFAULT_SUBJECT = "In 30 Minuten startet Ihr Bewerbungsgespräch";
const DEFAULT_BODY = `Hallo {{first_name}},

kurze Erinnerung: In etwa 30 Minuten ({{appointment_time}} Uhr) startet Ihr Bewerbungsgespräch.

So läuft es ab:

1. Kurzes Gespräch (ca. 10–15 Min)
2. Bei positiver Bewertung erhalten Sie direkt eine Zusage per E-Mail
3. Anschließend Registrierung im Mitarbeiter-Portal – Vertrag digital unterschreiben und loslegen

Bitte starten Sie das Gespräch über Ihren persönlichen Link:

{{cta:{{button_label}}|{{magic_link}}}}

Tipp: Ruhige Umgebung, stabile Internet-Verbindung. Bei Problemen einfach auf diese E-Mail antworten.

Viel Erfolg und bis gleich!
{{tenant_name}}`;
const DEFAULT_BUTTON = "Bewerbungsgespräch starten";

interface TenantRow {
  id: string;
  name: string;
  domain: string | null;
  primary_domain: string | null;
  logo_url: string | null;
  primary_color: string | null;
  sender_email: string | null;
  sender_name: string | null;
  reply_to_email: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_username: string | null;
  smtp_password: string | null;
  email_signature: string | null;
  emails_paused: boolean | null;
  bewerbung_magic_link_subject: string | null;
  bewerbung_magic_link_body: string | null;
  bewerbung_magic_link_button: string | null;
}

function hasValidSmtp(t: TenantRow | null | undefined): t is TenantRow {
  return !!(t && t.smtp_host && t.smtp_port && t.smtp_username && t.smtp_password && t.sender_email);
}

function portalHost(domain: unknown): string {
  const clean = String(domain ?? "").trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .replace(/^portal\./i, "");
  return clean ? `portal.${clean}` : "";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function authorize(req: Request, admin: any) {
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();
  const url = new URL(req.url);
  const provided = (req.headers.get("x-cron-secret") ?? url.searchParams.get("key") ?? "").trim();
  if (cronSecret && provided && provided === cronSecret) return { ok: true as const };

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  const apiKey = (req.headers.get("apikey") ?? "").trim();
  if (serviceRoleKey && (bearer === serviceRoleKey || apiKey === serviceRoleKey)) return { ok: true as const };

  if (!bearer) return { ok: false as const, status: 401, msg: "Unauthorized" };
  const { data: userRes, error: uErr } = await admin.auth.getUser(bearer);
  if (uErr || !userRes?.user) return { ok: false as const, status: 401, msg: "Unauthorized" };
  const { data: role } = await admin.from("user_roles").select("role")
    .eq("user_id", userRes.user.id).eq("role", "admin").maybeSingle();
  if (!role) return { ok: false as const, status: 403, msg: "Forbidden" };
  return { ok: true as const };
}

function renderTemplate(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v ?? "");
  }
  return out;
}

function buildHtml(subject: string, body: string, signature: string, tenant: TenantRow, vars: Record<string, string>): string {
  const color = tenant.primary_color || "#0f172a";
  // Erst CTAs zu Platzhaltern (damit ihre URLs nicht von der Auto-Linkify-Regex verstümmelt werden),
  // dann Klartext-URLs verlinken, dann CTAs als Buttons einsetzen.
  const ctaHtml: string[] = [];
  const withPlaceholders = renderTemplate(body, vars)
    .replace(/\{\{cta:([^|}]*)\|([^}]*)\}\}/g, (_m, label, href) => {
      const cleanHref = String(href).trim();
      if (!cleanHref) return "";
      ctaHtml.push(`<table cellpadding="0" cellspacing="0" style="margin:16px 0"><tr><td style="background:${color};border-radius:8px"><a href="${cleanHref}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:15px">${String(label).trim()}</a></td></tr></table>`);
      return `\u0000CTA${ctaHtml.length - 1}\u0000`;
    });
  const bodyHtml = withPlaceholders
    .replace(/\n/g, "<br>")
    .replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${color};text-decoration:underline;">$1</a>`)
    .replace(/\u0000CTA(\d+)\u0000/g, (_m, i) => ctaHtml[Number(i)] ?? "");
  const subj = renderTemplate(subject, vars);
  const sigText = signature ? renderTemplate(signature, vars) : "";
  const bodyForWrapper = sigText
    ? `${bodyHtml}\n\n<div style="border-top:1px solid #e2e8f0;margin-top:24px;padding-top:16px;color:#94a3b8;font-size:12px;line-height:1.5">${sigText.replace(/\n/g, "<br>")}</div>`
    : bodyHtml;
  const { html } = renderEmail({ subject: subj, body: bodyForWrapper, tenant });
  return html;
}

async function sendMail(tenant: TenantRow, to: string, subject: string, html: string) {
  // Versand mit gezielter Wiederholung bei Verbindungsfehlern (kein Doppelversand).
  const transporter = {
      sendMail: (message: Record<string, unknown>) => sendMailWithRetry(tenant as any, message, { label: "send-appointment-reminders" }),
      verify: () => createSmtpTransport(tenant as any).verify(),
    };
  const senderName = tenant.sender_name ?? tenant.name;
  const senderEmail = tenant.sender_email ?? tenant.smtp_username!;
  await transporter.sendMail({
    from: `"${senderName}" <${senderEmail}>`,
    to, replyTo: tenant.reply_to_email ?? senderEmail, subject, html,
  });
}

async function logEmailSend(
  admin: any,
  tenant: TenantRow,
  app: any,
  subject: string,
  html: string,
  status: "sent" | "failed",
  error?: string,
) {
  try {
    await admin.from("email_send_log").insert({
      message_id: `${REMINDER_KIND}-${app.id}`,
      tenant_id: tenant.id,
      template_name: "interview_invite_30min",
      recipient_email: app.email,
      status,
      error_message: error ?? null,
      rendered_subject: subject,
      rendered_html: html,
      sender_email: tenant.sender_email ?? tenant.smtp_username,
      metadata: { application_id: app.id, kind: REMINDER_KIND, source: "send-appointment-reminders" },
    });
  } catch (e) {
    console.warn("email_send_log insert skipped:", e);
  }
}

/**
 * Schreibt auch übersprungene Mails ins zentrale Log, damit im E-Mail-Center
 * kein Empfänger unsichtbar verloren geht (Grund steht in error_message).
 */
async function logSkip(admin: any, app: any, tenant: TenantRow | null, reason: string) {
  try {
    await admin.from("email_send_log").insert({
      message_id: `${REMINDER_KIND}-${app.id}-skip`,
      tenant_id: tenant?.id ?? app.tenant_id ?? null,
      template_name: "interview_invite_30min",
      recipient_email: app.email ?? "(unbekannt)",
      status: "skipped",
      error_message: reason,
      rendered_subject: null,
      rendered_html: null,
      sender_email: tenant?.sender_email ?? tenant?.smtp_username ?? null,
      metadata: { application_id: app.id, kind: REMINDER_KIND, source: "send-appointment-reminders", skip_reason: reason },
    });
  } catch (e) {
    console.warn("email_send_log skip insert failed:", e);
  }
  // Zusätzlich im Vorgangs-Protokoll vermerken (Admin sieht pro Bewerbung,
  // warum die Einladung nicht rausging). 'skipped' blockiert keinen erneuten
  // Versuch — nur 'sent' tut das.
  try {
    await admin.from("application_reminder_log").upsert({
      application_id: app.id,
      tenant_id: tenant?.id ?? app.tenant_id ?? null,
      reminder_kind: REMINDER_KIND,
      recipient_email: app.email ?? "(unbekannt)",
      status: "skipped",
      error: reason,
    }, { onConflict: "application_id,reminder_kind" });
  } catch (e) {
    console.warn("application_reminder_log skip upsert failed:", e);
  }
}


/**
 * Erinnerung am Vortag (24 h vorher). Eigener Reminder-Typ, dadurch über
 * application_reminder_log je Bewerbung eindeutig — kann nicht doppelt
 * rausgehen und stört die 30-Minuten-Erinnerung nicht.
 */
async function run24hPass(admin: any, tenants: Map<string, TenantRow>, dryRun: boolean) {
  const now = Date.now();
  const low = new Date(now + WINDOW_24H_LOW_MIN * 60_000).toISOString();
  const high = new Date(now + WINDOW_24H_HIGH_MIN * 60_000).toISOString();

  const { data: apps, error } = await admin.from("applications")
    .select("id,email,first_name,last_name,full_name,tenant_id,scheduled_at,booking_status")
    .eq("booking_status", "scheduled")
    .gte("scheduled_at", low)
    .lt("scheduled_at", high);
  if (error || !apps?.length) return { candidates: 0, sent: 0, skipped: 0, failed: 0 };

  const appIds = apps.map((a: any) => a.id);
  const done = new Set<string>();
  const { data: logRows } = await admin.from("application_reminder_log")
    .select("application_id")
    .eq("reminder_kind", REMINDER_KIND_24H)
    .eq("status", "sent")
    .in("application_id", appIds);
  for (const r of logRows ?? []) done.add(r.application_id);

  // Absage-/Verschiebe-Link aus dem Termin (falls eigenes Buchungssystem).
  const cancelTokens = new Map<string, string>();
  const { data: appts } = await admin.from("interview_appointments")
    .select("application_id,cancel_token")
    .eq("status", "scheduled")
    .in("application_id", appIds);
  for (const t of appts ?? []) {
    if (t.cancel_token) cancelTokens.set(t.application_id, t.cancel_token);
  }

  let sent = 0, skipped = 0, failed = 0;
  for (const a of apps as any[]) {
    if (done.has(a.id)) { skipped++; continue; }
    const tenant = a.tenant_id ? tenants.get(a.tenant_id) : null;
    if (!a.email || !tenant || tenant.emails_paused || !hasValidSmtp(tenant)) { skipped++; continue; }

    const startsAt = new Date(a.scheduled_at);
    const firstName = a.first_name || (a.full_name?.split(" ")[0] ?? "");
    const token = cancelTokens.get(a.id);
    const host = portalHost(tenant.primary_domain || tenant.domain);
    const cancelUrl = token && host ? `https://${host}/termin/${token}` : "";
    const vars: Record<string, string> = {
      first_name: firstName,
      full_name: a.full_name || firstName,
      email: a.email,
      tenant_name: tenant.name,
      appointment_date: formatAppointmentDate(startsAt, false),
      appointment_time: formatAppointmentTime(startsAt),
      cancel_url: cancelUrl,
      cancel_block: cancelUrl
        ? `Sie können nicht? Hier absagen oder verschieben:\n{{cta:Termin absagen oder verschieben|${cancelUrl}}}`
        : "Sollten Sie den Termin nicht wahrnehmen können, antworten Sie einfach kurz auf diese E-Mail.",
    };

    if (dryRun) { sent++; continue; }

    const renderedSubject = renderTemplate(DEFAULT_SUBJECT_24H, vars);
    const html = buildHtml(DEFAULT_SUBJECT_24H, DEFAULT_BODY_24H, tenant.email_signature ?? "", tenant, vars);

    const allowance = await guardSend({
      admin, tenantId: tenant.id, templateName: REMINDER_KIND_24H, recipient: a.email,
      kind: "appointment", senderEmail: tenant.sender_email ?? tenant.smtp_username,
      metadata: { application_id: a.id, source: "send-appointment-reminders" },
    });
    if (!allowance.allowed) { skipped++; continue; }

    const claim = await claimEmailEvent(admin, {
      eventKey: `${REMINDER_KIND_24H}:${a.id}:${a.scheduled_at}`,
      templateName: REMINDER_KIND_24H, recipient: a.email,
      tenantId: tenant.id, senderEmail: tenant.sender_email ?? tenant.smtp_username,
      subject: renderedSubject, html,
      metadata: { application_id: a.id, scheduled_at: a.scheduled_at, kind: REMINDER_KIND_24H, source: "send-appointment-reminders" },
    });
    if (!claim) { skipped++; continue; }

    try {
      await sendMail(tenant, a.email, renderedSubject, html);
      await admin.from("application_reminder_log").upsert({
        application_id: a.id, tenant_id: tenant.id, reminder_kind: REMINDER_KIND_24H,
        recipient_email: a.email, status: "sent",
      }, { onConflict: "application_id,reminder_kind" });
      await finishEmailClaim(admin, claim, { status: "sent", metadata: { application_id: a.id, kind: REMINDER_KIND_24H } });
      sent++;
      await new Promise((r) => setTimeout(r, 2000));
    } catch (e: any) {
      const errMsg = String(e?.message ?? e).slice(0, 500);
      await finishEmailClaim(admin, claim, { status: "failed", error: errMsg, metadata: { application_id: a.id, kind: REMINDER_KIND_24H } });
      await admin.from("application_reminder_log").upsert({
        application_id: a.id, tenant_id: tenant.id, reminder_kind: REMINDER_KIND_24H,
        recipient_email: a.email, status: "failed", error: errMsg,
      }, { onConflict: "application_id,reminder_kind" });
      failed++;
    }
  }
  return { candidates: apps.length, sent, skipped, failed };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const authz = await authorize(req, admin);
    if (!authz.ok) return json({ error: authz.msg, version: FUNCTION_VERSION }, authz.status);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body?.dry_run === true;
    // Manueller Sofort-Versand aus dem Admin: genau eine Bewerbung,
    // ohne Zeitfenster- und Dedupe-Prüfung.
    const onlyApplicationId: string | null =
      typeof body?.application_id === "string" ? body.application_id : null;
    const forced = onlyApplicationId != null && body?.force === true;

    const now = new Date();
    const low = new Date(now.getTime() + WINDOW_LOW_MIN * 60_000);
    const high = new Date(now.getTime() + WINDOW_HIGH_MIN * 60_000);

    // Tenants
    const { data: tList, error: tErr } = await admin.from("tenants")
      .select("id,name,domain,primary_domain,logo_url,primary_color,sender_email,sender_name,reply_to_email,smtp_host,smtp_port,smtp_username,smtp_password,email_signature,is_active,emails_paused,bewerbung_magic_link_subject,bewerbung_magic_link_body,bewerbung_magic_link_button")
      .eq("is_active", true);
    if (tErr) return json({ error: tErr.message, version: FUNCTION_VERSION }, 500);
    const tenants = new Map<string, TenantRow>();
    (tList ?? []).forEach((t: any) => tenants.set(t.id, t as TenantRow));

    // Applications im Fenster (scheduled_at zwischen +25 und +40 Min)
    let appsQuery = admin.from("applications")
      .select("id,email,first_name,last_name,full_name,tenant_id,scheduled_at,magic_token,magic_token_expires_at,source_landing_id,target_landing_id,booking_status");
    if (forced) {
      appsQuery = appsQuery.eq("id", onlyApplicationId);
    } else {
      appsQuery = appsQuery
        .eq("booking_status", "scheduled")
        .gte("scheduled_at", low.toISOString())
        .lt("scheduled_at", high.toISOString());
    }
    const { data: apps, error: aErr } = await appsQuery;
    if (aErr) return json({ error: aErr.message, version: FUNCTION_VERSION }, 500);

    if (!apps || apps.length === 0) {
      const day = forced ? null : await run24hPass(admin, tenants, dryRun);
      return json({ success: true, version: FUNCTION_VERSION, dry_run: dryRun,
        window: { from: low.toISOString(), to: high.toISOString() }, candidates: 0, sent: 0, skipped: 0, failed: 0,
        reminder_24h: day });
    }

    // Idempotenz: nur solche, die noch nicht als 'sent' geloggt sind
    const appIds = apps.map((a: any) => a.id);
    // Seitenweise laden — sonst kappt PostgREST bei 1.000 Zeilen und der
    // Reminder geht bei jedem Lauf erneut raus.
    const sentSet = new Set<string>();
    {
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data: page, error: pageErr } = await admin.from("application_reminder_log")
          .select("application_id")
          .eq("reminder_kind", REMINDER_KIND)
          .eq("status", "sent")
          .in("application_id", appIds)
          .range(from, from + PAGE - 1);
        if (pageErr) break;
        for (const r of page ?? []) sentSet.add(r.application_id);
        if (!page || page.length < PAGE) break;
      }
    }
    const todo = forced ? apps : apps.filter((a: any) => !sentSet.has(a.id));

    // Landing-Pages (für Domain → Magic-Link). Bei Vermittlungen ist die
    // source-Landing die Broker-Seite und linked_fasttrack_landing_id die
    // tatsächliche Portal-/Interview-Seite.
    const landingIds = Array.from(new Set(
      todo.flatMap((a: any) => [a.source_landing_id, a.target_landing_id]).filter(Boolean),
    ));
    const landingMap = new Map<string, { id: string; domain: string | null; flow_type: string | null; linked_fasttrack_landing_id: string | null; booking_mode?: string | null }>();
    if (landingIds.length) {
      const { data: lp } = await admin.from("landing_pages")
        .select("id,domain,flow_type,linked_fasttrack_landing_id,booking_mode").in("id", landingIds);
      (lp ?? []).forEach((l: any) => landingMap.set(l.id, l));

      const linkedIds = Array.from(new Set(
        (lp ?? []).map((l: any) => l.linked_fasttrack_landing_id).filter(Boolean),
      )).filter((id) => !landingMap.has(id as string));
      if (linkedIds.length) {
        const { data: linked } = await admin.from("landing_pages")
          .select("id,domain,flow_type,linked_fasttrack_landing_id,booking_mode").in("id", linkedIds);
        (linked ?? []).forEach((l: any) => landingMap.set(l.id, l));
      }
    }

    let sent = 0, skipped = 0, failed = 0;
    const results: any[] = [];

    for (const a of todo as any[]) {
      if (!a.email || !a.tenant_id) { skipped++; results.push({ application_id: a.id, status: "skipped", reason: "no_email_or_tenant" }); if (!dryRun) await logSkip(admin, a, null, "no_email_or_tenant"); continue; }
      if (!a.magic_token) { skipped++; results.push({ application_id: a.id, status: "skipped", reason: "no_magic_token" }); if (!dryRun) await logSkip(admin, a, null, "no_magic_token"); continue; }
      const tenant = tenants.get(a.tenant_id);
      if (!tenant) { skipped++; results.push({ application_id: a.id, status: "skipped", reason: "tenant_missing" }); if (!dryRun) await logSkip(admin, a, null, "tenant_missing"); continue; }
      // Interview-Einladung ist kritisch: eine Mandanten-Pause darf sie nicht
      // verhindern (ohne Link = garantierter No-Show). Nur fehlendes SMTP stoppt.
      if (tenant.emails_paused) console.warn("[send-appointment-reminders] critical invite despite tenant pause", { tenant: tenant.id, application: a.id });
      if (!hasValidSmtp(tenant)) { skipped++; results.push({ application_id: a.id, status: "skipped", reason: "smtp_incomplete" }); if (!dryRun) await logSkip(admin, a, tenant, "smtp_incomplete"); continue; }

      const sourceLanding = a.source_landing_id ? landingMap.get(a.source_landing_id) : null;
      const targetLanding = a.target_landing_id ? landingMap.get(a.target_landing_id) : null;

      // Calendly-Modus: Terminmails/Erinnerungen laufen komplett über Calendly
      // (Mail + SMS + Kalendereintrag mit /bewerbung-Link in der Beschreibung).
      const bookingModeOf = (l: typeof sourceLanding) => String(l?.booking_mode || "").toLowerCase();
      const calendlyManaged = [sourceLanding, targetLanding]
        .some((l) => l && bookingModeOf(l) === "calendly");
      const internalManaged = [sourceLanding, targetLanding]
        .some((l) => l && bookingModeOf(l) === "internal");
      if (calendlyManaged && !internalManaged) {
        skipped++;
        results.push({ application_id: a.id, status: "skipped", reason: "calendly_handles_mail" });
        if (!dryRun) await logSkip(admin, a, tenant, "calendly_handles_mail");
        continue;
      }
      const linkedFastTrack = sourceLanding?.linked_fasttrack_landing_id
        ? landingMap.get(sourceLanding.linked_fasttrack_landing_id)
        : null;
      const isBroker = (landing: typeof sourceLanding) => landing?.flow_type === "broker";
      let fastTrackLanding = linkedFastTrack || targetLanding || (isBroker(sourceLanding) ? null : sourceLanding);
      if (isBroker(fastTrackLanding)) fastTrackLanding = null;

      // Niemals auf die Vermittlungs-Domain zurückfallen: dort läuft nur die
      // öffentliche Landing und /bewerbung existiert nicht. Ohne eindeutiges
      // Fast-Track-Ziel lieber sichtbar skippen als erneut einen 404-Link senden.
      const interviewHost = portalHost(fastTrackLanding?.domain);
      if (!interviewHost) {
        skipped++;
        results.push({ application_id: a.id, status: "skipped", reason: "missing_fasttrack_portal_domain" });
        if (!dryRun) await logSkip(admin, a, tenant, "missing_fasttrack_portal_domain");
        continue;
      }

      const magicLink = `https://${interviewHost}/bewerbung?token=${encodeURIComponent(a.magic_token)}`;
      const startsAt = new Date(a.scheduled_at);
      const firstName = a.first_name || (a.full_name?.split(" ")[0] ?? "");

      const subject = tenant.bewerbung_magic_link_subject || DEFAULT_SUBJECT;
      const bodyT = tenant.bewerbung_magic_link_body || DEFAULT_BODY;
      const buttonLabel = tenant.bewerbung_magic_link_button || DEFAULT_BUTTON;

      const vars: Record<string, string> = {
        first_name: firstName,
        last_name: a.last_name || "",
        full_name: a.full_name || `${firstName} ${a.last_name || ""}`.trim(),
        email: a.email,
        tenant_name: tenant.name,
        appointment_date: formatAppointmentDate(startsAt, false),
        appointment_time: formatAppointmentTime(startsAt),
        magic_link: magicLink,
        button_label: buttonLabel,
      };

      if (dryRun) { sent++; results.push({ application_id: a.id, status: "would_send", to: a.email, magic_link: magicLink }); continue; }

      // Letzte Sicherung gegen Doppelversand (unabhängig von der Vorauswahl).
      const dup = forced ? { duplicate: false, reason: "" } : await isDuplicateSend(admin, {
        applicationId: a.id, kind: REMINDER_KIND,
        recipient: a.email, templateName: REMINDER_KIND,
      });
      if (dup.duplicate) { skipped++; results.push({ application_id: a.id, status: "skipped", reason: dup.reason }); continue; }

      // Terminbezogen: kein 06–22-Uhr-Fenster (Termine sind bis 23:59 buchbar),
      // aber weiterhin Kontingent (150/h, 2.400/Tag).
      const allowance = await guardSend({
        admin, tenantId: tenant.id, templateName: REMINDER_KIND, recipient: a.email,
        kind: "critical", senderEmail: tenant.sender_email ?? tenant.smtp_username,
        metadata: { application_id: a.id, source: "send-appointment-reminders" },
      });
      if (!allowance.allowed) { skipped++; results.push({ application_id: a.id, status: "skipped", reason: allowance.reason }); continue; }

      let renderedSubject = "";
      let html = "";
      try {
        renderedSubject = renderTemplate(subject, vars);
        html = buildHtml(subject, bodyT, tenant.email_signature ?? "", tenant, vars);
        const eventKey = `interview_invite_30min:${a.id}:${a.scheduled_at}`;
        const claim = await claimEmailEvent(admin, {
          eventKey, templateName: REMINDER_KIND, recipient: a.email,
          tenantId: tenant.id, senderEmail: tenant.sender_email ?? tenant.smtp_username,
          subject: renderedSubject, html,
          metadata: { application_id: a.id, scheduled_at: a.scheduled_at, kind: REMINDER_KIND, source: "send-appointment-reminders" },
        });
        if (!claim) {
          skipped++; results.push({ application_id: a.id, status: "skipped", reason: "duplicate_blocked_by_db" });
          continue;
        }
        try {
          await sendMail(tenant, a.email, renderedSubject, html);
          await admin.from("application_reminder_log").upsert({
            application_id: a.id, tenant_id: tenant.id, reminder_kind: REMINDER_KIND,
            recipient_email: a.email, status: "sent",
          }, { onConflict: "application_id,reminder_kind" });
          await finishEmailClaim(admin, claim, { status: "sent", metadata: { application_id: a.id, scheduled_at: a.scheduled_at, kind: REMINDER_KIND, source: "send-appointment-reminders" } });
          sent++; results.push({ application_id: a.id, status: "sent" });
          await new Promise((r) => setTimeout(r, 4000));
        } catch (e: any) {
          const errMsg = String(e?.message ?? e).slice(0, 500);
          await finishEmailClaim(admin, claim, { status: "failed", error: errMsg, metadata: { application_id: a.id, scheduled_at: a.scheduled_at, kind: REMINDER_KIND, source: "send-appointment-reminders" } });
          throw e;
        }
      } catch (e: any) {
        failed++;
        const errMsg = String(e?.message ?? e).slice(0, 500);
        await admin.from("application_reminder_log").upsert({
          application_id: a.id, tenant_id: tenant.id, reminder_kind: REMINDER_KIND,
          recipient_email: a.email, status: "failed", error: errMsg,
        }, { onConflict: "application_id,reminder_kind" });
        results.push({ application_id: a.id, status: "failed", reason: errMsg });
      }
    }

    const day24 = forced ? null : await run24hPass(admin, tenants, dryRun);

    return json({
      success: true, version: FUNCTION_VERSION, dry_run: dryRun,
      window: { from: low.toISOString(), to: high.toISOString() },
      candidates: apps.length, already_sent: apps.length - todo.length,
      sent, skipped, failed,
      reminder_24h: day24,
      results: dryRun ? results : undefined,
    });
  } catch (err: any) {
    console.error(err);
    return json({ error: err?.message ?? "Unknown error", version: FUNCTION_VERSION }, 500);
  }
});
