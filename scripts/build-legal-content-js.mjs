// Erzeugt landing-server/legal-content.js aus src/lib/legal-content.ts.
// Der Live-Renderer läuft eigenständig auf dem VPS und kann nicht aus src/
// importieren — deshalb dieser Mirror. Nach jeder Änderung an der TS-Datei:
//   bun scripts/build-legal-content-js.mjs
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("src/lib/legal-content.ts", "utf8");
let out = src
  // Typ-Deklarationen entfernen
  .replace(/export type [A-Za-z]+ = \{[\s\S]*?\n\};\n\n?/g, "")
  // Parameter-/Rückgabe-Annotationen
  .replace(/\((?:s|v): unknown\)/g, (m) => (m.includes("v:") ? "(v)" : "(s)"))
  .replace(/\): boolean \{/g, ") {")
  .replace(/\(b: LegalBranding\): string\[\]/g, "(b)")
  .replace(/\(b: LegalBranding = \{\}\)/g, "(b = {})")
  .replace(/b: LegalBranding = \{\},/g, "b = {},")
  .replace(/opts: LegalPageOptions = \{\},/g, "opts = {},")
  .replace(/\(title: string, body: string\)/g, "(title, body)")
  .replace(/title: string,\n  body: string,/g, "title,\n  body,")
  .replace(/\): string \{/g, ") {")
  .replace(/: string\[\] = \[\]/g, " = []")
  .replace(/const out: string\[\]/g, "const out")
  .replace(/\)\[c\]!,/g, ")[c],")
  .replace(/b\.primary_color!/g, "b.primary_color")
  .replace(/\(b\.primary_color \?\? ""\)/g, '(b.primary_color || "")')
  .replace(/^export const LEGAL_CONTENT_VERSION/m, "export const LEGAL_CONTENT_VERSION");

out = out.replace(
  "/**\n * Zentrale Rechtstexte",
  "/* AUTOGENERIERT aus src/lib/legal-content.ts — nicht direkt bearbeiten! */\n/**\n * Zentrale Rechtstexte",
);

if (/: (string|LegalBranding|LegalPageOptions|unknown)\b/.test(out)) {
  console.error("[legal-content] Rest-Typannotationen gefunden:");
  console.error(out.split("\n").filter((l) => /: (string|LegalBranding|LegalPageOptions|unknown)\b/.test(l)).join("\n"));
  process.exit(1);
}
writeFileSync("landing-server/legal-content.js", out);
console.log("landing-server/legal-content.js geschrieben", out.length, "bytes");
