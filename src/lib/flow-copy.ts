// Standard-Textwelten für die beiden Landing-Modi.
// "broker"  = Vermittlungsfirma (Vorbild top-personal.net)
// "fast"    = Auftraggeber/Dienstleister (Vorbild procepta.digital)
// Pro Theme wird eine andere Variante gezogen, damit sich die Seiten
// ähneln, aber nicht wortgleich sind.

export type FlowCopy = {
  kicker: string;
  title: string;
  subtitle: string;
  ctaPrimary: string;
  ctaSecondary: string;
};

const BROKER: FlowCopy[] = [
  {
    kicker: "Personalvermittlung",
    title: "Wir bringen Sie mit dem passenden Auftraggeber zusammen",
    subtitle:
      "Sie bewerben sich einmal — wir übernehmen den Rest. Wir prüfen Ihr Profil, schlagen Sie bei geprüften Unternehmen vor und begleiten Sie bis zum Vertrag. Kostenfrei für Bewerber.",
    ctaPrimary: "Jetzt bewerben",
    ctaSecondary: "So läuft die Vermittlung",
  },
  {
    kicker: "Ihre Vermittlung",
    title: "Ein Profil. Mehrere Chancen.",
    subtitle:
      "Statt sich einzeln überall zu bewerben: Wir kennen die Unternehmen, wissen wer gerade einstellt und stellen Sie gezielt vor — diskret und ohne Kosten für Sie.",
    ctaPrimary: "Jetzt bewerben",
    ctaSecondary: "Ablauf ansehen",
  },
  {
    kicker: "Vermittlung mit Handschlag",
    title: "Der kurze Weg zu Ihrem nächsten Job",
    subtitle:
      "Bewerbung in zwei Minuten, persönliches Kennenlernen, Vorstellung beim passenden Auftraggeber. Sie entscheiden in jedem Schritt selbst, wie es weitergeht.",
    ctaPrimary: "Jetzt bewerben",
    ctaSecondary: "Mehr erfahren",
  },
  {
    kicker: "Für Bewerberinnen und Bewerber",
    title: "Wir kennen die Unternehmen, die Sie suchen",
    subtitle:
      "Als Vermittler sitzen wir zwischen beiden Seiten: Wir wissen, welche Auftraggeber gerade Personal brauchen — und bringen Ihr Profil dort hin, wo es gebraucht wird.",
    ctaPrimary: "Jetzt bewerben",
    ctaSecondary: "Häufige Fragen",
  },
  {
    kicker: "Vermittlungsservice",
    title: "Bewerben Sie sich einmal — wir öffnen die Türen",
    subtitle:
      "Wir bereiten Ihre Unterlagen auf, empfehlen Sie weiter und stimmen den Gesprächstermin direkt mit dem Unternehmen ab. Für Sie bleibt nur ein Schritt: das Formular.",
    ctaPrimary: "Jetzt bewerben",
    ctaSecondary: "Ablauf in 3 Schritten",
  },
  {
    kicker: "Persönliche Vermittlung",
    title: "Passende Auftraggeber statt endloser Bewerbungen",
    subtitle:
      "Kein Anschreiben, keine Warteschleife. Wir sprechen kurz mit Ihnen, verstehen was Sie suchen und vermitteln Sie an das Unternehmen, das dazu passt.",
    ctaPrimary: "Jetzt bewerben",
    ctaSecondary: "Vorteile ansehen",
  },
];

const FAST: FlowCopy[] = [
  {
    kicker: "Jetzt einsteigen",
    title: "Arbeiten Sie von zuhause — flexibel, sicher, sozialversichert",
    subtitle:
      "Wir prüfen digitale Prozesse für namhafte Auftraggeber. Freie Zeiteinteilung, faire Vergütung und eine Einarbeitung, die Sie wirklich vorbereitet.",
    ctaPrimary: "Jetzt bewerben",
    ctaSecondary: "Aufgaben ansehen",
  },
  {
    kicker: "Ihr neuer Arbeitsplatz",
    title: "Qualitätssicherung im Homeoffice — ohne Vorerfahrung",
    subtitle:
      "Sie testen Anwendungen und Abläufe unserer Auftraggeber und melden, was nicht rund läuft. Alles, was Sie brauchen: Laptop, Internet und Sorgfalt.",
    ctaPrimary: "Jetzt bewerben",
    ctaSecondary: "So arbeiten wir",
  },
  {
    kicker: "Direkteinstieg",
    title: "Ein Job, der sich Ihrem Alltag anpasst",
    subtitle:
      "Feste Anstellung, planbare Vergütung, Arbeitszeiten die Sie selbst legen. Wir arbeiten für Unternehmen, deren Namen Sie kennen — und suchen Verstärkung.",
    ctaPrimary: "Jetzt bewerben",
    ctaSecondary: "Konditionen ansehen",
  },
  {
    kicker: "Wir stellen ein",
    title: "Digitale Prüfaufgaben für starke Auftraggeber",
    subtitle:
      "Strukturierte Einarbeitung, klare Abläufe und ein Team, das erreichbar ist. Bewerbung ohne Lebenslauf — das Kennenlernen führen wir online.",
    ctaPrimary: "Jetzt bewerben",
    ctaSecondary: "Häufige Fragen",
  },
  {
    kicker: "Karriere im Homeoffice",
    title: "Sichere Anstellung. Freie Zeiteinteilung.",
    subtitle:
      "Sie unterstützen unsere Auftraggeber bei Qualitäts- und Prüfprozessen. Einstieg jederzeit möglich, Einarbeitung bezahlt, Ansprechpartner inklusive.",
    ctaPrimary: "Jetzt bewerben",
    ctaSecondary: "Mehr zum Job",
  },
  {
    kicker: "Offene Stellen",
    title: "Ihr Einstieg bei einem gefragten Dienstleister",
    subtitle:
      "Wir arbeiten für Versicherungen, Banken und Konzerne — und suchen Menschen, die genau hinschauen. Bewerbung online, Rückmeldung meist am selben Tag.",
    ctaPrimary: "Jetzt bewerben",
    ctaSecondary: "Auftraggeber ansehen",
  },
];

function pick(list: FlowCopy[], themeId: string): FlowCopy {
  let sum = 0;
  for (let i = 0; i < themeId.length; i++) sum += themeId.charCodeAt(i);
  return list[sum % list.length]!;
}

export function flowCopyFor(themeId: string, flow: string): FlowCopy | null {
  if (flow === "broker") return pick(BROKER, themeId);
  if (flow === "fast") return pick(FAST, themeId);
  return null;
}

const KICKER = /^(hero_kicker|hero_eyebrow|eyebrow|hero_badge|hero_label)$/i;
const TITLE = /^(hero_title|hero_title_1|hero_headline|hero_h1|headline)$/i;
const SUB = /^(hero_subtitle|hero_subtext|hero_sub|hero_lead|hero_description|hero_text)$/i;
const CTA1 = /^(hero_cta_primary|hero_btn_primary|cta_label|hero_cta)$/i;
const CTA2 = /^(hero_cta_secondary|hero_btn_secondary)$/i;

/**
 * Setzt die Modus-Texte in die Hero-Slots eines Themes.
 * `onlyDefaults` schützt bereits vom Nutzer angepasste Texte.
 */
export function applyFlowCopy(
  themeId: string,
  flow: string,
  values: Record<string, string>,
  defaults: Record<string, string>,
  onlyDefaults = true,
): Record<string, string> {
  const copy = flowCopyFor(themeId, flow);
  if (!copy) return values;
  const next = { ...values };
  const set = (key: string, text: string) => {
    if (!(key in defaults)) return;
    const current = next[key] ?? defaults[key] ?? "";
    if (onlyDefaults && current.trim() && current !== defaults[key]) return;
    next[key] = text;
  };
  for (const key of Object.keys(defaults)) {
    if (KICKER.test(key)) set(key, copy.kicker);
    else if (TITLE.test(key)) set(key, copy.title);
    else if (SUB.test(key)) set(key, copy.subtitle);
    else if (CTA1.test(key)) set(key, copy.ctaPrimary);
    else if (CTA2.test(key)) set(key, copy.ctaSecondary);
  }
  return next;
}
