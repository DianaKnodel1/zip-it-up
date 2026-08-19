/**
 * WebID-Simulations-Proxy
 * -------------------------------------------------------------------------
 * - Hört auf 127.0.0.1:PORT (default 3002), Caddy macht TLS + Reverse-Proxy.
 * - Liest registrierte Simulationsdomains aus `public.webid_sim_domains`
 *   (anon key + RLS).
 * - Für jeden Request holt der Proxy die entsprechende Ressource vom
 *   `target_origin` der Domain (default: https://webid-gateway.de) und
 *   liefert sie mit injiziertem Simulations-Overlay zurück.
 * - POST/PUT/PATCH/DELETE werden per Default blockiert; keine echten Submits
 *   an WebID.
 *
 * Wichtige Endpunkte:
 *   GET /_health                → "ok"
 *   GET /_internal/ask?domain=  → 200 wenn Domain aktiv, sonst 404
 *   GET /robots.txt             → Disallow: /
 *   *   /*                       → Proxy
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const PORT = Number(process.env.PORT ?? 3002);
const DEFAULT_TARGET_ORIGIN = process.env.DEFAULT_TARGET_ORIGIN ?? "https://webid-gateway.de";
const CACHE_TTL_MS = 60_000;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  console.error("[webid-sim] SUPABASE_URL und SUPABASE_PUBLISHABLE_KEY müssen gesetzt sein.");
  process.exit(1);
}

type DomainRow = {
  id: string;
  domain: string;
  display_name: string;
  target_origin: string;
  logo_url: string | null;
  topbar_text: string;
  is_active: boolean;
  allow_submit: boolean;
};

const domainCache = new Map<string, { row: DomainRow | null; expiresAt: number }>();

async function fetchDomain(host: string): Promise<DomainRow | null> {
  const key = host.toLowerCase();
  const cached = domainCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.row;

  const url = new URL("/rest/v1/webid_sim_domains", SUPABASE_URL);
  url.searchParams.set("select", "id,domain,display_name,target_origin,logo_url,topbar_text,is_active,allow_submit");
  url.searchParams.set("domain", `eq.${key}`);
  url.searchParams.set("is_active", "eq.true");
  url.searchParams.set("limit", "1");

  let row: DomainRow | null = null;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY!,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY!}`,
        Accept: "application/json",
      },
    });
    if (res.ok) {
      const rows = (await res.json()) as DomainRow[];
      row = rows[0] ?? null;
    }
  } catch (err) {
    console.warn(`[webid-sim] domain lookup failed for ${key}: ${(err as Error).message}`);
  }
  domainCache.set(key, { row, expiresAt: Date.now() + CACHE_TTL_MS });
  return row;
}

// ── Rate-Limit (per IP) ───────────────────────────────────────────────────
const RATE_LIMIT_MAX = 120; // Requests
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function checkRate(ip: string): boolean {
  const now = Date.now();
  const b = rateBuckets.get(ip);
  if (!b || b.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  b.count++;
  return b.count <= RATE_LIMIT_MAX;
}

// ── Pfad-Whitelist ────────────────────────────────────────────────────────
// Wir blockieren nichts stumpf am Pfad — WebID lädt Assets aus vielen
// Unterordnern. Stattdessen wird via Host-Header / Origin sichergestellt,
// dass wir nur an die konfigurierte Ziel-Origin proxien.

function isHtmlResponse(res: Response): boolean {
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("text/html");
}

function isCssResponse(res: Response): boolean {
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("text/css");
}

// ── Overlay-Assets ────────────────────────────────────────────────────────
const OVERLAY_CSS = `
#__webid_sim_topbar{position:fixed !important;top:0 !important;left:0 !important;right:0 !important;
  z-index:2147483647 !important;background:repeating-linear-gradient(45deg,#111,#111 12px,#f5c400 12px,#f5c400 24px);
  color:#fff !important;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif !important;
  padding:8px 14px !important;text-align:center !important;letter-spacing:.02em !important;
  box-shadow:0 2px 8px rgba(0,0,0,.25) !important;pointer-events:auto !important;}
#__webid_sim_topbar span{background:rgba(0,0,0,.6);padding:4px 10px;border-radius:4px;display:inline-block;}
body.__webid_sim_shifted{padding-top:44px !important;}
#__webid_sim_badge{position:fixed !important;right:14px !important;bottom:14px !important;z-index:2147483646 !important;
  background:#fff !important;border:1px solid rgba(0,0,0,.1) !important;border-radius:10px !important;
  padding:8px 12px !important;box-shadow:0 6px 24px rgba(0,0,0,.15) !important;
  font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif !important;color:#111 !important;
  display:flex !important;align-items:center !important;gap:8px !important;}
#__webid_sim_badge img{height:24px !important;width:auto !important;display:block !important;}
#__webid_sim_backdrop{position:fixed !important;inset:0 !important;z-index:2147483645 !important;
  background:rgba(10,15,25,.72) !important;display:flex !important;align-items:center !important;
  justify-content:center !important;padding:20px !important;
  font:400 14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif !important;}
#__webid_sim_modal{background:#fff !important;color:#111 !important;max-width:480px !important;width:100% !important;
  border-radius:14px !important;padding:28px !important;box-shadow:0 20px 60px rgba(0,0,0,.4) !important;}
#__webid_sim_modal h2{margin:0 0 10px !important;font-size:20px !important;font-weight:700 !important;color:#111 !important;}
#__webid_sim_modal p{margin:0 0 12px !important;color:#333 !important;}
#__webid_sim_modal button{margin-top:8px !important;background:#111 !important;color:#fff !important;border:0 !important;
  border-radius:8px !important;padding:10px 18px !important;font-weight:600 !important;cursor:pointer !important;}
`;

function buildOverlay(row: DomainRow): string {
  const topbar = escapeHtml(row.topbar_text || "SIMULATIONSUMGEBUNG – Keine echte Identifikation. Zu Schulungszwecken.");
  const badgeName = escapeHtml(row.display_name || row.domain);
  const logoImg = row.logo_url ? `<img src="${escapeAttr(row.logo_url)}" alt=""/>` : "";
  const style = `<style id="__webid_sim_style">${OVERLAY_CSS}</style>`;
  const topbarEl = `<div id="__webid_sim_topbar" role="alert"><span>⚠ ${topbar}</span></div>`;
  const badgeEl = `<div id="__webid_sim_badge">${logoImg}<span>${badgeName} · Simulation</span></div>`;
  const modalEl = `<div id="__webid_sim_backdrop" role="dialog" aria-modal="true" aria-labelledby="__webid_sim_title">
    <div id="__webid_sim_modal">
      <h2 id="__webid_sim_title">Hinweis: Simulationsumgebung</h2>
      <p>Dies ist eine <strong>Simulation</strong> zu Awareness- und Schulungszwecken.
      Es findet <strong>keine echte Identifikation</strong> statt und es werden keine Identifikationsdaten verarbeitet.</p>
      <p>Mit dem Fortfahren bestätigst du, dass du diesen Hinweis gelesen hast.</p>
      <button type="button" onclick="var b=document.getElementById('__webid_sim_backdrop');if(b)b.remove();try{sessionStorage.setItem('__webid_sim_ack','1')}catch(e){}">Verstanden – fortfahren</button>
    </div>
  </div>`;
  const script = `<script>(function(){
    try{document.title='[SIMULATION] '+document.title;}catch(e){}
    function boot(){
      try{document.body.classList.add('__webid_sim_shifted');}catch(e){}
      var ack=false;try{ack=sessionStorage.getItem('__webid_sim_ack')==='1'}catch(e){}
      if(ack){var b=document.getElementById('__webid_sim_backdrop');if(b)b.remove();}
      // Watchdog: falls die Seite unsere Elemente entfernt, wieder einsetzen.
      var mo=new MutationObserver(function(){
        ['__webid_sim_topbar','__webid_sim_badge','__webid_sim_style'].forEach(function(id){
          if(!document.getElementById(id)){location.reload();}
        });
      });
      mo.observe(document.documentElement,{childList:true,subtree:true});
    }
    if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',boot);}else{boot();}
  })();</script>`;
  return `${style}${topbarEl}${badgeEl}${modalEl}${script}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
function escapeAttr(s: string): string { return escapeHtml(s); }

// ── HTML-Rewrite ──────────────────────────────────────────────────────────
function rewriteHtml(html: string, row: DomainRow, targetHost: string): string {
  const simHost = row.domain;
  // Absolute Links auf target host → sim host
  const re = new RegExp(`https?://${escapeReg(targetHost)}`, "gi");
  let out = html.replace(re, `https://${simHost}`);
  // Favicon-Links entfernen (wir setzen unser eigenes)
  out = out.replace(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/gi, "");
  const favicon = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="%23f5c400"/><text x="16" y="22" font-family="Arial" font-weight="700" font-size="18" text-anchor="middle" fill="%23111">S</text></svg>'.replace(/%23/g, "#")
  )}">`;
  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${favicon}</head>`);
  }
  const overlay = buildOverlay(row);
  if (/<\/body>/i.test(out)) {
    out = out.replace(/<\/body>/i, `${overlay}</body>`);
  } else {
    out += overlay;
  }
  return out;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteCss(css: string, targetHost: string, simHost: string): string {
  const re = new RegExp(`https?://${escapeReg(targetHost)}`, "gi");
  return css.replace(re, `https://${simHost}`);
}

// ── Handler ───────────────────────────────────────────────────────────────
async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const hostHeader = (req.headers.get("host") || "").split(":")[0].toLowerCase();
  const clientIp = req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "unknown";

  // Interne Endpunkte
  if (url.pathname === "/_health") return new Response("ok", { headers: { "content-type": "text/plain" } });
  if (url.pathname === "/_internal/ask") {
    const askedDomain = (url.searchParams.get("domain") || "").toLowerCase();
    const row = askedDomain ? await fetchDomain(askedDomain) : null;
    return new Response(row?.is_active ? "ok" : "unknown", { status: row?.is_active ? 200 : 404 });
  }
  if (url.pathname === "/robots.txt") {
    return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain", "x-robots-tag": "noindex, nofollow" } });
  }

  // Rate-Limit
  if (!checkRate(clientIp)) return new Response("Too Many Requests", { status: 429 });

  // Domain nachschlagen
  const row = await fetchDomain(hostHeader);
  if (!row) return new Response("Simulation domain not registered.", { status: 404, headers: { "content-type": "text/plain" } });

  // Method-Guard
  const method = req.method.toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*" } });
  }
  if (method !== "GET" && method !== "HEAD" && !(row.allow_submit && method === "POST")) {
    return simulationBlockedResponse(row);
  }

  // Target-URL bauen
  const targetOrigin = row.target_origin || DEFAULT_TARGET_ORIGIN;
  const targetUrl = new URL(url.pathname + url.search, targetOrigin);
  const targetHost = new URL(targetOrigin).host;

  // Header vorbereiten
  const outHeaders = new Headers();
  outHeaders.set("host", targetHost);
  outHeaders.set("user-agent", req.headers.get("user-agent") || "Mozilla/5.0");
  const forward = ["accept", "accept-language", "accept-encoding", "cookie", "referer", "content-type"];
  for (const h of forward) {
    const v = req.headers.get(h);
    if (v) outHeaders.set(h, h === "referer" ? v.replace(hostHeader, targetHost) : v);
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method,
      headers: outHeaders,
      body: method === "GET" || method === "HEAD" ? undefined : req.body,
      redirect: "manual",
    });
  } catch (err) {
    console.warn(`[webid-sim] upstream fail ${targetUrl}: ${(err as Error).message}`);
    return new Response("Upstream unavailable.", { status: 502 });
  }

  // Redirects umschreiben
  if (upstream.status >= 300 && upstream.status < 400) {
    const loc = upstream.headers.get("location");
    if (loc) {
      const rewritten = loc.replace(new RegExp(`https?://${escapeReg(targetHost)}`, "gi"), `https://${row.domain}`);
      const h = new Headers();
      h.set("location", rewritten);
      h.set("x-robots-tag", "noindex, nofollow");
      copySetCookie(upstream, h, targetHost, row.domain);
      return new Response(null, { status: upstream.status, headers: h });
    }
  }

  const resHeaders = new Headers();
  // CSP entfernen (wir setzen eigene), sicherheitsrelevante Header aufräumen
  const stripped = new Set(["content-security-policy", "content-security-policy-report-only", "strict-transport-security", "x-frame-options", "content-length", "content-encoding", "transfer-encoding"]);
  upstream.headers.forEach((v, k) => { if (!stripped.has(k.toLowerCase())) resHeaders.set(k, v); });
  resHeaders.set("content-security-policy", "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; img-src * data: blob:; style-src * 'unsafe-inline'; script-src * 'unsafe-inline' 'unsafe-eval';");
  resHeaders.set("x-robots-tag", "noindex, nofollow");
  copySetCookie(upstream, resHeaders, targetHost, row.domain);

  if (isHtmlResponse(upstream)) {
    const html = await upstream.text();
    const out = rewriteHtml(html, row, targetHost);
    resHeaders.set("content-type", upstream.headers.get("content-type") || "text/html; charset=utf-8");
    return new Response(out, { status: upstream.status, headers: resHeaders });
  }
  if (isCssResponse(upstream)) {
    const css = await upstream.text();
    const out = rewriteCss(css, targetHost, row.domain);
    resHeaders.set("content-type", upstream.headers.get("content-type") || "text/css; charset=utf-8");
    return new Response(out, { status: upstream.status, headers: resHeaders });
  }
  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
}

function copySetCookie(upstream: Response, target: Headers, targetHost: string, simHost: string): void {
  // Bun/undici: getSetCookie() gibt Array zurück
  const anyH = upstream.headers as unknown as { getSetCookie?: () => string[] };
  const cookies = typeof anyH.getSetCookie === "function" ? anyH.getSetCookie!() : [];
  for (const c of cookies) {
    const rewritten = c.replace(new RegExp(`Domain=\\.?${escapeReg(targetHost)}`, "gi"), `Domain=${simHost}`);
    target.append("set-cookie", rewritten);
  }
}

function simulationBlockedResponse(row: DomainRow): Response {
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
    <title>[SIMULATION] Aktion blockiert</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0b1220;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
    .card{max-width:520px;background:#fff;color:#111;border-radius:14px;padding:32px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
    h1{margin:0 0 10px;font-size:22px}p{margin:0 0 12px;color:#333}</style></head>
    <body><div class="card"><h1>Simulation beendet</h1>
    <p>An dieser Stelle würde in der echten WebID-Umgebung eine verbindliche
    Aktion ausgelöst. In der Simulation wird das <strong>bewusst blockiert</strong>,
    damit keine echte Identifikation ausgelöst wird.</p>
    <p>Wenn du den Ablauf ab hier weitertesten möchtest, sprich mit dem
    Simulations-Betreuer (${escapeHtml(row.display_name || row.domain)}).</p>
    </div></body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow" } });
}

// ── Server starten ────────────────────────────────────────────────────────
// @ts-expect-error Bun global
const bunServe = (globalThis as any).Bun?.serve;
if (!bunServe) {
  console.error("[webid-sim] Bun runtime nicht erkannt — bitte mit `bun server.ts` starten.");
  process.exit(1);
}
bunServe({
  port: PORT,
  hostname: "127.0.0.1",
  fetch: (req: Request) => handle(req).catch((err) => {
    console.error("[webid-sim] handler error", err);
    return new Response("Internal error", { status: 500 });
  }),
});
console.log(`[webid-sim] listening on 127.0.0.1:${PORT}, default target: ${DEFAULT_TARGET_ORIGIN}`);