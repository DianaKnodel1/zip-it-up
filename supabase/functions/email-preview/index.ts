// Deno Edge Function: email-preview
//
// Rendert alle zentralen Mail-Templates (Subject/HTML/Text) über den
// gemeinsamen renderEmail()-Wrapper — mit echtem Tenant-Branding (Logo,
// Recruiter, Farbe), aber Fake-Empfängerdaten. Kein Cron, kein Live-Versand,
// es sei denn `send_to` ist gesetzt.
//
// Auth: Service-Role only. Body: POST JSON
//   {
//     "template": "application_received" | "booking_confirmation" | ...   // optional; wenn leer → alle
//     "tenant_id": "<uuid>",           // optional; sonst erster Tenant
//     "landing_id": "<uuid>",          // optional; für Landing-Logo/Recruiter
//     "send_to": "test@example.com",   // optional; sendet EIN Rendering via Tenant-SMTP
//     "vars": { ... }                  // optional; überschreibt Sample-Vars
//   }
//
// Deploy: supabase functions deploy email-preview --no-verify-jwt

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "https://esm.sh/nodemailer@6.9.14";
import { renderEmail } from "../_shared/email-wrapper.ts";
import { pickLandingLogo, resolveEmailLogo } from "../_shared/email-logo.ts";
import { formatAppointmentDate, formatAppointmentTime } from "../_shared/format-datetime.ts";


const FUNCTION_VERSION = "2026-07-23-email-preview-v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function authorize(req: Request): Promise<boolean> {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!serviceRoleKey) return false;
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const apiKey = (req.headers.get("apikey") ?? req.headers.get("x-api-key") ?? "").trim();
  return bearer === serviceRoleKey || apiKey === serviceRoleKey;
}

// ---------- Template-Registry ----------
// Kopien der zentralen Defaults, damit die Preview stabil ist auch wenn eine
// Send-Function ihre Konstante umbenennt. Wenn Text divergiert, hier + dort
// nachziehen.
type TemplateSpec = {
  subject: string;
  body: string;
  preheader?: string;
  buttonLabel: string;
  spamHint?: boolean;
  roleLabel?: string;
  // Zusatz-Vars, die renderEmail sieht. Werden mit Sample-Vars gemerged.
  extraVars?: Record<string, string>;
};

const T: Record<string, TemplateSpec> = {
  application_received: {
    subject: "Bewerbung eingegangen – nächster Schritt",
    preheader: "Ihre Bewerbung ist eingegangen – jetzt Termin für das Bewerbungsgespräch buchen.",
    buttonLabel: "Jetzt Termin buchen",
    spamHint: true,
    roleLabel: "Personalabteilung",
    body: `Hallo {{first_name}},

vielen Dank für Ihre Bewerbung bei {{tenant_name}}. Wir haben Ihre Angaben erhalten.

Damit wir Sie persönlich kennenlernen können, wählen Sie bitte jetzt Ihren Termin für das Bewerbungsgespräch aus:

{{cta:{{button_label}}|{{booking_link}}}}

Falls der Button nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:
{{booking_link}}

Sollten Sie bereits einen Termin gebucht haben, müssen Sie nichts weiter tun.

Herzliche Grüße
{{recruiter_name}}`,
  },
  booking_confirmation: {
    subject: "Termin bestätigt: {{appointment_date}}, {{appointment_time}} Uhr",
    preheader: "Ihr Bewerbungsgespräch am {{appointment_date}} um {{appointment_time}} Uhr – alle Infos + Kalendereintrag im Anhang.",
    buttonLabel: "Termin verwalten",
    spamHint: true,
    roleLabel: "Personalabteilung",
    body: `Hallo {{first_name}},

vielen Dank – Ihr Termin für das Bewerbungsgespräch bei {{tenant_name}} ist fest reserviert:

Datum: {{appointment_date}}
Uhrzeit: {{appointment_time}} Uhr
Dauer: ca. {{duration_minutes}} Minuten

Sie finden den Termin als Kalendereintrag (.ics) im Anhang – einfach öffnen und in Outlook, Google oder Apple-Kalender speichern.

30 Minuten vor Beginn schicken wir Ihnen zusätzlich den direkten Link zum Gespräch, damit Sie ihn nicht extra suchen müssen.

Sollten Sie den Termin verschieben oder absagen müssen, tun Sie das jederzeit hier:

{{cta:{{button_label}}|{{cancel_url}}}}

Wir freuen uns auf das Gespräch!

Herzliche Grüße
{{recruiter_name}}`,
  },
  interview_invite_30min: {
    subject: "In 30 Minuten startet Ihr Bewerbungsgespräch",
    preheader: "Ihr Bewerbungsgespräch startet in ca. 30 Minuten – hier ist Ihr Direktlink.",
    buttonLabel: "Bewerbungsgespräch starten",
    roleLabel: "Personalabteilung",
    body: `Hallo {{first_name}},

in ca. 30 Minuten beginnt Ihr Bewerbungsgespräch bei {{tenant_name}}.

Termin: {{appointment_date}} um {{appointment_time}} Uhr
Dauer: ca. {{duration_minutes}} Minuten

Öffnen Sie den folgenden Link direkt vor Beginn – Ihr Gesprächsraum ist dann bereits vorbereitet:

{{cta:{{button_label}}|{{magic_link}}}}

Tipp: Testen Sie kurz Kamera + Mikrofon. Ein ruhiger Ort mit stabiler Internetverbindung genügt.

Bis gleich!
{{recruiter_name}}`,
  },
  interview_reminder_24h: {
    subject: "Erinnerung: Ihr Termin morgen um {{appointment_time}} Uhr",
    preheader: "Kurze Erinnerung an Ihren Termin morgen.",
    buttonLabel: "Termin absagen oder verschieben",
    roleLabel: "Personalabteilung",
    body: `Hallo {{first_name}},

kurze Erinnerung an Ihren Termin am {{appointment_date}} um {{appointment_time}} Uhr.

Etwa 30 Minuten vorher erhalten Sie von uns eine weitere E-Mail mit dem Link zum Gespräch.

Sie können nicht? Hier absagen oder verschieben:

{{cta:{{button_label}}|{{cancel_url}}}}

Bis morgen!
{{tenant_name}}`,
  },
  no_booking_24h: {
    subject: "Ihr Termin wartet – jetzt buchen",
    preheader: "Sie haben sich beworben, aber noch keinen Termin gebucht.",
    buttonLabel: "Jetzt Termin buchen",
    roleLabel: "Personalabteilung",
    body: `Hallo {{first_name}},

Ihre Bewerbung bei {{tenant_name}} liegt uns vor – super!

Damit wir starten können, fehlt nur noch ein Termin für das kurze Bewerbungsgespräch. In 2 Minuten reserviert:

{{cta:{{button_label}}|{{booking_link}}}}

Falls der Button nicht funktioniert:
{{booking_link}}

Herzliche Grüße
{{recruiter_name}}`,
  },
  no_booking_72h: {
    subject: "Letzte Erinnerung: Termin für Ihr Bewerbungsgespräch",
    preheader: "Sichern Sie sich jetzt Ihren Slot – die Plätze sind begrenzt.",
    buttonLabel: "Jetzt Termin sichern",
    roleLabel: "Personalabteilung",
    body: `Hallo {{first_name}},

wir wollten Ihre Bewerbung nicht in Vergessenheit geraten lassen. Bitte wählen Sie einen Termin für das Bewerbungsgespräch – die Plätze sind begrenzt:

{{cta:{{button_label}}|{{booking_link}}}}

Falls Sie kein Interesse mehr haben, ignorieren Sie diese Nachricht einfach.

Herzliche Grüße
{{recruiter_name}}`,
  },
  no_show_24h: {
    subject: "Termin verpasst? Jetzt neu buchen",
    preheader: "Sie haben Ihr Bewerbungsgespräch verpasst – kein Problem, buchen Sie einen neuen Termin.",
    buttonLabel: "Neuen Termin buchen",
    roleLabel: "Personalabteilung",
    body: `Hallo {{first_name}},

wir haben Sie gestern zum vereinbarten Termin nicht erreicht. Kein Stress – das passiert.

Wählen Sie einfach einen neuen Termin, der besser passt:

{{cta:{{button_label}}|{{booking_link}}}}

Herzliche Grüße
{{recruiter_name}}`,
  },
  rebook_after_cancel_24h: {
    subject: "Neuer Termin für Ihr Bewerbungsgespräch",
    preheader: "Sie haben Ihren Termin abgesagt – so buchen Sie einen neuen.",
    buttonLabel: "Neuen Termin wählen",
    roleLabel: "Personalabteilung",
    body: `Hallo {{first_name}},

Sie haben Ihren Termin abgesagt – kein Problem. Wählen Sie jetzt einen neuen Slot, der besser passt:

{{cta:{{button_label}}|{{booking_link}}}}

Herzliche Grüße
{{recruiter_name}}`,
  },
  rebook_after_cancel_72h: {
    subject: "Letzte Erinnerung: Neuen Termin buchen",
    preheader: "Sichern Sie sich einen neuen Termin für Ihr Bewerbungsgespräch.",
    buttonLabel: "Jetzt Termin sichern",
    roleLabel: "Personalabteilung",
    body: `Hallo {{first_name}},

möchten Sie nach der Absage einen neuen Termin? Hier entlang – die Plätze sind begrenzt:

{{cta:{{button_label}}|{{booking_link}}}}

Herzliche Grüße
{{recruiter_name}}`,
  },
  welcome_invitation: {
    subject: "Willkommen im Team – Ihre Registrierung in 5 Minuten",
    preheader: "Ihr Profil hat überzeugt – jetzt nur noch schnell registrieren.",
    buttonLabel: "Jetzt registrieren",
    spamHint: true,
    roleLabel: "Personalabteilung",
    body: `Hallo {{first_name}},

herzlichen Glückwunsch – Ihr Profil hat uns überzeugt.

Damit Sie direkt starten können, ist nur noch ein Schritt nötig: die Registrierung im Mitarbeiter-Portal.

Was Sie brauchen (bitte bereithalten):
• Personalausweis oder Reisepass
• IBAN (Bankverbindung für die Gehaltszahlung)
• Steuer-Identifikationsnummer (11-stellig)
• Sozialversicherungsnummer (falls vorhanden)

{{cta:{{button_label}}|{{portal_link}}}}

Bei Fragen antworten Sie einfach auf diese E-Mail – wir helfen gerne.

Herzliche Grüße
{{recruiter_name}}`,
  },
  signup_confirmation: {
    subject: "E-Mail-Adresse bestätigen",
    preheader: "Bitte bestätigen Sie Ihre E-Mail, um Ihr Konto zu aktivieren.",
    buttonLabel: "E-Mail bestätigen",
    body: `Hallo {{first_name}},

bitte bestätigen Sie Ihre E-Mail-Adresse, um Ihr Konto bei {{tenant_name}} zu aktivieren:

{{cta:{{button_label}}|{{confirmation_link}}}}

Der Link ist 24 Stunden gültig.

Herzliche Grüße
{{recruiter_name}}`,
  },
  password_reset: {
    subject: "Passwort zurücksetzen – {{tenant_name}}",
    preheader: "Setzen Sie Ihr Passwort in 2 Minuten zurück.",
    buttonLabel: "Passwort zurücksetzen",
    body: `Hallo {{first_name}},

Sie haben ein neues Passwort für {{tenant_name}} angefordert. Klicken Sie unten, um es zu setzen:

{{cta:{{button_label}}|{{reset_link}}}}

Wenn Sie diese Anfrage nicht ausgelöst haben, ignorieren Sie diese E-Mail einfach.

Herzliche Grüße
{{recruiter_name}}`,
  },
  reminder_invite: {
    subject: "Erinnerung: Ihre Registrierung",
    preheader: "Ihre Einladung wartet noch auf Sie.",
    buttonLabel: "Jetzt registrieren",
    body: `Hallo {{first_name}},

Sie haben unsere Einladung bekommen, aber noch kein Konto angelegt. Hier ist Ihr Link:

{{cta:{{button_label}}|{{portal_link}}}}

Herzliche Grüße
{{recruiter_name}}`,
  },
  reminder_confirm_email: {
    subject: "Erinnerung: E-Mail-Adresse bestätigen",
    preheader: "Bitte bestätigen Sie Ihre E-Mail, um fortzufahren.",
    buttonLabel: "E-Mail bestätigen",
    body: `Hallo {{first_name}},

Ihr Konto ist angelegt, aber die E-Mail-Bestätigung fehlt noch:

{{cta:{{button_label}}|{{confirmation_link}}}}

Herzliche Grüße
{{recruiter_name}}`,
  },
  reminder_complete_registration: {
    subject: "Registrierung abschließen",
    preheader: "Nur noch wenige Schritte bis zum Start.",
    buttonLabel: "Registrierung abschließen",
    body: `Hallo {{first_name}},

Ihre Registrierung ist noch nicht ganz vollständig. Bitte schließen Sie die letzten Schritte ab (Vertrag, Personalausweis, Pflichtdaten):

{{cta:{{button_label}}|{{portal_link}}}}

Herzliche Grüße
{{recruiter_name}}`,
  },
};

const ALL_KINDS = Object.keys(T);

function sampleVars(kind: string, tenantName: string): Record<string, string> {
  const in30 = new Date(Date.now() + 30 * 60_000);
  const inDay = new Date(Date.now() + 24 * 3600_000);
  const start = kind === "interview_invite_30min" ? in30 : inDay;
  return {
    first_name: "Max",
    last_name: "Mustermann",
    full_name: "Max Mustermann",
    tenant_name: tenantName,
    recruiter_name: "Anna Schmidt",
    appointment_date: formatAppointmentDate(start),
    appointment_time: formatAppointmentTime(start),
    duration_minutes: "20",
    booking_link: "https://portal.example.com/termin/buchen/PREVIEW-TOKEN",
    cancel_url: "https://portal.example.com/termin/PREVIEW-TOKEN",
    magic_link: "https://portal.example.com/interview/start/PREVIEW-TOKEN",
    portal_link: "https://portal.example.com/registrieren?token=PREVIEW-TOKEN",
    confirmation_link: "https://portal.example.com/confirm?token=PREVIEW-TOKEN",
    reset_link: "https://portal.example.com/reset?token=PREVIEW-TOKEN",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!(await authorize(req))) return json({ error: "Unauthorized", version: FUNCTION_VERSION }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const requestedTemplate: string | undefined = body?.template;
    const sendTo: string | undefined = body?.send_to;
    const overrideVars: Record<string, string> = body?.vars || {};

    if (requestedTemplate && !T[requestedTemplate]) {
      return json({ error: `unknown template: ${requestedTemplate}`, available: ALL_KINDS, version: FUNCTION_VERSION }, 400);
    }
    if (sendTo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sendTo)) {
      return json({ error: "invalid send_to email", version: FUNCTION_VERSION }, 400);
    }
    if (sendTo && !requestedTemplate) {
      return json({ error: "send_to requires an explicit `template`", version: FUNCTION_VERSION }, 400);
    }

    // Tenant + optionale Landing laden
    const tenantId: string | undefined = body?.tenant_id;
    const landingId: string | undefined = body?.landing_id;

    const tenantQuery = admin.from("tenants")
      .select("id, name, domain, primary_domain, logo_url, primary_color, sender_email, sender_name, reply_to_email, smtp_host, smtp_port, smtp_username, smtp_password, email_signature, emails_paused")
      .limit(1);
    const { data: tenants, error: tErr } = tenantId
      ? await tenantQuery.eq("id", tenantId)
      : await tenantQuery.order("created_at", { ascending: true });
    if (tErr) return json({ error: tErr.message, version: FUNCTION_VERSION }, 500);
    const tenant = tenants?.[0];
    if (!tenant) return json({ error: "no tenant found", version: FUNCTION_VERSION }, 404);

    let landing: any = null;
    if (landingId) {
      const { data } = await admin.from("landing_pages")
        .select("id, domain, logo_url, branding, slots, recruiter_name, recruiter_avatar_url, linked_fasttrack_landing_id, flow_type")
        .eq("id", landingId).maybeSingle();
      landing = data;
    }

    const logo = resolveEmailLogo([
      landing ? { source: "landing.logo", url: pickLandingLogo(landing), domain: landing?.domain } : { source: "landing.logo", url: null, domain: null },
      { source: "tenant.logo_url", url: tenant.logo_url && /^https:\/\//i.test(String(tenant.logo_url)) ? tenant.logo_url : null, domain: tenant.primary_domain || tenant.domain },
    ]);

    const recruiterName = landing?.recruiter_name || tenant.name;
    const recruiterAvatar = landing?.recruiter_avatar_url || null;

    const renderOne = (kind: string) => {
      const spec = T[kind];
      const vars: Record<string, string> = {
        ...sampleVars(kind, tenant.name),
        button_label: spec.buttonLabel,
        recruiter_name: recruiterName,
        ...overrideVars,
      };
      const { html, text, subject } = renderEmail({
        subject: spec.subject,
        body: spec.body,
        preheader: spec.preheader,
        spamHint: !!spec.spamHint,
        tenant: { ...tenant, logo_url: logo.url },
        recruiter: { name: recruiterName, avatar_url: recruiterAvatar, role_label: spec.roleLabel || "Personalabteilung" },
        vars,
        recipient: sendTo,
      });
      return { kind, subject, html, text, vars };
    };

    const kinds = requestedTemplate ? [requestedTemplate] : ALL_KINDS;
    const rendered = kinds.map(renderOne);

    // Optionaler Testversand — nur ein Template, nur eine Adresse
    let sendResult: any = null;
    if (sendTo && rendered.length === 1) {
      const r = rendered[0];
      if (!tenant.smtp_host || !tenant.smtp_port || !tenant.smtp_username || !tenant.smtp_password) {
        sendResult = { sent: false, error: "tenant has no SMTP configured" };
      } else {
        try {
          const transporter = nodemailer.createTransport({
            host: tenant.smtp_host,
            port: tenant.smtp_port,
            secure: tenant.smtp_port === 465,
            auth: { user: tenant.smtp_username, pass: tenant.smtp_password },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 20000,
          });
          await transporter.sendMail({
            from: `"${tenant.sender_name || tenant.name}" <${tenant.sender_email || tenant.smtp_username}>`,
            to: sendTo,
            replyTo: tenant.reply_to_email ?? tenant.sender_email ?? undefined,
            subject: `[PREVIEW] ${r.subject}`,
            html: r.html,
            text: r.text,
            headers: { "X-Email-Preview": "1", "X-Email-Preview-Kind": r.kind },
          });
          sendResult = { sent: true, to: sendTo, kind: r.kind };
        } catch (e: any) {
          sendResult = { sent: false, error: String(e?.message ?? e).slice(0, 500) };
        }
      }
    }

    // Wenn ein einzelnes Template ohne send_to angefragt wurde und der Client
    // ?format=html schickt: HTML direkt zurückgeben → im Browser sichtbar.
    const url = new URL(req.url);
    const format = url.searchParams.get("format");
    if (format === "html" && rendered.length === 1) {
      return new Response(rendered[0].html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders },
      });
    }

    return json({
      success: true,
      version: FUNCTION_VERSION,
      tenant: { id: tenant.id, name: tenant.name },
      logo_used: { url: logo.url, source: logo.source, reason: logo.reason },
      available_templates: ALL_KINDS,
      rendered: rendered.map((r) => ({
        kind: r.kind,
        subject: r.subject,
        text_preview: r.text.slice(0, 400),
        html_length: r.html.length,
        // vollständiges HTML nur bei Einzelabfrage — sonst wird die Antwort riesig
        html: rendered.length === 1 ? r.html : undefined,
      })),
      send_result: sendResult,
    });
  } catch (err: any) {
    console.error(err);
    return json({ error: err?.message ?? "Unknown error", version: FUNCTION_VERSION }, 500);
  }
});
