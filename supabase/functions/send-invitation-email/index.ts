// Deno Edge Function: send-invitation-email
//
// Wird beim Akzeptieren einer Bewerbung gerufen (admin.applications.$appId.tsx).
// Sendet eine Willkommens-/Einladungs-Mail mit Registrierungs-Link über die
// Tenant-SMTP. Respektiert tenants.emails_paused und nutzt verifyOrPause für
// Auto-Pause nach 3 SMTP-Verify-Fails (analog zu resend-signup-confirmation).
//
// Deploy:
//   supabase functions deploy send-invitation-email --no-verify-jwt

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createSmtpTransport, sendMailWithRetry } from "../_shared/smtp.ts";
import { resolveSender, type EmailKind } from "../_shared/sender-resolver.ts";
import { pickLandingLogo, resolveEmailLogo } from "../_shared/email-logo.ts";
import { guardSend } from "../_shared/send-guard.ts";
import { claimEmailEvent, finishEmailClaim, retryFailedEmailClaim, type EmailClaim } from "../_shared/send-claim.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_WELCOME_TEMPLATE = `Hallo {{first_name}},

herzlichen Glückwunsch – Ihr Profil hat uns überzeugt.

Damit Sie direkt starten können, ist nur noch ein Schritt nötig: die Registrierung im Mitarbeiter-Portal.

Was Sie brauchen (bitte bereithalten):
• Personalausweis oder Reisepass
• IBAN (Bankverbindung für die Gehaltszahlung)
• Steuer-Identifikationsnummer (11-stellig, steht auf Ihrem Lohnsteuerbescheid)
• Sozialversicherungsnummer (falls vorhanden)

Wie geht es weiter?
1. Portal-Registrierung abschließen (ca. 5 Minuten)
2. Arbeitsvertrag digital unterschreiben
3. Sofort loslegen – Aufträge stehen bereit

{{cta:Jetzt registrieren|{{portal_link}}}}

Bei Fragen antworten Sie einfach auf diese E-Mail – wir helfen gerne.

Herzliche Grüße
{{sender_name}}`;

const DEFAULT_APPLICATION_RECEIVED_SUBJECT = "Bewerbung eingegangen – nächster Schritt";
const DEFAULT_APPLICATION_RECEIVED_TEMPLATE = `Hallo {{first_name}},

vielen Dank für Ihre Bewerbung bei {{tenant_name}}. Wir haben Ihre Angaben erhalten.

Damit wir Sie persönlich kennenlernen können, wählen Sie bitte jetzt Ihren Termin für das Bewerbungsgespräch aus:

{{cta:{{application_received_button_label}}|{{booking_link}}}}

Falls der Button nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:
{{booking_link}}

Sollten Sie bereits einen Termin gebucht haben, müssen Sie nichts weiter tun.

Herzliche Grüße
{{sender_name}}`;

const LEGACY_WELCOME_MARKERS = [
  "dein Zugang für {{tenant_name}} ist bereit",
  "dein Zugang für",
  "Bitte registriere dich im Mitarbeiterportal und schließe anschließend dein Profil ab",
  "Willkommen im Team",
  "Ihre Registrierung",
  "Jetzt registrieren",
  "Mitarbeiter-Portal",
  "Mitarbeiterportal",
];

interface Payload {
  to: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  registrationLink: string;
  tenantId: string;
  /** Optional overrides for non-default flows (e.g. magic-link / interview link). */
  subject?: string;
  headline?: string;
  intro?: string;
  buttonLabel?: string;
  templateName?: string;
  /** Extra placeholder values (z.B. {{partner_name}}) für DB-Templates. */
  placeholders?: Record<string, string>;
  /** Optional: application_id → aktiviert zentrales SMTP-Routing (sender-resolver).
   *  Ohne applicationId bleibt tenantId aus dem Payload maßgeblich (Legacy-Verhalten). */
  applicationId?: string;
  /** Admin-Test aus /admin/tenants: umgeht Empfänger-Sperre und Kontingent. */
  testMode?: boolean;
  /** Korrelations-ID des Aufrufers — landet in metadata.request_id (Dedup im Mail-Center). */
  requestId?: string;
}

// Mapping template → EmailKind für den zentralen Resolver.
// application_received bleibt beim Broker (source_landing.tenant). Alle
// Registrierungs-/Welcome-Varianten werden zwangsweise auf Fast-Track umgeleitet.
const TEMPLATE_TO_KIND: Record<string, EmailKind> = {
  application_received: "broker_confirmation",
  invitation: "fasttrack_registration_complete",
  welcome: "fasttrack_registration_complete",
  registration: "fasttrack_registration_complete",
  registration_complete: "fasttrack_registration_complete",
  bewerbung_magic_link: "broker_interview_invite",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as Payload;
    const { to, fullName, firstName, lastName, registrationLink, tenantId,
      subject: subjectOverride, headline: headlineOverride,
      intro: introOverride, buttonLabel: buttonLabelOverride,
      templateName: templateNameOverride, placeholders: extraPlaceholders } = body;

    if (!to || !registrationLink || !tenantId) {
      return json({ error: "Missing required fields: to, registrationLink, tenantId" }, 400);
    }

    const supabaseAdmin = createClient(
      (Deno.env.get("SUPABASE_URL") ?? Deno.env.get("API_EXTERNAL_URL"))!,
      (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY"))!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const supabase = supabaseAdmin;

    const logTemplate = templateNameOverride || "invitation";
    // Jeder Abbruch MUSS im Mail-Center sichtbar sein → zentraler Abbruch-Logger.
    const logAbort = async (
      status: "failed" | "skipped",
      reason: string,
      tenantIdForLog: string | null,
      extra?: Record<string, unknown>,
    ) => {
      try {
        await supabaseAdmin.from("email_send_log").insert({
          message_id: `send-invitation-email:${body.requestId ?? crypto.randomUUID()}:${logTemplate}:${Date.now()}`,
          tenant_id: tenantIdForLog,
          template_name: logTemplate,
          recipient_email: to,
          status,
          error_message: reason.slice(0, 1000),
          metadata: {
            source: "send-invitation-email",
            request_id: body.requestId ?? null,
            application_id: body.applicationId ?? null,
            skip_reason: status === "skipped" ? reason : null,
            ...extra,
          },
        });
      } catch (e) {
        console.warn("[send-invitation-email] abort_log_failed:", (e as any)?.message ?? e);
      }
    };

    // Zentrales SMTP-Routing: wenn applicationId + bekannter templateName vorliegen,
    // ermittelt der Resolver den korrekten Tenant (Broker vs. Fast-Track) — unabhängig
    // vom übergebenen tenantId. Damit sendet z.B. "welcome/registration" IMMER über
    // Fast-Track-SMTP, auch wenn der Caller versehentlich den Broker-Tenant mitschickt.
    let effectiveTenantId = tenantId;
    // Hinweis auf einen Ersatzabsender (kritische Mails) für das E-Mail-Center.
    let senderFallbackMeta: Record<string, unknown> = {};
    const routingKind = TEMPLATE_TO_KIND[templateNameOverride ?? "invitation"];
    if (body.applicationId && routingKind) {
      const resolved = await resolveSender(supabaseAdmin, body.applicationId, routingKind);
      if (resolved.tenant?.id) {
        if (resolved.fallbackUsed) {
          senderFallbackMeta = {
            sender_fallback: true,
            sender_fallback_reason: resolved.fallbackReason ?? null,
            sender_intended_tenant_id: resolved.intendedTenantId ?? null,
            sender_used_tenant_id: resolved.tenant.id,
          };
        }
        if (resolved.tenant.id !== tenantId) {
          console.log("[send-invitation-email] tenant_reroute", {
            application_id: body.applicationId,
            template: templateNameOverride,
            kind: routingKind,
            from: tenantId, to: resolved.tenant.id,
          });
        }
        effectiveTenantId = resolved.tenant.id;
      } else {
        console.warn("[send-invitation-email] routing_skip", {
          application_id: body.applicationId, template: templateNameOverride,
          kind: routingKind, reason: resolved.reason,
        });
        await logAbort("skipped", `routing_skip: ${resolved.reason}`, tenantId ?? null, { routing_kind: routingKind });
        return json({ error: `routing_skip: ${resolved.reason}`, skipped: true, routing_reason: resolved.reason }, 409);
      }
    }


    const { data: tenant, error: tErr } = await supabaseAdmin
      .from("tenants")
      .select("id, name, domain, primary_domain, logo_url, primary_color, sender_email, sender_name, reply_to_email, smtp_host, smtp_port, smtp_username, smtp_password, is_active, emails_paused, emails_paused_reason, emails_paused_by, welcome_email_subject, welcome_email_body, application_received_subject, application_received_body, application_received_button_label")
      .eq("id", effectiveTenantId)
      .maybeSingle();

    if (tErr || !tenant) {
      await logAbort("failed", `tenant_not_found: ${effectiveTenantId}${tErr ? ` (${tErr.message})` : ""}`, null);
      return json({ error: "Tenant nicht gefunden" }, 404);
    }
    if (tenant.is_active === false) {
      await logAbort("skipped", "tenant_inactive", tenant.id, { tenant_name: tenant.name });
      return json({ error: "Tenant ist deaktiviert — kein E-Mail-Versand.", inactive: true }, 503);
    }
    if (!tenant.smtp_host || !tenant.smtp_port || !tenant.smtp_username || !tenant.smtp_password) {
      await logAbort("failed", "smtp_not_configured", tenant.id, { tenant_name: tenant.name });
      return json({ error: "Tenant hat keine vollständige SMTP-Konfiguration" }, 400);
    }
    // Kritische Mails (Terminbestätigung, Interview-Link) ignorieren jede Pause.
    const isCriticalMail = routingKind === "broker_booking_confirmation" || routingKind === "broker_interview_invite";
    if (tenant.emails_paused && !isCriticalMail) {
      // Nur noch manuell gesetzte Tenant-Pausen respektieren (kein Auto-Pause mehr).
      if (tenant.emails_paused_by && tenant.emails_paused_by !== "auto:smtp_verify") {
        await logAbort("skipped", `tenant_emails_paused${tenant.emails_paused_reason ? `: ${tenant.emails_paused_reason}` : ""}`, tenant.id, { tenant_name: tenant.name, paused_by: tenant.emails_paused_by });
        return json({
          error: `E-Mail-Versand für diesen Mandanten ist manuell pausiert${tenant.emails_paused_reason ? `: ${tenant.emails_paused_reason}` : ""}.`,
          paused: true,
        }, 503);
      }
      // Alte Auto-Pausen ignorieren — wir clearen sie unten still.
      try {
        await supabaseAdmin.from("tenants").update({
          emails_paused: false, emails_paused_at: null,
          emails_paused_reason: null, emails_paused_by: null,
        }).eq("id", tenant.id);
      } catch { /* egal */ }
    }

    // --- Recipient-Suppression: nur echte Empfänger-Ablehnungen sperren. ---
    // SMTP-Login-, Verbindungs- und Gatewayfehler gehören zum Absender/Server
    // und dürfen niemals eine Bewerberadresse (erst recht nicht tenantübergreifend)
    // auf die Sperrliste setzen.
    const isTestMode = body.testMode === true;
    if (!isTestMode) try {
      const { data: sup } = await supabaseAdmin
        .from("email_recipient_failures")
        .select("suppressed_at, consecutive_failures, last_error")
        .eq("recipient_email", to.toLowerCase().trim())
        .eq("tenant_id", tenant.id)
        .maybeSingle();
      if (sup?.suppressed_at && isRecipientDeliveryFailure(sup.last_error)) {
        const reason = `recipient_suppressed_after_${sup.consecutive_failures}_fails: ${sup.last_error ?? "unbekannt"}`;
        await logSend(supabaseAdmin, tenant.id, to, "(gesperrt)", "", tenant.sender_email ?? tenant.smtp_username, "skipped", reason, { template_name: templateNameOverride || "invitation" });
        return json({ error: reason, suppressed: true }, 409);
      }
    } catch (e) { console.warn("[send-invitation-email] suppression check skipped:", (e as any)?.message ?? e); }

    const senderName = tenant.sender_name ?? tenant.name;
    const senderEmail = tenant.sender_email ?? tenant.smtp_username;
    const brand = tenant.primary_color ?? "#0f172a";
    const greetingName = firstName || (fullName ? fullName.split(" ")[0] : "");

    // Placeholder-Map für DB-Templates.
    const phMap: Record<string, string> = {
      first_name: greetingName,
      last_name: lastName || "",
      full_name: fullName || `${firstName ?? ""} ${lastName ?? ""}`.trim(),
      email: to,
      tenant_name: tenant.name,
      company_name: tenant.name,
      sender_name: senderName,
      portal_link: registrationLink,
      booking_link: registrationLink,
      registration_link: registrationLink,
      application_received_button_label: tenant.application_received_button_label || "Jetzt Termin buchen",
      ...(extraPlaceholders || {}),
    };
    const applyPh = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, k) => phMap[k] ?? "");

    // Template-Defaults aus tenant-Spalten laden.
    let dbSubject: string | null = null;
    let dbBody: string | null = null;
    let dbButton: string | null = null;
    if (!templateNameOverride || templateNameOverride === "invitation") {
      dbSubject = tenant.welcome_email_subject || null;
      dbBody = tenant.welcome_email_body || null;
    }
    if (templateNameOverride === "application_received") {
      // Zentrale Default-Vorlage für alle Tenants — per-Tenant DB-Overrides
      // (application_received_subject/body/button_label) werden bewusst ignoriert.
      // Personalisierung läuft weiter über Platzhalter (Tenant-Name, Logo, Link, ...).
      dbSubject = null;
      dbBody = null;
      dbButton = null;
    }

    const isDefaultInvitation = !templateNameOverride || templateNameOverride === "invitation" || templateNameOverride === "ai_acceptance_invitation";
    if (isDefaultInvitation && dbBody && isLegacyWelcomeTemplate(dbBody)) dbBody = null;

    const isApplicationReceived = templateNameOverride === "application_received";
    const templateBody = introOverride && introOverride.trim()
      ? introOverride.trim()
      : (dbBody || (isDefaultInvitation ? DEFAULT_WELCOME_TEMPLATE : isApplicationReceived ? DEFAULT_APPLICATION_RECEIVED_TEMPLATE : null));

    const subject = subjectOverride && subjectOverride.trim()
      ? subjectOverride.trim()
      : (dbSubject ? applyPh(dbSubject) : isApplicationReceived ? applyPh(DEFAULT_APPLICATION_RECEIVED_SUBJECT) : `Willkommen im Team – Ihre Registrierung in 5 Minuten`);
    const headline = headlineOverride && headlineOverride.trim()
      ? headlineOverride.trim()
      : isApplicationReceived ? "Bewerbung eingegangen" : "Willkommen im Team";
    const buttonLabel = buttonLabelOverride && buttonLabelOverride.trim()
      ? buttonLabelOverride.trim()
      : (dbButton ? applyPh(dbButton) : isApplicationReceived ? "Jetzt Termin buchen" : "Jetzt registrieren");
    const renderedBody = templateBody
      ? renderTemplateBody(templateBody, phMap, brand, registrationLink, buttonLabel)
      : {
          html: isApplicationReceived
            ? `<p style="font-size:15px;line-height:1.65;color:#334155;margin:0 0 20px">Guten Tag${greetingName ? ` ${escapeHtml(greetingName)}` : ""},<br/><br/>vielen Dank für Ihre Bewerbung bei <strong>${escapeHtml(tenant.name)}</strong>. Wir haben Ihre Angaben erhalten. Bitte wählen Sie jetzt Ihren Termin für das Bewerbungsgespräch aus.</p>`
            : `<p style="font-size:15px;line-height:1.65;color:#334155;margin:0 0 20px">Guten Tag${greetingName ? ` ${escapeHtml(greetingName)}` : ""},<br/><br/><strong>Ihr Profil hat uns überzeugt – lassen Sie uns direkt starten!</strong><br/><br/>Wir freuen uns sehr, Sie bei <strong>${escapeHtml(tenant.name)}</strong> begrüßen zu dürfen. Damit Sie sofort loslegen können, haben wir Ihren persönlichen Zugang zum Mitarbeiterportal bereits für Sie vorbereitet.</p>`,
          hasCta: false,
        };

    const fallbackCta = registrationLink
      ? `<table cellpadding="0" cellspacing="0" align="center" style="margin:4px auto 24px"><tr><td style="background:${brand};border-radius:10px"><a href="${escapeAttr(registrationLink)}" style="display:inline-block;padding:15px 36px;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.4px;text-transform:uppercase">${escapeHtml(buttonLabel)}</a></td></tr></table><p style="font-size:12px;color:#94a3b8;margin:12px 0 0;">Sollte der Button nicht funktionieren, kopieren Sie bitte den folgenden Link in Ihren Browser:<br><a href="${escapeAttr(registrationLink)}" style="color:${brand};word-break:break-all">${escapeHtml(registrationLink)}</a></p>`
      : "";
    const bodyForWrapper = renderedBody.hasCta
      ? renderedBody.html
      : `${renderedBody.html}\n${fallbackCta}`;
    // Einheitliche Logo-Auflösung: Tenant → Fast-Track-Landing → Ziel-Landing → Quell-Landing.
    let sourceLanding: any = null;
    let targetLanding: any = null;
    let fastTrackLanding: any = null;
    if (body.applicationId) {
      try {
        const { data: appRow } = await supabaseAdmin
          .from("applications")
          .select("source_landing_id, target_landing_id, source_slug")
          .eq("id", body.applicationId)
          .maybeSingle();

        const ids = Array.from(new Set([(appRow as any)?.source_landing_id, (appRow as any)?.target_landing_id].filter(Boolean) as string[]));
        const lpMap = new Map<string, any>();
        if (ids.length) {
          const { data: lps } = await supabaseAdmin
            .from("landing_pages")
            .select("id, domain, logo_url, branding, slots, intermediate_logo_url, linked_fasttrack_landing_id, flow_type")
            .in("id", ids);
          for (const lp of (lps ?? []) as any[]) lpMap.set(lp.id, lp);
        }

        sourceLanding = (appRow as any)?.source_landing_id ? lpMap.get((appRow as any).source_landing_id) : null;
        targetLanding = (appRow as any)?.target_landing_id ? lpMap.get((appRow as any).target_landing_id) : null;

        const linkedFastTrackId = sourceLanding?.linked_fasttrack_landing_id || targetLanding?.linked_fasttrack_landing_id;
        if (linkedFastTrackId && !lpMap.has(linkedFastTrackId)) {
          const { data: linked } = await supabaseAdmin
            .from("landing_pages")
            .select("id, domain, logo_url, branding, slots, intermediate_logo_url, linked_fasttrack_landing_id, flow_type")
            .eq("id", linkedFastTrackId)
            .maybeSingle();
          if (linked) lpMap.set(linkedFastTrackId, linked);
        }
        fastTrackLanding = linkedFastTrackId ? lpMap.get(linkedFastTrackId) : null;
        if (!fastTrackLanding && targetLanding?.flow_type !== "broker") fastTrackLanding = targetLanding;
        if (!fastTrackLanding && sourceLanding?.flow_type !== "broker") fastTrackLanding = sourceLanding;

        if ((!sourceLanding || !targetLanding) && (appRow as any)?.source_slug) {
          const { data: slugLanding } = await supabaseAdmin
            .from("landing_pages")
            .select("id, domain, logo_url, branding, slots, intermediate_logo_url, linked_fasttrack_landing_id, flow_type")
            .or(`slug.eq.${(appRow as any).source_slug},source_slug.eq.${(appRow as any).source_slug}`)
            .maybeSingle();
          sourceLanding = sourceLanding || slugLanding;
        }
      } catch (e) { console.warn("[send-invitation-email] logo fallback failed:", (e as any)?.message ?? e); }
    }

    const isBrokerFlow = typeof routingKind === "string" && routingKind.startsWith("broker_");
    const tenantLogoAbsolute = tenant.logo_url && /^https:\/\//i.test(String(tenant.logo_url).trim())
      ? tenant.logo_url
      : null;
    if (tenant.logo_url && !tenantLogoAbsolute) {
      console.warn("[send-invitation-email] tenant.logo_url ist nicht absolut https:// — wird übersprungen", { tenant_id: tenant.id, logo_url: tenant.logo_url });
    }
    // Broker-Flow (inkl. application_received): Source-Landing zuerst — sie hostet das Logo
    // garantiert öffentlich. tenant.logo_url zeigt oft auf nicht-öffentliche Storage-URLs
    // → kaputtes Bild-Icon im Mail-Client.
    const logoCandidates = isBrokerFlow
      ? [
          { source: "source_landing.logo", url: pickLandingLogo(sourceLanding), domain: sourceLanding?.domain },
          { source: "tenant.logo_url", url: tenantLogoAbsolute, domain: tenant.primary_domain || tenant.domain },
          { source: "fasttrack_landing.logo", url: pickLandingLogo(fastTrackLanding), domain: fastTrackLanding?.domain },
          { source: "target_landing.logo", url: pickLandingLogo(targetLanding), domain: targetLanding?.domain },
        ]
      : [
          { source: "tenant.logo_url", url: tenantLogoAbsolute, domain: tenant.primary_domain || tenant.domain },
          { source: "fasttrack_landing.logo", url: pickLandingLogo(fastTrackLanding), domain: fastTrackLanding?.domain },
          { source: "target_landing.logo", url: pickLandingLogo(targetLanding), domain: targetLanding?.domain },
          { source: "source_landing.logo", url: pickLandingLogo(sourceLanding), domain: sourceLanding?.domain },
        ];
    const logo = resolveEmailLogo(logoCandidates);
    const logoMetadata = { email_logo_url: logo.url, email_logo_source: logo.source, email_logo_reason: logo.reason, email_logo_candidates: logo.candidates, email_logo_flow: isBrokerFlow ? "broker" : "default" };

    const { renderEmail } = await import("../_shared/email-wrapper.ts");
    const { html } = renderEmail({
      subject: headline,
      body: bodyForWrapper,
      tenant: { ...tenant, logo_url: logo.url },
      recipient: to,
    });

    // Versand mit gezielter Wiederholung bei Verbindungsfehlern (kein Doppelversand).
    const transporter = {
      sendMail: (message: Record<string, unknown>) => sendMailWithRetry(tenant as any, message, { label: "send-invitation-email" }),
      verify: () => createSmtpTransport(tenant as any).verify(),
    };

    const smtpMeta = {
      smtp_host: tenant.smtp_host,
      smtp_port: tenant.smtp_port,
      smtp_secure: tenant.smtp_port === 465,
      smtp_username: tenant.smtp_username,
      from_email: senderEmail,
      from_name: senderName,
      reply_to: tenant.reply_to_email ?? senderEmail,
      subject,
      tenant_id: tenant.id,
      tenant_name: tenant.name,
      template_name: templateNameOverride || "invitation",
      request_id: body.requestId ?? null,
      application_id: body.applicationId ?? null,
      ...logoMetadata,
      ...senderFallbackMeta,
    };

    // Kontingent-Schutz: verhindert SMTP-Blocks (150/h, 2.400/Tag) und
    // protokolliert die Blockade als "skipped" im E-Mail-Center.
    const allowance = isTestMode
      ? { allowed: true as const, count1h: 0, count24h: 0 }
      : await guardSend({
      admin: supabaseAdmin,
      tenantId: tenant.id,
      templateName: templateNameOverride || "invitation",
      recipient: to,
      kind: isCriticalMail ? "critical" : "transactional",
      senderEmail,
      metadata: smtpMeta,
    });
    if (!allowance.allowed) {
      return json({ error: `Versand blockiert: ${(allowance as any).reason}`, skipped: true, reason: (allowance as any).reason }, 429);
    }

    // Derselbe Bewerbungs-Request darf auch bei verlorener Gateway-Antwort nur
    // einmal versendet werden. Ohne requestId bleiben ältere interne Aufrufer
    // kompatibel und verwenden den bisherigen Log-Pfad.
    let sendClaim: EmailClaim | null = null;
    if (body.requestId) {
      const eventKey = `application-mail:${body.requestId}:${templateNameOverride || "invitation"}`;
      sendClaim = await claimEmailEvent(supabaseAdmin, {
        eventKey,
        templateName: templateNameOverride || "invitation",
        recipient: to,
        tenantId: tenant.id,
        senderEmail,
        subject,
        html,
        metadata: smtpMeta,
      });
      if (!sendClaim) {
        sendClaim = await retryFailedEmailClaim(supabaseAdmin, { eventKey, metadata: smtpMeta });
      }
      if (!sendClaim) {
        return json({ success: true, duplicate: true, reason: "event_already_claimed" }, 200);
      }
    }

    const verifyRes = await verifyOrPause(supabaseAdmin, tenant, transporter);
    if (!verifyRes.ok) {
      if (sendClaim) await finishEmailClaim(supabaseAdmin, sendClaim, { status: "failed", error: verifyRes.reason, metadata: smtpMeta });
      else await logSend(supabaseAdmin, tenant.id, to, subject, html, senderEmail, "failed", verifyRes.reason, smtpMeta);
      if (!isTestMode && isRecipientDeliveryFailure(verifyRes.reason)) {
        await bumpRecipientFailure(supabaseAdmin, to, tenant.id, verifyRes.reason ?? "smtp_verify_failed");
      }
      return json({ error: `SMTP-Verbindung fehlgeschlagen: ${verifyRes.reason}`, paused: verifyRes.paused }, 424);
    }

    try {
      // Hartes Gesamtlimit: die Funktion muss IMMER antworten, sonst sieht der
      // Admin nur "Failed to send a request to the Edge Function".
      const info: any = await Promise.race([
        transporter.sendMail({
          from: `"${senderName}" <${senderEmail}>`,
          to,
          replyTo: tenant.reply_to_email ?? senderEmail,
          subject,
          html,
        }),
        new Promise((_r, rej) =>
          setTimeout(
            () => rej(new Error(`smtp_send_timeout: ${tenant.smtp_host}:${tenant.smtp_port} hat innerhalb von 25 s nicht geantwortet`)),
            25000,
          )
        ),
      ]);
      const sentMeta = { ...smtpMeta, message_id: info?.messageId ?? null };
      if (sendClaim) await finishEmailClaim(supabaseAdmin, sendClaim, { status: "sent", metadata: sentMeta });
      else await logSend(supabaseAdmin, tenant.id, to, subject, html, senderEmail, "sent", undefined, sentMeta);
      await resetRecipientFailure(supabaseAdmin, to, tenant.id);
      return json({ success: true }, 200);
    } catch (sendErr: any) {
      const reason = String(sendErr?.message ?? sendErr);
      if (sendClaim) await finishEmailClaim(supabaseAdmin, sendClaim, { status: "failed", error: reason, metadata: smtpMeta });
      else await logSend(supabaseAdmin, tenant.id, to, subject, html, senderEmail, "failed", reason, smtpMeta);
      if (!isTestMode && isRecipientDeliveryFailure(reason)) {
        await bumpRecipientFailure(supabaseAdmin, to, tenant.id, reason);
      }
      return json({ error: `E-Mail konnte nicht gesendet werden: ${reason}` }, 424);
    }
  } catch (err: any) {
    console.error(err);
    try {
      const admin = createClient(
        (Deno.env.get("SUPABASE_URL") ?? Deno.env.get("API_EXTERNAL_URL"))!,
        (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY"))!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      await admin.from("email_send_log").insert({
        message_id: `send-invitation-email:unhandled:${Date.now()}`,
        template_name: "invitation",
        recipient_email: "(unbekannt)",
        status: "failed",
        error_message: String(err?.message ?? err).slice(0, 1000),
        metadata: { source: "send-invitation-email", unhandled: true },
      });
    } catch { /* non-critical */ }
    return json({ error: err?.message ?? "Unknown error" }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function escapeAttr(s: string) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}

function isLegacyWelcomeTemplate(s: string) {
  const value = String(s || "");
  return LEGACY_WELCOME_MARKERS.some((marker) => value.includes(marker));
}

function renderTemplateBody(template: string, phMap: Record<string, string>, brand: string, registrationLink: string, defaultButtonLabel: string) {
  const applyPh = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, k) => phMap[k] ?? "");
  const source = applyPh(template).replace(/\r\n/g, "\n").trim();
  const lines = source.split("\n");
  const parts: string[] = [];
  let para: string[] = [];
  let listItems: string[] = [];
  let hasCta = false;

  const flushPara = () => {
    if (!para.length) return;
    parts.push(`<p style="font-size:15px;line-height:1.65;color:#334155;margin:0 0 18px">${para.map(escapeHtml).join("<br/>")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    parts.push(`<table cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 24px">${listItems.map((item, index) => `<tr><td width="44" valign="top" style="padding:6px 0"><div style="width:28px;height:28px;border-radius:50%;background:${brand};color:#fff;text-align:center;line-height:28px;font-weight:700;font-size:13px">${index + 1}</div></td><td style="padding:8px 0;font-size:15px;color:#0f172a">${escapeHtml(item)}</td></tr>`).join("")}</table>`);
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    const cta = line.match(/^\{\{cta:([^|]*)\|([^}]*)\}\}$/);
    if (cta) {
      flushPara();
      flushList();
      const label = cta[1].trim() || defaultButtonLabel;
      const href = cta[2].trim() || registrationLink;
      if (!href) continue;
      hasCta = true;
      parts.push(`<table cellpadding="0" cellspacing="0" align="center" style="margin:4px auto 24px"><tr><td style="background:${brand};border-radius:10px"><a href="${escapeAttr(href)}" style="display:inline-block;padding:15px 36px;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.4px;text-transform:uppercase">${escapeHtml(label)}</a></td></tr></table>`);
      continue;
    }
    const list = line.match(/^\d+[.)]\s+(.+)$/);
    if (list) {
      flushPara();
      listItems.push(list[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();

  return { html: parts.join("\n"), hasCta };
}

const SUPPRESS_AFTER_FAILS = 3;

/** Nur permanente Ablehnungen der Zieladresse sind Empfängerfehler. */
function isRecipientDeliveryFailure(reason: unknown): boolean {
  const raw = String(reason ?? "").toLowerCase();
  if (!raw) return false;
  // Auth-, Verbindungs- und Serverfehler sind niemals der Empfängeradresse anzulasten.
  if (/invalid login|\b535\b|eauth|authentication failed|greeting never received|timeout|etimedout|econn|gateway|\b50[024]\b/.test(raw)) {
    return false;
  }
  return /\b5\.1\.[0-9]\b|\b550\b|\b551\b|\b552\b|\b553\b|\b554\b|user unknown|unknown user|mailbox (?:unavailable|not found)|recipient (?:rejected|not found|unknown)|address (?:rejected|not found|does not exist)/.test(raw);
}

async function bumpRecipientFailure(admin: any, email: string, tenantId: string, reason: string) {
  try {
    const key = email.toLowerCase().trim();
    const { data: existing } = await admin
      .from("email_recipient_failures")
      .select("consecutive_failures")
      .eq("recipient_email", key)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const next = (existing?.consecutive_failures ?? 0) + 1;
    const suppress = next >= SUPPRESS_AFTER_FAILS ? new Date().toISOString() : null;
    await admin.from("email_recipient_failures").upsert({
      recipient_email: key,
      tenant_id: tenantId,
      consecutive_failures: next,
      last_failed_at: new Date().toISOString(),
      last_error: reason.slice(0, 500),
      suppressed_at: suppress ?? undefined,
      updated_at: new Date().toISOString(),
    }, { onConflict: "recipient_email,tenant_id" });
    // suppressed_at NUR setzen, wenn Schwelle erreicht — sonst nicht zurücksetzen wenn schon gesperrt
    if (suppress) {
      await admin.from("email_recipient_failures")
        .update({ suppressed_at: suppress })
        .eq("recipient_email", key)
        .eq("tenant_id", tenantId)
        .is("suppressed_at", null);
    }
  } catch (e) { console.warn("[send-invitation-email] bumpRecipientFailure skipped:", (e as any)?.message ?? e); }
}

async function resetRecipientFailure(admin: any, email: string, tenantId: string) {
  try {
    const key = email.toLowerCase().trim();
    await admin.from("email_recipient_failures").upsert({
      recipient_email: key,
      tenant_id: tenantId,
      consecutive_failures: 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: "recipient_email,tenant_id" });
  } catch { /* egal */ }
}

async function logSend(admin: any, tenantId: string, to: string, subject: string, html: string, senderEmail: string, status: string, error?: string, metadata?: Record<string, unknown>) {
  try {
    await admin.from("email_send_log").insert({
      tenant_id: tenantId,
      template_name: (metadata as any)?.template_name || "invitation",
      recipient_email: to,
      status,
      error_message: error ?? null,
      rendered_subject: subject,
      rendered_html: html,
      sender_email: senderEmail,
      metadata: metadata ?? null,
    });
  } catch { /* non-critical */ }
}

async function verifyOrPause(admin: any, tenant: any, transporter: any): Promise<{ ok: boolean; reason?: string; paused?: boolean }> {
  try {
    await Promise.race([
      transporter.verify(),
      new Promise((_r, rej) => setTimeout(() => rej(new Error("verify timeout 15s")), 15000)),
    ]);
    const { error: healthOkErr } = await admin.from("tenant_smtp_health").upsert({
      tenant_id: tenant.id, consecutive_fails: 0,
      last_verify_at: new Date().toISOString(), last_verify_ok: true, updated_at: new Date().toISOString(),
    });
    if (healthOkErr) console.warn("[send-invitation-email] smtp health write skipped:", healthOkErr.message ?? healthOkErr);
    // Auto-Unpause: wenn Tenant zuvor durch das auto:smtp_verify-System pausiert
    // wurde und der Verify jetzt wieder klappt, geben wir den Versand wieder frei.
    if (tenant.emails_paused && tenant.emails_paused_by === "auto:smtp_verify") {
      try {
        await admin.from("tenants").update({
          emails_paused: false, emails_paused_at: null,
          emails_paused_reason: null, emails_paused_by: null,
        }).eq("id", tenant.id);
        await admin.from("activity_log").insert({
          action: "emails_auto_reaktiviert", entity_type: "tenant", entity_id: tenant.id,
          comment: "SMTP-Verify wieder erfolgreich — Versand automatisch reaktiviert.",
        }).then(() => {}, () => {});
      } catch (unpauseErr: any) {
        console.warn("[send-invitation-email] auto-unpause skipped:", unpauseErr?.message ?? unpauseErr);
      }
    }
    return { ok: true };
  } catch (e: any) {
    const reason = String(e?.message ?? e);
    let fails = 1;
    try {
      const { data: h, error: readErr } = await admin.from("tenant_smtp_health").select("consecutive_fails").eq("tenant_id", tenant.id).maybeSingle();
      if (readErr) console.warn("[send-invitation-email] smtp health read skipped:", readErr.message ?? readErr);
      fails = (h?.consecutive_fails ?? 0) + 1;
      const { error: writeErr } = await admin.from("tenant_smtp_health").upsert({
        tenant_id: tenant.id, consecutive_fails: fails,
        last_fail_at: new Date().toISOString(), last_fail_error: reason,
        last_verify_at: new Date().toISOString(), last_verify_ok: false, updated_at: new Date().toISOString(),
      });
      if (writeErr) console.warn("[send-invitation-email] smtp health fail write skipped:", writeErr.message ?? writeErr);
    } catch (healthErr: any) {
      console.warn("[send-invitation-email] smtp health skipped:", healthErr?.message ?? healthErr);
    }
    let paused = false;
    if (false && fails >= 5 && !tenant.emails_paused) {
      await admin.from("tenants").update({
        emails_paused: true,
        emails_paused_at: new Date().toISOString(),
        emails_paused_reason: `SMTP-Verify ${fails}x fehlgeschlagen: ${reason}`,
        emails_paused_by: "auto:smtp_verify",
      }).eq("id", tenant.id);
      await admin.from("activity_log").insert({
        action: "emails_auto_pausiert", entity_type: "tenant", entity_id: tenant.id,
        comment: `SMTP-Versand auto-pausiert nach ${fails} Verify-Fails: ${reason}`,
      }).then(() => {}, () => {});
      paused = true;
    }
    return { ok: false, reason, paused };
  }
}
