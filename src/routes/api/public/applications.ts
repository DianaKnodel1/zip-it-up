import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin",
  "Access-Control-Max-Age": "86400",
};

const Schema = z.object({
  full_name: z.string().trim().min(1).max(120),
  first_name: z.string().trim().max(80).optional().nullable(),
  last_name: z.string().trim().max(80).optional().nullable(),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().max(40).optional().nullable(),
  postal_code: z.string().trim().max(20).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  message: z.string().trim().max(2000).optional().nullable(),
  tenant_id: z.string().uuid().optional().nullable(),
  flow_type: z.enum(["classic", "fast", "broker"]).optional().default("classic"),
  portal_url: z.string().url().max(500).optional().nullable(),
  source_slug: z.string().trim().max(120).optional().nullable(),
  source_landing_id: z.string().uuid().optional().nullable(),
  target_landing_id: z.string().uuid().optional().nullable(),
  is_test: z.coerce.boolean().optional().default(false),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function tenantMailBlockReason(tenant: any | null): string | null {
  if (!tenant) return "tenant_not_found";
  if (tenant.is_active === false) return "tenant_inactive";
  // Auto-Pause entfernt (2026-07-26): Fehler werden pro Empfänger in
  // email_recipient_failures getrackt (3 Fails in Folge → dauerhaft gesperrt).
  // Nur noch MANUELLE Tenant-Pausen respektieren.
  if (tenant.emails_paused && tenant.emails_paused_by && tenant.emails_paused_by !== "auto:smtp_verify") {
    return tenant.emails_paused_reason
      ? `tenant_emails_paused: ${tenant.emails_paused_reason}`
      : "tenant_emails_paused";
  }
  if (!tenant.smtp_host || !tenant.smtp_port || !tenant.smtp_username || !tenant.smtp_password) {
    return "smtp_not_configured";
  }
  return null;
}

function portalBaseFromTenant(tenant: any | null): string | null {
  const domain = String(tenant?.primary_domain ?? tenant?.domain ?? "").trim().replace(/^portal\./, "");
  return domain ? `https://portal.${domain}` : null;
}

function portalBaseFromDomain(domain: unknown): string | null {
  const clean = String(domain ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/^portal\./, "");
  return clean ? `https://portal.${clean}` : null;
}

export const Route = createFileRoute("/api/public/applications")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        console.log("[applications] preflight", {
          origin: request.headers.get("origin") || null,
          requestedHeaders: request.headers.get("access-control-request-headers") || null,
        });
        return new Response(null, { status: 204, headers: CORS });
      },
      POST: async ({ request }) => {
        const requestId = crypto.randomUUID().slice(0, 8);
        const origin = request.headers.get("origin") || null;
        const referer = request.headers.get("referer") || null;
        console.log("[applications] request_received", { requestId, origin, referer });

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          console.warn("[applications] invalid_json", { requestId, origin, referer });
          return json({ error: "Invalid JSON" }, 400);
        }
        const parsed = Schema.safeParse(payload);
        if (!parsed.success) {
          console.warn("[applications] validation_failed", { requestId, details: parsed.error.flatten() });
          return json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
        }
        const d = parsed.data;
        console.log("[applications] payload_valid", {
          requestId,
          email: d.email,
          flow_type: d.flow_type,
          source_slug: d.source_slug ?? null,
          tenant_id: d.tenant_id ?? null,
          is_test: d.is_test,
        });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const isFast = d.flow_type === "fast";
        const displayName = d.is_test ? `[TEST] ${d.full_name}` : d.full_name;

        // Tenant-Fallback: Wenn kein tenant_id mitgeschickt wurde, versuche
        // ihn über Origin/Referer-Header zu ermitteln (Landingpage-Domain).
        let resolvedTenantId: string | null = d.tenant_id ?? null;
        if (!resolvedTenantId) {
          const originHeader = request.headers.get("origin") || request.headers.get("referer") || "";
          try {
            const host = new URL(originHeader).hostname.toLowerCase().replace(/^portal\./, "").replace(/^www\./, "");
            if (host && host !== "localhost") {
              const { data: tByPrimary } = await supabaseAdmin
                .from("tenants").select("id").eq("primary_domain", host).maybeSingle();
              if (tByPrimary?.id) {
                resolvedTenantId = tByPrimary.id;
              } else {
                const { data: tByDomain } = await supabaseAdmin
                  .from("tenants").select("id").eq("domain", host).maybeSingle();
                if (tByDomain?.id) resolvedTenantId = tByDomain.id;
              }
            }
          } catch { /* ignore parse errors */ }
        }

        // Broker-Flow: Partner/Fasttrack wird erst nach erfolgreichem Speichern
        // als Response zurückgegeben; die Landing zeigt den Calendly-Block dadurch
        // ausschließlich nach dem Formular-Submit.
        let calendlyOnLanding: string | null = null;
        let partner: any = null;
        let landingPage: any = null;
        let interviewMode: string | null = null;
        if (d.source_slug) {
          const source = d.source_slug.trim();
          let lp: any = null;
          const { data: bySource } = await supabaseAdmin
            .from("landing_pages")
            .select("id, slug, source_slug, tenant_id, calendly_url, partner_company_id, interview_mode, linked_fasttrack_landing_id, intermediate_company_name, logo_url, branding, booking_mode")
            .eq("source_slug", d.source_slug)
            .eq("is_published", true)
            .maybeSingle();
          lp = bySource ?? null;
          if (!lp) {
            const { data: bySlug } = await supabaseAdmin
              .from("landing_pages")
              .select("id, slug, source_slug, tenant_id, calendly_url, partner_company_id, interview_mode, linked_fasttrack_landing_id, intermediate_company_name, logo_url, branding, booking_mode")
              .eq("slug", source)
              .eq("is_published", true)
              .maybeSingle();
            lp = bySlug ?? null;
          }

          landingPage = lp;
          calendlyOnLanding = typeof lp?.calendly_url === "string" && lp.calendly_url.trim()
            ? lp.calendly_url.trim()
            : null;
          interviewMode = lp?.interview_mode ?? null;
          const partnerId = lp?.partner_company_id ?? null;
          if (partnerId) {
            const { data: pc } = await supabaseAdmin
              .from("partner_companies")
              .select("name, logo_url, calendly_url, portal_register_url, intro_headline, intro_subline, button_label")
              .eq("id", partnerId)
              .maybeSingle();
            partner = pc
              ? { ...pc, calendly_url: calendlyOnLanding || pc.calendly_url }
              : null;
          }
          if (!partner && d.flow_type === "broker" && lp?.linked_fasttrack_landing_id) {
            const { data: linked } = await supabaseAdmin
              .from("landing_pages")
              .select("domain, calendly_url, intermediate_company_name, logo_url, branding")
              .eq("id", lp.linked_fasttrack_landing_id)
              .eq("is_published", true)
              .maybeSingle();
            const linkedBranding = (linked as any)?.branding ?? {};
            const ownBranding = lp?.branding ?? {};
            if (linked) {
              partner = {
                name: (linked as any).intermediate_company_name || linkedBranding.firmenname || lp.intermediate_company_name || ownBranding.firmenname || "unserem Partner",
                logo_url: (linked as any).logo_url || linkedBranding.logo_image || null,
                calendly_url: calendlyOnLanding || (linked as any).calendly_url || linkedBranding.calendly_url || null,
                portal_register_url: null,
                intro_headline: null,
                intro_subline: null,
                button_label: "Jetzt Termin buchen",
              };
            }
          }
          if (!partner && d.flow_type === "broker" && calendlyOnLanding) {
            const ownBranding = landingPage?.branding ?? {};
            partner = {
              name: landingPage?.intermediate_company_name || ownBranding.firmenname || "unserem Partner",
              logo_url: landingPage?.logo_url || ownBranding.logo_image || null,
              calendly_url: calendlyOnLanding,
              portal_register_url: null,
              intro_headline: null,
              intro_subline: null,
              button_label: "Jetzt Termin buchen",
            };
          }
        }
        // Booking-Mode pro Landing Page steuert Calendly vs. eigenes System.
        // 'calendly' → Calendly-Flow; 'internal' → eigenes Buchungssystem.
        // Terminbuchung läuft immer über Calendly — internes Buchungssystem
        // und Verfügbarkeiten sind abgeschaltet.
        const bookingMode: "calendly" = "calendly";
        const isBrokerFlow = d.flow_type === "broker" && !!partner && !d.is_test;
        const isBroker = isBrokerFlow && bookingMode === "calendly";
        const useCalendly = !isBroker && !!calendlyOnLanding && !d.is_test && bookingMode === "calendly";

        // Tenant-Fallback #3: Landing-Page hat i.d.R. tenant_id → nutzen wenn
        // Origin/Referer nichts gebracht hat.
        if (!resolvedTenantId && landingPage?.tenant_id) {
          resolvedTenantId = landingPage.tenant_id as string;
        }
        console.log("[applications] tenant_resolved", {
          requestId,
          tenant_id: resolvedTenantId,
          landing_id: landingPage?.id ?? null,
          source_slug: d.source_slug ?? null,
          booking_mode: landingPage?.booking_mode ?? null,
          interview_mode: interviewMode,
        });

        // Tenant-Guard: Neue Bewerbung OHNE Tenant ist immer ein Bug
        // (Origin unbekannt + kein source_slug + kein tenant_id im Payload).
        // Statt null zu speichern → sauber abweisen, sonst rutschen Bewerber
        // in den "Kadermarketing/Digital-DGI"-Backfill-Zustand.
        if (!resolvedTenantId && !d.is_test) {
          console.warn("[applications] tenant_missing", {
            origin: request.headers.get("origin"),
            referer: request.headers.get("referer"),
            source_slug: d.source_slug ?? null,
            email: d.email,
          });
          return json({ error: "tenant_missing", message: "Bewerbung konnte keinem Mandanten zugeordnet werden." }, 400);
        }


        // Dedup: identische E-Mail im selben Tenant innerhalb 60 Tagen →
        // vorhandene Bewerbung wiederverwenden statt neuen Datensatz anzulegen.
        // Verhindert Doppel-/Dreifach-Einträge, wenn ein Bewerber das Formular
        // mehrfach abschickt (Marc Jung, Shirin Alaqrabawi, …).
        let appId: string | null = null;
        if (resolvedTenantId && !d.is_test) {
          const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60_000).toISOString();
          const { data: existing } = await supabaseAdmin
            .from("applications")
            .select("id")
            .eq("tenant_id", resolvedTenantId)
            .ilike("email", d.email)
            .gte("created_at", sixtyDaysAgo)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if ((existing as any)?.id) appId = (existing as any).id as string;
        }

        const wasNewlyCreated = !appId;
        if (!wasNewlyCreated) {
          console.log("[applications] duplicate_reused", { requestId, application_id: appId, tenant_id: resolvedTenantId, email: d.email });
        }
        if (!appId) {
          appId = crypto.randomUUID();
          // Vor-/Nachname aus explizitem Feld, sonst aus full_name gesplittet
          const nameParts = d.full_name.trim().split(/\s+/);
          const derivedFirst = nameParts[0] ?? "";
          const derivedLast = nameParts.slice(1).join(" ");
          const firstNameForDb = (d.first_name ?? "").trim() || derivedFirst;
          const lastNameForDb = (d.last_name ?? "").trim() || derivedLast;
          const { error } = await supabaseAdmin.from("applications").insert({
            id: appId,
            full_name: displayName,
            first_name: firstNameForDb || null,
            last_name: lastNameForDb || null,
            email: d.email,
            phone: d.phone ?? null,
            postal_code: d.postal_code ?? null,
            city: d.city ?? null,
            message: d.message ?? null,
            tenant_id: resolvedTenantId,
            // Niemals beim Formular-Submit als akzeptiert markieren: das triggert
            // alte Registrierungs-/Willkommens-Automatiken. Zusage erst nach
            // wahrgenommenem positivem Interview bzw. manuellem Recruiter-Entscheid.
            status: "neu",
            flow_type: d.flow_type ?? "classic",
            source_slug: d.source_slug ?? null,
            source_landing_id: d.source_landing_id ?? landingPage?.id ?? null,
            target_landing_id: d.target_landing_id ?? landingPage?.linked_fasttrack_landing_id ?? null,
            is_test: !!d.is_test,
            booking_status: (isBroker || useCalendly) ? "pending" : "none",
          } as any);
          if (error) {
            let recovered = false;
            // Gleichzeitige Absendung derselben Bewerbung: der eindeutige
            // Datenbank-Index lehnt die zweite Anlage ab → vorhandene
            // Bewerbung übernehmen statt Doppel-Eintrag + Doppel-Mail.
            if (String((error as any).code) === "23505" && resolvedTenantId) {
              const { data: existing } = await supabaseAdmin
                .from("applications")
                .select("id")
                .eq("tenant_id", resolvedTenantId)
                .ilike("email", d.email)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if ((existing as any)?.id) {
                appId = (existing as any).id as string;
                recovered = true;
                console.log("[applications] duplicate_race_reused", { requestId, application_id: appId });
              }
            }
            if (!recovered) {
              console.error("[applications] insert error:", error);
              return json({ error: "Could not save application" }, 500);
            }
          } else {
            console.log("[applications] inserted", { requestId, application_id: appId, tenant_id: resolvedTenantId, flow_type: d.flow_type });
          }
        }

        // Stabiler Schlüssel für alle Mails dieser Bewerbung (Doppelversand-Schutz).
        const mailRequestId = appId ? `app:${appId}` : requestId;

        // Eigenes Buchungssystem: falls für Source- oder Ziel-Landing ein aktiver
        // Kalender existiert, wird Calendly ignoriert und der Bewerber landet auf
        // /termin/buchen/:magic_token. Ziel-/Fasttrack-Landing hat Vorrang,
        // Source-Landing ist Fallback für Vermittlungsseiten ohne Ziel-Kalender.
        // K3: bei Dedup-Reuse die ORIGINAL source/target IDs nehmen, damit
        // Buchungs-Redirect + Statistik konsistent bleiben.
        //
        // PORTAL_URL-Fallback: Ältere Landings wurden ohne portal_url generiert
        // (window.PORTAL_URL = ""). Ohne portal_url baut die Route keine
        // Buchungs-URL → Bewerber sehen kein "Jetzt Termin buchen"-Button.
        // Fallback: aus tenant.primary_domain ableiten (`https://portal.<domain>`).
        {
          // Server ist Quelle der Wahrheit: alte Landing-Skripte können noch eine
          // stale portal_url (z.B. portal.uwk-consulting.com) mitsenden. Bei
          // Vermittlung/Broker immer aktuelle verknüpfte Fast-Track-Landing nutzen.
          let serverPortalUrl: string | null = null;
          const fastTrackId = landingPage?.linked_fasttrack_landing_id ?? d.target_landing_id ?? null;
          if (fastTrackId) {
            const { data: ftLp } = await supabaseAdmin
              .from("landing_pages").select("domain, flow_type").eq("id", fastTrackId).maybeSingle();
            if ((ftLp as any)?.flow_type !== "broker") serverPortalUrl = portalBaseFromDomain((ftLp as any)?.domain);
          }
          if (!serverPortalUrl && resolvedTenantId && d.flow_type !== "broker") {
            const { data: tRow } = await supabaseAdmin
              .from("tenants").select("primary_domain, domain").eq("id", resolvedTenantId).maybeSingle();
            serverPortalUrl = portalBaseFromTenant(tRow);
          }
          if (serverPortalUrl && (d.flow_type === "broker" || !d.portal_url || d.portal_url.trim() !== serverPortalUrl)) {
            (d as any).portal_url = serverPortalUrl;
            console.log("[applications] portal_url_server_resolved", { requestId, portal_url: serverPortalUrl, source: fastTrackId ? "fasttrack_landing" : "tenant" });
          }
        }
        let ownBookingUrl: string | null = null;
        const scheduleCandidateIds: string[] = [];
        const pushScheduleCandidate = (id?: string | null) => {
          if (id && !scheduleCandidateIds.includes(id)) scheduleCandidateIds.push(id);
        };
        pushScheduleCandidate(d.target_landing_id ?? null);
        pushScheduleCandidate(landingPage?.linked_fasttrack_landing_id ?? null);
        pushScheduleCandidate(d.source_landing_id ?? null);
        pushScheduleCandidate(landingPage?.id ?? null);
        {
          const { data: existingApp } = await supabaseAdmin
            .from("applications")
            .select("source_landing_id, target_landing_id")
            .eq("id", appId).maybeSingle();
          if (!wasNewlyCreated && landingPage?.linked_fasttrack_landing_id
              && (existingApp as any)?.target_landing_id !== landingPage.linked_fasttrack_landing_id) {
            await supabaseAdmin.from("applications").update({
              source_landing_id: (existingApp as any)?.source_landing_id ?? landingPage.id ?? null,
              target_landing_id: landingPage.linked_fasttrack_landing_id,
            } as any).eq("id", appId);
          }
          pushScheduleCandidate((existingApp as any)?.target_landing_id ?? null);
          pushScheduleCandidate((existingApp as any)?.source_landing_id ?? null);
        }
        // Internes Buchungssystem ist abgeschaltet: Terminbuchung läuft
        // ausschließlich über Calendly (keine Verfügbarkeiten, kein Fallback).

        let redirect_url: string | null = null;
        let booking_error: string | null = null;
        let broker_block: any = null;
        let email_status: {
          attempted: boolean;
          status: "not_attempted" | "sent" | "failed" | "skipped";
          template?: string;
          reason?: string;
        } = { attempted: false, status: "not_attempted" };
        const isOpaqueSupabaseKey = (key: string) => key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");
        const parseMailBody = (text: string) => {
          if (!text) return null;
          try {
            const parsed = JSON.parse(text);
            const value = parsed?.error ?? parsed?.message ?? parsed?.reason ?? parsed?.details ?? parsed?.msg ?? text;
            return typeof value === "string" ? value : JSON.stringify(value);
          } catch {
            return text;
          }
        };
        const mailErrorMessage = async (err: any, data?: any, response?: Response | null) => {
          const dataReason = parseMailBody(typeof data === "string" ? data : JSON.stringify(data ?? null));
          if (data?.error || data?.message) return String(data.error ?? data.message);
          if (dataReason && dataReason !== "null") return dataReason;

          const responseLike = response ?? err?.response ?? err?.context ?? null;
          if (responseLike && typeof responseLike.clone === "function") {
            try {
              const text = await responseLike.clone().text();
              const parsed = parseMailBody(text);
              if (parsed) return parsed;
            } catch { /* fall back to generic error below */ }
          } else if (responseLike && typeof responseLike.text === "function") {
            try {
              const text = await responseLike.text();
              const parsed = parseMailBody(text);
              if (parsed) return parsed;
            } catch { /* fall back to generic error below */ }
          }

          const status = responseLike?.status ? `HTTP ${responseLike.status}${responseLike.statusText ? ` ${responseLike.statusText}` : ""}` : null;
          const message = String(err?.message ?? err?.context?.msg ?? err ?? "Unbekannter Mailfehler");
          return message === "Edge Function returned a non-2xx status code" && status
            ? `send-invitation-email ${status}`
            : message;
        };
        // Rohes Gateway-HTML (Cloudflare-Fehlerseite) nie ins Mail-Protokoll schreiben.
        const normalizeGatewayError = (message: string, status: number | null): string => {
          const raw = String(message ?? "").trim();
          const looksHtml = /^<|<!doctype|<html|cf-error|cloudflare/i.test(raw);
          if (looksHtml || (status !== null && status >= 502 && status <= 524)) {
            return `Mail-Dienst vorübergehend nicht erreichbar${status ? ` (Gateway ${status})` : ""} – Versand kann erneut angestoßen werden`;
          }
          return raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
        };
        const invokeMailFunction = async (body: Record<string, unknown>) => {
          const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.API_EXTERNAL_URL ?? "").replace(/\/+$/, "");
          const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? "";
          if (!supabaseUrl || !serviceKey) {
            return { data: null as any, error: "mail_function_env_missing", response: null as Response | null };
          }
          // Der Schlüssel hängt an der Bewerbung, nicht an der zufälligen
          // Request-ID: zwei gleichzeitige Absendungen derselben Bewerbung
          // dürfen nur EINE Bestätigungsmail auslösen.
          body = { ...body, requestId: mailRequestId };
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            apikey: serviceKey,
          };
          if (!isOpaqueSupabaseKey(serviceKey)) headers.Authorization = `Bearer ${serviceKey}`;

          // Gateway-Aussetzer (502/503/504 von Cloudflare o.ä.) sind keine Mailfehler.
          // Die Mailfunktion selbst sperrt jedes Ereignis atomar – ein erneuter
          // Versuch kann daher keine zweite Mail auslösen.
          const GATEWAY_STATUSES = new Set([502, 503, 504, 520, 521, 522, 524]);
          const RETRY_DELAYS = [1500, 4000];
          let lastResult: { data: any; error: string | null; response: Response | null } = {
            data: null, error: "mail_function_unreachable", response: null,
          };
          for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
            try {
              const response = await fetch(`${supabaseUrl}/functions/v1/send-invitation-email`, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
              });
              const text = await response.clone().text();
              let data: any = null;
              if (text) {
                try { data = JSON.parse(text); } catch { data = text; }
              }
              if (!response.ok) {
                const error = normalizeGatewayError(await mailErrorMessage(null, data, response), response.status);
                console.warn("[applications] mail_function_non_2xx " + JSON.stringify({
                  requestId,
                  attempt: attempt + 1,
                  function_status: response.status,
                  function_status_text: response.statusText || null,
                  function_reason: error,
                  function_body: typeof data === "string" ? data.slice(0, 500) : data ? JSON.stringify(data).slice(0, 500) : null,
                }));
                lastResult = { data, error, response };
                // Nur echte Proxy-/Gateway-Antworten erneut aufrufen. Fachliche
                // JSON-Fehler der Mailfunktion (z. B. Tenant inaktiv) dürfen
                // keinen zweiten Versandversuch auslösen.
                const gatewayResponse = typeof data === "string" || data === null;
                if (GATEWAY_STATUSES.has(response.status) && gatewayResponse && attempt < RETRY_DELAYS.length) {
                  await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
                  continue;
                }
                return lastResult;
              }
              return { data, error: data?.error ? String(data.error) : null, response };
            } catch (err) {
              lastResult = { data: null, error: normalizeGatewayError(await mailErrorMessage(err), null), response: null };
              if (attempt < RETRY_DELAYS.length) {
                await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
                continue;
              }
            }
          }
          return lastResult;
        };
        let mailTenantLoaded = false;
        let mailTenant: any | null = null;
        const loadMailTenant = async () => {
          if (!resolvedTenantId) return { tenant: null, reason: "tenant_missing" };
          if (!mailTenantLoaded) {
            mailTenantLoaded = true;
            const { data: tenant, error: tenantErr } = await supabaseAdmin
              .from("tenants")
              .select("id, name, domain, primary_domain, smtp_host, smtp_port, smtp_username, smtp_password, is_active, emails_paused, emails_paused_reason, mailless_mode")
              .eq("id", resolvedTenantId)
              .maybeSingle();
            if (tenantErr) {
              const reason = `tenant_lookup_failed: ${tenantErr.message}`;
              console.warn("[applications] mail_tenant_lookup_failed", { requestId, tenant_id: resolvedTenantId, reason });
              return { tenant: null, reason };
            }
            mailTenant = tenant ?? null;
          }
          return { tenant: mailTenant, reason: tenantMailBlockReason(mailTenant) };
        };
        // Jede Mail-Entscheidung dieser Route wird protokolliert — sent, failed und skipped.
        const writeMailLog = async (
          template: "invitation" | "application_received",
          status: "sent" | "failed" | "skipped",
          reason?: string,
          metadata?: Record<string, unknown>,
        ) => {
          const { error: logErr } = await supabaseAdmin.from("email_send_log").insert({
            message_id: `applications:${requestId}:${template}:${Date.now()}`,
            tenant_id: resolvedTenantId ?? null,
            template_name: template,
            recipient_email: d.email,
            status,
            error_message: reason ? reason.slice(0, 1000) : null,
            metadata: {
              source: "applications_route",
              request_id: requestId,
              application_id: appId,
              skip_reason: status === "skipped" ? (reason ?? null) : null,
              full_name: d.full_name,
              first_name: d.first_name ?? null,
              last_name: d.last_name ?? null,
              flow_type: d.flow_type ?? "classic",
              source_slug: d.source_slug ?? null,
              ...metadata,
            },
          } as any);
          if (logErr) console.warn("[applications] mail_log_failed", { requestId, template, status, reason: logErr.message });
        };
        // Hat die Versand-Function für diese Bewerbung bereits geloggt?
        const functionAlreadyLogged = async (template: string) => {
          try {
            const { data } = await supabaseAdmin
              .from("email_send_log")
              .select("id")
              .eq("template_name", template)
              .eq("recipient_email", d.email)
              .contains("metadata", { request_id: mailRequestId } as any)
              .limit(1);
            return !!data?.length;
          } catch { return false; }
        };
        const logMailAttempt = (template: "invitation" | "application_received", extra?: Record<string, unknown>) => {
          console.log("[applications] mail_attempt " + JSON.stringify({
            requestId, application_id: appId, tenant_id: resolvedTenantId,
            recipient: d.email, template, ...extra,
          }));
        };
        const logMailResult = async (
          template: "invitation" | "application_received",
          status: "sent" | "failed" | "skipped",
          reason?: string,
          extra?: Record<string, unknown>,
        ) => {
          const payload = {
            requestId, application_id: appId, tenant_id: resolvedTenantId,
            recipient: d.email, template, status, reason: reason ?? null, ...extra,
          };
          const line = JSON.stringify(payload);
          if (status === "sent") {
            console.log("[applications] mail_sent " + line);
            if (!(await functionAlreadyLogged(template))) {
              await writeMailLog(template, "sent", undefined, extra);
            }
          } else if (status === "skipped") {
            console.log("[applications] mail_skipped " + line);
            await writeMailLog(template, "skipped", reason || "skipped", extra);
          } else {
            console.warn("[applications] mail_failed " + line);
            if (!(await functionAlreadyLogged(template))) {
              await writeMailLog(template, "failed", reason || "unknown_mail_error", extra);
            }
          }
        };

        // Terminbuchung immer über Calendly; danach ggf. Interview-Redirect.
        const useInterview = !d.is_test && !isBroker && !isFast && !!interviewMode
          && (interviewMode === "chat" || interviewMode === "voice" || interviewMode === "both")
          && !!d.portal_url && !!d.source_slug;


        if (useInterview) {
          const base = d.portal_url!.replace(/\/+$/, "");
          const qs = new URLSearchParams({
            landing: d.source_slug!,
            portal: base,
          }).toString();
          redirect_url = `${base}/interview/${appId}?${qs}`;
        } else if (isBroker) {

          const parts = d.full_name.trim().split(/\s+/);
          const firstName = parts[0] ?? "";
          const lastName = parts.slice(1).join(" ");
          const base = String(partner.calendly_url || "").trim();
          const sep = base.includes("?") ? "&" : "?";
          const qs = new URLSearchParams({
            name: d.full_name, email: d.email,
            first_name: firstName, last_name: lastName,
            utm_content: appId, utm_source: d.source_slug ?? "",
          }).toString();
          broker_block = {
            partner_name: partner.name,
            partner_logo: partner.logo_url ?? null,
            calendly_url: base ? `${base}${sep}${qs}` : "",
            fallback_url: null,
            button_label: partner.button_label || "Jetzt Termin buchen",
            intro_headline: partner.intro_headline ?? null,
            intro_subline: partner.intro_subline ?? null,
            portal_register_url: partner.portal_register_url ?? null,
          };
        } else if (useCalendly) {
          // Calendly sitzt IMMER vor dem Termin — auch bei Fast-Track.
          // Keine Portal-Weiterleitung, solange ein Calendly-Link hinterlegt ist.
          // Kollegen-Ablauf: KEINE Zwischenseite / Auto-Weiterleitung mehr.
          // Direkt auf der Landingpage die Danke-Karte mit einem Button
          // "Jetzt Termin buchen" (Calendly, vorbefüllt) rendern.
          const parts = d.full_name.trim().split(/\s+/);
          const firstName = parts[0] ?? "";
          const lastName = parts.slice(1).join(" ");
          const calBase = String(calendlyOnLanding || "").trim();
          const sep = calBase.includes("?") ? "&" : "?";
          const qs = new URLSearchParams({
            name: d.full_name, email: d.email,
            first_name: firstName, last_name: lastName,
            utm_content: appId, utm_source: d.source_slug ?? "",
          }).toString();
          // Die Danke-Karte nennt die Firma, an die vermittelt wird. Bei einer
          // Vermittlung ist das die verknüpfte Fast-Track-Landing, nicht die
          // eigene Landingpage.
          let targetName = "";
          let targetLogo: string | null = null;
          const linkedFastId = (landingPage as any)?.linked_fasttrack_landing_id
            ?? d.target_landing_id ?? null;
          if (linkedFastId) {
            const { data: ftLp } = await supabaseAdmin
              .from("landing_pages")
              .select("intermediate_company_name, logo_url, branding")
              .eq("id", linkedFastId)
              .maybeSingle();
            const ftBranding = (ftLp as any)?.branding ?? {};
            targetName = (ftLp as any)?.intermediate_company_name || ftBranding.firmenname || "";
            targetLogo = (ftLp as any)?.logo_url || ftBranding.logo_image || null;
          }
          const ownBranding = (landingPage as any)?.branding ?? {};
          broker_block = {
            partner_name:
              targetName
              || (landingPage as any)?.intermediate_company_name
              || (ownBranding.firmenname ?? "")
              || "unserem Partnerunternehmen",
            partner_logo: targetLogo || (landingPage as any)?.logo_url || ownBranding.logo_image || null,
            calendly_url: calBase ? `${calBase}${sep}${qs}` : "",
            fallback_url: null,
            button_label: "Jetzt Termin buchen",
            intro_headline: null,
            intro_subline: null,
            portal_register_url: null,
          };
        } else if (isFast && d.portal_url) {
          // Fasttrack ohne Calendly-Link: direkt zur Portal-Startseite.
          const base = d.portal_url.replace(/\/+$/, "");
          redirect_url = `${base}/`;
        }

        // Vermittlung/Calendly ohne Link = Fehlkonfiguration (kein Fallback mehr).
        if (broker_block && !broker_block.calendly_url) {
          booking_error = "calendly_missing";
          console.warn("[applications] calendly_missing", {
            requestId, application_id: appId, landing_id: landingPage?.id ?? null,
          });
        }

        // Fast-Track: KEINE "Willkommen im Team"-Mail mehr beim Bewerbungseingang.
        // Der einheitliche Ablauf ist: Bewerbungseingang-Bestätigung mit Termin-
        // link → Bewerber bucht → Terminbestätigung → Interview → erst nach
        // Zusage (Stage-Wechsel) schickt der Recruiter die Einladung.
        if (isFast && resolvedTenantId && !d.is_test) {
          try {
            await supabaseAdmin.from("invite_resend_queue")
              .update({ status: "skipped", last_error: "fast_track_accept" } as any)
              .eq("tenant_id", resolvedTenantId)
              .eq("email", d.email.toLowerCase())
              .in("status", ["queued", "sending"]);
          } catch (e) { console.warn("[applications fast] skip drip queue:", e); }
        }

        // Eingangsbestätigung an Bewerber – für ALLE Flows (inkl. Fast-Track).
        // Nur beim ersten Einreichen (wasNewlyCreated). Termin-Link
        // (Calendly/eigenes System/Broker) wird als Button eingebettet.
        const brokerBookingLink = broker_block?.calendly_url || ownBookingUrl;
        const confirmationBookingLink =
          brokerBookingLink
          || (useCalendly ? calendlyOnLanding : null)
          || ownBookingUrl
          || null;
        // Calendly übernimmt Mail + SMS + Kalendereintrag komplett selbst.
        // Für diesen Modus verschickt das Portal bewusst KEINE eigene
        // Eingangsbestätigung (A/B gegen die interne Terminbuchung).
        const calendlyHandlesMail = (isBroker || useCalendly) && !!broker_block?.calendly_url;
        // Mailless-Mode: das Portal verschickt grundsätzlich keine Bewerber-Mails
        // mehr (Calendly übernimmt Bestätigung/Reminder per Mail + SMS).
        const maillessTenant = resolvedTenantId && !d.is_test
          ? (await loadMailTenant()).tenant?.mailless_mode === true
          : false;
        const shouldSendConfirmation =
          wasNewlyCreated && resolvedTenantId && !d.is_test && !calendlyHandlesMail && !maillessTenant;

        console.log("[applications] confirmation_decision", {
          requestId,
          application_id: appId,
          shouldSendConfirmation,
          isFast,
          wasNewlyCreated,
          calendly_handles_mail: calendlyHandlesMail,
          tenant_id: resolvedTenantId,
          is_test: d.is_test,
          has_booking_link: !!confirmationBookingLink,
        });

        if (shouldSendConfirmation) {
          try {
            const parts = d.full_name.trim().split(/\s+/);
            const firstName = parts[0] ?? "";
            const lastName = parts.slice(1).join(" ");
            email_status = { attempted: true, status: "failed", template: "application_received" };
            const { tenant, reason: preflightReason } = await loadMailTenant();
            // Vermittlung/Broker: NIEMALS auf die Vermittlungs-Domain zurückfallen.
            // d.portal_url ist oben serverseitig bereits auf die verknüpfte
            // Fast-Track-Landing gesetzt; fehlt sie, lieber kein Link als ein
            // Link auf die Vermittlungsseite (dort gibt es kein Portal).
            const fallbackPortalLink = d.portal_url?.replace(/\/+$/, "")
              || (d.flow_type === "broker" ? null : portalBaseFromTenant(tenant));
            const confirmationActionLink = confirmationBookingLink || fallbackPortalLink || "";
            logMailAttempt("application_received", {
              has_booking_link: !!confirmationBookingLink,
              action_link_present: !!confirmationActionLink,
            });
            if (preflightReason) {
              email_status = { attempted: true, status: "failed", template: "application_received", reason: preflightReason };
              await logMailResult("application_received", "failed", preflightReason, { preflight: true, tenant_name: tenant?.name ?? null });
            } else if (!confirmationActionLink) {
              const reason = "confirmation_action_link_missing";
              email_status = { attempted: true, status: "failed", template: "application_received", reason };
              await logMailResult("application_received", "failed", reason, { preflight: true });
            } else {
              const { data: mailData, error: mailErr, response: mailResponse } = await invokeMailFunction({
                to: d.email,
                fullName: d.full_name,
                firstName,
                lastName,
                registrationLink: confirmationActionLink,
                tenantId: resolvedTenantId,
                templateName: "application_received",
                applicationId: appId,
                placeholders: {
                  partner_name: partner?.name ?? broker_block?.partner_name ?? "",
                  calendly_link: confirmationBookingLink ?? "",
                  booking_link: confirmationBookingLink ?? "",
                },
              });

              if (mailErr || mailData?.error) {
                const reason = await mailErrorMessage(mailErr, mailData, mailResponse);
                email_status = { attempted: true, status: "failed", template: "application_received", reason };
                await logMailResult("application_received", "failed", reason, { action_link_present: !!confirmationActionLink, function_status: mailResponse?.status ?? null, function_reason: mailErr ?? null });
              } else {
                email_status = { attempted: true, status: "sent", template: "application_received" };
                await logMailResult("application_received", "sent", undefined, { has_booking_link: !!confirmationBookingLink, action_link_present: !!confirmationActionLink, function_status: mailResponse?.status ?? null });
              }
            }
          } catch (e) {
            const reason = await mailErrorMessage(e);
            email_status = { attempted: true, status: "failed", template: "application_received", reason };
            await logMailResult("application_received", "failed", reason);
          }
        } else if (calendlyHandlesMail && !d.is_test) {
          email_status = { attempted: false, status: "skipped", template: "application_received", reason: "calendly_handles_mail" };
          await logMailResult("application_received", "skipped", "calendly_handles_mail");
        } else if (maillessTenant && wasNewlyCreated) {
          email_status = { attempted: false, status: "skipped", template: "application_received", reason: "mailless_mode" };
          await logMailResult("application_received", "skipped", "mailless_mode");
        } else if (!wasNewlyCreated && !d.is_test) {
          email_status = { attempted: false, status: "skipped", template: "application_received", reason: "duplicate_application" };
          await logMailResult("application_received", "skipped", "duplicate_application");
        }




        console.log("[applications] response", {
          requestId,
          application_id: appId,
          flow_type: d.flow_type ?? "classic",
          has_redirect: !!redirect_url,
          has_broker: !!broker_block,
          email_status,
        });
        return json({ success: true, flow_type: d.flow_type ?? "classic", redirect_url, broker: broker_block, email_status, booking_error });


      },
    },
  },
});
