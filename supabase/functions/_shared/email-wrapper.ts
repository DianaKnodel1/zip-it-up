// Shared email wrapper — Corporate Minimalist Design
//
// Einheitliches, professionelles Layout für ALLE Tenant-Mails:
//  - 6px Brand-Farb-Akzent oben
//  - Zentriertes Tenant-Logo (Fallback: Wortmarke)
//  - Klare Typo (Slate-Grau + Brand-Farbe für CTAs/Links)
//  - Optionale Recruiter-Karte (Avatar + Name + Rolle)
//  - Footer mit Firmenname + Copyright
//  - Optionaler Spam-Hinweis
//  - Automatisch generierte Plain-Text-Version
//
// Benutzung:
//   import { renderEmail, htmlToText } from "../_shared/email-wrapper.ts";
//   const { html, text, subject } = renderEmail({ subject, body, tenant, recruiter, vars });

import { resolveEmailLogoUrl } from "./email-logo.ts";

export type TenantBrand = {
  name: string;
  logo_url?: string | null;
  domain?: string | null;
  primary_domain?: string | null;
  primary_color?: string | null;
  email_signature?: string | null;
  reply_to_email?: string | null;
  sender_email?: string | null;
};

export type RecruiterBrand = {
  name?: string | null;
  avatar_url?: string | null;
  role_label?: string | null;
};

export type RenderOptions = {
  subject: string;
  body: string;
  preheader?: string;
  spamHint?: boolean;
  tenant: TenantBrand;
  recruiter?: RecruiterBrand | null;
  vars?: Record<string, string>;
  /** Optionaler Recipient (für Footer-Hinweis "Diese E-Mail wurde an X gesendet"). */
  recipient?: string;
};

const DEFAULT_COLOR = "#2563eb"; // schöneres Default-Blau statt Slate-900

export function renderTemplate(text: string, vars: Record<string, string> = {}): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v ?? "");
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>(\s*)/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "  • ")
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ( $1 )")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderBodyWithCta(body: string, color: string): string {
  return body.replace(/\{\{cta:([^|}]+)\|([^}]+)\}\}/g, (_m, label, href) => {
    const safeLabel = String(label).trim();
    const safeHref = String(href).trim();
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:${color};border-radius:6px;">
<a href="${safeHref}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">${escapeHtml(safeLabel)}</a>
</td></tr></table>`;
  });
}

export function renderEmail(opts: RenderOptions): { html: string; text: string; subject: string } {
  const { tenant, recruiter, vars = {}, spamHint = false, recipient } = opts;
  const color = tenant.primary_color || DEFAULT_COLOR;
  const year = new Date().getFullYear();
  const subject = renderTemplate(opts.subject, vars);
  const preheaderText = opts.preheader ? renderTemplate(opts.preheader, vars) : "";

  const resolvedBody = renderBodyWithCta(renderTemplate(opts.body, vars), color).replace(/\n/g, "<br>");

  // Nur absolute https-URLs als Logo einbetten — relative Pfade oder Storage-URLs
  // ohne öffentliche Erreichbarkeit erzeugen im Mail-Client ein defektes Bild-Icon.
  const logoUrl = resolveEmailLogoUrl(tenant.logo_url, tenant.primary_domain || tenant.domain).url;
  const logoBlock = logoUrl
    ? `<img src="${logoUrl}" alt="${escapeHtml(tenant.name)}" style="max-height:48px;max-width:220px;height:auto;display:inline-block;border:0;outline:none;text-decoration:none;" />`
    : `<div style="font-size:22px;font-weight:700;color:${color};letter-spacing:-0.3px;">${escapeHtml(tenant.name)}</div>`;

  const spamHintBlock = spamHint
    ? `<div style="margin:24px 0 8px;padding:14px 16px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:4px;color:#78350f;font-size:13px;line-height:1.55;"><strong>Hinweis:</strong> Sollten Sie diese E-Mail nicht im Posteingang finden, schauen Sie kurz in den Spam-Ordner und markieren Sie uns bitte als „Kein Spam“ – so gelangen künftige Nachrichten sicher zu Ihnen.</div>`
    : "";

  const recruiterBlock = recruiter?.name
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:24px;">
        <tr>
          ${recruiter.avatar_url
            ? `<td style="width:48px;vertical-align:middle;padding-right:14px;"><img src="${recruiter.avatar_url}" alt="${escapeHtml(recruiter.name)}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;display:block;" /></td>`
            : `<td style="width:48px;vertical-align:middle;padding-right:14px;"><div style="width:48px;height:48px;border-radius:50%;background:#e2e8f0;color:#64748b;font-size:16px;font-weight:600;line-height:48px;text-align:center;">${escapeHtml((recruiter.name || "?").trim().charAt(0).toUpperCase())}</div></td>`}
          <td style="vertical-align:middle;">
            <div style="font-weight:600;color:#0f172a;font-size:14px;">${escapeHtml(recruiter.name)}</div>
            <div style="color:#64748b;font-size:12px;margin-top:2px;">${escapeHtml(recruiter.role_label || "Personalabteilung")}</div>
          </td>
        </tr>
      </table>`
    : "";

  const signatureBlock = tenant.email_signature
    ? `<div style="margin-top:16px;color:#94a3b8;font-size:12px;line-height:18px;">${renderTemplate(tenant.email_signature, vars).replace(/\n/g, "<br>")}</div>`
    : "";

  const recipientLine = recipient
    ? `<div style="text-align:center;color:#94a3b8;font-size:11px;margin-top:8px;">Diese E-Mail wurde an ${escapeHtml(recipient)} gesendet.</div>`
    : "";

  const preheaderHidden = preheaderText
    ? `<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">${escapeHtml(preheaderText)}</div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a;">
${preheaderHidden}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 1px 3px rgba(15,23,42,0.04);overflow:hidden;">
  <tr><td style="height:6px;background:${color};line-height:6px;font-size:0;">&nbsp;</td></tr>
  <tr><td style="padding:40px 44px 8px;text-align:center;">${logoBlock}</td></tr>
  <tr><td style="padding:24px 44px 8px;">
    <h1 style="color:#0f172a;font-size:22px;font-weight:700;margin:0 0 20px;line-height:1.3;letter-spacing:-0.2px;">${escapeHtml(subject)}</h1>
    <div style="color:#475569;font-size:15px;line-height:1.65;">${resolvedBody}</div>
    ${spamHintBlock}
  </td></tr>
  <tr><td style="padding:32px 44px 32px;">
    <div style="border-top:1px solid #e2e8f0;padding-top:24px;">
      ${recruiterBlock}
      ${signatureBlock}
      <div style="text-align:center;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:1.2px;font-weight:500;margin-top:8px;">Gesendet von ${escapeHtml(tenant.name)}</div>
    </div>
  </td></tr>
</table>
<div style="text-align:center;color:#94a3b8;font-size:11px;margin-top:16px;">© ${year} ${escapeHtml(tenant.name)}</div>
${recipientLine}
</td></tr>
</table>
</body>
</html>`;

  const text = htmlToText(html);
  return { html, text, subject };
}
