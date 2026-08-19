// Deno Edge Function: send-application-reminders
//
// Zwei Bewerber-Reminder (Vermittlungs-/Broker-Flow):
//  1) no_booking_24h / no_booking_72h — Bewerbung eingegangen, aber kein Calendly-Termin gebucht.
//  2) no_show_24h                     — Termin gebucht, aber nicht wahrgenommen (24h nach scheduled_at).
//
// Trigger: pg_cron alle 30 Min. Auth via x-cron-secret Header ODER ?key=<CRON_SECRET>.
// Idempotenz: application_reminder_log UNIQUE(application_id, reminder_kind).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createSmtpTransport, sendMailWithRetry } from "../_shared/smtp.ts";
import { resolveSender, type EmailKind } from "../_shared/sender-resolver.ts";
import { renderEmail } from "../_shared/email-wrapper.ts";
import {

  MAX_PER_1H_PER_TENANT as LIMIT_1H,
  MAX_PER_12H_PER_TENANT as LIMIT_12H,
  MAX_PER_RUN_PER_TENANT as LIMIT_RUN,
} from "../_shared/limits.ts";
import { formatAppointmentDate, formatAppointmentTime } from "../_shared/format-datetime.ts";
import { claimEmailEvent, finishEmailClaim, releaseEmailClaim, type EmailClaim } from "../_shared/send-claim.ts";

const FUNCTION_VERSION = "2026-07-15-rebook-after-cancel-v9-smtp-rate-limit-safe";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const NO_BOOKING_1_MIN = 24 * 60;         // 24h
const NO_BOOKING_2_MIN = 72 * 60;         // 72h
const NO_SHOW_FAST_MIN = 30;              // 30 Min nach verpasstem Termin (Sofort-Recovery)
const NO_SHOW_MIN      = 24 * 60;         // 24h nach Termin
// Interview geöffnet, aber nie beendet: 60 Min nach Start nachfassen,
// danach 5 Tage lang nachholbar (falls Cron/SMTP zwischenzeitlich stand).
const ABANDONED_MIN     = 60;
const ABANDONED_MAX_MIN = 5 * 24 * 60;
const REG_PENDING_0_MIN = 2 * 60;         // 2h nach Zusage/Invite (Sofort-Nachfass)
const REG_PENDING_1_MIN = 24 * 60;        // 24h nach Zusage/Invite
const REG_PENDING_2_MIN = 72 * 60;        // 72h nach Zusage/Invite (2. Nachfass)
const REBOOK_1_MIN      = 24 * 60;        // 24h nach Cancel
const REBOOK_2_MIN      = 72 * 60;        // 72h nach Cancel

const DEFAULTS = {
  no_booking: {
    subject: "Erinnerung: Dein Termin bei {{tenant_name}} steht noch aus",
    body:
`Hallo {{first_name}},

vielen Dank für deine Bewerbung bei {{tenant_name}}. Damit wir dich kennenlernen können, fehlt nur noch dein Wunschtermin für das kurze Erstgespräch.

{{cta:Jetzt Termin auswählen|{{calendly_link}}}}

Falls der Button nicht funktioniert, kopiere diesen Link:
{{calendly_link}}

Viele Grüße
{{recruiter_name}}
{{tenant_name}}`,
  },
  no_show: {
    subject: "Schade, dass es nicht geklappt hat – buche einen neuen Termin",
    body:
`Hallo {{first_name}},

leider konnten wir dich zu deinem Termin am {{appointment_date}} um {{appointment_time}} Uhr nicht erreichen. Kein Problem – wir hätten dich gern trotzdem kennengelernt.

Bitte wähle einen neuen Wunschtermin, der besser passt:

{{cta:Neuen Termin auswählen|{{calendly_link}}}}

Falls du Fragen hast oder Unterstützung brauchst, antworte einfach auf diese E-Mail.

Viele Grüße
{{recruiter_name}}
{{tenant_name}}`,
  },
  no_show_fast: {
    subject: "Wir haben Sie eben vermisst – neuen Termin in 30 Sekunden wählen",
    body:
`Hallo {{first_name}},

wir haben soeben vergeblich auf Sie gewartet: Ihr Interview am {{appointment_date}} um {{appointment_time}} Uhr hat ohne Sie stattgefunden.

Das ist überhaupt kein Problem – Ihre Bewerbung bleibt aktiv. Wählen Sie einfach einen neuen Termin, der besser in Ihren Tag passt:

{{cta:Neuen Termin wählen|{{calendly_link}}}}

Falls der Button nicht funktioniert, kopieren Sie diesen Link:
{{calendly_link}}

Die Auswahl dauert weniger als eine Minute. Bei Fragen antworten Sie einfach auf diese E-Mail.

Herzliche Grüße
{{recruiter_name}}
{{tenant_name}}`,
  },
  interview_abandoned: {
    subject: "Ihr Bewerbungsgespräch ist noch offen – hier weitermachen",
    body:
`Hallo {{first_name}},

Sie haben Ihr Bewerbungsgespräch bereits gestartet, es aber noch nicht abgeschlossen. Ihre bisherigen Antworten sind gespeichert – Sie können genau dort weitermachen, wo Sie aufgehört haben.

{{cta:Gespräch jetzt fortsetzen|{{resume_link}}}}

Falls der Button nicht funktioniert, kopieren Sie diesen Link:
{{resume_link}}

Es dauert nur wenige Minuten. Erst nach dem Abschluss können wir Ihre Bewerbung bewerten und Ihnen eine Rückmeldung geben.

Herzliche Grüße
{{recruiter_name}}
{{tenant_name}}`,
  },
  rebook: {
    subject: "Ihr Termin wurde abgesagt – bitte wählen Sie einen neuen",
    body:
`Hallo {{first_name}},

Ihr geplanter Termin bei {{tenant_name}} wurde abgesagt. Wir würden Sie trotzdem sehr gerne kennenlernen und laden Sie ein, einen neuen Wunschtermin zu wählen.

{{cta:Neuen Termin auswählen|{{calendly_link}}}}

Falls der Button nicht funktioniert, kopieren Sie diesen Link:
{{calendly_link}}

Bei Fragen antworten Sie einfach auf diese E-Mail – wir helfen gerne.

Herzliche Grüße
{{recruiter_name}}
{{tenant_name}}`,
  },
  registration: {
    subject: "Ihr Portal-Zugang wartet – nur noch ein Klick, {{first_name}}",
    body:
`Hallo {{first_name}},

herzlichen Glückwunsch nochmal zu Ihrer Zusage bei {{tenant_name}}.

Uns ist aufgefallen, dass Sie sich noch nicht im Mitarbeiter-Portal registriert haben. Erst mit der Registrierung können wir Ihren Arbeitsvertrag bereitstellen und Sie erhalten Zugriff auf Ihre ersten Aufträge.

Die Registrierung dauert nur 2 Minuten:

{{cta:Jetzt im Portal registrieren|{{portal_link}}}}

Falls der Button nicht funktioniert, kopieren Sie diesen Link:
{{portal_link}}

Bei Fragen antworten Sie einfach auf diese E-Mail – wir helfen gerne.

Herzliche Grüße
{{recruiter_name}}
{{tenant_name}}`,
  },
};

interface TenantRow {
  id: string; name: string; domain: string | null; primary_domain: string | null;
  logo_url: string | null; primary_color: string | null;
  sender_email: string | null; sender_name: string | null; reply_to_email: string | null;
  smtp_host: string | null; smtp_port: number | null; smtp_username: string | null; smtp_password: string | null;
  email_signature: string | null; emails_paused: boolean | null;
  reminder_app_no_booking_subject: string | null; reminder_app_no_booking_body: string | null;
  reminder_app_no_show_subject: string | null;    reminder_app_no_show_body: string | null;
  reminder_app_registration_subject: string | null; reminder_app_registration_body: string | null;
  reminder_app_rebook_subject: string | null; reminder_app_rebook_body: string | null;
}

type LandingRow = {
  id?: string | null;
  tenant_id?: string | null;
  slug?: string | null;
  source_slug?: string | null;
  calendly_url?: string | null;
  branding?: any;
  recruiter_name?: string | null;
  updated_at?: string | null;
  booking_mode?: string | null;
  domain?: string | null;
  linked_fasttrack_landing_id?: string | null;
  flow_type?: string | null;
};

function normalizeKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function calendlyFromLanding(landing: LandingRow | null | undefined): string {
  return String(landing?.calendly_url || landing?.branding?.calendly_url || "").trim();
}

function isInternalBooking(landing: LandingRow | null | undefined): boolean {
  return String(landing?.booking_mode || "").toLowerCase() === "internal";
}

function toLanding(row: any): LandingRow {
  return {
    id: row?.id ?? null,
    tenant_id: row?.tenant_id ?? null,
    slug: row?.slug ?? null,
    source_slug: row?.source_slug ?? null,
    calendly_url: row?.calendly_url ?? null,
    branding: row?.branding ?? null,
    recruiter_name: row?.recruiter_name ?? null,
    updated_at: row?.updated_at ?? null,
    booking_mode: row?.booking_mode ?? null,
    domain: row?.domain ?? null,
    linked_fasttrack_landing_id: row?.linked_fasttrack_landing_id ?? null,
    flow_type: row?.flow_type ?? null,
  };
}

function hasValidSmtp(t: TenantRow | null | undefined): t is TenantRow {
  return !!(t && t.smtp_host && t.smtp_port && t.smtp_username && t.smtp_password && t.sender_email);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

async function authorize(req: Request, admin: any): Promise<{ ok: true } | { ok: false; status: number; msg: string }> {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
  const url = new URL(req.url);
  const provided = req.headers.get("x-cron-secret") ?? url.searchParams.get("key");
  if (cronSecret && provided && provided === cronSecret) return { ok: true };
  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  const apiKey = req.headers.get("apikey")?.trim() ?? "";
  if (serviceRoleKey && (jwt === serviceRoleKey || apiKey === serviceRoleKey)) return { ok: true };
  if (jwt && await verifyServiceRoleJwt(jwt)) return { ok: true };
  if (apiKey && await verifyServiceRoleJwt(apiKey)) return { ok: true };
  if (!jwt) return { ok: false, status: 401, msg: "Unauthorized" };
  const { data: userRes, error } = await admin.auth.getUser(jwt);
  if (error || !userRes?.user) return { ok: false, status: 401, msg: "Unauthorized" };
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", userRes.user.id).eq("role", "admin").maybeSingle();
  if (!role) return { ok: false, status: 403, msg: "Forbidden" };
  return { ok: true };
}

function b64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function verifyServiceRoleJwt(token: string): Promise<boolean> {
  const jwtSecret = Deno.env.get("JWT_SECRET");
  if (!jwtSecret) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const [headerB64, payloadB64, signatureB64] = parts;
    const header = JSON.parse(new TextDecoder().decode(b64UrlToBytes(headerB64)));
    if (header?.alg !== "HS256") return false;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(jwtSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64UrlToBytes(signatureB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    if (!valid) return false;
    const claims = JSON.parse(new TextDecoder().decode(b64UrlToBytes(payloadB64)));
    if (claims?.exp && Date.now() / 1000 >= Number(claims.exp)) return false;
    return claims?.role === "service_role";
  } catch {
    return false;
  }
}

function render(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v ?? "");
  return out;
}

function buildHtml(subject: string, body: string, signature: string, tenant: TenantRow, vars: Record<string, string>): string {
  const color = tenant.primary_color || "#0f172a";
  // Erst CTAs zu Platzhaltern (damit ihre URLs nicht von der Auto-Linkify-Regex verstümmelt werden),
  // dann Klartext-URLs verlinken, dann CTAs als Buttons einsetzen.
  const ctaHtml: string[] = [];
  const withPlaceholders = render(body, vars).replace(/\{\{cta:([^|}]*)\|([^}]*)\}\}/g, (_m, label, href) => {
    const cleanHref = String(href).trim();
    if (!cleanHref) return "";
    ctaHtml.push(`<table cellpadding="0" cellspacing="0" style="margin:16px 0"><tr><td style="background:${color};border-radius:8px"><a href="${cleanHref}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:15px">${String(label).trim()}</a></td></tr></table>`);
    return `\u0000CTA${ctaHtml.length - 1}\u0000`;
  });
  const bodyHtml = withPlaceholders
    .replace(/\n/g, "<br>")
    .replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${color};text-decoration:underline;">$1</a>`)
    .replace(/\u0000CTA(\d+)\u0000/g, (_m, i) => ctaHtml[Number(i)] ?? "");
  const subj = render(subject, vars);
  const sigText = signature ? render(signature, vars) : "";
  const bodyForWrapper = sigText
    ? `${bodyHtml}\n\n<div style="border-top:1px solid #e2e8f0;margin-top:24px;padding-top:16px;color:#94a3b8;font-size:12px;line-height:1.5">${sigText.replace(/\n/g, "<br>")}</div>`
    : bodyHtml;
  const { html } = renderEmail({ subject: subj, body: bodyForWrapper, tenant });
  return html;
}

async function sendMail(tenant: TenantRow, to: string, subject: string, html: string) {
  // Mail-los-Modus: Funnel läuft ohne Mails (Calendly + /bewerbung).
  if ((tenant as any).mailless_mode !== false) {
    throw new Error("mailless_mode");
  }
  // Versand mit gezielter Wiederholung bei Verbindungsfehlern (kein Doppelversand).
  const transporter = {
      sendMail: (message: Record<string, unknown>) => sendMailWithRetry(tenant as any, message, { label: "send-application-reminders" }),
      verify: () => createSmtpTransport(tenant as any).verify(),
    };
  const senderName = tenant.sender_name ?? tenant.name;
  const senderEmail = tenant.sender_email ?? tenant.smtp_username!;
  await transporter.sendMail({
    from: `"${senderName}" <${senderEmail}>`, to,
    replyTo: tenant.reply_to_email ?? senderEmail,
    subject, html,
  });
}

function firstName(full?: string | null): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

function appendUtm(url: string, appId: string): string {
  if (!url) return "";
  const sep = url.includes("?") ? "&" : "?";
  const has = /utm_content=/.test(url);
  return has ? url : `${url}${sep}utm_content=${encodeURIComponent(appId)}`;
}

function portalHost(domain: unknown): string {
  const clean = String(domain ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/^portal\./, "");
  return clean ? `portal.${clean}` : "";
}

function smtpErrorMessage(e: unknown): string {
  return String((e as any)?.message ?? e ?? "SMTP error").slice(0, 500);
}

function isSmtpHourlyRateLimit(errMsg: string): boolean {
  const normalized = errMsg.toLowerCase();
  return (
    normalized.includes("too many messages") ||
    normalized.includes("last 60 minutes") ||
    normalized.includes("rate limit") ||
    normalized.includes("rate-limit") ||
    normalized.includes("throttl") ||
    normalized.includes("quota exceeded") ||
    normalized.includes("try again later")
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Mail-los-Modus: Das Portal verschickt keine Bewerber-Mails mehr.
  return json({ sent: 0, skipped: 0, reason: "mailless_mode", results: [] });

  // eslint-disable-next-line no-unreachable
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? Deno.env.get("API_EXTERNAL_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const authz = await authorize(req, admin);
    if (!authz.ok) return json({ error: authz.msg }, authz.status);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body?.dry_run === true;
    const onlyApplicationId: string | null = typeof body?.application_id === "string" ? body.application_id : null;
    const onlyEmail: string | null = typeof body?.only_email === "string" ? body.only_email.toLowerCase() : null;
    // Manueller Sofort-Versand aus dem Admin ("Jetzt senden"): genau eine
    // Bewerbung, genau eine Reminder-Art, ohne Zeitfenster-Prüfung.
    const forceKind: string | null =
      typeof body?.force_kind === "string" && onlyApplicationId ? body.force_kind : null;

    // Tenants vorladen
    const { data: tList, error: tErr } = await admin
      .from("tenants")
      .select("id,name,domain,primary_domain,logo_url,primary_color,sender_email,sender_name,reply_to_email,smtp_host,smtp_port,smtp_username,smtp_password,email_signature,is_active,emails_paused,mailless_mode,reminder_app_no_booking_subject,reminder_app_no_booking_body,reminder_app_no_show_subject,reminder_app_no_show_body,reminder_app_registration_subject,reminder_app_registration_body,reminder_app_rebook_subject,reminder_app_rebook_body")
      .eq("is_active", true);
    if (tErr) return json({ error: tErr.message }, 500);
    const tenants = new Map<string, TenantRow>((tList ?? []).map((t: any) => [t.id, t as TenantRow]));

    const now = Date.now();

    // ─── Kandidaten laden ───
    // Bewerbungen der letzten 10 Tage — Filterung im Code.
    const since = new Date(now - 10 * 86400_000).toISOString();
    let appsQuery = admin
      .from("applications")
      .select("id,tenant_id,broker_tenant_id,fasttrack_tenant_id,source_slug,source_landing_id,target_landing_id,full_name,email,status,created_at,updated_at,booking_status,scheduled_at,interview_started_at,interview_completed_at,flow_type,magic_token")
      .gte("created_at", since);
    if (onlyApplicationId) appsQuery = appsQuery.eq("id", onlyApplicationId);
    if (onlyEmail) appsQuery = appsQuery.ilike("email", onlyEmail);
    const { data: apps, error: aErr } = await appsQuery;

    if (aErr) return json({ error: aErr.message }, 500);

    if (!apps?.length) return json({ success: true, dry_run: dryRun, candidates: 0, sent: 0, skipped: 0, failed: 0 });

    // Landing-Pages (direkte Zuordnung via source_landing_id / target_landing_id)
    const landingIds = Array.from(new Set(apps.flatMap((a: any) => [a.source_landing_id, a.target_landing_id]).filter(Boolean)));
    const landingMap = new Map<string, LandingRow>();
    const landingErrors: Record<string, string> = {};
    const LANDING_COLS = "id,tenant_id,slug,source_slug,calendly_url,branding,updated_at,booking_mode,domain,linked_fasttrack_landing_id,flow_type";
    if (landingIds.length) {
      const { data: lps, error: lpErr } = await admin.from("landing_pages")
        .select(LANDING_COLS)
        .in("id", landingIds);
      if (lpErr) landingErrors.direct = lpErr.message;
      for (const l of (lps ?? []) as any[]) landingMap.set(l.id, toLanding(l));
    }

    // Legacy-Fallback über slug / source_slug.
    const sourceSlugs = Array.from(new Set(apps.map((a: any) => normalizeKey(a.source_slug)).filter(Boolean)));
    const slugLandingMap = new Map<string, LandingRow>();
    if (sourceSlugs.length) {
      const { data: bySlug, error: bsErr } = await admin.from("landing_pages")
        .select(LANDING_COLS)
        .in("slug", sourceSlugs);
      const { data: bySourceSlug, error: bssErr } = await admin.from("landing_pages")
        .select(LANDING_COLS)
        .in("source_slug", sourceSlugs);
      if (bsErr) landingErrors.by_slug = bsErr.message;
      if (bssErr) landingErrors.by_source_slug = bssErr.message;
      for (const l of ([...(bySlug ?? []), ...(bySourceSlug ?? [])] as any[])) {
        const landing = toLanding(l);
        const keys = [landing.slug, landing.source_slug].map(normalizeKey).filter(Boolean);
        for (const key of keys) {
          const current = slugLandingMap.get(key);
          if (!current || (!calendlyFromLanding(current) && !isInternalBooking(current)
              && (calendlyFromLanding(landing) || isInternalBooking(landing)))) {
            slugLandingMap.set(key, landing);
          }
        }
      }
    }

    // Ziel-Landing (Fast-Track) für Broker-Landings vorladen — brauchen wir für portal-Domain-Auflösung.
    const linkedIds = Array.from(new Set(
      Array.from(landingMap.values()).map((l) => l.linked_fasttrack_landing_id).filter(Boolean) as string[],
    )).filter((id) => !landingMap.has(id));
    if (linkedIds.length) {
      const { data: linkedLps } = await admin.from("landing_pages").select(LANDING_COLS).in("id", linkedIds);
      for (const l of (linkedLps ?? []) as any[]) landingMap.set(l.id, toLanding(l));
    }

    // Tenant-Fallback (nur relevant für Calendly-basierte Legacy-Flows).
    const tenantIdsForFallback = Array.from(new Set(apps.flatMap((a: any) => [a.tenant_id, a.broker_tenant_id, a.fasttrack_tenant_id]).filter(Boolean)));
    const tenantLandingFallback = new Map<string, LandingRow>();
    let tenantLandingRawCount = 0;
    if (tenantIdsForFallback.length) {
      const { data: tlps, error: tlpErr } = await admin.from("landing_pages")
        .select(LANDING_COLS)
        .in("tenant_id", tenantIdsForFallback)
        .order("updated_at", { ascending: false });
      if (tlpErr) landingErrors.tenant = tlpErr.message;
      tenantLandingRawCount = (tlps ?? []).length;
      for (const l of (tlps ?? []) as any[]) {
        const landing = toLanding(l);
        if (!tenantLandingFallback.has(l.tenant_id) && (calendlyFromLanding(landing) || isInternalBooking(landing))) {
          tenantLandingFallback.set(l.tenant_id, landing);
        }
      }
    }
    console.log("[reminders v4] landing queries", {
      landingIdsCount: landingIds.length,
      landingMapSize: landingMap.size,
      sourceSlugsCount: sourceSlugs.length,
      slugLandingMapSize: slugLandingMap.size,
      tenantIdsForFallbackCount: tenantIdsForFallback.length,
      tenantLandingRawCount,
      tenantLandingFallbackSize: tenantLandingFallback.size,
      landingErrors,
    });

    // Bereits versendete Reminder pro (application_id, kind)
    const appIds = apps.map((a: any) => a.id);
    // Nur 'sent' blockiert weitere Zustellversuche. 'skipped'/'failed' dürfen erneut
    // versucht werden (z.B. wenn inzwischen ein Calendly-Link hinterlegt wurde).
    // WICHTIG: seitenweise laden. PostgREST liefert sonst nur die ersten 1000
    // Zeilen — fehlt die Zeile dieses Bewerbers, wird dieselbe Mail bei JEDEM
    // Cron-Lauf erneut versendet (Endlosschleife).
    const already = new Set<string>();
    {
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data: page, error: pageErr } = await admin
          .from("application_reminder_log")
          .select("application_id,reminder_kind,status")
          .in("application_id", appIds)
          .eq("status", "sent")
          .range(from, from + PAGE - 1);
        if (pageErr) break;
        for (const r of page ?? []) already.add(`${r.application_id}|${r.reminder_kind}`);
        if (!page || page.length < PAGE) break;
      }
    }

    type ReminderKind = "no_booking_24h" | "no_booking_72h" | "no_show_30min" | "no_show_24h" | "interview_abandoned" | "registration_pending_2h" | "registration_pending_24h" | "registration_pending_72h" | "rebook_after_cancel_24h" | "rebook_after_cancel_72h";
    type Todo = { app: any; kind: ReminderKind; inviteToken?: string };
    const todo: Todo[] = [];

    // ─── Invitation-Tokens laden (für registration_pending) ───
    // Bewerbungen mit Status "akzeptiert" + Invitation-Token → prüfen ob registriert.
    const acceptedApps = (apps as any[]).filter((a) =>
      a.email && a.tenant_id &&
      (a.status === "akzeptiert" || a.status === "vermittlung_zusage" || a.status === "fasttrack_angenommen")
    );
    const acceptedIds = acceptedApps.map((a) => a.id);
    const tokensByAppId = new Map<string, { token: string; created_at: string }>();
    const registeredEmails = new Set<string>();
    if (acceptedIds.length) {
      const { data: tokens } = await admin
        .from("invitation_tokens")
        .select("token, application_id, created_at")
        .in("application_id", acceptedIds);
      for (const t of (tokens ?? []) as any[]) {
        if (!tokensByAppId.has(t.application_id)) {
          tokensByAppId.set(t.application_id, { token: t.token, created_at: t.created_at });
        }
      }
      // Registrierte Bewerber = existiert Profil im Ziel-Tenant, dessen Auth-User
      // dieselbe E-Mail trägt. WICHTIG: profiles hat KEINE email-Spalte — die
      // frühere Abfrage lief deshalb immer ins Leere und "registration_pending"
      // ging auch an längst registrierte Mitarbeiter raus.
      const emails = new Set(acceptedApps.map((a) => a.email.toLowerCase().trim()));
      const tenantIds = Array.from(new Set(acceptedApps.map((a) => a.fasttrack_tenant_id ?? a.tenant_id).filter(Boolean)));
      if (emails.size && tenantIds.length) {
        const { data: profs, error: profErr } = await admin
          .from("profiles")
          .select("user_id, tenant_id")
          .in("tenant_id", tenantIds);
        if (profErr) console.error("[reminders] profiles lookup:", profErr);
        const tenantByUserId = new Map<string, string>();
        for (const p of (profs ?? []) as any[]) {
          if (p.user_id && p.tenant_id) tenantByUserId.set(p.user_id, p.tenant_id);
        }
        if (tenantByUserId.size) {
          const { data: usersList } = await admin.auth.admin.listUsers({ page: 1, perPage: 5000 });
          for (const u of (usersList?.users ?? []) as any[]) {
            const tid = tenantByUserId.get(u.id);
            const mail = String(u.email ?? "").toLowerCase().trim();
            if (tid && mail && emails.has(mail)) registeredEmails.add(`${tid}|${mail}`);
          }
        }
      }
    }

    for (const a of apps as any[]) {
      if (!a.email || !a.tenant_id) continue;
      const createdMs = new Date(a.created_at).getTime();
      const ageMin = (now - createdMs) / 60_000;

      // 0) Interview gestartet, aber nie abgeschlossen — fällt sonst durch jedes
      //    Netz: die No-Show-Erkennung greift hier bewusst NICHT.
      if (a.interview_started_at && !a.interview_completed_at && a.status !== "akzeptiert") {
        const startedMin = (now - new Date(a.interview_started_at).getTime()) / 60_000;
        if (startedMin >= ABANDONED_MIN && startedMin < ABANDONED_MAX_MIN) {
          if (!already.has(`${a.id}|interview_abandoned`)) todo.push({ app: a, kind: "interview_abandoned" });
          continue;
        }
      }

      // 1) No-Show 24h nach Termin — nur wenn Termin nachweislich NICHT wahrgenommen wurde.
      const noShowEligible =
        a.scheduled_at &&
        !a.interview_started_at &&
        !a.interview_completed_at &&
        a.booking_status !== "completed";
      if (noShowEligible) {
        const schedMs = new Date(a.scheduled_at).getTime();
        const sinceMin = (now - schedMs) / 60_000;
        if (sinceMin >= NO_SHOW_FAST_MIN && sinceMin < NO_SHOW_MIN) {
          if (!already.has(`${a.id}|no_show_30min`)) {
            todo.push({ app: a, kind: "no_show_30min" });
            continue;
          }
        }
        if (sinceMin >= NO_SHOW_MIN && sinceMin < NO_SHOW_MIN + 24 * 60) {
          if (!already.has(`${a.id}|no_show_24h`)) todo.push({ app: a, kind: "no_show_24h" });
          continue;
        }
      }

      // 2) Registration Pending (Zusage erteilt, aber nicht registriert)
      const invite = tokensByAppId.get(a.id);
      if (invite) {
        const registrationTenantId = a.fasttrack_tenant_id ?? a.tenant_id;
        const emailKey = `${registrationTenantId}|${String(a.email).toLowerCase().trim()}`;
        const isRegistered = registeredEmails.has(emailKey);
        if (!isRegistered) {
          const inviteAgeMin = (now - new Date(invite.created_at).getTime()) / 60_000;
          if (inviteAgeMin >= REG_PENDING_0_MIN && inviteAgeMin < REG_PENDING_1_MIN) {
            if (!already.has(`${a.id}|registration_pending_2h`)) {
              todo.push({ app: a, kind: "registration_pending_2h", inviteToken: invite.token });
              continue;
            }
          } else if (inviteAgeMin >= REG_PENDING_1_MIN && inviteAgeMin < REG_PENDING_2_MIN) {
            if (!already.has(`${a.id}|registration_pending_24h`)) {
              todo.push({ app: a, kind: "registration_pending_24h", inviteToken: invite.token });
              continue;
            }
          } else if (inviteAgeMin >= REG_PENDING_2_MIN && inviteAgeMin < REG_PENDING_2_MIN + 5 * 24 * 60) {
            if (!already.has(`${a.id}|registration_pending_72h`)) {
              todo.push({ app: a, kind: "registration_pending_72h", inviteToken: invite.token });
              continue;
            }
          }
        }
        // Bewerber mit Zusage bekommen KEINE No-Booking Mail mehr.
        continue;
      }

      // 3) Rebook nach Cancel (Termin wurde abgesagt, kein neuer gebucht)
      if (a.booking_status === "cancelled") {
        const changedMs = new Date(a.updated_at ?? a.created_at).getTime();
        const sinceChangeMin = (now - changedMs) / 60_000;
        if (sinceChangeMin >= REBOOK_1_MIN && sinceChangeMin < REBOOK_2_MIN) {
          if (!already.has(`${a.id}|rebook_after_cancel_24h`)) todo.push({ app: a, kind: "rebook_after_cancel_24h" });
        } else if (sinceChangeMin >= REBOOK_2_MIN && sinceChangeMin < REBOOK_2_MIN + 5 * 24 * 60) {
          if (!already.has(`${a.id}|rebook_after_cancel_72h`)) todo.push({ app: a, kind: "rebook_after_cancel_72h" });
        }
        continue;
      }

      // 4) No-Booking (nur wenn kein Termin gebucht)
      const hasBooking = a.booking_status === "scheduled" || !!a.scheduled_at;
      if (hasBooking) continue;

      if (ageMin >= NO_BOOKING_1_MIN && ageMin < NO_BOOKING_2_MIN) {
        if (!already.has(`${a.id}|no_booking_24h`)) todo.push({ app: a, kind: "no_booking_24h" });
      } else if (ageMin >= NO_BOOKING_2_MIN && ageMin < NO_BOOKING_2_MIN + 24 * 60) {
        if (!already.has(`${a.id}|no_booking_72h`)) todo.push({ app: a, kind: "no_booking_72h" });
      }
    }

    let sent = 0, skipped = 0, failed = 0;
    const results: any[] = [];

    // Sofort-Versand überschreibt die Kandidatenliste komplett.
    if (forceKind) {
      const app = (apps as any[]).find((a) => a.id === onlyApplicationId);
      todo.length = 0;
      if (app) todo.push({ app, kind: forceKind as ReminderKind, inviteToken: tokensByAppId.get(app.id)?.token });
    }

    // ─── Sendefenster 06–22 Uhr (Europe/Berlin) ───
    // Erinnerungen sind Marketing-nahe Mails: nachts nicht zustellen (SMTP-
    // Reputation + Empfängererlebnis). Manueller Sofort-Versand (forceKind)
    // und Trockenlauf bleiben davon unberührt.
    if (!forceKind && !dryRun) {
      const berlinHour = Number.parseInt(
        new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).format(new Date()),
        10,
      );
      if (berlinHour < 6 || berlinHour >= 22) {
        return json({
          success: true,
          skipped_reason: "outside_send_window",
          berlin_hour: berlinHour,
          candidates: todo.length,
          sent: 0,
          skipped: todo.length,
          failed: 0,
        });
      }
    }

    // ─── Rate-Limits (SMTP-Reputationsschutz) ───
    // Neuer SMTP-Vertrag: 150 Mails/h pro Tenant/Sender, Sendefenster 6–22 Uhr.
    // 12h-Cap = 12 × 150 = 1800. Cron läuft alle 5 Min → RUN-Cap 10 (max. 120/h).
    const MAX_PER_RUN_PER_TENANT = LIMIT_RUN;
    const MAX_PER_1H_PER_TENANT = LIMIT_1H;
    const MAX_PER_12H_PER_TENANT = LIMIT_12H;
    const JITTER_MIN_MS = 400;
    const JITTER_MAX_MS = 1200;
    const AUTO_PAUSE_AFTER_FAILS = 3;

    const runSentByTenant = new Map<string, number>();
    const failStreakByTenant = new Map<string, number>();
    const pausedInThisRun = new Set<string>();
    const rateLimitedInThisRun = new Set<string>();

    // 1h-/12h-Zählstand aus email_send_log (zentrale Tabelle im E-Mail-Center).
    const sent12hByTenant = new Map<string, number>();
    const sent1hByTenant = new Map<string, number>();
    // WICHTIG: serverseitig ZÄHLEN statt Zeilen laden. Beim Laden kappt
    // PostgREST nach 1.000 Zeilen — die Kontingente wären dann zu niedrig
    // gerechnet und die SMTP-Grenze würde zu spät gezogen.
    try {
      const cutoff12h = new Date(Date.now() - 12 * 3600_000).toISOString();
      const cutoff1h = new Date(Date.now() - 3600_000).toISOString();
      const countSent = async (tenantId: string, sinceIso: string) => {
        const { count } = await admin
          .from("email_send_log")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("status", "sent")
          .gte("created_at", sinceIso);
        return count ?? 0;
      };
      for (const tenantId of tenants.keys()) {
        const [c1h, c12h] = await Promise.all([
          countSent(tenantId, cutoff1h),
          countSent(tenantId, cutoff12h),
        ]);
        sent1hByTenant.set(tenantId, c1h);
        sent12hByTenant.set(tenantId, c12h);
      }
    } catch { /* email_send_log optional */ }

    const jitter = () => new Promise(res => setTimeout(res, JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS)));

    for (const { app, kind, inviteToken } of todo) {
      const isRegistration = kind.startsWith("registration_pending");
      const isNoShow = kind === "no_show_24h" || kind === "no_show_30min";
      const isNoShowFast = kind === "no_show_30min";
      const isAbandoned = kind === "interview_abandoned";
      const isRebook = kind === "rebook_after_cancel_24h" || kind === "rebook_after_cancel_72h";
      const emailKind: EmailKind = isRegistration
        ? "fasttrack_registration_complete"
        : (isNoShow || isAbandoned)
          ? "broker_no_show"
          : "broker_no_booking";
      const resolved = await resolveSender(admin, app.id, emailKind);
      const tenant = resolved.tenant as TenantRow | null;
      if (!tenant) {
        skipped++; results.push({ app: app.id, kind, status: "skipped", reason: resolved.reason || "routing_failed", sender_kind: resolved.kind });
        if (!dryRun) await admin.from("application_reminder_log").upsert({
          application_id: app.id, tenant_id: app.tenant_id ?? null, reminder_kind: kind,
          recipient_email: app.email, status: "skipped", error: `routing_${resolved.reason || "failed"}`,
          sent_at: new Date().toISOString(),
        }, { onConflict: "application_id,reminder_kind" });
        continue;
      }
      // Übersprungene Mails ebenfalls zentral loggen → im E-Mail-Center sichtbar.
      const logSkipCentral = async (reason: string) => {
        if (dryRun) return;
        try {
          await admin.from("email_send_log").insert({
            message_id: `${kind}-${app.id}-skip-${reason}`,
            tenant_id: tenant.id,
            template_name: kind,
            recipient_email: app.email,
            status: "skipped",
            error_message: reason,
            sender_email: tenant.sender_email ?? tenant.smtp_username,
            metadata: { application_id: app.id, kind, source: "send-application-reminders", skip_reason: reason },
          } as any);
        } catch { /* non-critical */ }
      };
      if (tenant.emails_paused || pausedInThisRun.has(tenant.id)) { skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "tenant_paused" }); await logSkipCentral("tenant_paused"); continue; }
      if (rateLimitedInThisRun.has(tenant.id)) { skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "tenant_rate_limited_retry_later" }); await logSkipCentral("tenant_rate_limited_retry_later"); continue; }
      if (!hasValidSmtp(tenant)) { skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "smtp_incomplete" }); await logSkipCentral("smtp_incomplete"); continue; }

      // Rate-Limits pro tatsächlich aufgelöstem Absender-Tenant.
      const runCount = runSentByTenant.get(tenant.id) ?? 0;
      if (runCount >= MAX_PER_RUN_PER_TENANT) { skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "tenant_run_cap" }); await logSkipCentral("tenant_run_cap"); continue; }
      const total1h = (sent1hByTenant.get(tenant.id) ?? 0) + runCount;
      if (total1h >= MAX_PER_1H_PER_TENANT) { skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "tenant_1h_cap", limit: MAX_PER_1H_PER_TENANT }); await logSkipCentral("tenant_1h_cap"); continue; }
      const total12h = (sent12hByTenant.get(tenant.id) ?? 0) + runCount;
      if (total12h >= MAX_PER_12H_PER_TENANT) { skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "tenant_12h_cap" }); await logSkipCentral("tenant_12h_cap"); continue; }


      const sourceLanding = app.source_landing_id ? landingMap.get(app.source_landing_id) : null;
      const targetLanding = app.target_landing_id ? landingMap.get(app.target_landing_id) : null;
      const landing = sourceLanding
        || targetLanding
        || (app.source_slug ? slugLandingMap.get(normalizeKey(app.source_slug)) : null)
        || tenantLandingFallback.get(app.tenant_id)
        || null;

      // Fast-Track-Landing (die tatsächlich das Portal + KI-Interview hostet) ermitteln.
      // Vermittlungs-/Broker-Landings hosten KEIN Portal — niemals als Portal-Domain nutzen.
      const notBroker = (l: LandingRow | null | undefined): LandingRow | null =>
        l && l.flow_type !== "broker" ? l : null;
      const fastTrackLanding: LandingRow | null =
        (sourceLanding?.linked_fasttrack_landing_id
              ? notBroker(landingMap.get(sourceLanding.linked_fasttrack_landing_id) ?? null)
              : null)
        || notBroker(targetLanding)
        || (isInternalBooking(landing) ? notBroker(landing) : null);
      const fastTrackDomain = String(fastTrackLanding?.domain || (isRegistration ? (tenant.primary_domain || tenant.domain) : "") || "").trim();
      const fastTrackHost = portalHost(fastTrackDomain);

      // Internes Buchungssystem? → Rebook-Link auf portal.<fast-track-domain>/termin/buchen/<magic_token>
      const useInternalBooking = !!(app.magic_token && fastTrackHost
        && (isInternalBooking(sourceLanding) || isInternalBooking(targetLanding) || isInternalBooking(fastTrackLanding)));

      const rawCalendly = calendlyFromLanding(landing);

      // Calendly-Modus: Termin-Mails (kein Termin gebucht / No-Show / Neubuchung)
      // übernimmt Calendly selbst inkl. SMS + Kalendereintrag. Wir schicken
      // dafür KEINE eigenen Mails — nur der interne Buchungsmodus bekommt sie.
      if (!isRegistration && !isAbandoned && !useInternalBooking && rawCalendly) {
        skipped++;
        results.push({ app: app.id, kind, status: "skipped", reason: "calendly_handles_mail" });
        if (!dryRun) await admin.from("application_reminder_log").upsert({
          application_id: app.id, tenant_id: tenant.id, reminder_kind: kind,
          recipient_email: app.email, status: "skipped", error: "calendly_handles_mail",
          sent_at: new Date().toISOString(),
        }, { onConflict: "application_id,reminder_kind" });
        continue;
      }

      // Registration-Reminder braucht KEIN Calendly, sondern portal_link.
      let calendlyLink = "";
      let portalLink = "";
      let rebookLink = "";
      let resumeLink = "";
      if (isRegistration) {
        if (!inviteToken) {
          skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "no_invite_token" });
          continue;
        }
        const activeDomain = tenant.primary_domain || tenant.domain;
        const registrationHost = portalHost(activeDomain);
        if (!registrationHost) {
          skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "no_tenant_domain" });
          continue;
        }
        portalLink = `https://${registrationHost}/register?token=${encodeURIComponent(inviteToken)}&ref=${encodeURIComponent(app.id)}`;
      } else if (isAbandoned) {
        // Wiederaufnahme genau dort, wo das Gespräch abgebrochen wurde.
        if (!app.magic_token || !fastTrackHost) {
          skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "no_resume_link" });
          await logSkipCentral("no_resume_link");
          continue;
        }
        resumeLink = `https://${fastTrackHost}/bewerbung?token=${encodeURIComponent(app.magic_token)}`;
      } else if (useInternalBooking) {
        // Neuer/verpasster Termin → Bewerber landet im Fast-Track-Portal-Kalender.
        rebookLink = `https://${fastTrackHost}/termin/buchen/${encodeURIComponent(app.magic_token)}?rebook=1`;
        calendlyLink = rebookLink; // Fallback für Templates, die noch {{calendly_link}} referenzieren
      } else {
        if (!rawCalendly) {
          skipped++; results.push({
            app: app.id, kind, status: "skipped", reason: "no_calendly_link",
            source_landing_id: app.source_landing_id ?? null,
            target_landing_id: app.target_landing_id ?? null,
            source_slug: app.source_slug ?? null,
            tenant_has_landing_fallback: tenantLandingFallback.has(app.tenant_id),
          });
          if (!dryRun) await admin.from("application_reminder_log").upsert({
            application_id: app.id, tenant_id: tenant.id, reminder_kind: kind,
            recipient_email: app.email, status: "skipped", error: "no_calendly_link",
            sent_at: new Date().toISOString(),
          }, { onConflict: "application_id,reminder_kind" });
          continue;
        }
        calendlyLink = appendUtm(rawCalendly, app.id);
      }

      const tmplSubject = isRegistration
        ? (tenant.reminder_app_registration_subject || DEFAULTS.registration.subject)
        : isAbandoned
          ? DEFAULTS.interview_abandoned.subject
          : isRebook
          ? (tenant.reminder_app_rebook_subject || DEFAULTS.rebook.subject)
          : isNoShow
            ? (isNoShowFast
                ? DEFAULTS.no_show_fast.subject
                : (tenant.reminder_app_no_show_subject || DEFAULTS.no_show.subject))
            : (tenant.reminder_app_no_booking_subject || DEFAULTS.no_booking.subject);
      const tmplBody = isRegistration
        ? (tenant.reminder_app_registration_body || DEFAULTS.registration.body)
        : isAbandoned
          ? DEFAULTS.interview_abandoned.body
          : isRebook
          ? (tenant.reminder_app_rebook_body || DEFAULTS.rebook.body)
          : isNoShow
            ? (isNoShowFast
                ? DEFAULTS.no_show_fast.body
                : (tenant.reminder_app_no_show_body || DEFAULTS.no_show.body))
            : (tenant.reminder_app_no_booking_body || DEFAULTS.no_booking.body);

      const recruiter = landing?.recruiter_name || landing?.branding?.recruiter_name || tenant.sender_name || tenant.name;

      const scheduledDate = app.scheduled_at ? new Date(app.scheduled_at) : null;
      const portalUrl = fastTrackHost ? `https://${fastTrackHost}` : "";
      const vars: Record<string, string> = {
        first_name: firstName(app.full_name),
        full_name: app.full_name ?? "",
        email: app.email,
        tenant_name: tenant.name,
        recruiter_name: recruiter,
        calendly_link: calendlyLink,
        rebook_link: rebookLink || calendlyLink,
        resume_link: resumeLink,
        portal_link: portalLink,
        portal_url: portalUrl,
        appointment_date: scheduledDate ? formatAppointmentDate(scheduledDate, false) : "",
        appointment_time: scheduledDate ? formatAppointmentTime(scheduledDate) : "",
      };
      const subject = render(tmplSubject, vars);
      const html = buildHtml(tmplSubject, tmplBody, tenant.email_signature ?? "", tenant, vars);

      if (dryRun) { sent++; results.push({ app: app.id, kind, status: "would_send", to: app.email }); continue; }

      const templateName = `${isRegistration ? "fasttrack" : "vermittlung"}_${kind}`;
      // Einheitliche Protokoll-Metadaten inkl. Auslöser (Cron oder Handklick).
      const logMeta = {
        application_id: app.id, kind, source: "send-application-reminders",
        sender_kind: emailKind, resolved_tenant_id: tenant.id,
        trigger: forceKind ? "manual" : "cron", manual_send: !!forceKind,
        // Der eindeutige Index erlaubt eine zweite 'sent'-Zeile am selben Tag
        // nur mit eigener Kennung — bewusster Handversand bleibt so möglich.
        ...(forceKind ? { resend_nonce: `manual-${Date.now()}` } : {}),
      };
      const messageId = `${kind}-${app.id}-${Date.now()}@${isRegistration ? "fasttrack" : "vermittlung"}`;

      // ── Letzte Sicherung gegen Doppelversand ───────────────────────────────
      // Auch wenn oben etwas schiefging (Log-Zeile fehlt, Query gekappt):
      // dieselbe Mail geht pro Bewerber nur EINMAL raus.
      try {
        const { count: alreadySent } = forceKind ? { count: 0 } : await admin
          .from("application_reminder_log")
          .select("application_id", { count: "exact", head: true })
          .eq("application_id", app.id)
          .eq("reminder_kind", kind)
          .eq("status", "sent");
        if ((alreadySent ?? 0) > 0) {
          skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "already_sent" });
          continue;
        }
        const since = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
        const { count: recentSend } = forceKind ? { count: 0 } : await admin
          .from("email_send_log")
          .select("id", { count: "exact", head: true })
          .eq("recipient_email", app.email)
          .eq("template_name", templateName)
          .eq("status", "sent")
          .gte("created_at", since);
        if ((recentSend ?? 0) > 0) {
          skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "duplicate_within_20h" });
          continue;
        }
      } catch { /* Prüfung darf den Lauf nicht abbrechen */ }

      // ── Platzhalter-Zeile VOR dem Versand ──────────────────────────────────
      // Der eindeutige Index (template_name + Empfänger + Vorgang + Tag) lässt
      // nur eine 'sent'-Zeile zu. Schlägt der Insert fehl, hat ein paralleler
      // Mail-los-Modus: dieser Tenant verschickt gar nichts (Calendly + /bewerbung).
      if ((tenant as any).mailless_mode !== false) {
        skipped++;
        results.push({ app: app.id, kind, status: "skipped", reason: "mailless_mode" });
        continue;
      }

      // Lauf diese Mail bereits übernommen → hier nicht nochmal senden.
      let claim: EmailClaim | null = null;
      // Auch der manuelle Sofort-Versand reserviert. Er darf bewusst wiederholen,
      // bekommt dafür aber eine eigene Kennung — so bleiben zwei parallele
      // Handklicks (bzw. Handklick + Cron in derselben Sekunde) ausgeschlossen
      // und die Zeile ist später als Handversand erkennbar.
      {
        const manual = !!forceKind;
        const eventKey = manual
          ? `application_reminder:${app.id}:${kind}:manual:${Math.floor(Date.now() / 60_000)}`
          : `application_reminder:${app.id}:${kind}`;
        claim = await claimEmailEvent(admin, {
          eventKey,
          templateName, recipient: app.email, tenantId: tenant.id,
          senderEmail: tenant.sender_email ?? tenant.smtp_username,
          subject, html,
          metadata: {
            application_id: app.id, kind, source: "send-application-reminders",
            sender_kind: emailKind, resolved_tenant_id: tenant.id,
            trigger: manual ? "manual" : "cron", manual_send: manual,
            ...(manual ? { resend_nonce: (logMeta as any).resend_nonce } : {}),
          },
        });
        if (!claim) {
          skipped++;
          results.push({ app: app.id, kind, status: "skipped", reason: "duplicate_blocked_by_db" });
          continue;
        }
      }

      try {
        await sendMail(tenant, app.email, subject, html);
        // Throttle: 4s Pause zwischen Sends, um SMTP-Rate-Limit (554) zu vermeiden
        await new Promise((r) => setTimeout(r, 4000));
        await admin.from("application_reminder_log").upsert({
          application_id: app.id, tenant_id: tenant.id, reminder_kind: kind,
          recipient_email: app.email, status: "sent", error: null,
          sent_at: new Date().toISOString(),
        }, { onConflict: "application_id,reminder_kind" });
        // Sichtbarkeit im E-Mail-Center
        try {
          // Alte "pending"-Retry-Zeilen desselben Versands abschließen, damit sie
          // nicht dauerhaft als "Warteschlange" in der Statistik hängen bleiben.
          await admin.from("email_send_log")
            .update({ status: "superseded" })
            .eq("template_name", templateName)
            .eq("recipient_email", app.email)
            .eq("status", "pending");
          if (claim) {
            await finishEmailClaim(admin, claim, { status: "sent", metadata: logMeta });
          } else await admin.from("email_send_log").insert({
            message_id: messageId, tenant_id: tenant.id,
            template_name: templateName, recipient_email: app.email,
            status: "sent", rendered_subject: subject, rendered_html: html,
            sender_email: tenant.sender_email ?? tenant.smtp_username,
            metadata: logMeta,
          } as any);
        } catch { /* non-critical */ }

        sent++; results.push({ app: app.id, kind, status: "sent" });
        runSentByTenant.set(tenant.id, runCount + 1);
        failStreakByTenant.set(tenant.id, 0);
        await jitter();
      } catch (e: any) {
        const errMsg = smtpErrorMessage(e);
        if (isSmtpHourlyRateLimit(errMsg)) {
          rateLimitedInThisRun.add(tenant.id);
          await admin.from("application_reminder_log").upsert({
            application_id: app.id, tenant_id: tenant.id, reminder_kind: kind,
            recipient_email: app.email, status: "skipped", error: `smtp_rate_limited_retry_later: ${errMsg}`,
            sent_at: new Date().toISOString(),
          }, { onConflict: "application_id,reminder_kind" });
          try {
            if (claim) {
              // Nicht als Fehler abschließen: die Mail SOLL später erneut
              // versucht werden. Die Reservierung wird deshalb freigegeben.
              await releaseEmailClaim(admin, claim, {
                reason: `SMTP-Stundenlimit erreicht, wird später erneut versucht: ${errMsg}`,
                metadata: { ...logMeta, retry_reason: "smtp_hourly_rate_limit" },
              });
            } else await admin.from("email_send_log").insert({
              message_id: messageId, tenant_id: tenant.id,
              template_name: templateName, recipient_email: app.email,
              status: "pending", error_message: `SMTP-Stundenlimit erreicht, wird später erneut versucht: ${errMsg}`,
              rendered_subject: subject, rendered_html: html,
              sender_email: tenant.sender_email ?? tenant.smtp_username,
              metadata: { ...logMeta, retry_reason: "smtp_hourly_rate_limit" },
            } as any);
          } catch { /* non-critical */ }
          skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "smtp_rate_limited_retry_later", detail: errMsg });
          await jitter();
          continue;
        }
        await admin.from("application_reminder_log").upsert({
          application_id: app.id, tenant_id: tenant.id, reminder_kind: kind,
          recipient_email: app.email, status: "failed", error: errMsg,
          sent_at: new Date().toISOString(),
        }, { onConflict: "application_id,reminder_kind" });
        try {
          await admin.from("email_send_log")
            .update({ status: "superseded" })
            .eq("template_name", templateName)
            .eq("recipient_email", app.email)
            .eq("status", "pending");
          if (claim) {
            await finishEmailClaim(admin, claim, { status: "failed", error: errMsg, metadata: logMeta });
          } else await admin.from("email_send_log").insert({
            message_id: messageId, tenant_id: tenant.id,
            template_name: templateName, recipient_email: app.email,
            status: "failed", error_message: errMsg,
            rendered_subject: subject, rendered_html: html,
            sender_email: tenant.sender_email ?? tenant.smtp_username,
            metadata: logMeta,
          } as any);
        } catch { /* non-critical */ }

        failed++; results.push({ app: app.id, kind, status: "failed", reason: errMsg });
        const streak = (failStreakByTenant.get(tenant.id) ?? 0) + 1;
        failStreakByTenant.set(tenant.id, streak);
        // Auto-Pause deaktiviert: E-Mails werden nie automatisch pausiert.
        // Fehler werden geloggt und im Email-Center sichtbar; Admin entscheidet manuell.
        if (false && streak >= AUTO_PAUSE_AFTER_FAILS) {
          pausedInThisRun.add(tenant.id);
        }
      }
    }


    return json({
      success: true, version: FUNCTION_VERSION, dry_run: dryRun,
      candidates: todo.length, sent, skipped, failed,
      fallback_counts: {
        direct_landing_ids: landingMap.size,
        source_slugs: slugLandingMap.size,
        tenant_landing_fallbacks: tenantLandingFallback.size,
        tenant_landing_raw_rows: tenantLandingRawCount,
        landing_errors: landingErrors,
      },
      results: dryRun || todo.length < 100 ? results : undefined,
    });
  } catch (err: any) {
    console.error(err);
    return json({ error: err?.message ?? "Unknown error" }, 500);
  }
});
