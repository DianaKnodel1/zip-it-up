// Deno Edge Function: send-password-reset
//
// Sendet Passwort-Reset-Mails über den TENANT-EIGENEN SMTP (nicht Supabase-Auth-SMTP).
// Der Reset-Link wird per `supabase.auth.admin.generateLink({ type: "recovery" })`
// erzeugt und in das Tenant-Template eingebettet. Keine User-Enumeration:
// Antwort ist immer { ok: true }, egal ob die Mail existiert.
//
// Deploy:
//   supabase functions deploy send-password-reset --no-verify-jwt

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

const DEFAULT_SUBJECT = "Passwort zurücksetzen – {{tenant_name}}";
const DEFAULT_BODY = `<h1 style="font-size:22px;margin:0 0 16px;color:#0f172a">Passwort zurücksetzen</h1>
<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 16px">Hallo {{first_name}},</p>
<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 24px">du hast ein neues Passwort für dein Konto bei <strong>{{tenant_name}}</strong> angefordert. Klicke auf den Button, um ein neues Passwort zu setzen. Der Link ist 24 Stunden gültig und kann nur einmal verwendet werden. Danach musst du einen neuen Link anfordern.</p>
{{cta:Passwort zurücksetzen|{{reset_url}}}}
<p style="font-size:13px;color:#94a3b8;margin:24px 0 0">Oder kopiere diesen Link: {{reset_url}}</p>
<p style="font-size:12px;color:#94a3b8;margin:16px 0 0">Wenn du das nicht angefordert hast, kannst du diese Mail ignorieren — dein Passwort bleibt unverändert.</p>`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  // WICHTIG: Erst einfache Variablen ersetzen ({{reset_url}} etc.).
  // {{cta:...}} bleibt unberührt, weil ":" kein \w-Zeichen ist.
  // Vorher brach die CTA-Regex am ersten "}" von verschachteltem {{reset_url}} ab
  // → kaputter Button + übriges "}}" in der Mail.
  let out = tpl.replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? "");
  // CTA-Pattern: {{cta:Label|URL}} → Button (URL ist jetzt bereits aufgelöst)
  out = out.replace(/\{\{cta:([^|]+)\|([^}]+)\}\}/g, (_m, label, href) => {
    const safeHref = String(href).trim().replace(/"/g, "&quot;");
    return `<table cellpadding="0" cellspacing="0"><tr><td style="background:${vars._brand};border-radius:8px"><a href="${safeHref}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">${escapeHtml(label)}</a></td></tr></table>`;
  });
  return out;
}

async function shellHtml(tenant: any, inner: string, recipient?: string): Promise<string> {
  const { renderEmail } = await import("../_shared/email-wrapper.ts");
  const { html } = renderEmail({
    subject: tenant.reset_email_subject || "Passwort zurücksetzen",
    body: `${inner}\n\n<p style="font-size:12px;color:#94a3b8;margin:16px 0 0">Diese E-Mail wurde automatisch versendet. Wenn du das Zurücksetzen nicht angefordert hast, ignoriere sie einfach.</p>`,
    tenant,
    recipient,
  });
  return html;
}


function normalizeDomain(d: string | null | undefined): string {
  return (d ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^portal\./, "").trim();
}

async function resolveTenant(admin: any, host: string | null) {
  const norm = normalizeDomain(host);
  const { data: tenants } = await admin
    .from("tenants")
    .select("id,name,domain,primary_domain,domain_aliases,logo_url,primary_color,sender_email,sender_name,reply_to_email,smtp_host,smtp_port,smtp_username,smtp_password,reset_email_subject,reset_email_body,is_active,emails_paused,emails_paused_reason")
    .eq("is_active", true);
  if (!tenants || tenants.length === 0) return null;
  if (!norm) return tenants[0];
  for (const t of tenants) {
    const primary = normalizeDomain(t.primary_domain ?? t.domain);
    if (primary === norm) return t;
    const aliases: string[] = Array.isArray(t.domain_aliases) ? t.domain_aliases : [];
    if (aliases.map(normalizeDomain).includes(norm)) return t;
  }
  // Fallback: first active
  return tenants[0];
}

async function logEmail(admin: any, tenant: any, email: string, subject: string, html: string | null, status: "sent" | "failed", error?: string) {
  try {
    await admin.from("email_send_log").insert({
      message_id: `password_reset-${crypto.randomUUID()}`,
      template_name: "password_reset",
      recipient_email: email,
      status,
      error_message: error ?? null,
      rendered_subject: subject,
      rendered_html: html,
      sender_email: tenant?.sender_email ?? tenant?.smtp_username ?? null,
      tenant_id: tenant?.id ?? null,
      metadata: {
        from_name: tenant?.sender_name ?? tenant?.name ?? null,
        smtp_host: tenant?.smtp_host ?? null,
      },
    });
  } catch (e) {
    console.error("logEmail failed", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let admin: any;
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      console.error("send-password-reset: SUPABASE_URL/SERVICE_ROLE_KEY missing in function env");
      return new Response(JSON.stringify({ ok: true, warn: "env_missing" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  } catch (e: any) {
    console.error("send-password-reset: createClient failed", e);
    return new Response(JSON.stringify({ ok: true, warn: "init_failed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    const host = body?.host ? String(body.host) : null;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const tenant: any = await resolveTenant(admin, host);
    if (!tenant) {
      await logMailAbort(admin, {
        source: "send-password-reset", templateName: "password_reset", recipient: email,
        tenantId: null, status: "failed", reason: `tenant_not_resolved (host: ${host ?? "n/a"})`,
      });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (tenant.emails_paused) {
      // Generic OK (keine Enumeration), aber loggen
      await logEmail(admin, tenant, email, "(Passwort-Reset)", null, "failed", `skipped: tenant paused (${tenant.emails_paused_reason ?? "n/a"})`);
      return new Response(JSON.stringify({ ok: true, warn: "paused" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Bounce-Suppression: Empfänger mit email_status != 'active' überspringen.
    // Schützt Sender-Reputation. Antwort bleibt ok (keine Enumeration).
    try {
      const [{ data: prof }, { data: app }] = await Promise.all([
        admin.from("profiles").select("email_status").ilike("email", email).neq("email_status", "active").limit(1).maybeSingle(),
        admin.from("applications").select("email_status").ilike("email", email).neq("email_status", "active").limit(1).maybeSingle(),
      ]);
      if (prof || app) {
        await logEmail(admin, tenant, email, "(Passwort-Reset)", null, "failed", "skipped: email_status != active (bounce/complaint suppression)");
        return new Response(JSON.stringify({ ok: true, warn: "suppressed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } catch (e) {
      console.warn("suppression-check failed (continuing):", e);
    }

    const portalHost = `portal.${tenant.primary_domain ?? tenant.domain}`;
    const redirectTo = `https://${portalHost}/reset-password`;

    // Recovery-Link generieren — wir nehmen den hashed_token und bauen den Link
    // selbst auf die Tenant-Domain, damit der Supabase-Auth-Host (api.…) NICHT
    // in der Mail erscheint. Die /reset-password-Seite ruft dann verifyOtp().
    let actionLink: string | null = null;
    try {
      const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } } as any);
      if (error) {
        // user_not_found etc. → ok-Antwort, kein Send
        await logEmail(admin, tenant, email, "(Passwort-Reset)", null, "failed", `skipped: kein Recovery-Link (${error.message ?? "user_not_found"})`);
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const hashed = (data as any)?.properties?.hashed_token ?? null;
      if (hashed) {
        actionLink = `${redirectTo}?token_hash=${encodeURIComponent(hashed)}&type=recovery`;
      }
    } catch (e: any) {
      await logEmail(admin, tenant, email, "(Passwort-Reset)", null, "failed", `generateLink exception: ${String(e?.message ?? e).slice(0, 300)}`);
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!actionLink) {
      await logEmail(admin, tenant, email, "(Passwort-Reset)", null, "failed", "hashed_token fehlt — kein Recovery-Link erzeugt");
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // First-Name aus profiles (optional)
    let firstName = "";
    try {
      const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const u = (users?.users ?? []).find((x: any) => (x.email ?? "").toLowerCase() === email);
      if (u) {
        const { data: prof } = await admin.from("profiles").select("full_name").eq("user_id", u.id).maybeSingle();
        firstName = (prof?.full_name ?? "").split(" ")[0] ?? "";
      }
    } catch {}

    // SMTP-Check: ohne vollständige Tenant-SMTP-Konfiguration NICHT versenden.
    if (!tenant.smtp_host || !tenant.smtp_port || !tenant.smtp_username || !tenant.smtp_password || !tenant.sender_email) {
      await logEmail(admin, tenant, email, "(Passwort-Reset)", null, "failed", "SMTP nicht konfiguriert");
      return new Response(JSON.stringify({ ok: true, warn: "smtp_missing" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const subjectTpl = tenant.reset_email_subject || DEFAULT_SUBJECT;
    const bodyTpl = tenant.reset_email_body || DEFAULT_BODY;

    const vars: Record<string, string> = {
      tenant_name: tenant.name ?? "",
      company_name: tenant.name ?? "",
      first_name: firstName,
      email,
      reset_url: actionLink,
      portal_link: `https://${portalHost}/login`,
      _brand: tenant.primary_color ?? "#0f172a",
    };

    const subject = renderTemplate(subjectTpl, vars).replace(/<[^>]+>/g, "");
    let inner = renderTemplate(bodyTpl, vars);
    if (!/<[a-z][\s\S]*>/i.test(inner)) inner = inner.replace(/\n/g, "<br/>");
    const html = await shellHtml(tenant, inner, email);

    // Versand mit gezielter Wiederholung bei Verbindungsfehlern (kein Doppelversand).
    const transporter = {
      sendMail: (message: Record<string, unknown>) => sendMailWithRetry(tenant as any, message, { label: "send-password-reset" }),
      verify: () => createSmtpTransport(tenant as any).verify(),
    };
    const senderName = tenant.sender_name ?? tenant.name;
    const senderEmail = tenant.sender_email;
    // Kontingent-Schutz (150/h, 2.400/Tag) + Log der Blockade als "skipped".
    const allowance = await guardSend({
      admin, tenantId: tenant.id ?? null, templateName: "password_reset",
      recipient: email, kind: "transactional", senderEmail,
      // Mail-los-Modus gilt ausnahmslos — auch Passwort-Reset-Mails werden
      // nicht verschickt. Zugang wird bei Bedarf manuell wiederhergestellt.
      metadata: { source: "send-password-reset", tenant_name: tenant.name ?? null },
    });
    if (!allowance.allowed) {
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const claim = await claimEmailEvent(admin, {
      eventKey: actionBucketEventKey("password_reset", email),
      templateName: "password_reset", recipient: email,
      tenantId: tenant.id, senderEmail, subject, html,
      metadata: { source: "send-password-reset", user_initiated: true },
    });
    if (!claim) {
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    try {
      const verifyRes = await verifyOrPause(admin, tenant, transporter);
      if (!verifyRes.ok) {
        await finishEmailClaim(admin, claim, { status: "failed", error: `verify_failed: ${verifyRes.reason}${verifyRes.paused ? " (tenant auto-paused)" : ""}`, metadata: { source: "send-password-reset", user_initiated: true } });
      } else {
        await transporter.sendMail({
          from: `"${senderName}" <${senderEmail}>`,
          to: email,
          replyTo: tenant.reply_to_email ?? senderEmail,
          subject,
          html,
        });
        await finishEmailClaim(admin, claim, { status: "sent", metadata: { source: "send-password-reset", user_initiated: true } });
      }
    } catch (err: any) {
      console.error("send-password-reset SMTP failed", err);
      await finishEmailClaim(admin, claim, { status: "failed", error: String(err?.message ?? err), metadata: { source: "send-password-reset", user_initiated: true } });
      // dennoch ok zurückgeben, um keine Enumeration zu ermöglichen
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("send-password-reset error", e);
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

// SMTP-Verify mit Smart-Pause (3 Fails → tenants.emails_paused = true).
// Migration: 20260608110000_tenant_smtp_health.sql
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
