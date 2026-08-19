# Landing-Themes: Vermittlungs-Optik, Bilder-Bug, Logo-Leiste

## Was ich geprüft habe

- **Bilder-Bug (bestätigt):** Sieben Themes verweisen im Hero auf `/src/assets/landing-themes/*.jpg` — ein Entwicklungs-Pfad, den es auf dem Landing-Server nicht gibt. Betroffen: **Raster (QA Grid), Meridian, Aurum, Kontor, Radar, Achse, Puls**. Live ergibt das 404 → genau der kaputte Zustand auf `odb-beratungsagentur.de` nach dem Theme-Wechsel. **Antwort auf deine Meridian-Frage: nein, die Bilder laden dort aktuell nicht.**
- **Kunden-Logoleiste (bestätigt):** Die Leiste mit Deutsche Bank, HypoVereinsbank usw. wird nur beim ZIP-Export eingebaut, **nicht** beim Live-Rendern. Deshalb fehlt sie auf Puls und allen anderen Fast-Track-Seiten im Netz.
- **top-personal.net:** Aufbau erfasst (Hero mit Bildhintergrund, drei Job-Karten mit Status-Badges, „Ihr Karriere-Partner", Ansprechpartner-Block, Zahlen-Block 6592/2334/9+, Über-uns mit Bild, Bewerbungsformular).

## Was ich umsetze

### 1. Bilder-Bug beheben (Ursache des Theme-Wechsel-Problems)
Die sieben Hero-Bilder wandern in den `assets/`-Ordner des jeweiligen Themes, die Vorgabewerte zeigen künftig auf `assets/<name>.jpg`, und die eingebettete Asset-Datei wird neu erzeugt. Damit synchronisiert der Landing-Server die Bilder automatisch mit.
Zusätzlich: bereits gespeicherte Bildwerte mit `/src/assets/...` werden beim Rendern automatisch auf den neuen Pfad umgebogen, damit bestehende Seiten wie ODB auch ohne erneutes Speichern sofort wieder korrekt aussehen.

### 2. Kunden-Logoleiste überall auf Fast-Track
Die Logoleiste (Allianz, Deutsche Bank, HypoVereinsbank, Commerzbank, DKB, SAP, AOK, Deutsche Post, Debeka, WebID) wird in den Live-Renderer übernommen und automatisch auf **jeder** Fast-Track-Landing eingeblendet — nicht nur bei Puls. Doppel-Einbau wird verhindert, falls ein Theme bereits eine Leiste hat.

### 3. Themes auf Vermittlungs-Optik umstellen
- **Anker:** Texte konsequent aus Vermittler-Sicht — „Unsere Partnerunternehmen suchen Verstärkung" statt „wir suchen". Hero, Leistungen, Ablauf und Formular-Texte entsprechend, plus Partner-/Vermittlungs-Sektion.
- **Zunft:** vom Beratungs-/Handwerks-Auftritt zur Personalvermittlung umgebaut: Stellen-Bereiche statt Beratungsleistungen, Ablauf „Bewerbung → Gespräch → Vermittlung zum Partnerunternehmen", Vertrauenszahlen, Ansprechpartner.
- **Fährte:** gleiche Richtung — Sektionen und Texte auf Vermittlung ausgerichtet (Kandidaten-Pool, geprüfte Arbeitgeber, persönliche Betreuung, Ablauf, FAQ).
- **Weitblick:** wird als 1:1-Nachbau von top-personal.net neu aufgebaut — Hero mit Bildhintergrund und zwei Buttons, drei Job-Karten mit Status-Badges, „Ihr Karriere-Partner"-Block mit drei Vorteilen, Ansprechpartner-Sektion, Zahlen-Block, Über-uns mit Bild, Footer mit Impressum/Datenschutz. Alle Texte, Farben, Firmenname und Bilder bleiben über den Generator austauschbar.

### 4. Aurum und Kontor entfernen
Beide verschwinden aus der Vorlagen-Auswahl im Generator. Die Dateien bleiben im Hintergrund erhalten, damit eventuell bereits damit gebaute Landing Pages weiter ausgeliefert werden und nicht plötzlich weiß sind.

## Technische Details

- Assets: `src/assets/landing-themes/*.jpg` → `src/landing-themes/theme-*/assets/hero.jpg`, Defaults in `meta.json` angepasst, `node scripts/build-theme-assets.mjs` neu ausführen.
- Legacy-Pfad-Rewrite und Logoleiste in `landing-server/server.js` (Render-Pfad), Logo-Markup aus `src/lib/client-logos.ts` gespiegelt.
- Theme-Rewrites in `template.html` / `style.css` / `meta.json` der betroffenen Ordner; `theme-azb-replica` wird komplett neu geschrieben.
- `HIDDEN_THEMES` in `src/lib/landing-themes.ts` um `theme-career-atlas` und `theme-connect-people` erweitert.
- Abschluss: `bash scripts/check-themes.sh`, Typecheck und Build.

## Deployment
Danach sind Portal-Server (Frontend) **und** ein Theme-Resync auf den Landing-Servern nötig; die Deploy-Befehle gebe ich am Ende durch.