# Landing-Themes: Bugs beheben, Farbwelten trennen, Namen und Texte neu

## 1. Zwei defekte Vorlagen reparieren (Blocker)

**Quantum Tech** und **Editorial Premium** liefern eine völlig unformatierte Seite aus — beiden Templates fehlt die Einbindung ihrer Stildatei (`style.css`). Alle anderen 19 Vorlagen haben sie. Fix: Einbindung ergänzen, danach beide Seiten im Browser gegenprüfen.

Zusätzlich wird eine Sicherung eingebaut: Fehlt die Stildatei-Einbindung in einem Template, ergänzt der Generator sie automatisch beim Erzeugen des Pakets — damit kann dieser Fehler nicht erneut auftreten. Der Theme-Check bekommt dieselbe Prüfung als festen Punkt.

## 2. Doppelung entfernen

„TTS Beratung Replica" und „TTS-Beratung Replica — Digitalisierungs-Beratung" sind zwei Einträge mit praktisch gleichem Namen. Die schwächere der beiden fällt weg, die bessere bleibt und wird überarbeitet. Ergebnis: 20 Vorlagen.

## 3. Farbwelten sauber trennen

Aktuell teilen sich viele Vorlagen dieselben Grundtöne — dasselbe Dunkelblau (Nebula Flux, QA Platform Premium, Midnight Premium, Quantum Tech, Device Stack, QA Grid) und dieselbe Creme-Palette (Quality Report, Connect People, Career Atlas, Talent Hub, Tester Lab, Editorial Premium). Deshalb wirken sie austauschbar.

Jede Vorlage bekommt eine eigene, festgelegte Farbwelt. Keine zwei Vorlagen teilen sich Hintergrund + Akzent. Grobe Aufteilung:

**Partner-Firma (Auftraggeber-Optik, Vorbild procepta.digital)** — technisch, klar, seriös:
Anthrazit/Limette · Tiefblau/Orange · Reinweiß/Royalblau · Nachtblau/Cyan · Graphit/Bernstein · Off-White/Petrol · Schiefer/Koralle · Schwarz/Gold · Stahlgrau/Grün

**Vermittlung (Personalagentur-Optik, Vorbild top-personal.net)** — warm, menschlich, vertrauensbildend:
Creme/Terrakotta · Weiß/Waldgrün · Sand/Burgund · Hellblau/Marine · Papierweiß/Aubergine · Warmgrau/Kupfer · Elfenbein/Salbei · Weiß/Indigo · Beige/Ziegelrot · Perlgrau/Teal · Creme/Tiefbraun

**QA Platform Premium** bekommt wie gewünscht einen deutlich helleren Hintergrund (heller Grundton statt Dunkelmodus).

## 4. Neue Namen — getrennt nach Welt

Kurze Markennamen, klar zwei Gruppen. Im Generator werden sie unter zwei Überschriften gezeigt: „Vermittlung" und „Partner-Firma".

**Vermittlung:** Kontor · Meridian · Aurum · Lumen · Anker · Nordstern · Fährte · Weitblick · Zunft · Passage · Signal

**Partner-Firma:** Prisma · Achse · Raster · Vektor · Puls · Radar · Zenit · Kern · Basalt

Die technischen Kennungen der Vorlagen bleiben unverändert, damit bestehende Landing Pages weiterlaufen — es ändert sich nur die Anzeige.

## 5. Texte auf die jeweilige Rolle ausrichten

Die Vermittlungs-Seiten sprechen bisher teils, als wären sie selbst der Arbeitgeber. Richtig ist: **Die Vermittlung stellt Kontakt zu Partnerfirmen her.**

Durchgängige Sprachregelung für alle Vermittlungs-Vorlagen:
- Positionierung: „Wir vermitteln Sie an geprüfte Partnerunternehmen" statt „Arbeite bei uns"
- Ablauf: Profil einreichen → persönliches Kennenlernen → Vorstellung beim Partnerunternehmen → Vertrag beim Partner
- Vertrauensbausteine: Anzahl vermittelter Kandidaten, Partnerunternehmen, Vermittlungsdauer, kostenfrei für Bewerber, Datenschutz-Hinweis, echte Ansprechpartner mit Namen/Foto-Platz
- Keine Gehalts-/Arbeitgeberversprechen, die nur der Partner geben kann

Für Partner-Firma-Vorlagen bleibt die Auftraggeber-Sprache (direkte Anstellung, eigene Leistungen) plus die bestehende Logoleiste „Vertrauen von führenden Unternehmen".

Jede Vorlage erhält zusätzlich, sofern noch nicht vorhanden: Vertrauensbereich (Zahlen/Siegel), FAQ (4-6 Fragen), Ablauf in 3 Schritten, klarer Abschluss-Aufruf, vollständiger Footer mit Impressum/Datenschutz.

## 6. Kontrolle vor Abgabe

- Theme-Prüfskript grün für alle 20 Vorlagen
- Typprüfung + Produktions-Build
- Alle 20 Vorlagen im Browser gerendert und per Screenshot gesichtet — insbesondere Quantum Tech, Editorial Premium und QA Platform Premium
- Je eine Testgenerierung Vermittlung und Partner-Firma

## Technische Details

- `src/landing-themes/theme-quantum-tech/template.html`, `theme-editorial-premium/template.html`: `<link rel="stylesheet" href="style.css" />` im `<head>` ergänzen.
- `src/lib/landing-themes.ts`: in `withSharedForm` Fallback ergänzen, der die Stylesheet-Einbindung injiziert, wenn sie fehlt; das doppelte TTS-Theme aus Registry, Importen und `THEME_FLOW` entfernen; `name` je Theme neu setzen.
- `scripts/check-themes.sh`: Prüfpunkt „style.css eingebunden" ergänzen.
- Pro Theme: `style.css` Farbvariablen neu setzen, `meta.json` `name`, `description` und Text-Defaults an die Rollen-Sprache anpassen, ggf. `template.html` um Vertrauens-/FAQ-Abschnitt erweitern.
- `src/routes/admin.landing-generator.tsx`: Theme-Liste in zwei benannte Gruppen aufteilen.
- `src/lib/flow-copy.ts`: Vermittlungs-Textbausteine an die Partner-Weiterleitung angleichen.