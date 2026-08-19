/**
 * Landing-Renderer (Server 1)
 * --------------------------------------------------------------------------
 * - Hört auf 127.0.0.1:PORT (default 3001), Caddy macht TLS + Reverse-Proxy.
 * - Liest Landing per Host-Header aus `public.landing_pages` (anon-Key + RLS).
 * - Rendert Theme (HTML/CSS/JS aus ./themes/) mit Branding + Slots.
 * - Caching im Memory mit 60s TTL.
 *
 * Endpunkte:
 *   GET /_health              → "ok"
 *   GET /_internal/ask?domain → 200 wenn Domain bekannt+published (für Caddy
 *                               on_demand_tls), sonst 404 (Cert-Spam-Schutz)
 *   GET /style.css            → CSS des Themes
 *   GET /script.js            → JS des Themes
 *   GET /assets/logo.*        → Redirect auf logo_url aus DB
 *   GET /assets/favicon.*     → Redirect auf favicon_url aus DB
 *   GET /                     → gerendertes HTML
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLegalPage, isPlaceholderValue, renderDatenschutz, renderImpressum } from "./legal-content.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const PORTAL_API_ENDPOINT = process.env.PORTAL_API_ENDPOINT ?? "";
const PORT = Number(process.env.PORT ?? 3001);
const CACHE_TTL_MS = 60_000;
const NEGATIVE_CACHE_TTL_MS = 15_000;
const ASSET_VERSION = process.env.LANDING_ASSET_VERSION || process.env.RELEASE_VERSION || String(Date.now());

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  console.error("[landing-server] SUPABASE_URL und SUPABASE_PUBLISHABLE_KEY müssen gesetzt sein.");
  process.exit(1);
}

const LANDING_SELECT = "id,slug,domain,tenant_id,theme_id,branding,slots,logo_url,favicon_url,flow_type,source_slug,is_published,linked_fasttrack_landing_id,linked_fasttrack:landing_pages!linked_fasttrack_landing_id(domain)";

// ── Themes von Disk laden (einmal beim Start) ────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
type Theme = { id: string; html: string; css: string; js: string };
const THEMES: Record<string, Theme> = {};
const themesDir = join(__dirname, "themes");
for (const id of existsSync(themesDir) ? readdirSync(themesDir) : []) {
  const dir = join(themesDir, id);
  try {
    THEMES[id] = {
      id,
      html: readFileSync(join(dir, "template.html"), "utf8"),
      css: readFileSync(join(dir, "style.css"), "utf8"),
      js: readFileSync(join(dir, "script.js"), "utf8"),
    };
  } catch (e) {
    console.warn(`[themes] Skip ${id}: ${(e as Error).message}`);
  }
}
console.log(`[landing-server] ${Object.keys(THEMES).length} Themes geladen: ${Object.keys(THEMES).join(", ")}`);

// ── Cache ────────────────────────────────────────────────────────────────
type LandingRow = {
  id: string;
  slug: string;
  domain: string;
  tenant_id: string | null;
  theme_id: string;
  branding: Record<string, any>;
  slots: Record<string, string>;
  logo_url: string | null;
  favicon_url: string | null;
  flow_type: "classic" | "fast" | "broker";
  source_slug: string | null;
  is_published: boolean;
};
const cache = new Map<string, { row: LandingRow | null; expiresAt: number; stale?: boolean }>();
const inFlight = new Map<string, Promise<{ row: LandingRow | null; degraded: boolean }>>();

async function fetchLandingOnce(key: string): Promise<{ ok: boolean; row?: LandingRow | null; error?: string }> {
  const apiUrl = new URL("/rest/v1/landing_pages", SUPABASE_URL);
  apiUrl.searchParams.set("select", LANDING_SELECT);
  apiUrl.searchParams.set("domain", `eq.${key}`);
  apiUrl.searchParams.set("is_published", "eq.true");
  apiUrl.searchParams.set("limit", "1");
  try {
    const res = await fetch(apiUrl, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY!,
        authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${(await res.text()).slice(0, 300)}` };
    const rows = (await res.json()) as LandingRow[];
    if (!Array.isArray(rows)) return { ok: false, error: "unexpected response shape" };
    return { ok: true, row: rows[0] ?? null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function refreshLanding(key: string): Promise<{ row: LandingRow | null; degraded: boolean }> {
  let result = await fetchLandingOnce(key);
  if (!result.ok) {
    await new Promise((r) => setTimeout(r, 300));
    result = await fetchLandingOnce(key);
  }
  if (!result.ok) {
    console.error(`[landing-server] DB-Error für ${key}: ${result.error}`);
    const prev = cache.get(key);
    if (prev?.row) {
      // Backend gestört → letzten bekannten Stand weiterliefern statt 404.
      prev.expiresAt = Date.now() + CACHE_TTL_MS;
      prev.stale = true;
      return { row: prev.row, degraded: true };
    }
    // Fehler NIE als "Domain unbekannt" cachen.
    return { row: null, degraded: true };
  }
  const row = result.row ?? null;
  cache.set(key, { row, stale: false, expiresAt: Date.now() + (row ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS) });
  return { row, degraded: false };
}

async function loadLandingState(domain: string): Promise<{ row: LandingRow | null; degraded: boolean }> {
  // www.example.com und example.com auf denselben Datensatz mappen —
  // Caddy on_demand_tls fragt sonst für www.* nach und bekommt 404.
  const key = domain.toLowerCase().replace(/^www\./, "");
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { row: cached.row, degraded: false };

  if (cached?.row) {
    // Abgelaufen, aber bekannt: sofort ausliefern, im Hintergrund erneuern.
    cached.expiresAt = Date.now() + CACHE_TTL_MS;
    if (!inFlight.has(key)) {
      const p = refreshLanding(key).finally(() => inFlight.delete(key));
      inFlight.set(key, p);
      p.catch(() => {});
    }
    return { row: cached.row, degraded: false };
  }

  let pending = inFlight.get(key);
  if (!pending) {
    pending = refreshLanding(key).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

async function loadLanding(domain: string): Promise<LandingRow | null> {
  return (await loadLandingState(domain)).row;
}

// ── Template-Rendering (Platzhalter ersetzen) ────────────────────────────
function applyPlaceholders(src: string, branding: Record<string, any>, slots: Record<string, string>): string {
  const b = { ...(branding || {}) };
  const addrParts = [b.strasse, [b.plz, b.stadt].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const aliases = {
    logo_text: b.firmenname || "",
    firmenname: b.firmenname || "",
    seo_title: b.seo_title || "",
    seo_description: b.seo_description || "",
    landing_domain: b.landing_domain || "",
    address: b.address || addrParts,
    contact_address: b.contact_address || addrParts,
    contact_email: b.contact_email || b.email || "",
    contact_phone: b.contact_phone || b.telefon || "",
    footer_address: b.footer_address || b.address || addrParts,
    footer_email: b.footer_email || b.email || "",
    footer_phone: b.footer_phone || b.telefon || "",
    sitz_stadt: b.sitz_stadt || b.stadt || "",
    sitz_stadt_upper: b.sitz_stadt_upper || (b.stadt ? String(b.stadt).toUpperCase() : ""),
    hrb_nummer: b.hrb_nummer || b.hrb || "",
  };
  // Muster-/Demo-Werte aus Theme-Defaults nie ausspielen.
  const cleanSlots: Record<string, string> = {};
  for (const [k, v] of Object.entries(slots || {})) {
    if (k in aliases && isPlaceholderValue(v)) continue;
    cleanSlots[k] = v;
  }
  const merged = { ...cleanSlots, ...aliases, ...b };
  let out = src;
  for (let i = 0; i < 3; i++) {
    let changed = false;
    for (const [k, v] of Object.entries(merged)) {
      const token = `{{${k}}}`;
      if (out.includes(token)) {
        out = out.split(token).join(String(v ?? ""));
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

function injectLandingConfig(html: string, row: LandingRow): string {
  const esc = (s: string) => String(s ?? "").replace(/[<>"']/g, (c) => ({ "<": "\\u003c", ">": "\\u003e", '"': '\\"', "'": "\\'" }[c]!));
  const rawApi = row.branding?.api_endpoint || PORTAL_API_ENDPOINT;
  const apiEndpoint = String(rawApi ?? "").trim().replace(/[.,;\s]+$/g, "");
  const portalUrl = row.branding?.portal_url || "";
  const wa = row.branding?.whatsapp_enabled ? String(row.branding?.whatsapp_number ?? "").replace(/[^0-9]/g, "") : "";
  const cleanHtml = html.replace(/<script>\s*window\.PORTAL_API\s*=\s*[\s\S]*?<\/script>\s*/gi, "");
  const block = `<script>
window.PORTAL_API = "${esc(apiEndpoint)}";
window.PORTAL_URL = "${esc(portalUrl)}";
window.TENANT_ID = "${esc(row.tenant_id ?? "")}";
window.FLOW_TYPE = "${esc(row.flow_type)}";
window.SOURCE_SLUG = "${esc(row.source_slug ?? row.slug)}";
window.LANDING_ID = "${esc(row.id ?? "")}";
window.WHATSAPP_NUMBER = "${esc(wa)}";

(function(){
  // Fasttrack-Empfang: ?ref=<broker_landing_id> aus URL nach window.SOURCE_LANDING_ID übernehmen
  // und in jeden POST an PORTAL_API (Bewerbungs-Endpoint) source_landing_id + target_landing_id injizieren.
  try {
    var u = new URL(location.href);
    var ref = u.searchParams.get("ref");
    if (ref && /^[0-9a-f-]{36}$/i.test(ref)) {
      window.SOURCE_LANDING_ID = ref;
      try { sessionStorage.setItem("vermittlung_ref", ref); } catch(_){}
    } else {
      try { var s = sessionStorage.getItem("vermittlung_ref"); if (s) window.SOURCE_LANDING_ID = s; } catch(_){}
    }
  } catch(_){}
  var origFetch = window.fetch;
  if (typeof origFetch !== "function") return;
  window.fetch = function(input, init){
    try {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      var api = window.PORTAL_API || "";
      if (api && url && url.indexOf(api) === 0 && init && init.body && typeof init.body === "string") {
        var b = JSON.parse(init.body);
        if (typeof b === "object" && b !== null) {
          if (window.SOURCE_LANDING_ID && !b.source_landing_id) b.source_landing_id = window.SOURCE_LANDING_ID;
          if (window.LANDING_ID && !b.target_landing_id) b.target_landing_id = window.LANDING_ID;
          init = Object.assign({}, init, { body: JSON.stringify(b) });
        }
      }
    } catch(_){}
    return origFetch.call(this, input, init);
  };
})();
</script>`;
  return /<\/head>/i.test(cleanHtml) ? cleanHtml.replace(/<\/head>/i, block + "</head>") : block + cleanHtml;
}

function cleanEmptyMeta(html: string, branding: Record<string, any>, domain: string): string {
  let out = html;
  if (!branding?.seo_image) {
    out = out.replace(/\s*<meta[^>]*property=["']og:image["'][^>]*content=["']["'][^>]*>\s*/gi, "\n");
    out = out.replace(/\s*<meta[^>]*name=["']twitter:image["'][^>]*content=["']["'][^>]*>\s*/gi, "\n");
  }
  // Domain immer da → wir setzen sie nach
  out = out.replace(/\{\{landing_domain\}\}/g, domain);
  return out;
}

// Rechtstexte zentral aus ./legal-content.js (Mirror von src/lib/legal-content.ts).
// Neu erzeugen mit: bun scripts/build-legal-content-js.mjs

function versionThemeAssets(html: string): string {
  const v = encodeURIComponent(ASSET_VERSION);
  return html
    .replace(/\bhref=["'](?:\.\/|\/)?style\.css["']/gi, `href="/style.css?v=${v}"`)
    .replace(/\bsrc=["'](?:\.\/|\/)?script\.js["']/gi, `src="/script.js?v=${v}"`);
}

function renderHtml(row: LandingRow, host: string): { body: string; status: number } {
  const theme = THEMES[row.theme_id];
  if (!theme) return { body: `Theme nicht gefunden: ${row.theme_id}`, status: 500 };
  const slots = { ...(row.slots || {}) };
  slots.impressum_url = "impressum.html";
  slots.datenschutz_url = "datenschutz.html";
  if (row.logo_url && !slots.logo_image) slots.logo_image = "/assets/logo";
  if (row.favicon_url && !slots.favicon_image) slots.favicon_image = "/assets/favicon";
  let html = applyPlaceholders(theme.html, row.branding, slots);
  html = html.replace(/<section[^>]*id=["'](?:impressum|datenschutz)["'][\s\S]*?<\/section>\s*/gi, "");
  html = cleanEmptyMeta(html, row.branding, host);
  html = injectLandingConfig(html, row);
  html = versionThemeAssets(html);
  // Logo/Favicon-Pfade auf /assets/* zeigen lassen (wir redirecten auf Storage)
  if (row.logo_url) html = html.replace(/assets\/logo\.[a-z]+/gi, "/assets/logo");
  if (row.favicon_url) html = html.replace(/assets\/favicon\.[a-z]+/gi, "/assets/favicon");
  return { body: html, status: 200 };
}

function renderLegal(row: LandingRow, type: "impressum" | "datenschutz"): string {
  const branding = row.branding || {};
  const body = type === "datenschutz" ? renderDatenschutz(branding) : renderImpressum(branding);
  return buildLegalPage(type === "datenschutz" ? "Datenschutz" : "Impressum", body, branding, {
    homeHref: "/",
    impressumHref: "/impressum.html",
    datenschutzHref: "/datenschutz.html",
    logoUrl: row.logo_url ? "/assets/logo" : undefined,
  });
}

function renderCss(row: LandingRow): string {
  const t = THEMES[row.theme_id];
  return t ? applyPlaceholders(t.css, row.branding, row.slots) : "/* theme missing */";
}
function renderJs(row: LandingRow): string {
  const t = THEMES[row.theme_id];
  return t ? applyPlaceholders(t.js, row.branding, row.slots) : "// theme missing";
}

function statusPage(title: string, text: string): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  :root{color-scheme:light}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#f6f7f9;color:#1c2430;
       font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  main{max-width:32rem;padding:2.5rem 1.5rem;text-align:center}
  h1{font-size:1.4rem;margin:0 0 .75rem;font-weight:650}
  p{margin:0;color:#5b6674}
</style></head>
<body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;
}

// ── HTTP-Handler ─────────────────────────────────────────────────────────
const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/_health") return new Response("ok");

    // Caddy on_demand_tls ask endpoint
    if (path === "/_internal/ask") {
      const domain = (url.searchParams.get("domain") || "").toLowerCase();
      if (!domain) return new Response("missing domain", { status: 400 });
      const { row } = await loadLandingState(domain);
      return row ? new Response("ok") : new Response("not found", { status: 404 });
    }

    const host = (req.headers.get("host") || "").toLowerCase().split(":")[0];
    if (!host) return new Response("no host", { status: 400 });
    const { row, degraded } = await loadLandingState(host);
    if (!row) {
      console.warn(`[landing-server] keine Landing für ${host} (${degraded ? "Backend-Störung" : "kein Datensatz"})`);
      return degraded
        ? new Response(
            statusPage("Die Seite ist gerade nicht erreichbar", "Wir haben ein kurzes technisches Problem. Bitte lade die Seite in einem Moment neu."),
            { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "30" } },
          )
        : new Response(
            statusPage("Diese Seite ist nicht verfügbar", "Unter dieser Adresse ist derzeit keine Seite hinterlegt."),
            { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
          );
    }

    if (path === "/style.css") {
      return new Response(renderCss(row), { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public,max-age=300" } });
    }
    if (path === "/script.js") {
      return new Response(renderJs(row), { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public,max-age=300" } });
    }
    if (path.startsWith("/assets/logo")) {
      if (row.logo_url) return Response.redirect(row.logo_url, 302);
      return new Response("no logo", { status: 404 });
    }
    if (path.startsWith("/assets/favicon")) {
      if (row.favicon_url) return Response.redirect(row.favicon_url, 302);
      return new Response("no favicon", { status: 404 });
    }
    // Statische Theme-Assets (Hero-Bilder, Service-Bilder etc.) direkt von Disk
    // ausliefern — liegen unter themes/<theme_id>/assets/<file>.
    if (path.startsWith("/assets/")) {
      const rel = path.slice("/assets/".length);
      // Sicherheit: keine Path-Traversal, kein Unterordner
      if (!rel || rel.includes("..") || rel.includes("/") || rel.includes("\\")) {
        return new Response("bad path", { status: 400 });
      }
      const file = Bun.file(join(themesDir, row.theme_id, "assets", rel));
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            "content-type": file.type || "application/octet-stream",
            "cache-control": "public,max-age=86400,immutable",
          },
        });
      }
      return new Response("asset not found", { status: 404 });
    }
    if (path === "/" || path === "/index.html") {
      const { body, status } = renderHtml(row, host);
      return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
    }
    if (path === "/impressum" || path === "/impressum.html") {
      return new Response(renderLegal(row, "impressum"), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
    }
    if (path === "/datenschutz" || path === "/datenschutz.html") {
      return new Response(renderLegal(row, "datenschutz"), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`[landing-server] listening on http://127.0.0.1:${server.port}`);
