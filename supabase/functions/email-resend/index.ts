// Deno Edge Function: email-resend
//
// Generischer "Erneut senden"-Button für JEDEN Mail-Typ im E-Mail-Center /
// Roh-Log. Nimmt eine email_send_log-ID, lädt das dort gespeicherte
// rendered_html / rendered_subject und versendet es erneut über das SMTP des
// zugehörigen Tenants. Dadurch funktioniert der Resend für alle Templates,
// ohne Template-Variablen neu aufzubauen.
//
// Payload: { log_id: string, to?: string, is_test?: boolean }
//   to      → Override-Empfänger ("Testkopie an mich"), funktioniert für alle Typen
//   is_test → markiert den Log-Eintrag als Test (kein Supersede der Ursprungszeile)
//
// Auth: Bearer-Token eines eingeloggten Admins (user_roles.role = 'admin')
//       ODER SUPABASE_SERVICE_ROLE_KEY.
//
// Deploy:
//   supabase functions deploy email-resend --no-verify-jwt

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createSmtpTransport, sendMailWithRetry } from "../_shared/smtp.ts";
import { loadTenantForSend } from "../_shared/sender-resolver.ts";
import { guardSend } from "../_shared/send-guard.ts";
import { runRetryQueue } from "../_shared/retry-queue.ts";

const FUNCTION_VERSION = "2026-08-12-generic-resend-retry-queue-v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Templates mit ablaufenden Links/Tokens: gespeichertes HTML enthält den ALTEN Link.
// Diese dürfen nicht "blind" erneut gesendet werden.
const TOKEN_TEMPLATES = new Set([
  "signup_confirmation",
  "signup_confirmation_resend",
  "password_reset",
  "reminder_confirm_email",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function smtpErrorMessage(e: unknown): string {
  return String((e as any)?.message ?? e ?? "SMTP error").slice(0, 500);
}

function isSmtpHourlyRateLimit(errMsg: string): boolean {
  const n = errMsg.toLowerCase();
  return (
    n.includes("too many messages") ||
    n.includes("last 60 minutes") ||
    n.includes("rate limit") ||
    n.includes("rate-limit") ||
    n.includes("throttl") ||
    n.includes("quota exceeded") ||
    n.includes("try again later") ||
    n.includes("451") ||
    n.includes("554 5.7.1")
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  try {
    const body = await req.json().catch(() => ({}));
    const logId: string | null = typeof body?.log_id === "string" ? body.log_id : null;
    const toOverride: string | null =
      typeof body?.to === "string" && body.to.includes("@") ? body.to.trim() : null;
    const isTest = body?.is_test === true;
    const force = body?.force === true;

    // ---------- Auth: Admin-JWT oder Service-Role ----------
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Nicht autorisiert" }, 401);

    let actorId: string | null = null;
    if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      actorId = null; // System-Trigger
    } else {
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) return json({ error: "Nicht autorisiert" }, 401);
      actorId = userData.user.id;
      const { data: role } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", actorId)
        .eq("role", "admin")
        .maybeSingle();
      if (!role) return json({ error: "Nur Admins dürfen E-Mails erneut senden" }, 403);
    }

    // ---------- Modus: automatische Nachversand-Warteschlange ----------
    // Cron ruft alle 10 Minuten mit { retry_queue: true } auf.
    if (body?.retry_queue === true) {
      const summary = await runRetryQueue(admin, {
        dryRun: body?.dry_run === true,
        limit: body?.limit,
        tenantId: typeof body?.tenant_id === "string" ? body.tenant_id : null,
        logId,
      });
      return json({ success: true, mode: "retry_queue", version: FUNCTION_VERSION, ...summary });
    }

    if (!logId) return json({ error: "log_id required", version: FUNCTION_VERSION }, 400);

    // ---------- Log-Zeile laden ----------
    const { data: log, error: logErr } = await admin
      .from("email_send_log")
      .select("id, tenant_id, template_name, recipient_email, rendered_subject, rendered_html, metadata, status, created_at")
      .eq("id", logId)
      .maybeSingle();
    if (logErr) return json({ error: logErr.message }, 500);
    if (!log) return json({ error: "Log-Eintrag nicht gefunden" }, 404);

    if (!log.rendered_html || !log.rendered_subject) {
      return json({
        error: "Diese E-Mail kann nicht erneut gesendet werden (kein gespeichertes HTML). Bitte den Prozess erneut auslösen.",
        code: "no_rendered_html",
      }, 422);
    }

    if (TOKEN_TEMPLATES.has(log.template_name) && !force) {
      return json({
        error: "Diese E-Mail enthält einen zeitlich begrenzten Link. Bitte einen frischen Link über die zuständige Funktion erzeugen.",
        code: "token_template",
        template_name: log.template_name,
      }, 409);
    }

    const to = toOverride ?? log.recipient_email;
    if (!to) return json({ error: "Kein Empfänger bekannt" }, 422);

    // ---------- Suppression ----------
    const { data: suppressed } = await admin
      .from("suppressed_emails")
      .select("email, reason")
      .ilike("email", to)
      .maybeSingle();
    if (suppressed) {
      return json({
        error: `Diese Adresse ist gesperrt (Bounce: ${suppressed.reason}).`,
        code: "suppressed",
      }, 200);
    }

    // ---------- Tenant / SMTP ----------
    const tenantId: string | null =
      log.tenant_id ?? (log.metadata as any)?.resolved_tenant_id ?? (log.metadata as any)?.tenant_id ?? null;
    if (!tenantId) return json({ error: "Kein Mandant am Log-Eintrag hinterlegt", code: "no_tenant" }, 422);

    const { tenant, reason } = await loadTenantForSend(admin, tenantId);
    if (!tenant) return json({ error: `Versand nicht möglich: ${reason}`, code: reason }, 422);

    // Auch der manuelle Resend zählt gegen die SMTP-Kontingente des Tenants.
    const allowance = await guardSend({
      admin,
      tenantId,
      templateName: log.template_name,
      recipient: to,
      kind: "transactional",
      metadata: { source: "email-resend", resent_from: log.id, resent_by: actorId, is_test: isTest },
    });
    if (!allowance.allowed) {
      return json({
        error: "Versand blockiert: Stunden-/Tageskontingent des Mandanten erreicht.",
        code: allowance.reason,
        count_1h: allowance.count1h,
        count_24h: allowance.count24h,
      }, 200);
    }

    // ---------- Senden ----------
    const senderName = tenant.sender_name ?? tenant.name;
    const senderEmail = tenant.sender_email ?? tenant.smtp_username;
    const subject = isTest ? `[TEST] ${log.rendered_subject}` : log.rendered_subject;

    try {
      // Versand mit gezielter Wiederholung bei Verbindungsfehlern (kein Doppelversand).
      const transporter = {
      sendMail: (message: Record<string, unknown>) => sendMailWithRetry(tenant as any, message, { label: "email-resend" }),
      verify: () => createSmtpTransport(tenant as any).verify(),
    };
      await transporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        to,
        replyTo: tenant.reply_to_email ?? senderEmail,
        subject,
        html: log.rendered_html,
      });
    } catch (e) {
      const errMsg = smtpErrorMessage(e);
      const rateLimited = isSmtpHourlyRateLimit(errMsg);
      await admin.from("email_send_log").insert({
        tenant_id: tenantId,
        template_name: log.template_name,
        recipient_email: to,
        status: rateLimited ? "pending" : "failed",
        error_message: errMsg,
        rendered_subject: subject,
        rendered_html: log.rendered_html,
        sender_email: senderEmail,
        metadata: {
          ...(log.metadata ?? {}),
          source: "email-resend",
          resent_from: log.id,
          resent_by: actorId,
          is_test: isTest,
          retry_reason: rateLimited ? "smtp_hourly_rate_limit" : undefined,
        },
      });
      return json({
        error: rateLimited
          ? "SMTP-Stundenlimit erreicht — die E-Mail wurde für einen späteren Versuch eingeplant."
          : errMsg,
        code: rateLimited ? "smtp_rate_limited_retry_later" : "smtp_error",
      }, 200);
    }

    // ---------- Erfolg loggen ----------
    await admin.from("email_send_log").insert({
      tenant_id: tenantId,
      template_name: log.template_name,
      recipient_email: to,
      status: "sent",
      rendered_subject: subject,
      rendered_html: log.rendered_html,
      sender_email: senderEmail,
      metadata: {
        ...(log.metadata ?? {}),
        source: "email-resend",
        resent_from: log.id,
        resent_by: actorId,
        is_test: isTest,
        // Manuelle Wiederholungen dürfen die DB-Doppelsperre passieren.
        resend_nonce: `${log.id}-${Date.now()}`,
      },
    });

    // Ursprungszeile abräumen: hängende Retries verschwinden aus der Warteschlange,
    // Fehler gelten als bearbeitet. Bei Testkopien bleibt das Original unberührt.
    if (!isTest && !toOverride) {
      if (log.status === "pending") {
        await admin.from("email_send_log").update({ status: "superseded" }).eq("id", log.id);
      } else if (["failed", "dlq", "bounced"].includes(log.status)) {
        await admin
          .from("email_send_log")
          .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: actorId })
          .eq("id", log.id);
      }
    }

    return json({ success: true, to, template_name: log.template_name, version: FUNCTION_VERSION });
  } catch (e) {
    return json({ error: smtpErrorMessage(e), version: FUNCTION_VERSION }, 500);
  }
});
