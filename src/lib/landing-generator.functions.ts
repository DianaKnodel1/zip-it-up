import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import JSZip from "jszip";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getTheme } from "./landing-themes";
import { THEME_ASSETS } from "./theme-assets.generated";
import { buildLegalPage, renderImpressum, renderDatenschutz, isPlaceholderValue } from "./legal-content";
import { buildClientLogosBlock } from "./client-logos-block";


const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Ungültige Hex-Farbe");

// Akzeptiert "example.com", "www.example.com" oder volle URLs.
// Wird vor der URL-Validierung normalisiert (https:// prepended, trailing slash entfernt).
const normalizeUrl = (v: unknown) => {
  if (typeof v !== "string") return v;
  const trimmed = v.trim();
  if (!trimmed) return trimmed;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
};
const UrlLike = z.preprocess(normalizeUrl, z.string().url().max(500));
const OptionalUrlLike = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? "" : normalizeUrl(v)),
  z.union([z.string().url().max(500), z.literal("")]),
);

const BrandingSchema = z.object({
  firmenname: z.string().min(1).max(120),
  primary_color: HexColor,
  secondary_color: HexColor,
  whatsapp_number: z.string().max(40).default(""),
  whatsapp_enabled: z.coerce.boolean().default(false),
  email: z.string().email().max(255),
  telefon: z.string().max(40).default(""),
  telefon_2: z.string().max(40).default(""),
  strasse: z.string().max(200).default(""),
  plz: z.string().max(20).default(""),
  stadt: z.string().max(120).default(""),
  hrb: z.string().max(60).default(""),
  registergericht: z.string().max(120).default(""),
  ust_id: z.string().max(40).default(""),
  steuernummer: z.string().max(40).default(""),
  geschaeftsfuehrer: z.string().max(120).default(""),
  impressum: z.string().max(5000).default(""),
  landing_domain: z.string().min(1, "Landing-Domain ist Pflicht (für SEO/Canonical)").max(255),
  api_endpoint: UrlLike,
  portal_url: OptionalUrlLike.default(""),
  supabase_url: OptionalUrlLike.default(""),
  supabase_anon_key: z.string().max(2000).optional().or(z.literal("")).default(""),
  tenant_id: z.string().max(120).optional().or(z.literal("")).default(""),

  flow_type: z.enum(["classic", "fast", "broker"]).default("classic"),
  // Funnel-Tracking: kurzer Slug pro Landing (z.B. "kw24-fast-de").
  // Wird mit jeder Bewerbung gespeichert → Konversion pro Landing messbar.
  source_slug: z.string().max(120).default(""),
  // SEO / Browser-Tab
  seo_title: z.string().max(160).default(""),
  seo_description: z.string().max(320).default(""),
  seo_image: z.string().max(500).default(""),
});

const InputSchema = z.object({
  themeId: z.string().min(1).max(40),
  branding: BrandingSchema,
  // Logo als data-URL: "data:image/png;base64,...."
  logoDataUrl: z.string().max(15_000_000).optional().nullable(),
  faviconDataUrl: z.string().max(1_000_000).optional().nullable(),
  // Theme-Slot-Werte (Texte/Bilder/Farben aus dem UI-Theme-Editor).
  slots: z.record(z.string().min(1).max(60), z.string().max(20_000)).optional().default({}),
});

function cleanLandingDomain(d: string): string {
  return String(d ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/**
 * Repariert kaputte Slot-Werte:
 *  1) Direkt wiederholte, identische Textblöcke ("STEP · 02STEP · 02…") werden
 *     auf eine Ausgabe reduziert — betrifft bereits gespeicherte Seiten.
 *  2) step_num_N bekommt garantiert die fortlaufende Nummer N.
 */
function collapseRepeatedText(value: string): string {
  const v = String(value ?? "");
  if (v.length < 6 || v.length > 400) return v;
  for (let unit = 3; unit <= v.length / 2; unit++) {
    if (v.length % unit !== 0) continue;
    const head = v.slice(0, unit);
    if (head.repeat(v.length / unit) === v) return head;
  }
  return v;
}

function normalizeSlotValues(slotValues: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(slotValues ?? {})) {
    let value = collapseRepeatedText(String(raw ?? ""));
    const stepMatch = /^step_num_(\d+)$/.exec(key);
    if (stepMatch && /\d/.test(value)) {
      const n = Number(stepMatch[1]);
      value = value.replace(/\d+(?!.*\d)/, String(n).padStart(2, "0"));
    }
    out[key] = value;
  }
  return out;
}

function applyPlaceholders(
  src: string,
  branding: z.infer<typeof BrandingSchema>,
  slotValues: Record<string, string> = {},
): string {
  slotValues = normalizeSlotValues(slotValues);
  // Computed Aliase: address/contact_email/contact_phone aus Firmendaten ableiten,
  // damit Slot-Defaults (Impressum/Datenschutz) automatisch korrekt befüllt werden.
  const b: Record<string, unknown> = { ...branding };
  const addrParts = [b.strasse as string, [b.plz as string, b.stadt as string].filter(Boolean).join(" ")]
    .filter(Boolean).join(", ");
  // Rechts-Block (sichtbar im Footer): Firma, Adresse, GF, HRB, USt-ID, Kontakt.
  // Ersetzt die "winzigen Impressum-Links" durch einen abmahnsicheren Klartext-Block.
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));
  const legalLines: string[] = [];
  if (branding.firmenname) legalLines.push(`<strong>${esc(branding.firmenname)}</strong>`);
  if (branding.strasse) legalLines.push(esc(branding.strasse));
  const plzStadt = [branding.plz, branding.stadt].filter(Boolean).join(" ");
  if (plzStadt) legalLines.push(esc(plzStadt));
  if (branding.telefon) legalLines.push(`Telefon: <a href="tel:${esc(branding.telefon)}" style="color:inherit;">${esc(branding.telefon)}</a>`);
  if (branding.email) legalLines.push(`E-Mail: <a href="mailto:${esc(branding.email)}" style="color:inherit;">${esc(branding.email)}</a>`);
  if (branding.geschaeftsfuehrer) legalLines.push(`Geschäftsführung: ${esc(branding.geschaeftsfuehrer)}`);
  const regLine = [
    branding.registergericht ? `Registergericht ${esc(branding.registergericht)}` : "",
    branding.hrb ? `HRB ${esc(branding.hrb)}` : "",
  ].filter(Boolean).join(", ");
  if (regLine) legalLines.push(regLine);
  if (branding.ust_id) legalLines.push(`USt-IdNr.: ${esc(branding.ust_id)}`);
  else if (branding.steuernummer) legalLines.push(`Steuernummer: ${esc(branding.steuernummer)}`);
  const legalBlock = legalLines.length
    ? `<div class="lv-legal-block" style="font-size:14.5px;line-height:1.75;color:inherit;">${legalLines.join("<br/>")}</div>`
    : "";
  const legalInlineParts = [
    branding.firmenname,
    branding.geschaeftsfuehrer ? `GF: ${branding.geschaeftsfuehrer}` : "",
    branding.hrb ? `HRB ${branding.hrb}` : "",
    branding.ust_id ? `USt-IdNr. ${branding.ust_id}` : "",
  ].filter(Boolean).map(esc).join(" · ");
  const contactBlock = (branding.firmenname || branding.telefon || branding.email)
    ? `<div class="lv-contact-block" style="font-size:15px;line-height:1.7;color:inherit;">`
      + (branding.firmenname ? `<div style="font-weight:700;font-size:16px;margin-bottom:4px;">${esc(branding.firmenname)}</div>` : "")
      + (branding.strasse ? `<div>${esc(branding.strasse)}</div>` : "")
      + (plzStadt ? `<div>${esc(plzStadt)}</div>` : "")
      + (branding.telefon ? `<div style="margin-top:8px;"><strong>Telefon:</strong> <a href="tel:${esc(branding.telefon)}" style="color:inherit;font-size:17px;font-weight:600;">${esc(branding.telefon)}</a></div>` : "")
      + (branding.email ? `<div><strong>E-Mail:</strong> <a href="mailto:${esc(branding.email)}" style="color:inherit;">${esc(branding.email)}</a></div>` : "")
      + `</div>`
    : "";

  const aliases: Record<string, string> = {
    address: addrParts,
    contact_address: addrParts,
    contact_email: (b.email as string) || "",
    contact_phone: (b.telefon as string) || "",
    footer_address: addrParts,
    footer_email: (b.email as string) || "",
    footer_phone: (b.telefon as string) || "",
    sitz_stadt: (b.stadt as string) || "",
    legal_block: legalBlock,
    legal_inline: legalInlineParts,
    contact_block: contactBlock,
  };
  // Muster-/Demo-Werte aus Theme-Defaults verwerfen, damit keine Fantasie-Adressen
  // auf einer echten Landing landen — die echten Firmendaten greifen dann.
  const cleanSlots: Record<string, string> = {};
  for (const [key, value] of Object.entries(slotValues)) {
    if (key in aliases && isPlaceholderValue(value)) continue;
    cleanSlots[key] = value;
  }
  const merged: Record<string, unknown> = { ...aliases, ...b, ...cleanSlots };

  let out = src;
  // Mehrere Passes: Slot-Werte können selbst {{branding}}-Tokens enthalten.
  for (let i = 0; i < 3; i++) {
    let changed = false;
    for (const [key, value] of Object.entries(merged)) {
      const token = `{{${key}}}`;
      if (out.includes(token)) {
        out = out.split(token).join(String(value ?? ""));
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

// Entfernt leere/kaputte Meta-Tags (og:image ohne Wert, Canonical/og:url ohne Domain).
function cleanEmptyMetaTags(html: string, b: z.infer<typeof BrandingSchema>): string {
  let out = html;
  if (!b.seo_image) {
    out = out.replace(/\s*<meta[^>]*property=["']og:image["'][^>]*content=["']["'][^>]*>\s*/gi, "\n");
    out = out.replace(/\s*<meta[^>]*name=["']twitter:image["'][^>]*content=["']["'][^>]*>\s*/gi, "\n");
  }
  if (!b.landing_domain) {
    out = out.replace(/\s*<link[^>]*rel=["']canonical["'][^>]*href=["']https?:\/\/\/[^"']*["'][^>]*>\s*/gi, "\n");
    out = out.replace(/\s*<meta[^>]*property=["']og:url["'][^>]*content=["']https?:\/\/\/[^"']*["'][^>]*>\s*/gi, "\n");
  }
  return out;
}

// Injiziert window.PORTAL_API/TENANT_ID/PORTAL_URL/FLOW_TYPE in jedes generierte
// HTML — unabhängig davon, ob das Theme-Template einen <script>-Block dafür hat.
// Garantiert, dass Bewerbungen die richtige tenant_id mitsenden → Reminder/Accept-
// Mail nutzen automatisch den korrekten Tenant-SMTP.
function injectLandingConfig(html: string, b: z.infer<typeof BrandingSchema>): string {
  const escape = (s: string) => String(s ?? "").replace(/[<>"']/g, (c) => ({ "<": "\\u003c", ">": "\\u003e", '"': '\\"', "'": "\\'" }[c]!));
  const block = `<script>
window.PORTAL_API = "${escape(b.api_endpoint)}";
window.PORTAL_URL = "${escape(b.portal_url ?? "")}";
window.TENANT_ID = "${escape(b.tenant_id ?? "")}";
window.FLOW_TYPE = "${escape(b.flow_type)}";
window.SOURCE_SLUG = "${escape(b.source_slug ?? "")}";
window.WHATSAPP_NUMBER = "${escape(b.whatsapp_enabled ? (b.whatsapp_number ?? "").replace(/[^0-9]/g, "") : "")}";
window.LANDING_FIRMENNAME = "${escape(b.firmenname ?? "")}";
window.LANDING_DATENSCHUTZ_URL = "datenschutz.html";
window.LANDING_IMPRESSUM_URL = "impressum.html";
window.LANDING_CONTACT_EMAIL = "${escape(b.email ?? "")}";
window.LANDING_CONTACT_PHONE = "${escape(b.telefon ?? "")}";
</script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, block + "</head>");
  return block + html;
}

// Injiziert einen professionellen Trust-Footer (Impressum, Kontakt, Rechtliches)
// VOR </body> in jedes Theme — überschreibt nichts, ergänzt nur. Wird
// unterdrückt, wenn das Template bereits {{legal_block}} enthält (dort hat
// das Theme die Anbieterkennzeichnung schon eingebaut).
function injectTrustFooter(html: string, b: z.infer<typeof BrandingSchema>): string {
  if (/lv-legal-block/.test(html)) return html; // schon vorhanden
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));
  const plzStadt = [b.plz, b.stadt].filter(Boolean).join(" ");
  const regLine = [
    b.registergericht ? `Registergericht ${esc(b.registergericht)}` : "",
    b.hrb ? `HRB ${esc(b.hrb)}` : "",
  ].filter(Boolean).join(", ");
  const legalItems: string[] = [];
  if (b.firmenname) legalItems.push(`<strong>${esc(b.firmenname)}</strong>`);
  if (b.strasse) legalItems.push(esc(b.strasse));
  if (plzStadt) legalItems.push(esc(plzStadt));
  if (b.geschaeftsfuehrer) legalItems.push(`Geschäftsführung: ${esc(b.geschaeftsfuehrer)}`);
  if (regLine) legalItems.push(regLine);
  if (b.ust_id) legalItems.push(`USt-IdNr.: ${esc(b.ust_id)}`);
  else if (b.steuernummer) legalItems.push(`Steuernummer: ${esc(b.steuernummer)}`);
  const contactItems: string[] = [];
  if (b.telefon) contactItems.push(`<a href="tel:${esc(b.telefon)}" style="color:inherit;text-decoration:none;font-weight:600;">${esc(b.telefon)}</a>`);
  if (b.email) contactItems.push(`<a href="mailto:${esc(b.email)}" style="color:inherit;text-decoration:none;">${esc(b.email)}</a>`);
  const addrHtml = [b.strasse, plzStadt].filter(Boolean).map(esc).join("<br/>");
  const year = new Date().getFullYear();
  const block = `
<section class="lv-trust-footer lv-legal-block" style="background:#0f172a;color:#e2e8f0;padding:56px 24px 32px;margin-top:64px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:1180px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:40px;">
    <div>
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8;margin-bottom:16px;">Kontakt</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:8px;color:#f8fafc;">${esc(b.firmenname)}</div>
      ${addrHtml ? `<div style="font-size:14px;line-height:1.7;color:#cbd5e1;margin-bottom:12px;">${addrHtml}</div>` : ""}
      ${contactItems.length ? `<div style="font-size:15px;line-height:1.9;color:#f8fafc;">${contactItems.join("<br/>")}</div>` : ""}
    </div>
    <div>
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8;margin-bottom:16px;">Anbieterkennzeichnung</div>
      <div style="font-size:14.5px;line-height:1.8;color:#e2e8f0;">${legalItems.join("<br/>")}</div>
    </div>
    <div>
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8;margin-bottom:16px;">Rechtliches</div>
      <ul style="list-style:none;padding:0;margin:0;font-size:14.5px;line-height:2;">
        <li><a href="impressum.html" style="color:#e2e8f0;text-decoration:none;">Impressum</a></li>
        <li><a href="datenschutz.html" style="color:#e2e8f0;text-decoration:none;">Datenschutzerklärung</a></li>
      </ul>
      <div style="margin-top:18px;font-size:13px;line-height:1.7;color:#94a3b8;">
        Die Übertragung Ihrer Bewerbungsdaten erfolgt TLS-verschlüsselt. Die Verarbeitung richtet sich nach unserer Datenschutzerklärung.
      </div>
    </div>

  </div>
  <div style="max-width:1180px;margin:32px auto 0;padding-top:20px;border-top:1px solid rgba(226,232,240,.1);font-size:12.5px;color:#94a3b8;text-align:center;">
    © ${year} ${esc(b.firmenname)}. Alle Rechte vorbehalten.
  </div>
</section>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, block + "\n</body>");
  return html + block;
}

// Fügt einen HTML-Block vor dem ersten "sinnvollen" Anker ein: bewerbung-form-
// Section (falls Theme eine hat) → sonst <footer> → sonst lov-apply-modal →
// sonst </body>. Sorgt dafür, dass zentral injizierte Trust-Sektionen in
// JEDEM Theme sichtbar werden, auch wenn das Bewerbungsformular als Modal läuft.
function insertBeforeAnchor(html: string, block: string): string {
  const anchors: RegExp[] = [
    /<section[^>]*id=["']bewerbung-form["']/i,
    /<footer[\s>]/i,
    /<div[^>]*id=["']lov-apply-modal["']/i,
  ];
  for (const re of anchors) {
    if (re.test(html)) return html.replace(re, (m) => block + "\n" + m);
  }
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, block + "\n</body>");
  return html + block;
}

// Injiziert einen "So geht's weiter"-Trust-Block direkt VOR dem
// Bewerbungsformular. Baut Vertrauen genau am Conversion-Punkt.
function injectTrustStrip(html: string, flow: string = "classic"): string {
  if (/lv-trust-strip/.test(html)) return html;
  const broker = flow === "broker";
  const heading = broker ? "In 3 Schritten zum passenden Auftraggeber" : "In 3 Schritten zum Job";
  const s1t = broker ? "Profil einreichen" : "Bewerbung absenden";
  const s1d = broker
    ? "Formular in 2 Minuten ausfüllen — ohne Anschreiben. Wir prüfen Ihr Profil kostenfrei."
    : "Formular in 2 Minuten ausfüllen — ohne Anschreiben, ohne Lebenslauf-Pflicht.";
  const s2t = broker ? "Persönliches Kennenlernen" : "Kennenlern-Termin";
  const s2d = broker
    ? "Kurzes Gespräch: Wir klären, was Sie suchen und welcher Auftraggeber dazu passt."
    : "Sie wählen selbst einen 15-Minuten-Termin, der zu Ihnen passt — telefonisch oder per Video.";
  const s3t = broker ? "Vorstellung beim Auftraggeber" : "Vertragsangebot";
  const s3d = broker
    ? "Wir stellen Sie beim passenden Unternehmen vor und begleiten Sie bis zum Vertrag."
    : "Passt alles, erhalten Sie ein schriftliches Angebot — Festanstellung, sozialversichert.";
  const block = `
<section class="lv-trust-strip" style="background:#f8fafc;padding:48px 24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:1080px;margin:0 auto;">
    <div style="text-align:center;margin-bottom:32px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">So geht's weiter</div>
      <h2 style="font-size:28px;font-weight:700;color:#0f172a;margin:0;line-height:1.2;">${heading}</h2>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px;">
      <div class="lv-step-card" style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px 24px;text-align:center;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease;">
        <div style="width:52px;height:52px;border-radius:14px;background:#eff6ff;color:#2563eb;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
        </div>
        <div style="font-size:12px;font-weight:700;color:#2563eb;letter-spacing:.1em;margin-bottom:6px;">SCHRITT 1</div>
        <div style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:6px;">${s1t}</div>
        <div style="font-size:14px;color:#64748b;line-height:1.6;">${s1d}</div>
      </div>
      <div class="lv-step-card" style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px 24px;text-align:center;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease;">
        <div style="width:52px;height:52px;border-radius:14px;background:#f0fdf4;color:#16a34a;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <div style="font-size:12px;font-weight:700;color:#16a34a;letter-spacing:.1em;margin-bottom:6px;">SCHRITT 2</div>
        <div style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:6px;">${s2t}</div>
        <div style="font-size:14px;color:#64748b;line-height:1.6;">${s2d}</div>
      </div>
      <div class="lv-step-card" style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px 24px;text-align:center;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease;">
        <div style="width:52px;height:52px;border-radius:14px;background:#fef3c7;color:#d97706;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        </div>
        <div style="font-size:12px;font-weight:700;color:#d97706;letter-spacing:.1em;margin-bottom:6px;">SCHRITT 3</div>
        <div style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:6px;">${s3t}</div>
        <div style="font-size:14px;color:#64748b;line-height:1.6;">${s3d}</div>
      </div>
    </div>
  </div>
</section>`;
  return insertBeforeAnchor(html, block);
}


// ── Sprint 2/3: neue Trust-Sektionen (zentral, betrifft alle 17 Themes) ──

function escH(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));
}

// ── Auftraggeber-Logoleiste (Standard auf allen Fast-Track-Landings) ──
function injectClientLogos(html: string, accent: string): string {
  if (/lv-client-logos/.test(html)) return html;
  return insertBeforeAnchor(html, buildClientLogosBlock(accent));
}

function injectSocialProofBar(html: string, slots: Record<string, string>): string {
  if (/lv-social-proof/.test(html)) return html;
  const rating = (slots.google_rating || "").trim();
  const ratingCount = (slots.google_rating_count || "").trim();
  const kununu = (slots.kununu_score || "").trim();
  const foundedYear = (slots.founded_year || "").trim();
  const placedCount = (slots.placed_count || "").trim();
  const items: string[] = [];
  if (rating) {
    const stars = Math.round(parseFloat(rating.replace(",", ".")) || 0);
    const starRow = Array.from({ length: 5 }, (_, i) =>
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="${i < stars ? "#fbbf24" : "#e2e8f0"}" style="display:inline-block;vertical-align:middle;"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>`
    ).join("");
    items.push(`<div style="display:flex;align-items:center;gap:10px;">${starRow}<div style="font-size:14px;color:#0f172a;"><strong>${escH(rating)}</strong>${ratingCount ? ` · <span style="color:#64748b;">${escH(ratingCount)} Bewertungen</span>` : ""} <span style="color:#64748b;">bei Google</span></div></div>`);
  }
  if (kununu) items.push(`<div style="display:flex;align-items:center;gap:8px;font-size:14px;color:#0f172a;"><span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:#0ea5e9;color:#fff;font-size:11px;font-weight:800;letter-spacing:.05em;">k</span><strong>${escH(kununu)}</strong> <span style="color:#64748b;">auf Kununu</span></div>`);
  if (foundedYear) {
    const years = Math.max(0, new Date().getFullYear() - parseInt(foundedYear, 10));
    if (years > 0) items.push(`<div style="display:flex;align-items:center;gap:8px;font-size:14px;color:#0f172a;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg><strong>Seit ${years}+ Jahren</strong> <span style="color:#64748b;">am Markt</span></div>`);
  }
  if (placedCount) items.push(`<div style="display:flex;align-items:center;gap:8px;font-size:14px;color:#0f172a;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><strong>${escH(placedCount)}+</strong> <span style="color:#64748b;">vermittelte Fachkräfte</span></div>`);
  if (items.length === 0) return html;
  const block = `
<section class="lv-social-proof" style="background:#fff;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;padding:20px 24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:1080px;margin:0 auto;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:32px 40px;">
    ${items.join("")}
  </div>
</section>`;
  const re = /<section[^>]*class=["'][^"']*lv-trust-strip[^"']*["']/i;
  if (re.test(html)) return html.replace(re, (m) => block + "\n" + m);
  return insertBeforeAnchor(html, block);
}


function injectContactCard(
  html: string,
  b: z.infer<typeof BrandingSchema>,
  slots: Record<string, string>,
): string {
  if (/lv-contact-card/.test(html)) return html;
  const name = (slots.recruiter_name_form || "").trim();
  const role = (slots.recruiter_role || "Ihr Ansprechpartner").trim();
  const photo = (slots.recruiter_photo_url || "").trim();
  const phone = (slots.recruiter_phone || b.telefon || "").trim();
  const email = (slots.recruiter_email || b.email || "").trim();
  if (!name && !photo && !phone) return html;
  const initials = name ? name.split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() : "";
  const avatarBlock = photo
    ? `<img src="${escH(photo)}" alt="${escH(name || role)}" style="width:88px;height:88px;border-radius:50%;object-fit:cover;box-shadow:0 6px 18px -6px rgba(15,23,42,.25);flex-shrink:0;"/>`
    : `<div style="width:88px;height:88px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:700;box-shadow:0 6px 18px -6px rgba(15,23,42,.25);flex-shrink:0;">${escH(initials || "★")}</div>`;
  const block = `
<section class="lv-contact-card" style="background:#fff;padding:32px 24px 0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:1080px;margin:0 auto;background:linear-gradient(135deg,#f8fafc 0%,#eff6ff 100%);border:1px solid #e2e8f0;border-radius:16px;padding:24px 28px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
    ${avatarBlock}
    <div style="flex:1;min-width:220px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#2563eb;margin-bottom:4px;">Ihr direkter Kontakt</div>
      ${name ? `<div style="font-size:20px;font-weight:700;color:#0f172a;margin-bottom:2px;">${escH(name)}</div>` : ""}
      <div style="font-size:14px;color:#64748b;margin-bottom:8px;">${escH(role)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px 16px;font-size:14px;">
        ${phone ? `<a href="tel:${escH(phone)}" style="display:inline-flex;align-items:center;gap:6px;color:#0f172a;text-decoration:none;font-weight:600;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/></svg>${escH(phone)}</a>` : ""}
        ${email ? `<a href="mailto:${escH(email)}" style="display:inline-flex;align-items:center;gap:6px;color:#0f172a;text-decoration:none;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>${escH(email)}</a>` : ""}
      </div>
      <div style="margin-top:10px;font-size:12.5px;color:#16a34a;font-weight:600;display:inline-flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;"></span>Antwortet meist innerhalb weniger Stunden</div>
    </div>
  </div>
</section>`;
  return insertBeforeAnchor(html, block);

}

function injectTestimonials(html: string, slots: Record<string, string>): string {
  if (/lv-testimonials/.test(html)) return html;
  const cards: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const text = (slots[`testimonial_${i}_text`] || "").trim();
    const author = (slots[`testimonial_${i}_author`] || "").trim();
    const role = (slots[`testimonial_${i}_role`] || "").trim();
    const photo = (slots[`testimonial_${i}_photo`] || "").trim();
    if (!text) continue;
    const initials = author ? author.split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() : "";
    const avatar = photo
      ? `<img src="${escH(photo)}" alt="${escH(author)}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;flex-shrink:0;"/>`
      : `<div style="width:48px;height:48px;border-radius:50%;background:#e0e7ff;color:#4338ca;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex-shrink:0;">${escH(initials || "•")}</div>`;
    cards.push(`
      <div class="lv-testi-card" style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px 24px;box-shadow:0 4px 12px -6px rgba(15,23,42,.08);transition:transform .18s ease,box-shadow .18s ease;">
        <div style="color:#fbbf24;font-size:16px;margin-bottom:12px;">★★★★★</div>
        <blockquote style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#0f172a;font-style:normal;">„${escH(text)}"</blockquote>
        <div style="display:flex;align-items:center;gap:12px;">
          ${avatar}
          <div>
            ${author ? `<div style="font-size:14px;font-weight:700;color:#0f172a;">${escH(author)}</div>` : ""}
            ${role ? `<div style="font-size:12.5px;color:#64748b;">${escH(role)}</div>` : ""}
          </div>
        </div>
      </div>`);
  }
  if (cards.length === 0) return html;
  const block = `
<section class="lv-testimonials" style="background:#fff;padding:64px 24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:1180px;margin:0 auto;">
    <div style="text-align:center;margin-bottom:40px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">Erfahrungen</div>
      <h2 style="font-size:30px;font-weight:700;color:#0f172a;margin:0;">Das sagen unsere Mitarbeiter</h2>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;">${cards.join("")}</div>
  </div>
</section>`;
  return insertBeforeAnchor(html, block);

}

function injectBenefits(html: string, slots: Record<string, string>): string {
  if (/lv-benefits/.test(html)) return html;
  const defaults: Array<[string, string, string]> = [
    ["Tarifgehalt", "Faire Bezahlung nach Tarifvertrag mit übertariflichen Zulagen.", "M12 8v13||M12 8V6a2 2 0 1 1 4 0v2||M12 8H6a2 2 0 0 0-2 2v3||M12 8h4a2 2 0 0 1 2 2v3||M4 13h16v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6z"],
    ["Urlaub & Sonderzahlungen", "Urlaubs- und Weihnachtsgeld sowie 25+ Tage Jahresurlaub.", "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z||M9 10h6||M12 7v6"],
    ["Fahrtkostenerstattung", "Anfahrt zum Einsatz wird übernommen — Ticket oder Kilometergeld.", "M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"],
    ["Übernahmegarantie", "Klarer Weg zur Festanstellung im Einsatzbetrieb.", "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z||M9 12l2 2 4-4"],
    ["Weiterbildung", "Regelmäßige Schulungen und Zertifikate — auf unsere Kosten.", "M22 10v6||M2 10l10-5 10 5-10 5z||M6 12v5c3 3 9 3 12 0v-5"],
    ["Sozialleistungen", "Krankenversicherung, betriebliche Altersvorsorge, Sonderurlaub.", "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2||M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  ];
  const items: string[] = [];
  for (let i = 0; i < 6; i++) {
    const t = (slots[`benefit_${i + 1}_title`] || defaults[i][0]).trim();
    const d = (slots[`benefit_${i + 1}_desc`] || defaults[i][1]).trim();
    if (!t) continue;
    const paths = defaults[i][2].split("||");
    items.push(`
      <div class="lv-benefit-card" style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:24px;transition:transform .18s ease,border-color .18s ease;">
        <div style="width:44px;height:44px;border-radius:12px;background:#eff6ff;color:#2563eb;display:inline-flex;align-items:center;justify-content:center;margin-bottom:14px;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths.map((p) => `<path d="${p}"/>`).join("")}</svg>
        </div>
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:6px;">${escH(t)}</div>
        <div style="font-size:13.5px;color:#64748b;line-height:1.6;">${escH(d)}</div>
      </div>`);
  }
  const block = `
<section class="lv-benefits" style="background:#f8fafc;padding:64px 24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:1180px;margin:0 auto;">
    <div style="text-align:center;margin-bottom:36px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">Was Sie erwartet</div>
      <h2 style="font-size:30px;font-weight:700;color:#0f172a;margin:0;">Ihre Vorteile im Überblick</h2>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;">${items.join("")}</div>
  </div>
</section>`;
  return insertBeforeAnchor(html, block);

}

function injectFaq(html: string, slots: Record<string, string>): string {
  if (/lv-faq/.test(html)) return html;
  const defaults: Array<[string, string]> = [
    ["Wie lange dauert das Bewerbungsverfahren?", "Nach Absenden Ihrer Bewerbung melden wir uns in der Regel innerhalb von 24 Stunden. Das Kennenlern-Gespräch dauert etwa 15 Minuten — häufig können wir schon direkt danach ein Angebot machen."],
    ["Was kostet mich das?", "Nichts. Unsere Vermittlung ist für Bewerber grundsätzlich kostenfrei. Sie zahlen weder für die Bewerbung noch für die Vermittlung."],
    ["Bin ich fest angestellt?", "Ja. Sie werden bei uns unbefristet und sozialversicherungspflichtig fest angestellt — inklusive Urlaubs-, Weihnachtsgeld und aller gesetzlichen Sozialleistungen."],
    ["Kann ich mich auch ohne Lebenslauf bewerben?", "Ja. Für die Erst-Bewerbung reichen die Angaben im Formular vollständig. Zeugnisse und Lebenslauf können Sie später nachreichen."],
    ["Was passiert mit meinen Daten?", "Ihre Daten werden ausschließlich zur Durchführung des Bewerbungsverfahrens verwendet, DSGVO-konform gespeichert und spätestens nach 6 Monaten gelöscht — es sei denn, Sie stimmen einer längeren Speicherung explizit zu."],
    ["Wie geht es nach dem Gespräch weiter?", "Passt alles zusammen, erhalten Sie ein schriftliches Vertragsangebot. Sie prüfen es in Ruhe, wir klären offene Fragen und starten anschließend im Wunsch-Einsatzbetrieb."],
  ];
  const items = defaults.map(([q, a], i) => {
    const qOverride = (slots[`faq_${i + 1}_q`] || "").trim();
    const aOverride = (slots[`faq_${i + 1}_a`] || "").trim();
    return `
      <details class="lv-faq-item" style="border-bottom:1px solid #e2e8f0;padding:18px 0;">
        <summary style="cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:16px;font-size:16px;font-weight:600;color:#0f172a;">
          <span>${escH(qOverride || q)}</span>
          <svg class="lv-faq-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;transition:transform .18s;"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div style="margin-top:12px;font-size:14.5px;line-height:1.7;color:#475569;">${escH(aOverride || a)}</div>
      </details>`;
  }).join("");
  const block = `
<section class="lv-faq" style="background:#fff;padding:64px 24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:820px;margin:0 auto;">
    <div style="text-align:center;margin-bottom:32px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">Häufige Fragen</div>
      <h2 style="font-size:30px;font-weight:700;color:#0f172a;margin:0;">Alles Wichtige auf einen Blick</h2>
    </div>
    <div>${items}</div>
  </div>
</section>
<style>.lv-faq-item[open] .lv-faq-icon{transform:rotate(180deg);}</style>`;
  const re = /<section[^>]*class=["'][^"']*lv-trust-footer[^"']*["']/i;
  if (re.test(html)) return html.replace(re, (m) => block + "\n" + m);
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, block + "\n</body>");
  return html + block;
}

function injectCertBar(html: string, slots: Record<string, string>): string {
  if (/lv-cert-bar/.test(html)) return html;
  const items: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const label = (slots[`cert_${i}_label`] || "").trim();
    const img = (slots[`cert_${i}_img`] || "").trim();
    if (!label && !img) continue;
    items.push(img
      ? `<img src="${escH(img)}" alt="${escH(label || "Zertifikat")}" style="height:44px;width:auto;object-fit:contain;filter:grayscale(1);opacity:.7;transition:filter .2s,opacity .2s;" onmouseover="this.style.filter='none';this.style.opacity='1';" onmouseout="this.style.filter='grayscale(1)';this.style.opacity='.7';"/>`
      : `<div style="padding:8px 14px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:600;letter-spacing:.05em;color:#475569;">${escH(label)}</div>`);
  }
  if (items.length === 0) return html;
  const block = `
<section class="lv-cert-bar" style="background:#f8fafc;padding:28px 24px;border-top:1px solid #e2e8f0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:1180px;margin:0 auto;">
    <div style="text-align:center;font-size:11.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#94a3b8;margin-bottom:16px;">Zertifiziert & ausgezeichnet</div>
    <div style="display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:28px 40px;">${items.join("")}</div>
  </div>
</section>`;
  const re = /<section[^>]*class=["'][^"']*lv-trust-footer[^"']*["']/i;
  if (re.test(html)) return html.replace(re, (m) => block + "\n" + m);
  return html;
}

function injectPolish(html: string): string {
  if (/lv-polish-style/.test(html)) return html;
  const block = `
<style class="lv-polish-style">
  .lv-step-card:hover,.lv-benefit-card:hover,.lv-testi-card:hover{transform:translateY(-3px);box-shadow:0 12px 32px -12px rgba(15,23,42,.18);border-color:#cbd5e1;}
  .lv-form-submit,button[type=submit]{transition:transform .16s ease,box-shadow .16s ease,filter .16s ease;}
  .lv-form-submit:hover,button[type=submit]:hover{transform:translateY(-1px);box-shadow:0 10px 24px -10px rgba(15,23,42,.35);filter:brightness(1.05);}
  a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid #2563eb;outline-offset:2px;border-radius:4px;}
  .lv-reveal{opacity:0;transform:translateY(16px);transition:opacity .5s ease,transform .5s ease;}
  .lv-reveal.lv-in{opacity:1;transform:none;}
  @media (prefers-reduced-motion: reduce){
    .lv-reveal{opacity:1;transform:none;transition:none;}
    .lv-step-card:hover,.lv-benefit-card:hover,.lv-testi-card:hover{transform:none;}
  }
</style>
<script>
(function(){
  document.addEventListener('DOMContentLoaded',function(){
    var sel='.lv-trust-strip,.lv-social-proof,.lv-contact-card,.lv-testimonials,.lv-benefits,.lv-faq,.lv-cert-bar';
    var els=document.querySelectorAll(sel);
    els.forEach(function(el){el.classList.add('lv-reveal');});
    if(!('IntersectionObserver' in window)){els.forEach(function(e){e.classList.add('lv-in');});return;}
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){if(e.isIntersecting){e.target.classList.add('lv-in');io.unobserve(e.target);}});
    },{threshold:.12});
    els.forEach(function(el){io.observe(el);});
  });
})();
</script>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, block + "\n</body>");
  return html + block;
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mime, bytes };
}

// Impressum/Datenschutz/Seitenrahmen kommen zentral aus src/lib/legal-content.ts
// (gespiegelt nach landing-server/legal-content.js für den Live-Renderer).


export const generateLandingZip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Admin-Check
    const { data: roleRow, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Nicht autorisiert");

    const theme = getTheme(data.themeId);
    if (!theme) throw new Error(`Theme nicht gefunden: ${data.themeId}`);

    const slots = { ...(data.slots ?? {}) };
    // Domain user-freundlich säubern (https://, trailing slash entfernen)
    const cleanedBranding = { ...data.branding, landing_domain: cleanLandingDomain(data.branding.landing_domain) };

    // Impressum/Datenschutz immer als echte Unterseiten — Slots überschreiben.
    slots.impressum_url = "impressum.html";
    slots.datenschutz_url = "datenschutz.html";

    // Hochgeladenes Logo/Favicon automatisch in {{logo_image}}/{{favicon_image}}
    // spiegeln, damit Themes wie Eilers/TTS/AZB den Branding-Upload anzeigen.
    if (data.logoDataUrl && !slots.logo_image) slots.logo_image = "assets/logo.png";
    if (data.faviconDataUrl && !slots.favicon_image) slots.favicon_image = "assets/favicon.png";

    const portalBase = (cleanedBranding.portal_url || "").replace(/\/+$/, "");
    const ctaRaw = (slots.cta_url ?? "").trim();
    const isAbsolute = /^https?:\/\//i.test(ctaRaw);
    if (!isAbsolute) {
      const path = ctaRaw.startsWith("/") ? ctaRaw : "/bewerbung";
      slots.cta_url = portalBase ? `${portalBase}${path}` : "#bewerbung-form";
    }

    let html = applyPlaceholders(theme.html, cleanedBranding, slots);

    if (portalBase) {
      html = html.replace(/href=(["'])\/bewerbung(\/[^"']*)?(\?[^"']*)?(#[^"']*)?\1/gi,
        (_m, q, p = "", qs = "", h = "") => `href=${q}${portalBase}/bewerbung${p}${qs}${h}${q}`);
    }

    // Inline-Sektionen für Impressum/Datenschutz aus index.html entfernen —
    // diese leben jetzt als eigene Unterseiten.
    html = html.replace(/<section[^>]*id=["'](?:impressum|datenschutz)["'][\s\S]*?<\/section>\s*/gi, "");

    html = cleanEmptyMetaTags(html, cleanedBranding);
    html = injectTrustStrip(html, cleanedBranding.flow_type);
    if (cleanedBranding.flow_type === "fast") {
      html = injectClientLogos(html, cleanedBranding.primary_color || "#2563eb");
    }
    html = injectSocialProofBar(html, slots);
    html = injectContactCard(html, cleanedBranding, slots);
    html = injectBenefits(html, slots);
    html = injectTestimonials(html, slots);
    html = injectTrustFooter(html, cleanedBranding);
    html = injectCertBar(html, slots);
    html = injectFaq(html, slots);
    html = injectPolish(html);
    html = injectLandingConfig(html, cleanedBranding);
    // Sicherheitsnetz: nicht aufgelöste {{platzhalter}} nie an Besucher ausliefern.
    html = html.replace(/\{\{\s*[a-z0-9_]+\s*\}\}/gi, "");
    const css = applyPlaceholders(theme.css, cleanedBranding, slots);
    const js = applyPlaceholders(theme.js, cleanedBranding, slots);

    const legalOpts = {
      homeHref: "index.html",
      impressumHref: "impressum.html",
      datenschutzHref: "datenschutz.html",
      logoUrl: data.logoDataUrl ? "assets/logo.png" : undefined,
    };
    const impressumHtml = buildLegalPage("Impressum", renderImpressum(cleanedBranding), cleanedBranding, legalOpts);
    const datenschutzHtml = buildLegalPage("Datenschutz", renderDatenschutz(cleanedBranding), cleanedBranding, legalOpts);


    const zip = new JSZip();
    zip.file("index.html", html);
    zip.file("impressum.html", impressumHtml);
    zip.file("datenschutz.html", datenschutzHtml);
    zip.file("style.css", css);
    zip.file("script.js", js);
    zip.file(
      "README.txt",
      `Landing Page: ${data.branding.firmenname}\nTheme: ${theme.name}\nGeneriert: ${new Date().toISOString()}\n\n` +
        `Upload-Anleitung:\n` +
        `1. Diesen Ordner per FTP (FileZilla) ins Web-Root deines VPS kopieren\n` +
        `   (z.B. /var/www/${data.branding.landing_domain || "kunde"}/)\n` +
        `2. nginx/Apache konfigurieren, sodass index.html ausgeliefert wird\n` +
        `3. SSL-Zertifikat (Let's Encrypt) für die Domain einrichten\n\n` +
        `Bewerbungen werden an: ${data.branding.api_endpoint} gesendet.\n`,
    );

    // Theme-eigene statische Assets (Hero-Bilder, Testimonials, Partner-Logos)
    // aus src/landing-themes/<id>/assets/ in die ZIP packen.
    const themeAssets = THEME_ASSETS[data.themeId] ?? {};
    for (const [name, b64] of Object.entries(themeAssets)) {
      // Base64 → Uint8Array (Worker-kompatibel)
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      zip.folder("assets")!.file(name, bytes);
    }

    if (data.logoDataUrl) {
      const parsed = parseDataUrl(data.logoDataUrl);
      if (parsed) {
        const ext = parsed.mime.includes("svg")
          ? "svg"
          : parsed.mime.includes("jpeg") || parsed.mime.includes("jpg")
            ? "jpg"
            : parsed.mime.includes("webp")
              ? "webp"
              : "png";
        // Theme erwartet assets/logo.png — wir nehmen die richtige Endung und
        // patchen das HTML, falls anders.
        const filename = `logo.${ext}`;
        zip.folder("assets")!.file(filename, parsed.bytes);
        if (ext !== "png") {
          const finalHtml = html.split("assets/logo.png").join(`assets/${filename}`);
          zip.file("index.html", finalHtml);
        }
      }
    } else {
      // Platzhalter, damit der <img>-Tag nicht ins Leere zeigt
      zip.folder("assets")!.file(
        "logo.png",
        new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
          0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
          0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
          0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ]),
      );
    }

    // Favicon (optional) — bei Fehlen 1×1-PNG-Platzhalter, damit assets/favicon.png nicht 404 wirft
    if (data.faviconDataUrl) {
      const fav = parseDataUrl(data.faviconDataUrl);
      if (fav) {
        const ext = fav.mime.includes("svg")
          ? "svg"
          : fav.mime.includes("png")
            ? "png"
            : fav.mime.includes("ico") || fav.mime.includes("icon")
              ? "ico"
              : "png";
        zip.folder("assets")!.file(`favicon.${ext}`, fav.bytes);
      }
    } else {
      zip.folder("assets")!.file(
        "favicon.png",
        new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
          0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
          0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
          0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ]),
      );
    }

    const buffer = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    // Base64 für Transport über JSON
    let binary = "";
    for (let i = 0; i < buffer.length; i++) binary += String.fromCharCode(buffer[i]);
    const base64 = btoa(binary);

    const safeName = data.branding.firmenname.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const datum = new Date().toISOString().slice(0, 10);
    const filename = `landing-${safeName}-${theme.id}-${datum}.zip`;

    return { zipBase64: base64, filename };
  });