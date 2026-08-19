# KI-Vorschlag automatisch + Landing-Themes reparieren

## 1. KI-Vorschlag erscheint automatisch beim Öffnen des Chats

Heute muss man den Vorschlag per Knopf anfordern. Neu:

- Beim Öffnen einer Unterhaltung wird automatisch ein Vorschlag erzeugt, wenn
  die letzte Nachricht vom Mitarbeiter kommt, noch nicht beantwortet wurde und
  das Eingabefeld leer ist.
- Der Vorschlag steht direkt im Eingabefeld — absenden, ändern oder verwerfen.
  Kleiner Hinweis über dem Feld: „Vorschlag — bitte prüfen“ mit „Neu“ und
  „Verwerfen“. Nichts wird ohne Freigabe gesendet.
- Pro Unterhaltung nur einmal automatisch (gemerkt bis eine neue Nachricht
  eintrifft), damit keine unnötigen Anfragen entstehen.
- Wissensbasis und Mitarbeiter-Kontext werden weiterhin serverseitig geladen —
  das sind nur wenige Zeilen Text (Onboarding, Aufträge, nächster Termin,
  FAQ-Einträge) und daher unkritisch. Zur Sicherheit werden FAQ-Einträge auf die
  wichtigsten begrenzt und der Verlauf auf die letzten Nachrichten gekürzt.

## 2. Platzhalter `{{brand_name}}` bleibt stehen / wird leer

Ursache (geprüft): Der Generator kennt Aliase wie `contact_address` oder
`legal_block`, aber **kein** `brand_name`. Themes wie Ruby haben zusätzlich
keinen `brand_name`-Slot in ihrer `meta.json`. Der Platzhalter wird deshalb am
Ende vom Sicherheitsnetz einfach entfernt → leere Logo-Zeile.

Fix:
- `brand_name` (und `logo_text`) als Alias auf den Firmennamen im Generator
  ergänzen, damit jedes Theme automatisch den echten Namen zeigt.
- In allen Themes, die `{{brand_name}}` verwenden, den Slot in `meta.json`
  ergänzen, damit er im Editor auch überschreibbar ist.

## 3. Ruby lädt nicht richtig (tb-app.de)

Geprüft: `theme-ruby-broker` ist nur ein Gerüst — leerer Markenname (siehe
Punkt 2), CTA-Links zeigen auf `#bewerbung-form`, das Template hat aber keinen
Formularbereich, und die CSS-Datei hat nur 27 Zeilen (zum Vergleich: Noir 318).
Ergebnis: halbleere, unfertig wirkende Seite.

Fix: Ruby wird zu einem vollwertigen Theme ausgebaut (Hero mit Bild, Trust-Zeile,
Prozess, Leistungen, Stimmen, FAQ, Bewerbungsbereich mit Anker, kompletter
Footer mit Impressum/Datenschutz) inklusive ausgearbeitetem CSS und passender
`meta.json`.

## 4. Slate, Sapphire, Emerald, Amber

Gleiche Ursache: Slate (49 Zeilen Template / 28 CSS), Sapphire (48/29),
Emerald (55/27) und Amber (123/49) sind ebenfalls Gerüste ohne
Bewerbungsbereich und mit sehr dünnem Styling — daher der „tote“, leere
Eindruck.

Fix pro Theme, jeweils in eigener Farbwelt und Typografie (kein Einheitsbrei):
- Hero mit Bild/Struktur statt reiner Textblock
- Vertrauenszeile, Prozessschritte, Leistungen, Zahlen, Stimmen, FAQ
- Bewerbungsbereich `#bewerbung-form`, damit alle CTA-Links greifen
- Footer mit Kontakt, Impressum und Datenschutz
- CSS mit Abständen, Karten, Hover, Mobil-Layout

Amber und Emerald werden dabei zusätzlich auf die gleichen Punkte geprüft
(Platzhalter, tote Links, Slot-Abgleich).

## Prüfen und ausliefern

- `bash scripts/check-themes.sh` muss für alle geänderten Themes „OK“ melden.
- Danach auf dem Server deployen und im Admin den Themes-Resync für die
  Landing-Server auslösen, damit tb-app.de die neue Ruby-Version bekommt; die
  bestehende Seite einmal neu generieren, damit `brand_name` gefüllt wird.

## Technische Details

- `src/lib/ai-chat-helper.functions.ts`: FAQ-Limit, Verlaufskürzung.
- `src/routes/admin.chat.tsx`: Auto-Trigger beim Auswählen einer Unterhaltung,
  Vorschlags-Hinweisleiste, „Neu“/„Verwerfen“.
- `src/lib/landing-generator.functions.ts`: Alias-Map um `brand_name` und
  `logo_text` erweitern.
- `src/landing-themes/theme-{ruby-broker,slate-premium,sapphire-matching,
  emerald-talent,amber-consult}/`: `template.html`, `style.css`, `meta.json`.
