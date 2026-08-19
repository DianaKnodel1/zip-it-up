export type LogoCandidate = {
  source: string;
  url: unknown;
  domain?: unknown;
};

export type LogoResolution = {
  url: string | null;
  source: string | null;
  reason: string;
  candidates: Array<{
    source: string;
    raw: string;
    domain: string;
    resolved: string | null;
    reason: string;
  }>;
};

export function cleanEmailLogoHost(domain: unknown): string {
  return String(domain ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\/+$/, "");
}

export function pickLandingLogo(landing: any): string | null {
  return landing?.logo_url
    || landing?.branding?.logo_url
    || landing?.branding?.logo_image
    || landing?.slots?.logo_url
    || landing?.slots?.logo_image
    || landing?.intermediate_logo_url
    || null;
}

export function resolveEmailLogoUrl(raw: unknown, domain?: unknown): { url: string | null; reason: string } {
  const value = String(raw ?? "").trim();
  if (!value) return { url: null, reason: "empty" };
  if (value.startsWith("data:")) return { url: null, reason: "data_url_not_allowed" };
  if (/^https:\/\//i.test(value)) return { url: value, reason: "absolute_https" };
  if (/^http:\/\//i.test(value)) return { url: value.replace(/^http:\/\//i, "https://"), reason: "upgraded_http" };
  if (/^\/\//.test(value)) return { url: `https:${value}`, reason: "protocol_relative" };
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(value)) return { url: `https://${value.replace(/^\/+/g, "")}`, reason: "host_path" };

  const normalizedPath = value.replace(/^\.\//, "").replace(/^\/+/g, "");
  if (/^(storage\/v1\/object\/public|object\/public)\//i.test(normalizedPath)) {
    const storageBase = String(Deno.env.get("API_EXTERNAL_URL") || Deno.env.get("SUPABASE_URL") || "").trim().replace(/\/+$/, "");
    if (storageBase) {
      const path = normalizedPath.replace(/^object\/public\//i, "storage/v1/object/public/");
      return { url: `${storageBase}/${path}`.replace(/^http:\/\//i, "https://"), reason: "storage_public_path" };
    }
  }

  const host = cleanEmailLogoHost(domain);
  if (!host) return { url: null, reason: "relative_without_domain" };

  const path = normalizedPath;
  if (!path) return { url: null, reason: "empty_path" };
  return { url: `https://${host}/${path}`, reason: "relative_with_domain" };
}

export function resolveEmailLogo(candidates: LogoCandidate[]): LogoResolution {
  const inspected: LogoResolution["candidates"] = [];

  for (const candidate of candidates) {
    const raw = String(candidate.url ?? "").trim();
    const domain = cleanEmailLogoHost(candidate.domain);
    const resolved = resolveEmailLogoUrl(candidate.url, candidate.domain);
    inspected.push({
      source: candidate.source,
      raw,
      domain,
      resolved: resolved.url,
      reason: resolved.reason,
    });
    if (resolved.url) {
      return {
        url: resolved.url,
        source: candidate.source,
        reason: resolved.reason,
        candidates: inspected,
      };
    }
  }

  return { url: null, source: null, reason: "no_usable_logo", candidates: inspected };
}