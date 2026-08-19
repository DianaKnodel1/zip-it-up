# Landing-Generator: Vermittlung vs. Fast-Track vor dem Deploy geradeziehen

Beim Durchgehen des Generators ist ein echter Blocker aufgefallen — und zwei Stellen, an denen die beiden Theme-Welten noch nicht sauber getrennt sind.

## 1. Blocker: Vermittlungs-Seiten lassen sich nicht generieren

Die Server-Prüfung des Generators kennt nur die Modi „Klassisch" und „Fast-Track". Der Modus „Vermittlung" (broker) wird von der Oberfläche zwar gesetzt und mitgeschickt, vom Server aber als ungültiger Wert abgelehnt — der ZIP-Download bricht mit einem Validierungsfehler ab.

Fix: „Vermittlung" als gültigen Modus in der Server-Prüfung ergänzen, damit derselbe Wert durchläuft, den die Oberfläche und die Datenbank schon nutzen.

## 2. Themes sind keiner der beiden Welten zugeordnet

Aktuell zeigt die Theme-Auswahl in beiden Modi alle 21 Vorlagen. Man kann also versehentlich eine Vermittlungs-Optik für eine Partnerfirma nehmen (und umgekehrt) — genau die Vermischung, die vermieden werden soll.

Fix: Jedes Theme bekommt eine Kennzeichnung „Vermittlung", „Fast-Track" oder „beides". Die Auswahl im Generator zeigt dann standardmäßig nur die passenden Vorlagen zum gewählten Modus, mit einem Schalter „alle Themes anzeigen" als Notausgang. Zusätzlich ein Farb-Chip pro Theme-Kachel, damit die Zuordnung sichtbar bleibt.

Zuordnung nach Optik/Inhalt der Vorlagen:
- Fast-Track (Auftraggeber-Stil, procepta.digital): quality-report, qa-grid, qa-platform-premium, tester-lab, device-stack, quantum-tech, nebula-flux, midnight-premium, theme-10
- Vermittlung (Agentur-Stil, top-personal.net): connect-people, talent-hub, career-atlas, job-gleiter, tts-beratung, tts-consultant, cle-beratung, for-tel, azb-replica, eilers-replica, mirror-site, editorial-premium

## 3. Bausteine, die im falschen Modus landen

- Die Auftraggeber-Logoleiste („Vertrauen von führenden Unternehmen") wird bereits nur bei Fast-Track eingesetzt — bleibt so.
- Der Block „In 3 Schritten zum Job" wird derzeit in **jede** Seite eingefügt, auch bei Vermittlung, mit Fast-Track-Wortlaut („Bewerbung absenden → Termin → Start"). Fix: bei Vermittlung eine Agentur-Variante mit gleicher Optik, aber passendem Text (Profil einreichen → Kennenlernen → Vorstellung beim Auftraggeber).

## Technische Details

- `src/lib/landing-generator.functions.ts`: `flow_type` in `BrandingSchema` auf `["classic","fast","broker"]` erweitern; `injectTrustStrip(html)` um den Flow-Parameter ergänzen und zwei Schritt-Textsätze (fast/classic vs. broker) hinterlegen.
- `src/lib/landing-themes.ts`: pro Theme-Eintrag `flow: "fast" | "broker" | "both"` ergänzen (rein additiv, keine Renderänderung).
- `src/routes/admin.landing-generator.tsx`: Theme-Liste nach `branding.flow_type` filtern, Umschalter „Alle Themes anzeigen", Badge auf der Theme-Kachel.

## Danach

Typprüfung und Produktions-Build, dazu je eine Testgenerierung Vermittlung und Fast-Track, bevor du deployst.
