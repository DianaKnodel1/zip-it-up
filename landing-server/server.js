/**
 * Landing-Renderer (RAM-schonende Runtime-Version)
 * Läuft ohne TypeScript-Transpiling und ohne npm-Abhängigkeiten.
 */

import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLegalPage, isPlaceholderValue, renderDatenschutz, renderImpressum } from "./legal-content.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const PORTAL_API_ENDPOINT = process.env.PORTAL_API_ENDPOINT || "";
// Basis-URL zum Portal für Theme-Assets (…/applications → …/landing-server-files).
const PORTAL_FILES_BASE = (process.env.PORTAL_FILES_BASE || PORTAL_API_ENDPOINT.replace(/\/applications\/?$/, "/landing-server-files")).replace(/\/+$/, "");
const PORT = Number(process.env.PORT || 3001);
const CACHE_TTL_MS = 60_000;
// Ein echtes "Domain steht nicht in der Tabelle" nur kurz merken, damit eine
// frisch angelegte Landing schnell live geht.
const NEGATIVE_CACHE_TTL_MS = 15_000;
const ASSET_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const assetCache = new Map();

const LANDING_SELECT = "id,slug,domain,tenant_id,theme_id,branding,slots,logo_url,favicon_url,flow_type,source_slug,is_published,calendly_url,intermediate_company_name,updated_at,linked_fasttrack_landing_id,linked_fasttrack:landing_pages!linked_fasttrack_landing_id(domain,branding,calendly_url,intermediate_company_name,logo_url)";
const __dirname = dirname(fileURLToPath(import.meta.url));
// Themes-Verzeichnis: zuerst ENV, dann Portal-Repo (automatisch), dann lokales themes/
function resolveThemesDir() {
  const candidates = [
    process.env.THEMES_DIR,
    "/opt/apps/portal/src/landing-themes",
    join(__dirname, "..", "portal", "src", "landing-themes"),
    join(__dirname, "themes"),
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) {
      console.log(`[themes] using ${p}`);
      return p;
    }
  }
  return join(__dirname, "themes");
}
const themesDir = resolveThemesDir();
const cache = new Map();
const themeCache = new Map();
const THEME_CACHE_TTL_MS = 30_000;


function requestJson(url, headers) {
  return new Promise((resolve, reject) => {
    const request = url.protocol === "http:" ? httpRequest : httpsRequest;
    const req = request(url, { method: "GET", headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > 2_000_000) req.destroy(new Error("response too large"));
      });
      res.on("end", () => {
        resolve({
          ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
          status: res.statusCode || 0,
          text: body,
          json: () => JSON.parse(body),
        });
      });
    });
    req.setTimeout(6_000, () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
    req.end();
  });
}

function requestBuffer(url, headers) {
  return new Promise((resolve, reject) => {
    const request = url.protocol === "http:" ? httpRequest : httpsRequest;
    const req = request(url, { method: "GET", headers }, (res) => {
      const chunks = [];
      let total = 0;
      res.on("data", (chunk) => {
        chunks.push(chunk);
        total += chunk.length;
        if (total > 10_000_000) req.destroy(new Error("response too large"));
      });
      res.on("end", () => {
        resolve({
          ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
          status: res.statusCode || 0,
          buf: Buffer.concat(chunks),
          ct: String(res.headers["content-type"] || "application/octet-stream"),
        });
      });
    });
    req.setTimeout(15_000, () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
    req.end();
  });
}

function guessMime(name) {
  const ext = String(name).toLowerCase().split(".").pop() || "";
  return ({
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
    gif: "image/gif", svg: "image/svg+xml", ico: "image/x-icon",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
    css: "text/css", js: "application/javascript", json: "application/json",
    html: "text/html", txt: "text/plain",
  })[ext] || "application/octet-stream";
}

async function loadAsset(themeId, file) {
  const safeTheme = String(themeId || "").replace(/[^a-z0-9_-]/gi, "");
  const safeFile = String(file || "").replace(/[^A-Za-z0-9._-]/g, "");
  if (!safeTheme || !safeFile) return null;
  const key = `${safeTheme}/${safeFile}`;
  const cached = assetCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  // 1) Lokales FS (via Heartbeat gesynct)
  try {
    const localPath = join(themesDir, safeTheme, "assets", safeFile);
    if (existsSync(localPath)) {
      const buf = readFileSync(localPath);
      const entry = { buf, ct: guessMime(safeFile), expiresAt: Date.now() + ASSET_CACHE_TTL_MS };
      assetCache.set(key, entry);
      return entry;
    }
  } catch (_) { /* fall through */ }
  // 2) Portal-Fallback
  if (!PORTAL_FILES_BASE) return null;
  try {
    const url = new URL(`${PORTAL_FILES_BASE}/themes/${safeTheme}/assets/${safeFile}`);
    const res = await requestBuffer(url, { accept: "*/*" });
    if (!res.ok) return null;
    const entry = { buf: res.buf, ct: res.ct, expiresAt: Date.now() + ASSET_CACHE_TTL_MS };
    assetCache.set(key, entry);
    return entry;
  } catch (e) {
    console.error(`[landing-server] asset fetch failed ${key}:`, e?.message || e);
    return null;
  }
}

async function loadTheme(id) {
  const safeId = basename(String(id || "")).replace(/[^a-z0-9_-]/gi, "");
  if (!safeId) return null;
  const cached = themeCache.get(safeId);
  if (cached && Date.now() - cached.ts < THEME_CACHE_TTL_MS) return cached.theme;
  const dir = join(themesDir, safeId);
  const files = { html: "template.html", css: "style.css", js: "script.js" };
  const out = { id: safeId, html: "", css: "", js: "" };
  for (const [k, fname] of Object.entries(files)) {
    let content = "";
    try {
      if (existsSync(join(dir, fname))) {
        content = readFileSync(join(dir, fname), "utf8");
      }
    } catch (_) { content = ""; }
    // Fallback: fehlt/leer lokal → vom Portal nachladen (identische Quelle wie Heartbeat-Resync).
    if (!content && PORTAL_FILES_BASE) {
      try {
        const url = new URL(`${PORTAL_FILES_BASE}/themes/${safeId}/${fname}`);
        const res = await requestBuffer(url, { accept: "*/*" });
        if (res.ok && res.buf.length > 0) content = res.buf.toString("utf8");
      } catch (e) {
        console.warn(`[themes] portal fetch failed ${safeId}/${fname}: ${e?.message || e}`);
      }
    }
    out[k] = content;
  }
  if (!out.html) {
    themeCache.set(safeId, { ts: Date.now(), theme: null });
    return null;
  }
  themeCache.set(safeId, { ts: Date.now(), theme: out });
  return out;
}



// Fehlerzähler pro Domain (Diagnose via /_internal/stats).
const lookupErrors = new Map();
const inFlight = new Map();

function noteLookupError(key, message) {
  const prev = lookupErrors.get(key) || { count: 0, last: null, lastAt: null };
  lookupErrors.set(key, { count: prev.count + 1, last: message, lastAt: new Date().toISOString() });
}

/**
 * Fragt genau einmal die Datenbank.
 * → { ok: true, row }   Antwort erhalten (row kann null sein = Domain unbekannt)
 * → { ok: false, error } Abfrage fehlgeschlagen (Timeout / HTTP-Fehler / Netz)
 */
async function fetchLandingOnce(key) {
  const apiUrl = new URL("/rest/v1/landing_pages", SUPABASE_URL);
  apiUrl.searchParams.set("select", LANDING_SELECT);
  apiUrl.searchParams.set("domain", `eq.${key}`);
  apiUrl.searchParams.set("is_published", "eq.true");
  apiUrl.searchParams.set("limit", "1");

  try {
    const res = await requestJson(apiUrl, {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      accept: "application/json",
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${String(res.text).slice(0, 300)}` };
    let rows;
    try { rows = res.json(); } catch (e) { return { ok: false, error: `invalid JSON: ${e?.message || e}` }; }
    if (!Array.isArray(rows)) return { ok: false, error: "unexpected response shape" };
    return { ok: true, row: rows[0] || null };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Ein Retry nach kurzer Pause — deckt einzelne Timeouts/5xx ab.
async function refreshLanding(key) {
  let result = await fetchLandingOnce(key);
  if (!result.ok) {
    await new Promise((r) => setTimeout(r, 300));
    result = await fetchLandingOnce(key);
  }

  if (!result.ok) {
    noteLookupError(key, result.error);
    console.error(`[landing-server] DB-Error für ${key}: ${result.error}`);
    const prev = cache.get(key);
    if (prev && prev.row) {
      // Letzten bekannten Stand weiterverwenden, statt die Landing offline zu nehmen.
      prev.expiresAt = Date.now() + CACHE_TTL_MS;
      prev.stale = true;
      console.warn(`[landing-server] liefere zwischengespeicherten Stand für ${key} weiter (stale)`);
      return { row: prev.row, degraded: true };
    }
    // Kein bekannter Stand → Fehler NICHT als "nicht vorhanden" cachen.
    return { row: null, degraded: true };
  }

  cache.set(key, {
    row: result.row,
    stale: false,
    expiresAt: Date.now() + (result.row ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS),
  });
  return { row: result.row, degraded: false };
}

/**
 * Liefert die Landing zur Domain.
 * @returns {Promise<{row: object|null, degraded: boolean}>}
 *   degraded=true → Backend nicht erreichbar (nicht "Domain unbekannt").
 */
async function loadLandingState(domain) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    console.error("[landing-server] SUPABASE_URL und SUPABASE_PUBLISHABLE_KEY müssen gesetzt sein.");
    return { row: null, degraded: true };
  }

  const key = domain.toLowerCase().replace(/^www\./, "");
  const cached = cache.get(key);

  if (cached && cached.expiresAt > Date.now()) return { row: cached.row, degraded: false };

  // Abgelaufen, aber bekannt: sofort ausliefern und im Hintergrund erneuern.
  if (cached && cached.row) {
    cached.expiresAt = Date.now() + CACHE_TTL_MS;
    if (!inFlight.has(key)) {
      const p = refreshLanding(key).finally(() => inFlight.delete(key));
      inFlight.set(key, p);
      p.catch(() => {});
    }
    return { row: cached.row, degraded: false };
  }

  // Parallele Anfragen auf dieselbe Domain bündeln.
  let pending = inFlight.get(key);
  if (!pending) {
    pending = refreshLanding(key).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

async function loadLanding(domain) {
  const { row } = await loadLandingState(domain);
  return row;
}

function applyPlaceholders(src, branding, slots) {
  // Computed Aliase, damit Slot-Defaults wie {{address}} / {{contact_email}} / {{contact_phone}}
  // automatisch aus den Branding-Firmendaten gefüllt werden.
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
  // Slots speichern bei manchen Themes eigene Branding-Felder (logo_text, firmenname,
  // contact_*). Live muss trotzdem die zentralen Firmendaten gewinnen, sonst bleiben
  // alte Theme-Defaults wie "CLE-Beratung" trotz geänderter Einstellungen sichtbar.
  // Muster-/Demo-Werte aus Theme-Defaults nie ausspielen.
  const cleanSlots = {};
  for (const [k, v] of Object.entries(slots || {})) {
    if (k in aliases && isPlaceholderValue(v)) continue;
    cleanSlots[k] = v;
  }
  const merged = { ...cleanSlots, ...aliases, ...b };
  // 3 Passes: Slot-Defaults können selbst {{branding}}-Platzhalter enthalten.
  let out = src;
  for (let i = 0; i < 3; i++) {
    let changed = false;
    for (const [k, v] of Object.entries(merged)) {
      const token = `{{${k}}}`;
      if (out.includes(token)) { out = out.split(token).join(String(v ?? "")); changed = true; }
    }
    if (!changed) break;
  }
  return out;
}

function injectLandingConfig(html, row) {
  const esc = (s) => String(s || "").replace(/[<>"']/g, (c) => ({ "<": "\\u003c", ">": "\\u003e", '"': '\\"', "'": "\\'" }[c]));
  const rawApi = row.branding?.api_endpoint || PORTAL_API_ENDPOINT;
  const apiEndpoint = String(rawApi || "").trim().replace(/[.,;\s]+$/g, "");
  const portalUrl = row.branding?.portal_url || "";
  const wa = row.branding?.whatsapp_enabled ? String(row.branding?.whatsapp_number || "").replace(/[^0-9]/g, "") : "";
  const cleanHtml = html.replace(/<script>\s*window\.PORTAL_API\s*=\s*[\s\S]*?<\/script>\s*/gi, "");
  const block = `<script>
window.PORTAL_API = "${esc(apiEndpoint)}";
window.PORTAL_URL = "${esc(portalUrl)}";
window.TENANT_ID = "${esc(row.tenant_id || "")}";
window.FLOW_TYPE = "${esc(row.flow_type)}";
window.SOURCE_SLUG = "${esc(row.source_slug || row.slug)}";
window.LANDING_ID = "${esc(row.id || "")}";
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

function cleanEmptyMeta(html, branding, domain) {
  let out = html;
  if (!branding?.seo_image) {
    out = out.replace(/\s*<meta[^>]*property=["']og:image["'][^>]*content=["']["'][^>]*>\s*/gi, "\n");
    out = out.replace(/\s*<meta[^>]*name=["']twitter:image["'][^>]*content=["']["'][^>]*>\s*/gi, "\n");
  }
  // Footer-Blöcke: {{contact_block}} und {{legal_block}} sicherstellen
  const b = branding || {};
  const contactLines = [
    b.firmenname,
    b.strasse,
    [b.plz, b.stadt].filter(Boolean).join(" "),
    b.email ? `E-Mail: ${b.email}` : "",
    b.telefon ? `Tel: ${b.telefon}` : ""
  ].filter(Boolean);
  const contactBlock = contactLines.join("<br/>");
  const legalBlock = `<a href="/impressum.html">Impressum</a><br/><a href="/datenschutz.html">Datenschutz</a>`;
  
  out = out.replace(/\{\{contact_block\}\}/g, contactBlock);
  out = out.replace(/\{\{legal_block\}\}/g, legalBlock);
  
  out = out.replace(/\{\{contact_address\}\}/g, [b.firmenname, b.strasse, [b.plz, b.stadt].filter(Boolean).join(" ")].filter(Boolean).join("<br/>"));
  out = out.replace(/\{\{contact_phone\}\}/g, b.telefon || "");
  out = out.replace(/\{\{contact_email\}\}/g, b.email || "");
  out = out.replace(/\{\{impressum_url\}\}/g, "/impressum.html");
  out = out.replace(/\{\{datenschutz_url\}\}/g, "/datenschutz.html");

  return out.replace(/\{\{landing_domain\}\}/g, domain);
}

// Rechtstexte zentral aus ./legal-content.js (Mirror von src/lib/legal-content.ts).
// Neu erzeugen mit: bun scripts/build-legal-content-js.mjs

async function renderHtml(row, host) {
  const theme = await loadTheme(row.theme_id);
  if (!theme) return { body: `Theme nicht gefunden: ${row.theme_id}`, status: 500 };
  // Branding-Logo automatisch in {{logo_image}}/{{favicon_image}}-Slots spiegeln,
  // damit Themes wie Eilers/TTS/AZB den hochgeladenen Logo nutzen.
  const slots = { ...(row.slots || {}) };
  // Rechtliches sind auf dem Live-Renderer echte Unterseiten. Alte gespeicherte
  // Slot-Werte (#impressum/#datenschutz) werden bewusst überschrieben, damit
  // die Startseite nicht mehr bis zu den Rechtstexten durchscrollt.
  slots.impressum_url = "impressum.html";
  slots.datenschutz_url = "datenschutz.html";
  // Cache-Buster aus updated_at, damit Browser/Cloudflare beim Logo-Wechsel neu laden.
  const ver = row.updated_at ? `?v=${Date.parse(row.updated_at) || ""}` : "";
  if (row.logo_url && !slots.logo_image) slots.logo_image = `/assets/logo${ver}`;
  if (row.favicon_url && !slots.favicon_image) slots.favicon_image = `/assets/favicon${ver}`;
  let html = applyPlaceholders(theme.html, row.branding, slots);
  html = html.replace(/<section[^>]*id=["'](?:impressum|datenschutz)["'][\s\S]*?<\/section>\s*/gi, "");
  html = cleanEmptyMeta(html, row.branding, host);
  html = injectLandingConfig(html, row);
  // Alte gespeicherte Bildpfade aus der Entwicklungsumgebung auf die
  // Theme-Assets umbiegen (sonst 404 nach einem Theme-Wechsel).
  html = html.replace(/["'](?:\.)?\/?src\/assets\/landing-themes\/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp)["']/gi, '"/assets/hero.$1"');
  html = await injectClientLogos(html, row);
  if (row.logo_url) html = html.replace(/assets\/logo\.[a-z]+/gi, `/assets/logo${ver}`);
  if (row.favicon_url) html = html.replace(/assets\/favicon\.[a-z]+/gi, `/assets/favicon${ver}`);
  return { body: html, status: 200 };
}

// ── Auftraggeber-Logoleiste (Standard auf allen Fast-Track-Landings) ──
let clientLogosCache = { html: "", expiresAt: 0 };

async function loadClientLogosBlock() {
  if (clientLogosCache.html && clientLogosCache.expiresAt > Date.now()) return clientLogosCache.html;
  if (!PORTAL_FILES_BASE) return "";
  try {
    const res = await requestBuffer(new URL(`${PORTAL_FILES_BASE}/client-logos.html`), { accept: "text/html" });
    if (!res.ok || !res.buf.length) return clientLogosCache.html || "";
    const html = res.buf.toString("utf8");
    clientLogosCache = { html, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
    return html;
  } catch (e) {
    console.warn(`[landing-server] client-logos fetch failed: ${e?.message || e}`);
    return clientLogosCache.html || "";
  }
}

async function injectClientLogos(html, row) {
  if (String(row.flow_type || "") !== "fast") return html;
  if (/lv-client-logos/.test(html)) return html;
  const block = await loadClientLogosBlock();
  if (!block) return html;
  const anchor = /<section[^>]*id=["']bewerbung["']/i.exec(html) || /<footer[\s>]/i.exec(html);
  if (anchor) return html.slice(0, anchor.index) + block + "\n" + html.slice(anchor.index);
  return html.replace(/<\/body>/i, `${block}\n</body>`);
}


function renderLegal(row, type) {
  const branding = row.branding || {};
  const body = type === "datenschutz" ? renderDatenschutz(branding) : renderImpressum(branding);
  return buildLegalPage(type === "datenschutz" ? "Datenschutz" : "Impressum", body, branding, {
    homeHref: "/",
    impressumHref: "/impressum.html",
    datenschutzHref: "/datenschutz.html",
    logoUrl: row.logo_url ? "/assets/logo" : undefined,
  });
}

function renderCss(row) {
  return loadTheme(row.theme_id).then((theme) => theme ? applyPlaceholders(theme.css, row.branding, row.slots) : "/* theme missing */");
}

function renderJs(row) {
  return loadTheme(row.theme_id).then((theme) => theme ? applyPlaceholders(theme.js, row.branding, row.slots) : "// theme missing");
}


function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function statusPage(title, text) {
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

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };

function sendUnavailable(res, degraded) {
  if (degraded) {
    // Backend-Störung: 503 statt 404, damit Suchmaschinen die Seite nicht
    // als dauerhaft entfernt werten.
    return send(res, 503, statusPage(
      "Die Seite ist gerade nicht erreichbar",
      "Wir haben ein kurzes technisches Problem. Bitte lade die Seite in einem Moment neu.",
    ), { ...HTML_HEADERS, "retry-after": "30" });
  }
  return send(res, 404, statusPage(
    "Diese Seite ist nicht verfügbar",
    "Unter dieser Adresse ist derzeit keine Seite hinterlegt.",
  ), HTML_HEADERS);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const path = url.pathname;

    if (path === "/_health") return send(res, 200, "ok");

    // Cache-Flush (nur lokal erreichbar, Caddy proxied /_internal/* nicht nach außen):
    // Themes/Assets/Landings werden live vom Portal geholt — ein Flush reicht als "Resync".
    if (path === "/_internal/flush") {
      const n = cache.size + themeCache.size + assetCache.size;
      cache.clear();
      themeCache.clear();
      assetCache.clear();
      console.log(`[cache] flushed ${n} Einträge`);
      return send(res, 200, JSON.stringify({ ok: true, flushed: n }), { "content-type": "application/json" });
    }

    // Diagnose: wie oft schlug die Domain-Abfrage fehl, und was liegt im Cache?
    if (path === "/_internal/stats") {
      const payload = {
        ok: true,
        cached: Array.from(cache.entries()).map(([domain, v]) => ({
          domain,
          found: Boolean(v.row),
          stale: Boolean(v.stale),
          expires_in_ms: Math.max(0, v.expiresAt - Date.now()),
        })),
        lookup_errors: Array.from(lookupErrors.entries()).map(([domain, v]) => ({ domain, ...v })),
      };
      return send(res, 200, JSON.stringify(payload, null, 2), { "content-type": "application/json" });
    }

    if (path === "/_internal/ask") {
      const domain = (url.searchParams.get("domain") || "").toLowerCase();
      if (!domain) return send(res, 400, "missing domain");
      const { row } = await loadLandingState(domain);
      return row ? send(res, 200, "ok") : send(res, 404, "not found");
    }

    const host = String(req.headers.host || "").toLowerCase().split(":")[0];
    if (!host) return send(res, 400, "no host");
    const { row, degraded } = await loadLandingState(host);
    if (!row) {
      console.warn(`[landing-server] keine Landing für ${host} (${degraded ? "Backend-Störung" : "kein Datensatz"})`);
      return sendUnavailable(res, degraded);
    }

    if (path === "/style.css") {
      return send(res, 200, await renderCss(row), { "content-type": "text/css; charset=utf-8", "cache-control": "public,max-age=300" });
    }
    if (path === "/script.js") {
      return send(res, 200, await renderJs(row), { "content-type": "application/javascript; charset=utf-8", "cache-control": "public,max-age=300" });
    }
    if (path.startsWith("/assets/logo")) {
      return row.logo_url
        ? send(res, 302, "", { location: row.logo_url, "cache-control": "no-cache, no-store, must-revalidate" })
        : send(res, 404, "no logo");
    }
    if (path.startsWith("/assets/favicon")) {
      return row.favicon_url
        ? send(res, 302, "", { location: row.favicon_url, "cache-control": "no-cache, no-store, must-revalidate" })
        : send(res, 404, "no favicon");
    }
    if (path.startsWith("/assets/")) {
      const rel = path.slice("/assets/".length);
      if (!rel || rel.includes("..") || rel.includes("/")) return send(res, 404, "not found");
      const asset = await loadAsset(row.theme_id, rel);
      if (!asset) return send(res, 404, "asset not found");
      return send(res, 200, asset.buf, { "content-type": asset.ct, "cache-control": "public,max-age=86400,immutable" });
    }
    if (path === "/" || path === "/index.html") {
      const { body, status } = await renderHtml(row, host);
      return send(res, status, body, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    }

    if (path === "/impressum" || path === "/impressum.html") {
      return send(res, 200, renderLegal(row, "impressum"), { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    }
    if (path === "/datenschutz" || path === "/datenschutz.html") {
      return send(res, 200, renderLegal(row, "datenschutz"), { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    }
    return send(res, 404, "not found");
  } catch (e) {
    console.error("[landing-server] request error:", e?.message || e);
    return send(res, 500, "internal error");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[landing-server] listening on http://127.0.0.1:${PORT}`);
});