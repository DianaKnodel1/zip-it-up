// Bot-/Scraper-Schutz für das Portal.
//
// Ziel: KI-Crawler und Klon-/Scraping-Dienste sollen die Oberfläche nicht
// abziehen können. Reguläre Suchmaschinen (Google, Bing) bleiben erlaubt,
// damit öffentliche Bewerbungsseiten weiterhin gefunden werden.

/** Bekannte KI-/Trainings-/Scraping-Crawler (Kleinbuchstaben-Match im User-Agent). */
const BLOCKED_AGENTS = [
  "gptbot", "oai-searchbot", "chatgpt-user", "claudebot", "claude-web",
  "anthropic-ai", "perplexitybot", "perplexity-user", "google-extended",
  "applebot-extended", "bytespider", "ccbot", "diffbot", "facebookbot",
  "meta-externalagent", "amazonbot", "cohere-ai", "timpibot", "omgilibot",
  "imagesiftbot", "youbot", "ai2bot", "firecrawl", "scrapy", "httrack",
  "libwww-perl", "phantomjs", "webcopier", "webzip", "teleport", "sitesucker",
  "heritrix", "nutch", "zgrab", "masscan",
];

/** Generische HTTP-Clients / Kommandozeilen-Tools, mit denen Seiten abgezogen werden. */
const GENERIC_CLIENTS = [
  "curl/", "wget", "python-requests", "python-urllib", "aiohttp", "httpx",
  "go-http-client", "java/", "okhttp", "node-fetch", "undici", "axios",
  "got (", "guzzle", "restsharp", "postmanruntime", "insomnia", "apache-httpclient",
  "headlesschrome", "puppeteer", "playwright", "selenium", "chrome-lighthouse",
];

/** Bekannte Crawler/KI-Bots. */
export function isBlockedAgent(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").toLowerCase().trim();
  if (!ua) return false;
  return BLOCKED_AGENTS.some((needle) => ua.includes(needle));
}

/**
 * Sieht der Request aus wie ein echter Browser?
 *
 * Echte Browser senden immer `Accept: text/html…`, eine `Accept-Language`
 * und (seit Jahren) die `Sec-Fetch-*`-Header. Server-seitige Abrufer —
 * also genau das, was passiert, wenn jemand den Link in eine KI kippt und
 * „bau mir das nach" sagt — senden diese Kombination nicht.
 */
function looksLikeRealBrowser(request: Request): boolean {
  const h = request.headers;
  const ua = (h.get("user-agent") ?? "").toLowerCase();
  if (!ua) return false;
  if (GENERIC_CLIENTS.some((needle) => ua.includes(needle))) return false;
  if (!/mozilla\/|applewebkit|gecko|safari|chrome|firefox|edg\//.test(ua)) return false;

  const accept = h.get("accept") ?? "";
  if (!accept.includes("text/html") && !accept.includes("*/*")) return false;

  const hasSecFetch = !!h.get("sec-fetch-mode") || !!h.get("sec-fetch-dest");
  const hasLanguage = !!h.get("accept-language");
  return hasSecFetch || hasLanguage;
}

/** Interne Health-Checks (Deploy-Skript, Reverse-Proxy auf demselben Host). */
function isInternalRequest(request: Request): boolean {
  const host = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  const bypass = process.env.BOT_SHIELD_BYPASS;
  return !!bypass && request.headers.get("x-portal-check") === bypass;
}

/** Nur HTML-Seitenaufrufe werden streng geprüft — Assets bleiben frei. */
function isDocumentRequest(request: Request, pathname: string): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (/\.[a-z0-9]{2,5}$/i.test(pathname)) return false; // .js, .css, .png, …
  if (pathname.startsWith("/_serverFn") || pathname.startsWith("/@")) return false;
  return true;
}

/** Öffentliche Endpunkte, die Maschinen erreichen dürfen (Webhooks, Cron, Health). */
function isMachineAllowedPath(pathname: string): boolean {
  return pathname.startsWith("/api/public/") || pathname === "/robots.txt";
}

/**
 * Liefert eine 403-Antwort, wenn der Request von einem bekannten
 * Scraper/KI-Crawler kommt — sonst `null`.
 */
export function botShieldResponse(request: Request): Response | null {
  let pathname = "/";
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    /* ignore */
  }
  if (isMachineAllowedPath(pathname)) return null;
  if (isInternalRequest(request)) return null;

  const blocked =
    isBlockedAgent(request.headers.get("user-agent")) ||
    (isDocumentRequest(request, pathname) && !looksLikeRealBrowser(request));
  if (!blocked) return null;

  return new Response(
    "403 – Automatisierter Zugriff auf diese Anwendung ist nicht gestattet.",
    {
      status: 403,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noai, noimageai",
        "cache-control": "no-store",
      },
    },
  );
}

/** Schutz-Header für jede ausgelieferte Seite. */
export function applyAntiScrapeHeaders(response: Response, request: Request): Response {
  let pathname = "/";
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    /* ignore */
  }
  const headers = new Headers(response.headers);
  headers.set("x-robots-tag", "noai, noimageai");
  // Interner Bereich zusätzlich komplett aus dem Index halten.
  if (pathname.startsWith("/admin") || pathname.startsWith("/dashboard")) {
    headers.set("x-robots-tag", "noindex, nofollow, noarchive, nosnippet, noai, noimageai");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
