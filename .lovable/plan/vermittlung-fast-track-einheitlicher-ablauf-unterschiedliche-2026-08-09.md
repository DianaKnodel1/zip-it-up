# Vermittlung & Fast-Track: einheitlicher Ablauf, unterschiedliche Designs

## 1. Bewerbungen-Toolbar entfernen
Die komplette Toolbar-Zeile in `/admin/bewerbungen` (Suche, Mandanten-Filter, Aktiv-Umschalter, Archivieren, Cleanup, Bewerber zurücksetzen) wird entfernt. Die Liste zeigt danach direkt die aktiven Bewerbungen. Die zugehörigen Server-Funktionen bleiben erhalten (kein Datenverlust), nur die Bedienelemente verschwinden.

## 2. Erfolgs-Pop-up für alle Vermittlungs-Seiten vereinheitlichen
Das Pop-up aus Screenshot 2 wird der verbindliche Standard für **jede** Vermittlungs-Landing:

- Grüner Haken → „Herzlichen Glückwunsch!" → „Wir haben Ihre Bewerbung erfolgreich erhalten."
- Partner-Karte: Logo + „Wir verbinden Sie mit" + Firmenname der verknüpften Fast-Track-Firma
- Trennlinie → „Wie geht es jetzt weiter?" + Einladungstext
- Grüner Button „Jetzt Termin buchen" → öffnet den Calendly-Link in neuem Fenster
- Hinweis „Es öffnet sich ein neues Fenster zur Terminauswahl."

Umsetzung: das gemeinsame Formular-Skript wird zur einzigen Quelle dieses Pop-ups; Theme-eigene Kopien (u. a. theme-10) werden entfernt, damit kein Theme mehr abweicht. Optik ist überall identisch — unabhängig vom Landing-Design.

Button-Ziel: Calendly-Link der Vermittlungs-Landing bzw. der verknüpften Partnerfirma. Ist keiner hinterlegt, führt der Button auf die verknüpfte Fast-Track-Landing (Interview-Portal), damit der Bewerber nie in einer Sackgasse landet. Der Interview-Link steht zusätzlich in der Calendly-Terminbeschreibung.

## 3. Auftraggeber-Logoleiste als Standard auf allen Fast-Track-Seiten
Neuer gemeinsamer Baustein „Vertrauen von führenden Unternehmen" (Screenshot 3):

- Fester Logo-Satz (Allianz, Deutsche Bank, AOK, BBVA, Commerzbank, Debeka, Deutsche Post, SAP, DKB, WebID) aus den bereits im Projekt liegenden SVGs
- Horizontales Karussell mit Pfeil-Buttons links/rechts, automatischer Endlos-Lauf, Touch-Swipe auf Mobil
- Wird beim Generieren automatisch in jede Fast-Track-Landing eingefügt — analog zum Formular-Baustein
- Pro Theme eigene Farb-/Rahmen-Variante, damit die Seiten sich weiter unterscheiden; Aufbau bleibt gleich

## 4. Texte: Vermittlung vs. Fast-Track
Zwei Textwelten mit je mehreren Formulierungs-Varianten (eine pro Theme), damit sich Seiten ähneln, aber nicht identisch wirken:

- **Vermittlung** (Vorbild top-personal.net): Positionierung als Personalvermittlung — „Wir bringen Sie mit passenden Auftraggebern zusammen", Ablauf in Schritten, Vorteile, kein eigenes Produktversprechen. Kein Auftraggeber-Logo-Block.
- **Fast-Track** (Vorbild procepta.digital): Positionierung als Auftraggeber/Dienstleister — konkrete Tätigkeit, Zahlen/Benefits, Logoleiste als Proof, direktes Bewerbungsformular.

Die Texte werden als neue Standardwerte in den Theme-Definitionen hinterlegt und lassen sich im Landing-Generator weiterhin überschreiben. Designs (Farben, Layout, Typografie) bleiben pro Theme unverändert unterschiedlich und werden dort, wo Themes sich zu ähnlich sind, farblich/strukturell stärker differenziert.

## Technische Details
- `src/routes/admin.bewerbungen.tsx`: Toolbar-Block inkl. Dialoge entfernen, ungenutzte Imports/States aufräumen.
- `src/landing-themes/_shared/form-section.js`: Broker-Zweig als Standard-Pop-up festziehen (Fallback-Button ohne Calendly), Theme-Overrides wie `theme-10/script.js` auf das gemeinsame Skript reduzieren.
- Neu: `src/landing-themes/_shared/trust-logos.html`, `trust-logos.css`, `trust-logos.js` + Logo-SVGs unter `_shared/logos/`; Einbindung im Generator (`src/lib/landing-generator.functions.ts` / `admin.landing-generator.tsx`) nur bei `flow_type = "fast"`.
- Theme-`meta.json`-Defaults auf die neuen Vermittlungs- bzw. Fast-Track-Texte umstellen.
- Danach: Typecheck + Produktions-Build, Prüfung einer Vermittlungs- und einer Fast-Track-Vorschau.
