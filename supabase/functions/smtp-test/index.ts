// Deno Edge Function: smtp-test
// Prüft die SMTP-Konfiguration eines Tenants mit Admin-Auth und liefert
// detaillierte Diagnose-Schritte für die Admin-Oberfläche.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createSmtpTransport } from "../_shared/smtp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Stage = "AUTH" | "CONFIG" | "TENANT" | "VERIFY" | "DONE";

interface Payload {
  tenant_id?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const debug: Record<string, unknown> = {
    current_stage: "AUTH",
    last_successful_stage: null,
  };

  try {
    const { tenant_id } = (await req.json().catch(() => ({}))) as Payload;
    if (!tenant_id) {
      return json({ success: false, error: "tenant_id fehlt", errorCode: "VALIDATION_ERROR", debug }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("API_EXTERNAL_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      debug.current_stage = "CONFIG" satisfies Stage;
      return json({ success: false, error: "Server-Konfiguration fehlt", errorCode: "CONFIG_ERROR", debug }, 500);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) {
      return json({ success: false, error: "Nicht autorisiert", errorCode: "AUTH_ERROR", debug }, 401);
    }

    const { data: userRes, error: userErr } = await admin.auth.getUser(bearer);
    if (userErr || !userRes?.user) {
      return json({ success: false, error: "Admin-Sitzung ungültig", errorCode: "AUTH_ERROR", details: userErr?.message, debug }, 401);
    }

    const { data: role, error: roleErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userRes.user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (roleErr) {
      return json({ success: false, error: "Admin-Rolle konnte nicht geprüft werden", errorCode: "AUTH_ERROR", details: roleErr.message, debug }, 500);
    }
    if (!role) {
      return json({ success: false, error: "Nicht autorisiert", errorCode: "AUTH_ERROR", debug }, 403);
    }

    debug.last_successful_stage = "AUTH";
    debug.current_stage = "TENANT" satisfies Stage;

    const { data: tenant, error: tenantErr } = await admin
      .from("tenants")
      .select("id,name,sender_email,smtp_host,smtp_port,smtp_username,smtp_password,is_active,emails_paused,emails_paused_by,emails_paused_reason")
      .eq("id", tenant_id)
      .maybeSingle();

    if (tenantErr) {
      return json({ success: false, error: "Tenant konnte nicht geladen werden", errorCode: "TENANT_ERROR", details: tenantErr.message, debug }, 500);
    }
    if (!tenant) {
      return json({ success: false, error: "Tenant nicht gefunden", errorCode: "TENANT_ERROR", debug }, 404);
    }
    if (tenant.is_active === false) {
      return json({ success: false, error: "Tenant ist deaktiviert", errorCode: "TENANT_INACTIVE", debug }, 400);
    }
    // Bewusst KEIN Abbruch bei emails_paused: sonst kann man nach dem
    // Eintragen neuer Zugangsdaten nie nachweisen, dass SMTP wieder geht
    // (Henne-Ei). Der Pausen-Zustand wird nur informativ mitgegeben.
    const wasPaused = !!tenant.emails_paused;
    const pausedBy = (tenant as any).emails_paused_by ?? null;
    const pausedReason = tenant.emails_paused_reason ?? null;
    if (!tenant.smtp_host || !tenant.smtp_port || !tenant.smtp_username || !tenant.smtp_password || !tenant.sender_email) {
      return json({ success: false, error: "SMTP ist nicht vollständig konfiguriert", errorCode: "SMTP_CONFIG_INCOMPLETE", debug }, 400);
    }

    debug.last_successful_stage = "TENANT";
    debug.current_stage = "VERIFY" satisfies Stage;
    debug.smtp_host = tenant.smtp_host;
    debug.smtp_port = tenant.smtp_port;
    debug.smtp_secure = tenant.smtp_port === 465;
    debug.smtp_username = tenant.smtp_username;
    debug.sender_email = tenant.sender_email;

    // Kurze Timeouts nur für den Test: nodemailer soll seinen echten Fehler
    // melden, bevor die Edge-Runtime den Aufruf hart abbricht (HTTP 502 ohne
    // JSON – dann ginge die Ursache verloren).
    const transporter = createSmtpTransport(tenant as any, {
      connectionTimeout: 3500,
      greetingTimeout: 3500,
      socketTimeout: 4500,
    });

    try {
      await Promise.race([
        transporter.verify(),
        // Muss deutlich unter dem Proxy-Timeout liegen, sonst liefert der
        // Reverse-Proxy eine HTML-502-Seite und die Diagnose geht verloren.
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error("verify timeout 5s")), 5000)),
      ]);
    } finally {
      // Promise.race beendet nur unser Warten, nicht den offenen SMTP-Socket.
      // Ohne close() hält nodemailer die Edge Function weiter am Leben, bis
      // der Reverse-Proxy sie trotz bereits erkanntem Timeout mit 502 beendet.
      try {
        transporter.close();
      } catch {
        // Der Transport kann bei DNS-/Connect-Fehlern bereits geschlossen sein.
      }
    }

    debug.last_successful_stage = "VERIFY";
    debug.current_stage = "DONE" satisfies Stage;

    // Health-Counter zurücksetzen
    await admin.from("tenant_smtp_health").upsert({
      tenant_id: tenant.id,
      consecutive_fails: 0,
      last_verify_ok: true,
      last_verify_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    let autoResumed = false;
    let resumeBlocked: string | null = null;

    if (wasPaused) {
      const manualPause = typeof pausedBy === "string" && pausedBy.startsWith("manual:");
      if (manualPause) {
        resumeBlocked = "manual";
      } else {
        const { error: resumeErr } = await admin
          .from("tenants")
          .update({
            emails_paused: false,
            emails_paused_at: null,
            emails_paused_reason: null,
            emails_paused_by: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", tenant.id);

        if (resumeErr) {
          resumeBlocked = "error";
        } else {
          autoResumed = true;
          await admin.from("activity_log").insert({
            actor_id: userRes.user.id,
            action: "emails_reaktiviert",
            entity_type: "tenant",
            entity_id: tenant.id,
            comment: `Automatisch freigegeben nach erfolgreichem SMTP-Test (vorher: ${pausedBy ?? "unbekannt"}${pausedReason ? ` – ${pausedReason}` : ""}).`,
          });
        }
      }
    }

    return json({
      success: true,
      message: autoResumed
        ? "SMTP-Verbindung und Login erfolgreich – Mail-Versand wurde automatisch wieder freigegeben."
        : "SMTP-Verbindung und Login erfolgreich",
      was_paused: wasPaused,
      paused_by: pausedBy,
      paused_reason: pausedReason,
      auto_resumed: autoResumed,
      resume_blocked: resumeBlocked,
      debug,
    }, 200);
  } catch (err: any) {
    const message = String(err?.message ?? err);
    const smtpMeta = {
      code: typeof err?.code === "string" ? err.code : null,
      command: typeof err?.command === "string" ? err.command : null,
      responseCode: typeof err?.responseCode === "number" ? err.responseCode : null,
      response: typeof err?.response === "string" ? err.response : null,
    };
    // Bewusst HTTP 200 mit success:false: Bei 5xx ersetzen Proxy/Gateway
    // (Kong bzw. Edge-Runtime) die Antwort teilweise durch einen leeren Body –
    // dann geht die eigentliche Fehlerursache verloren und im Portal steht nur
    // "keine rechtzeitige Antwort".
    return json({
      success: false,
      error: classifySmtpError(message, smtpMeta),
      errorCode: smtpErrorCode(message, smtpMeta),
      details: message,
      debug: { ...debug, rawError: message, smtp: smtpMeta },
    }, 200);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function smtpErrorCode(message: string, meta?: { code?: string | null; command?: string | null; responseCode?: number | null; response?: string | null }) {
  const code = String(meta?.code ?? "").toUpperCase();
  const command = String(meta?.command ?? "").toUpperCase();
  const normalized = `${message} ${meta?.response ?? ""}`.toLowerCase();
  if (code === "EAUTH" || meta?.responseCode === 535 || command.startsWith("AUTH")) return "AUTH_ERROR";
  if (normalized.includes("timeout") || normalized.includes("etimedout")) return "TIMEOUT";
  if (normalized.includes("econnrefused") || normalized.includes("connection refused")) return "CONNECTION_REFUSED";
  if (normalized.includes("enotfound") || normalized.includes("getaddrinfo")) return "DNS_ERROR";
  if (normalized.includes("certificate") || normalized.includes("tls") || normalized.includes("ssl")) return "TLS_ERROR";
  return "SMTP_ERROR";
}

function classifySmtpError(message: string, meta?: { code?: string | null; command?: string | null; responseCode?: number | null; response?: string | null }) {
  const diagnostic = [meta?.code, meta?.command, meta?.responseCode].filter(Boolean).join(", ");
  switch (smtpErrorCode(message, meta)) {
    case "AUTH_ERROR":
      return `SMTP-Server erreichbar, aber Anmeldung abgelehnt${diagnostic ? ` (${diagnostic})` : ""}: Benutzername, Passwort/App-Passwort und SMTP-AUTH prüfen.`;
    case "TIMEOUT":
      return "SMTP-Server antwortet nicht rechtzeitig.";
    case "CONNECTION_REFUSED":
      return "SMTP-Verbindung wurde abgelehnt: Host oder Port prüfen.";
    case "DNS_ERROR":
      return "SMTP-Host konnte nicht aufgelöst werden.";
    case "TLS_ERROR":
      return "TLS/SSL-Verbindung zum SMTP-Server fehlgeschlagen.";
    default:
      return `SMTP-Test fehlgeschlagen: ${message}`;
  }
}