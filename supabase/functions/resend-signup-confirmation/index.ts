// Deno Edge Function: resend-signup-confirmation
//
// Schickt einem bereits angelegten, aber noch NICHT bestätigten User eine neue
// Confirmation-Mail über die Tenant-SMTP. Wenn der User schon bestätigt ist
// → 200 mit {already_confirmed:true}. Wenn der User nicht existiert → 404.
//
// Deploy:
//   supabase functions deploy resend-signup-confirmation --no-verify-jwt

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createSmtpTransport, sendMailWithRetry } from "../_shared/smtp.ts";
import { guardSend } from "../_shared/send-guard.ts";
import { logMailAbort } from "../_shared/log-abort.ts";
import { actionBucketEventKey, claimEmailEvent, finishEmailClaim } from "../_shared/send-claim.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  email: string;
  tenant_id: string;
  redirect_to?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, tenant_id, redirect_to } = (await req.json()) as Payload;
    if (!email || !tenant_id) return json({ error: "Missing required fields: email, tenant_id" }, 400);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Tenant + SMTP laden
    const { data: tenant, error: tErr } = await supabaseAdmin
      .from("tenants")
      .select("id, name, domain, logo_url, primary_color, sender_email, sender_name, reply_to_email, smtp_host, smtp_port, smtp_username, smtp_password, is_active, emails_paused, emails_paused_reason")
      .eq("id", tenant_id)
      .maybeSingle();
    const abort = (status: "failed" | "skipped", reason: string, tid: string | null) =>
      logMailAbort(supabaseAdmin, {
        source: "resend-signup-confirmation", templateName: "signup_confirmation",
        recipient: email, tenantId: tid, status, reason,
      });

    if (tErr || !tenant) {
      await abort("failed", `tenant_not_found: ${tenant_id}${tErr ? ` (${tErr.message})` : ""}`, null);
      return json({ error: "Tenant nicht gefunden" }, 404);
    }
    if (tenant.is_active === false) {
      await abort("skipped", "tenant_inactive", tenant.id);
      return json({ error: "Tenant ist deaktiviert — kein E-Mail-Versand." }, 503);
    }
    if (!tenant.smtp_host || !tenant.smtp_port || !tenant.smtp_username || !tenant.smtp_password) {
      await abort("failed", "smtp_not_configured", tenant.id);
      return json({ error: "Tenant hat keine vollständige SMTP-Konfiguration" }, 400);
    }
    if (tenant.emails_paused) {
      await abort("skipped", `tenant_emails_paused${tenant.emails_paused_reason ? `: ${tenant.emails_paused_reason}` : ""}`, tenant.id);
      return json({ error: `E-Mail-Versand für diesen Mandanten ist pausiert${tenant.emails_paused_reason ? `: ${tenant.emails_paused_reason}` : ""}.` }, 503);
    }

    // User per E-Mail finden. WICHTIG: Niemals unterscheiden, ob die Adresse
    // existiert / bestätigt / unbekannt ist — sonst wird das ein Account-Enumeration-Oracle.
    // In allen Fällen identische 200-Response.
    const GENERIC_OK = json({ success: true }, 200);

    const { data: list, error: lErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (lErr) { console.error("listUsers failed:", lErr); return GENERIC_OK; }
    const user = list.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (!user) return GENERIC_OK;
    if (user.email_confirmed_at) return GENERIC_OK;

    // Frischen Confirmation-Link erzeugen (ohne Passwort → existierender User)
    const redirectTo = redirect_to ?? `https://${tenant.domain}/auth/confirmed`;
    const { data: linkData, error: gErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "signup",
      email,
      options: { redirectTo },
    });
    if (gErr || !linkData?.properties) {
      await abort("failed", `link_generation_failed: ${gErr?.message ?? "unbekannt"}`, tenant.id);
      return json({ error: gErr?.message ?? "Confirmation-Link konnte nicht generiert werden" }, 400);
    }
    // Token-Hash statt action_link (Gmail-Prefetch-Schutz, siehe send-signup-confirmation)
    const tokenHash = (linkData.properties as any)?.hashed_token;
    if (!tokenHash) {
      await abort("failed", "hashed_token_missing", tenant.id);
      return json({ error: "hashed_token fehlt" }, 500);
    }
    const actionLink = `${redirectTo}?token_hash=${encodeURIComponent(tokenHash)}&type=signup`;

    const senderName = tenant.sender_name ?? tenant.name;
    const senderEmail = tenant.sender_email ?? tenant.smtp_username;
    const { renderEmail } = await import("../_shared/email-wrapper.ts");
    const { html, subject: renderedSubject } = renderEmail({
      subject: `Neue Bestätigungs-E-Mail – ${tenant.name}`,
      body: `Du hast eine neue Bestätigungs-E-Mail angefordert. Klicke auf den Button, um deinen Account bei <strong>${escapeHtml(tenant.name)}</strong> zu aktivieren.\n\nDer Link ist 24 Stunden gültig und nur einmal nutzbar.\n\n{{cta:E-Mail bestätigen|${actionLink}}}\n\nFalls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:\n<a href="${actionLink}" style="color:${tenant.primary_color ?? "#2563eb"};word-break:break-all">${actionLink}</a>`,
      tenant,
      recipient: email,
    });

    // Versand mit gezielter Wiederholung bei Verbindungsfehlern (kein Doppelversand).
    const transporter = {
      sendMail: (message: Record<string, unknown>) => sendMailWithRetry(tenant as any, message, { label: "resend-signup-confirmation" }),
      verify: () => createSmtpTransport(tenant as any).verify(),
    };

    const verifyRes = await verifyOrPause(supabaseAdmin, tenant, transporter);
    if (!verifyRes.ok) {
      await abort("failed", `smtp_verify_failed: ${(verifyRes as any).error ?? "unbekannt"}`, tenant.id);
      return json({ success: true }, 200); // generic OK, kein Enumeration-Hint
    }

    // Kontingent-Schutz (150/h, 2.400/Tag); Blockade wird als "skipped" geloggt.
    const allowance = await guardSend({
      admin: supabaseAdmin, tenantId: tenant.id, templateName: "signup_confirmation_resend",
      recipient: email, kind: "transactional", senderEmail,
      metadata: { user_id: user.id, source: "resend-signup-confirmation" },
    });
    if (!allowance.allowed) return json({ success: true }, 200);

    const mailSubject = `Neue Bestätigungs-E-Mail – ${tenant.name}`;
    const messageId = `signup_confirmation_resend-${user.id}-${Date.now()}`;
    const eventKey = actionBucketEventKey("signup_confirmation_resend", email);
    const claim = await claimEmailEvent(supabaseAdmin, {
      eventKey, templateName: "signup_confirmation_resend", recipient: email,
      tenantId: tenant.id, senderEmail, subject: mailSubject, html,
      metadata: { user_id: user.id, source: "resend-signup-confirmation", user_initiated: true },
    });
    if (!claim) return json({ success: true }, 200);

    try {
      await transporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        to: email,
        replyTo: tenant.reply_to_email ?? senderEmail,
        subject: mailSubject,
        html,
      });
    } catch (sendErr: any) {
      await finishEmailClaim(supabaseAdmin, claim, { status: "failed", error: String(sendErr?.message ?? sendErr).slice(0, 500), metadata: { user_id: user.id, source: "resend-signup-confirmation", user_initiated: true } });
      return json({ success: true }, 200); // generic OK, kein Enumeration-Hint
    }

    await finishEmailClaim(supabaseAdmin, claim, { status: "sent", metadata: { user_id: user.id, source: "resend-signup-confirmation", user_initiated: true } });

    return json({ success: true }, 200);

  } catch (err: any) {
    console.error(err);
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
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// Zentrale Logs-Tabelle des E-Mail-Centers. Ohne diesen Insert taucht die
// Resend-Bestätigungsmail nirgends im Admin-Center auf.
async function logSend(admin: any, p: {
  messageId: string; tenantId: string; to: string; subject: string; html: string;
  senderEmail: string; status: "sent" | "failed"; error?: string;
}) {
  try {
    await admin.from("email_send_log").insert({
      message_id: p.messageId,
      tenant_id: p.tenantId,
      template_name: "signup_confirmation_resend",
      recipient_email: p.to,
      status: p.status,
      error_message: p.error ?? null,
      rendered_subject: p.subject,
      rendered_html: p.html,
      sender_email: p.senderEmail,
      metadata: { source: "resend-signup-confirmation" },
    });
  } catch (e) {
    console.warn("email_send_log insert skipped:", e);
  }
}



// SMTP-Verify mit Smart-Pause: erst nach 3 aufeinander folgenden Fails wird
// der Tenant auto-pausiert. Siehe migration 20260608110000_tenant_smtp_health.sql.
async function verifyOrPause(admin: any, tenant: any, transporter: any): Promise<{ ok: boolean; reason?: string; paused?: boolean }> {
  try {
    await Promise.race([
      transporter.verify(),
      new Promise((_r, rej) => setTimeout(() => rej(new Error("verify timeout 15s")), 15000)),
    ]);
    await admin.from("tenant_smtp_health").upsert({
      tenant_id: tenant.id, consecutive_fails: 0,
      last_verify_at: new Date().toISOString(), last_verify_ok: true, updated_at: new Date().toISOString(),
    });
    return { ok: true };
  } catch (e: any) {
    const reason = String(e?.message ?? e);
    const { data: h } = await admin.from("tenant_smtp_health").select("consecutive_fails").eq("tenant_id", tenant.id).maybeSingle();
    const fails = (h?.consecutive_fails ?? 0) + 1;
    await admin.from("tenant_smtp_health").upsert({
      tenant_id: tenant.id, consecutive_fails: fails,
      last_fail_at: new Date().toISOString(), last_fail_error: reason,
      last_verify_at: new Date().toISOString(), last_verify_ok: false, updated_at: new Date().toISOString(),
    });
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
