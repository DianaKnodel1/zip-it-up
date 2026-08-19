import { createFileRoute } from "@tanstack/react-router";

// Wird vom pg_cron alle 5 Min angefragt. Pingt alle aktiven Tenant-Domains
// (primary + aliases), loggt Status, schreibt bei `down` einen Activity-Log-
// Eintrag (Admin sieht ihn auf /admin/activity).
//
// WICHTIG: Dieser Job pausiert KEINEN Mail-Versand mehr. Mails laufen über
// SMTP und sind von der Erreichbarkeit der Landing-Domain unabhängig. Eine
// offline-Domain ist nur ein Hinweis (Links in Mails könnten ins Leere zeigen).
// Pausiert wird ausschließlich bei echten SMTP-Fehlern (siehe smtp-health-cron).
//
// Auth: ?key=<CRON_SECRET> oder Service-Role via Authorization/apikey.

function normalizeDomain(d: string): string {
  return String(d).toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^portal\./, "");
}

async function pingDomain(host: string, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(`https://${host}/`, { method: "HEAD", signal: ctrl.signal, redirect: "manual" });
    clearTimeout(t);
    const latency = Date.now() - start;
    if (res.status === 404) {
      return {
        status: "no_landing",
        http_status: 404,
        latency_ms: latency,
        error: "Erreichbar, aber keine Landing Page für diesen Host konfiguriert." as string | null,
      };
    }
    return { status: latency > 3000 ? "slow" : "ok", http_status: res.status, latency_ms: latency, error: null as string | null };
  } catch (e: any) {
    clearTimeout(t);
    return { status: "down", http_status: null, latency_ms: Date.now() - start, error: String(e?.message ?? e) };
  }
}

async function checkDomain(domain: string) {
  const rootHost = domain;
  const portalHost = `portal.${domain}`;
  const [root, portal] = await Promise.all([
    pingDomain(rootHost),
    pingDomain(portalHost),
  ]);
  const rootAlive = root.status !== "down";
  const portalAlive = portal.status !== "down";
  const rank = (s: string) => (s === "ok" ? 3 : s === "slow" ? 2 : s === "no_landing" ? 1 : 0);
  const preferred = rank(portal.status) >= rank(root.status)
    ? { host: portalHost, ...portal }
    : { host: rootHost, ...root };

  return {
    status: portalAlive || rootAlive ? preferred.status : "down",
    http_status: preferred.http_status,
    latency_ms: preferred.latency_ms,
    error: portalAlive || rootAlive
      ? preferred.error
      : `Root und Portal nicht erreichbar. Root: ${root.error ?? "keine Antwort"}; Portal: ${portal.error ?? "keine Antwort"}`,
    checked_url: `https://${preferred.host}/`,
    root_status: root.status,
    root_error: root.error,
    portal_status: portal.status,
    portal_error: portal.error,
  };
}

function isAuthorized(request: Request, url: URL) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const providedKey = (url.searchParams.get("key") ?? request.headers.get("x-cron-secret") ?? "").trim();
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const apikey = (request.headers.get("apikey") ?? "").trim();

  return Boolean(
    (cronSecret && providedKey === cronSecret) ||
    (serviceRole && (bearer === serviceRole || apikey === serviceRole))
  );
}

export const Route = createFileRoute("/api/public/domain-health-cron")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (!isAuthorized(request, url)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const sb = supabaseAdmin as any;
        const { data: tenants, error } = await sb
          .from("tenants")
          .select("id,name,domain,domain_aliases,primary_domain,emails_paused")
          .eq("is_active", true);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const results: any[] = [];
        const warned: string[] = [];
        for (const t of tenants ?? []) {
          const aliases: string[] = Array.isArray(t.domain_aliases) ? t.domain_aliases : [];
          const all = Array.from(new Set([t.domain, ...aliases].filter(Boolean).map(normalizeDomain)));
          const primary = t.primary_domain ? normalizeDomain(t.primary_domain) : (t.domain ? normalizeDomain(t.domain) : null);

          let downCount = 0;
          for (const d of all) {
            const r = await checkDomain(d);
            results.push({ tenant_id: t.id, tenant_name: t.name, domain: d, is_primary: d === primary, ...r });

            if (r.status === "down") {
              downCount++;
              try {
                await sb.from("activity_log").insert({
                  action: "domain_down_alert",
                  entity_type: "tenant",
                  entity_id: t.id,
                  comment: `Domain ${d} ist DOWN (${r.error ?? "no response"}). ${d === primary ? "AKTIVE Versand-Domain — sofortiger Wechsel auf Alias nötig!" : "Inaktive Alias-Domain."}`,
                });
              } catch {}
            }
          }

          // KEINE Auto-Pause mehr: Mail-Versand hängt an SMTP, nicht an der
          // Erreichbarkeit der Landing-Domain. Nur Warnung ins Activity-Log.
          if (all.length > 0 && downCount === all.length) {
            try {
              await sb.from("activity_log").insert({
                action: "domains_alle_offline",
                entity_type: "tenant",
                entity_id: t.id,
                comment: `Alle ${all.length} Domain(s) nicht erreichbar. Mail-Versand läuft weiter (SMTP), aber Links in Mails könnten ins Leere zeigen — ggf. auf eine erreichbare Alias-Domain wechseln.`,
              });
              warned.push(t.id);
            } catch {}
          }
        }

        return Response.json({ ok: true, checked_at: new Date().toISOString(), domains: results, warned_all_offline: warned, auto_paused: [] });
      },
    },
  },
});
