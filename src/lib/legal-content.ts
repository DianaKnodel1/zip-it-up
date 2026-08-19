/**
 * Zentrale Rechtstexte für alle Landing Pages.
 * --------------------------------------------------------------------------
 * LEGAL_CONTENT_VERSION muss identisch sein mit
 * `landing-server/legal-content.js` — der Live-Renderer läuft als eigene App
 * auf dem VPS und kann nicht aus `src/` importieren. Bei Änderungen IMMER
 * beide Dateien anpassen und die Version hochzählen.
 */

export const LEGAL_CONTENT_VERSION = "2026-07-26.1";

export type LegalBranding = {
  firmenname?: string;
  strasse?: string;
  plz?: string;
  stadt?: string;
  telefon?: string;
  email?: string;
  geschaeftsfuehrer?: string;
  registergericht?: string;
  hrb?: string;
  ust_id?: string;
  steuernummer?: string;
  aufsichtsbehoerde?: string;
  impressum?: string;
  primary_color?: string;
  secondary_color?: string;
};

export type LegalPageOptions = {
  /** Ziel des "Zurück zur Startseite"-Links. */
  homeHref?: string;
  impressumHref?: string;
  datenschutzHref?: string;
  /** Absolute oder relative Logo-URL; sonst wird der Firmenname gesetzt. */
  logoUrl?: string;
  /** Optionales Theme-CSS, das zusätzlich geladen wird (nur für Schriften). */
  stylesheetHref?: string;
};

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/**
 * Erkennt Muster-/Demo-Daten aus Theme-Defaults ("Musterstraße 1",
 * "hallo@example.com", "+49 30 12345678", …). Solche Werte dürfen NIE auf einer
 * echten Kunden-Landing landen — sie werden verworfen, damit stattdessen die
 * gepflegten Firmendaten greifen.
 */
export function isPlaceholderValue(v: unknown): boolean {
  const s = String(v ?? "").trim();
  if (!s) return true;
  const patterns = [
    /musterstra/i,
    /musterstadt/i,
    /mustermann/i,
    /\bmusterfirma\b/i,
    /\bbeispiel(firma|stadt|str)/i,
    /example\.(com|org|net|de)/i,
    /\+49\s*\(?\s*0?\s*\)?\s*123\s*456\s*789/,
    /\+49\s*30\s*12345678\b/,
    /\+49\s*30\s*000\s*000\s*00\b/,
    /\+49\s*30\s*123\s*456\s*78\b/,
    /\b12345\s+Musterstadt\b/i,
    /\{\{legal_block\}\}/i,
    /\{\{contact_block\}\}/i
  ];
  return patterns.some((re) => re.test(s));
}



function addressLines(b: LegalBranding): string[] {
  const plzStadt = [b.plz, b.stadt].filter(Boolean).join(" ");
  return [b.strasse, plzStadt].filter(Boolean).map((x) => escapeHtml(x));
}

function section(title: string, body: string): string {
  return `<section class="legal-section"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

/** Vollständiges Impressum nach § 5 DDG / § 18 MStV. */
export function renderImpressum(b: LegalBranding = {}): string {
  const addr = addressLines(b);
  const firm = escapeHtml(b.firmenname);
  const out: string[] = [];

  out.push(
    section(
      "Angaben gemäß § 5 DDG",
      `<p class="legal-lead"><strong>${firm}</strong>${addr.length ? `<br/>${addr.join("<br/>")}` : ""}</p>`,
    ),
  );

  if (b.geschaeftsfuehrer) {
    out.push(section("Vertreten durch", `<p>${escapeHtml(b.geschaeftsfuehrer)}</p>`));
  }

  const contact: string[] = [];
  if (b.telefon)
    contact.push(
      `<dt>Telefon</dt><dd><a href="tel:${escapeHtml(b.telefon)}">${escapeHtml(b.telefon)}</a></dd>`,
    );
  if (b.email)
    contact.push(
      `<dt>E-Mail</dt><dd><a href="mailto:${escapeHtml(b.email)}">${escapeHtml(b.email)}</a></dd>`,
    );
  if (contact.length) out.push(section("Kontakt", `<dl class="legal-dl">${contact.join("")}</dl>`));

  const reg: string[] = [];
  if (b.registergericht) reg.push(`<dt>Registergericht</dt><dd>${escapeHtml(b.registergericht)}</dd>`);
  if (b.hrb) reg.push(`<dt>Registernummer</dt><dd>${escapeHtml(b.hrb)}</dd>`);
  if (reg.length) out.push(section("Registereintrag", `<dl class="legal-dl">${reg.join("")}</dl>`));

  const tax: string[] = [];
  if (b.ust_id)
    tax.push(
      `<dt>Umsatzsteuer-Identifikationsnummer</dt><dd>${escapeHtml(b.ust_id)}<br/><span class="legal-note">gemäß § 27a Umsatzsteuergesetz</span></dd>`,
    );
  if (b.steuernummer) tax.push(`<dt>Steuernummer</dt><dd>${escapeHtml(b.steuernummer)}</dd>`);
  if (tax.length) out.push(section("Umsatzsteuer", `<dl class="legal-dl">${tax.join("")}</dl>`));

  if (b.aufsichtsbehoerde) {
    out.push(section("Zuständige Aufsichtsbehörde", `<p>${escapeHtml(b.aufsichtsbehoerde)}</p>`));
  }

  const responsible = escapeHtml(b.geschaeftsfuehrer || b.firmenname);
  out.push(
    section(
      "Redaktionell verantwortlich",
      `<p>${responsible}${addr.length ? `<br/>${addr.join("<br/>")}` : ""}<br/><span class="legal-note">Angabe gemäß § 18 Abs. 2 MStV</span></p>`,
    ),
  );

  if (b.impressum) {
    out.push(section("Weitere Angaben", `<div>${b.impressum}</div>`));
  }

  out.push(
    section(
      "Haftung für Inhalte",
      `<p>Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 DDG sind wir als Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen. Verpflichtungen zur Entfernung oder Sperrung der Nutzung von Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt. Eine diesbezügliche Haftung ist jedoch erst ab dem Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich. Bei Bekanntwerden entsprechender Rechtsverletzungen entfernen wir diese Inhalte umgehend.</p>`,
    ),
  );

  out.push(
    section(
      "Haftung für Links",
      `<p>Unser Angebot enthält gegebenenfalls Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich. Die verlinkten Seiten wurden zum Zeitpunkt der Verlinkung auf mögliche Rechtsverstöße überprüft; rechtswidrige Inhalte waren zum Zeitpunkt der Verlinkung nicht erkennbar. Bei Bekanntwerden von Rechtsverletzungen entfernen wir derartige Links umgehend.</p>`,
    ),
  );

  out.push(
    section(
      "Urheberrecht",
      `<p>Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen Autors bzw. Erstellers. Soweit die Inhalte auf dieser Seite nicht vom Betreiber erstellt wurden, werden die Urheberrechte Dritter beachtet und als solche gekennzeichnet.</p>`,
    ),
  );

  out.push(
    section(
      "Hinweis zur Streitbeilegung",
      `<p>Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit: <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer">https://ec.europa.eu/consumers/odr/</a>. Unsere E-Mail-Adresse finden Sie oben im Impressum.</p>
       <p>Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>`,
    ),
  );

  return out.join("\n");
}

/** Datenschutzerklärung mit Fokus auf Bewerbungsverfahren. */
export function renderDatenschutz(b: LegalBranding = {}): string {
  const name = escapeHtml(b.firmenname);
  const email = escapeHtml(b.email);
  const addr = addressLines(b);
  const mail = email ? `<a href="mailto:${email}">${email}</a>` : name;
  const out: string[] = [];

  out.push(
    section(
      "1. Verantwortlicher",
      `<p>Verantwortlich für die Datenverarbeitung auf dieser Website ist:<br/>
       <strong>${name}</strong>${addr.length ? `<br/>${addr.join("<br/>")}` : ""}${email ? `<br/>E-Mail: ${mail}` : ""}${b.telefon ? `<br/>Telefon: ${escapeHtml(b.telefon)}` : ""}</p>`,
    ),
  );

  out.push(
    section(
      "2. Erhebung und Verarbeitung personenbezogener Daten",
      `<p>Wir verarbeiten personenbezogene Daten, die Sie uns über das Bewerbungsformular zur Verfügung stellen (z.&nbsp;B. Name, Anschrift, Geburtsdatum, Kontaktdaten, Angaben zur Qualifikation), zur Durchführung des Bewerbungsverfahrens gemäß Art.&nbsp;6 Abs.&nbsp;1 lit.&nbsp;b DSGVO in Verbindung mit § 26 Abs.&nbsp;1 BDSG.</p>`,
    ),
  );

  out.push(
    section(
      "3. Hosting und Server-Logfiles",
      `<p>Beim Aufruf dieser Website werden durch den Hosting-Anbieter automatisch Informationen in sogenannten Server-Logfiles gespeichert (IP-Adresse, Datum und Uhrzeit des Zugriffs, aufgerufene Seite, übertragene Datenmenge, Browsertyp und Betriebssystem). Diese Daten dienen ausschließlich dem sicheren und stabilen Betrieb der Website. Rechtsgrundlage ist unser berechtigtes Interesse nach Art.&nbsp;6 Abs.&nbsp;1 lit.&nbsp;f DSGVO. Die Logfiles werden nach spätestens 30 Tagen gelöscht.</p>`,
    ),
  );

  out.push(
    section(
      "4. Cookies und Reichweitenmessung",
      `<p>Diese Website setzt ausschließlich technisch notwendige Cookies ein, die für den Betrieb und die Übermittlung des Bewerbungsformulars erforderlich sind. Eine Auswertung Ihres Nutzungsverhaltens zu Werbezwecken oder eine Weitergabe an Werbenetzwerke findet nicht statt. Sollten künftig Analyse- oder Marketing-Dienste eingesetzt werden, geschieht dies ausschließlich auf Grundlage Ihrer vorherigen Einwilligung nach Art.&nbsp;6 Abs.&nbsp;1 lit.&nbsp;a DSGVO.</p>`,
    ),
  );

  out.push(
    section(
      "5. Speicherdauer",
      `<p>Ihre Bewerbungsdaten werden bis zu 6 Monate nach Abschluss des Verfahrens gespeichert und anschließend gelöscht, sofern keine längere gesetzliche Aufbewahrungspflicht besteht oder Sie in eine längere Speicherung — etwa zur Aufnahme in einen Bewerberpool — eingewilligt haben.</p>`,
    ),
  );

  out.push(
    section(
      "6. Empfänger und Auftragsverarbeiter",
      `<p>Eine Weitergabe an Dritte erfolgt nur, wenn dies zur Durchführung des Bewerbungsverfahrens erforderlich ist (z.&nbsp;B. an Partnerunternehmen im Rahmen einer Vermittlung) oder Sie ausdrücklich eingewilligt haben. Für Hosting, E-Mail-Versand und die technische Bereitstellung des Bewerbungsportals setzen wir sorgfältig ausgewählte Dienstleister ein, mit denen Verträge zur Auftragsverarbeitung nach Art.&nbsp;28 DSGVO bestehen.</p>`,
    ),
  );

  out.push(
    section(
      "7. Ihre Rechte",
      `<p>Sie haben das Recht auf Auskunft (Art.&nbsp;15 DSGVO), Berichtigung (Art.&nbsp;16 DSGVO), Löschung (Art.&nbsp;17 DSGVO), Einschränkung der Verarbeitung (Art.&nbsp;18 DSGVO), Datenübertragbarkeit (Art.&nbsp;20 DSGVO) sowie das Recht auf Widerspruch (Art.&nbsp;21 DSGVO). Eine erteilte Einwilligung können Sie jederzeit mit Wirkung für die Zukunft widerrufen. Anfragen richten Sie bitte an ${mail}.</p>`,
    ),
  );

  out.push(
    section(
      "8. Beschwerderecht",
      `<p>Unbeschadet anderweitiger Rechtsbehelfe haben Sie das Recht, sich bei einer Datenschutz-Aufsichtsbehörde über die Verarbeitung Ihrer personenbezogenen Daten zu beschweren — insbesondere in dem Mitgliedstaat Ihres Aufenthaltsorts, Ihres Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes.</p>`,
    ),
  );

  out.push(
    section(
      "9. Verschlüsselte Übertragung",
      `<p>Diese Website nutzt eine TLS-Verschlüsselung, damit Ihre Angaben — insbesondere die Inhalte des Bewerbungsformulars — auf dem Transportweg geschützt sind. Eine verschlüsselte Verbindung erkennen Sie am Schloss-Symbol in der Adresszeile Ihres Browsers.</p>`,
    ),
  );

  return out.join("\n");
}

/** Ruhige, markenkonforme Hülle für Impressum/Datenschutz. */
export function buildLegalPage(
  title: string,
  body: string,
  b: LegalBranding = {},
  opts: LegalPageOptions = {},
): string {
  const t = escapeHtml(title);
  const firm = escapeHtml(b.firmenname);
  const home = escapeHtml(opts.homeHref ?? "index.html");
  const impressumHref = escapeHtml(opts.impressumHref ?? "impressum.html");
  const datenschutzHref = escapeHtml(opts.datenschutzHref ?? "datenschutz.html");
  const primary = /^#[0-9a-fA-F]{6}$/.test(b.primary_color ?? "") ? b.primary_color! : "#1d4ed8";
  const addr = addressLines(b);
  const year = new Date().getFullYear();

  const brand = opts.logoUrl
    ? `<img src="${escapeHtml(opts.logoUrl)}" alt="${firm}" class="legal-logo" />`
    : `<span class="legal-wordmark">${firm}</span>`;

  const contactLine = [
    addr.join(", "),
    b.telefon ? `Telefon: ${escapeHtml(b.telefon)}` : "",
    b.email ? `<a href="mailto:${escapeHtml(b.email)}">${escapeHtml(b.email)}</a>` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${t} – ${firm}</title>
<meta name="robots" content="noindex,follow" />
<style>
  :root { --legal-accent: ${primary}; --legal-ink: #111827; --legal-muted: #5b6472; --legal-line: #e4e7ec; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; background:#ffffff; color:var(--legal-ink);
    font-family: "Plus Jakarta Sans", "Manrope", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    font-size:16px; line-height:1.72; -webkit-font-smoothing:antialiased; }
  a { color: var(--legal-accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .legal-header { border-bottom:1px solid var(--legal-line); background:#fff; }
  .legal-header-inner { max-width:920px; margin:0 auto; padding:20px 24px; display:flex; align-items:center; justify-content:space-between; gap:24px; }
  .legal-logo { height:34px; width:auto; display:block; }
  .legal-wordmark { font-size:17px; font-weight:700; letter-spacing:-0.01em; color:var(--legal-ink); }
  .legal-back { font-size:14px; color:var(--legal-muted); white-space:nowrap; }
  .legal-hero { max-width:920px; margin:0 auto; padding:56px 24px 24px; }
  .legal-eyebrow { font-size:12px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--legal-accent); margin:0 0 10px; }
  .legal-hero h1 { font-size:40px; line-height:1.15; letter-spacing:-0.02em; margin:0 0 12px; color:var(--legal-ink); }
  .legal-hero p { margin:0; color:var(--legal-muted); font-size:16px; max-width:60ch; }
  .legal-rule { max-width:920px; margin:28px auto 0; padding:0 24px; }
  .legal-rule span { display:block; height:3px; width:64px; background:var(--legal-accent); border-radius:99px; }
  .legal-page { max-width:920px; margin:0 auto; padding:8px 24px 88px; }
  .legal-section { padding:28px 0; border-bottom:1px solid var(--legal-line); }
  .legal-section:last-child { border-bottom:0; }
  .legal-section h2 { font-size:19px; line-height:1.35; letter-spacing:-0.01em; margin:0 0 10px; color:var(--legal-ink); }
  .legal-section p { margin:0 0 12px; }
  .legal-section p:last-child { margin-bottom:0; }
  .legal-lead { font-size:17px; }
  .legal-note { font-size:13.5px; color:var(--legal-muted); }
  .legal-dl { display:grid; grid-template-columns:1fr; gap:2px 24px; margin:0; }
  .legal-dl dt { font-weight:600; color:var(--legal-ink); }
  .legal-dl dd { margin:0 0 10px; color:var(--legal-ink); }
  .legal-dl dd:last-child { margin-bottom:0; }
  @media (min-width: 720px) {
    .legal-section { display:grid; grid-template-columns:230px 1fr; gap:32px; }
    .legal-section h2 { margin:0; padding-top:2px; }
    .legal-dl { grid-template-columns:200px 1fr; }
    .legal-dl dt { grid-column:1; }
    .legal-dl dd { grid-column:2; margin-bottom:4px; }
  }
  .legal-footer { border-top:1px solid var(--legal-line); background:#fafbfc; }
  .legal-footer-inner { max-width:920px; margin:0 auto; padding:28px 24px 40px; font-size:13.5px; color:var(--legal-muted); display:flex; flex-wrap:wrap; gap:8px 20px; justify-content:space-between; }
  .legal-footer-inner a { color:var(--legal-muted); }
  .legal-footer-links { display:flex; gap:18px; }
</style>
</head>
<body>
<header class="legal-header">
  <div class="legal-header-inner">
    <a href="${home}" aria-label="${firm}">${brand}</a>
    <a href="${home}" class="legal-back">← Zurück zur Startseite</a>
  </div>
</header>
<div class="legal-hero">
  <p class="legal-eyebrow">Rechtliche Informationen</p>
  <h1>${t}</h1>
  <p>Pflichtangaben und Hinweise zu ${firm}.</p>
</div>
<div class="legal-rule"><span></span></div>
<main class="legal-page">
  ${body}
</main>
<footer class="legal-footer">
  <div class="legal-footer-inner">
    <div>© ${year} ${firm}${contactLine ? ` · ${contactLine}` : ""}</div>
    <div class="legal-footer-links">
      <a href="${impressumHref}">Impressum</a>
      <a href="${datenschutzHref}">Datenschutz</a>
    </div>
  </div>
</footer>
</body>
</html>`;
}
