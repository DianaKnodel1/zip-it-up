// Deno Edge Function: send-chat-reminder
//
// Wird vom Admin-Chat manuell per Button getriggert ("📨 Erinnerung senden").
// Schickt dem Mitarbeiter eine kurze E-Mail "Du hast eine neue Nachricht von
// {Teamleiter}" mit Login-Link. Nutzt Tenant-SMTP analog zu send-invitation-email.
//
// Payload: { userId: string, leaderName?: string }
//
// Deploy:
//   supabase functions deploy send-chat-reminder --no-verify-jwt

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createSmtpTransport, sendMailWithRetry } from "../_shared/smtp.ts";
import { loadTenantForSend } from "../_shared/sender-resolver.ts";
import { guardSend } from "../_shared/send-guard.ts";
import { logMailAbort } from "../_shared/log-abort.ts";
import { claimEmailEvent, finishEmailClaim } from "../_shared/send-claim.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  userId: string;
  leaderName?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { userId, leaderName } = (await req.json()) as Payload;
    if (!userId) return json({ error: "userId required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Profil + Tenant
    const { data: profile } = await admin
      .from("profiles")
      .select("user_id, full_name, tenant_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!profile?.tenant_id) return json({ error: "Profil/Tenant nicht gefunden" }, 404);

    // Email aus auth.users
    const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(userId);
    if (authErr || !authUser?.user?.email) return json({ error: "E-Mail nicht gefunden" }, 404);
    const to = authUser.user.email;

    // 🚫 Suppression-Check: Adresse durch Bounces gesperrt?
    const { data: suppressed } = await admin
      .from("suppressed_emails")
      .select("email, reason")
      .ilike("email", to)
      .maybeSingle();
    const abort = (status: "failed" | "skipped", reason: string, tid: string | null) =>
      logMailAbort(admin, {
        source: "send-chat-reminder", templateName: "chat_reminder",
        recipient: to, tenantId: tid, status, reason, metadata: { user_id: userId },
      });

    if (suppressed) {
      await abort("skipped", `recipient_suppressed: ${suppressed.reason}`, profile.tenant_id);
      return json({
        error: `Diese Adresse ist gesperrt (Bounce: ${suppressed.reason}). Bitte direkt anrufen.`,
        suppressed: true,
      }, 200);
    }

    // ⏱️ Rate-Limit: max. 1 Reminder / 24h pro Empfänger
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await admin
      .from("email_send_log")
      .select("created_at")
      .eq("template_name", "chat_reminder")
      .eq("status", "sent")
      .ilike("recipient_email", to)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent) {
      const hoursAgo = Math.round((Date.now() - new Date(recent.created_at).getTime()) / 3600000);
      await abort("skipped", `rate_limited_24h (letzter Versand vor ${hoursAgo}h)`, profile.tenant_id);
      return json({
        error: `Bereits vor ${hoursAgo}h ein Reminder gesendet. Bitte warte 24h zwischen Erinnerungen.`,
        skipped: true,
        lastSentAt: recent.created_at,
      }, 200);
    }

    // Ungelesene Nachrichten zählen (nur informativ für Template-Variable).
    // Reminder darf jetzt auch OHNE ungelesene Nachrichten rausgehen — z.B.
    // wenn ein Mitarbeiter länger nicht mehr im Portal war und der Teamleiter
    // ihn anschreiben will.
    const { count } = await admin
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("receiver_id", userId)
      .eq("read", false);
    const unreadCount = count ?? 0;




    const resolved = await loadTenantForSend(admin, profile.tenant_id, "fasttrack_chat_reminder");
    const tenant = resolved.tenant;
    if (!tenant) {
      await abort("failed", `routing_failed: ${resolved.reason || "tenant_not_found"}`, profile.tenant_id);
      return json({ error: `Routing fehlgeschlagen: ${resolved.reason || "tenant_not_found"}`, routing_reason: resolved.reason }, 409);
    }
    if (!tenant.smtp_host || !tenant.smtp_port || !tenant.smtp_username || !tenant.smtp_password) {
      await abort("failed", "smtp_not_configured", tenant.id);
      return json({ error: "Tenant hat keine vollständige SMTP-Konfiguration" }, 400);
    }
    if (tenant.emails_paused) {
      await abort("skipped", `tenant_emails_paused${tenant.emails_paused_reason ? `: ${tenant.emails_paused_reason}` : ""}`, tenant.id);
      return json({ error: `E-Mail-Versand pausiert${tenant.emails_paused_reason ? `: ${tenant.emails_paused_reason}` : ""}`, paused: true }, 503);
    }

    const senderName = tenant.sender_name ?? tenant.name;
    const senderEmail = tenant.sender_email ?? tenant.smtp_username;
    const brand = tenant.primary_color ?? "#0f172a";
    const firstName = (profile.full_name ?? "").split(" ")[0] || "Hallo";
    const leader = leaderName?.trim() || tenant.team_leader_name || "deinem Teamleiter";
    const loginUrl = `https://${portalHost(tenant.primary_domain || tenant.domain)}/login`;

    // Template aus Tenant (oder Default), Platzhalter ersetzen
    const DEFAULT_SUBJECT = "Neue Nachricht von {{team_leader_name}} – {{tenant_name}}";
    const DEFAULT_BODY = `Hi {{first_name}},\n\nkurze Erinnerung von {{team_leader_name}} aus dem Mitarbeiter-Portal.\n\nBitte logge dich kurz ein – so bleibst du auf dem Laufenden und wir können dir schnell weiterhelfen.\n\n{{cta:Jetzt einloggen|{{login_link}}}}\n\nFalls der Button nicht funktioniert: {{login_link}}`;
    const tplSubject = (tenant.reminder_chat_subject || DEFAULT_SUBJECT);
    const tplBody = (tenant.reminder_chat_body || DEFAULT_BODY);

    const vars: Record<string, string> = {
      first_name: firstName,
      team_leader_name: leader,
      tenant_name: tenant.name,
      company_name: tenant.name,
      login_link: loginUrl,
      portal_link: loginUrl,
      email: to,
      unread_count: String(unreadCount),
    };

    const replaceVars = (s: string) =>
      s.replace(/\{\{(\w+)\}\}/g, (_m, k) => (vars[k] !== undefined ? vars[k] : `{{${k}}}`));
    const subject = replaceVars(tplSubject);

    // Body: erst Vars ersetzen, dann CTA-Syntax, dann Newlines + Links
    let bodyResolved = replaceVars(tplBody);
    bodyResolved = bodyResolved.replace(/\{\{cta:([^|}]+)\|([^}]+)\}\}/g, (_m, label, href) => {
      const url = replaceVars(String(href).trim());
      return `<table cellpadding="0" cellspacing="0" style="margin:16px 0"><tr><td style="background:${brand};border-radius:8px"><a href="${url}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:15px">${escapeHtml(String(label).trim())}</a></td></tr></table>`;
    });
    const bodyHtml = bodyResolved
      .split(/\n/).map((line) => /<table|<a |<div|<p|<h[1-6]/.test(line) ? line : escapeHtml(line)).join("<br>");

    const { renderEmail } = await import("../_shared/email-wrapper.ts");
    const { html } = renderEmail({
      subject,
      body: bodyResolved,
      tenant,
      recipient: to,
    });

    // Versand mit gezielter Wiederholung bei Verbindungsfehlern (kein Doppelversand).
    const transporter = {
      sendMail: (message: Record<string, unknown>) => sendMailWithRetry(tenant as any, message, { label: "send-chat-reminder" }),
      verify: () => createSmtpTransport(tenant as any).verify(),
    };

    // Reminder: Sendefenster 06–22 Uhr + Kontingent (150/h, 2.400/Tag).
    const allowance = await guardSend({
      admin, tenantId: tenant.id, templateName: "chat_reminder", recipient: to,
      kind: "reminder", senderEmail,
      metadata: { user_id: userId, unread_count: unreadCount, source: "send-chat-reminder" },
    });
    if (!allowance.allowed) {
      return json({ success: true, skipped: true, reason: allowance.reason }, 200);
    }

    // Atomarer Anspruch: verhindert Doppelversand bei Doppelklick oder
    // parallelen Aufrufen (Datenbank-Index auf event_key).
    const hourBucket = Math.floor(Date.now() / 3_600_000);
    const claim = await claimEmailEvent(admin, {
      eventKey: `chat_reminder:${userId}:${hourBucket}`,
      templateName: "chat_reminder",
      recipient: to,
      tenantId: tenant.id,
      senderEmail,
      subject,
      html,
      metadata: { user_id: userId, unread_count: unreadCount, source: "send-chat-reminder" },
    });
    if (!claim) {
      return json({ success: true, skipped: true, reason: "already_claimed" }, 200);
    }

    try {
      const info = await transporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        to,
        replyTo: tenant.reply_to_email ?? senderEmail,
        subject,
        html,
      });
      await finishEmailClaim(admin, claim, {
        status: "sent",
        metadata: { message_id: info?.messageId ?? null, unread_count: unreadCount, user_id: userId, tenant_id: tenant.id, sender_kind: "fasttrack_chat_reminder", resolved_tenant_id: tenant.id, source: "send-chat-reminder" },
      });
      return json({ success: true, unread: unreadCount }, 200);

    } catch (sendErr: any) {
      const reason = String(sendErr?.message ?? sendErr);
      await finishEmailClaim(admin, claim, {
        status: "failed",
        error: reason,
        metadata: { user_id: userId, tenant_id: tenant.id, source: "send-chat-reminder" },
      });
      return json({ error: `Versand fehlgeschlagen: ${reason}` }, 502);
    }
  } catch (err: any) {
    console.error(err);
    return json({ error: err?.message ?? "Unknown error" }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function portalHost(domain: unknown): string {
  const clean = String(domain ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/^portal\./, "");
  return clean ? `portal.${clean}` : "";
}
