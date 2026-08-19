// Automatische Schreibstil-Erkennung aus vorhandenen Nachrichten.

export interface DetectedStyle {
  anrede: "Du" | "Sie";
  avgLength: number;
  sentenceStyle: string;
  greeting: string;
  closing: string;
  emojis: boolean;
  examples: string[];
}

const DU = /\b(du|dich|dir|dein|deine|deinen|deinem)\b/gi;
const SIE = /\b(sie|ihnen|ihr\s|ihre|ihren|ihrem)\b/g;

export function analyzeStyle(samples: string[]): DetectedStyle {
  const texts = samples.map((s) => s.trim()).filter((s) => s.length > 1).slice(0, 30);
  const joined = texts.join("\n");

  const duHits = (joined.match(DU) ?? []).length;
  const sieHits = (joined.match(SIE) ?? []).length;

  const avgLength = texts.length
    ? Math.round(texts.reduce((sum, t) => sum + t.length, 0) / texts.length)
    : 0;

  const greetingMatch = texts.map((t) => t.split(/[\n,!.]/)[0]?.trim() ?? "")
    .find((g) => /^(hallo|hi|hey|moin|guten)/i.test(g));
  const closingMatch = texts.map((t) => t.split(/\n/).slice(-1)[0]?.trim() ?? "")
    .find((c) => /(gr[üu][ßs]e|vg|lg|beste|viele gr)/i.test(c));

  return {
    anrede: sieHits > duHits ? "Sie" : "Du",
    avgLength,
    sentenceStyle: avgLength > 320 ? "ausführliche Absätze" : avgLength > 120 ? "kurze Absätze" : "sehr knappe Sätze",
    greeting: greetingMatch || "meist ohne feste Begrüßung",
    closing: closingMatch || "meist ohne feste Grußformel",
    emojis: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(joined),
    examples: texts.slice(0, 6).map((t) => t.replace(/\s+/g, " ").slice(0, 200)),
  };
}
