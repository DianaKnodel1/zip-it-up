# Zwei neue Server + Theme-Bereinigung

## 1. Server-Anleitung (WebID-Modul und Bot-Runner)

Zwei getrennte Server, weil beide unterschiedliche Anforderungen haben:

| Server | Zweck | Empfehlung |
|---|---|---|
| WebID-Server | Simulations-Proxy für die Legitimation, braucht öffentliche Domains + TLS | 2 vCPU / 4 GB, Ubuntu 22.04/24.04, feste IP |
| Bot-Server | Playwright-Browser für Kontoeröffnungen, braucht RAM + Proxys | 4 vCPU / 8 GB, Ubuntu 22.04/24.04 |

Beide Setups existieren bereits als Skripte im Projekt (`webid-sim-server/setup.sh`, `scripts/setup-bot-runner.sh`). Der Plan ergänzt eine verständliche Schritt-für-Schritt-Anleitung als `docs/SERVER-SETUP.md` mit:

- Server bestellen, DNS setzen (WebID: Simulationsdomains auf die neue IP; Bot: keine Domain nötig)
- Grundabsicherung (SSH-Key, Firewall: WebID 80/443, Bot nur SSH raus)
- Repo klonen, `.env` mit Backend-URL und Keys anlegen
- Einzeiler-Installation je Server
- Prüfen, ob es läuft (Health-Check, `journalctl`), und was bei Fehlern zu tun ist
- Bot-Server: Proxy-Pflicht, Captcha/VideoIdent gehen an dich als Admin (Handoff)

Zusätzlich wird `scripts/setup-bot-runner.sh` so angepasst, dass es auch auf einem frischen, leeren Server läuft (Bun/Playwright-Abhängigkeiten installieren, Repo-Pfad frei wählbar), damit die Anleitung wirklich Copy-Paste-fähig ist.

## 2. Impressum/Datenschutz doppelt

Ursache ist geprüft: Der Generator hängt an jede Landing einen zentralen Trust-Footer an. Er wird nur unterdrückt, wenn das Theme den Platzhalter `{{legal_block}}` enthält. 17 von 27 Themes haben diesen Platzhalter **nicht**, bringen aber im eigenen Footer schon Impressum-/Datenschutz-Links mit — daher erscheinen die Links zweimal (Screenshot 1 und 2).

Fix:
- Der Generator entfernt beim Anhängen des Trust-Footers die vorhandenen Rechtslinks aus dem Theme-Footer (statt sie doppelt zu zeigen).
- Themes mit eigenem `{{legal_block}}` bleiben unverändert, dort wird nichts injiziert.
- `scripts/check-themes.sh` bekommt eine zusätzliche Prüfung „doppelte Rechtslinks“, damit das nicht wieder passiert.

## 3. Footer/Bottom wirkt leer (Nordstern und andere)

Der zentrale Trust-Footer bekommt mehr Substanz statt drei dünner Spalten: Firmenblock mit Claim, Kontakt (Adresse, Telefon, E-Mail), Nützliche Links (Ablauf, Bewerbung, Kontakt), Anbieterkennzeichnung, Hinweis zur verschlüsselten Übertragung, Copyright-Zeile. Farben passen sich hell/dunkel an, damit er nicht als schwarzer Fremdkörper unter hellen Themes klebt.

## 4. Alle Themes prüfen

Vollständiger Durchgang über alle 27 Themes mit `scripts/check-themes.sh` plus manueller Sichtprüfung über die Theme-Vorschau:

- Jeder Platzhalter im Template hat einen Slot in `meta.json` (sonst bleibt Text stehen oder wird leer)
- `{{brand_name}}`, `{{logo_text}}`, `{{firmenname}}` werden überall durch den echten Firmennamen ersetzt
- Keine toten Links (`href="#"`), Impressum/Datenschutz genau einmal verlinkt
- Bewerbungsformular/CTA-Anker vorhanden und erreichbar
- Themes, die inhaltlich zu dünn sind, werden auf denselben Aufbau gebracht wie die bereits überarbeiteten (Hero, Trust, Ablauf, Zielgruppen, Stimmen, FAQ, CTA, Footer)

Ergebnis wird als kurze Liste „Theme → Status“ zurückgemeldet.

## Technische Details

- `src/lib/landing-generator.functions.ts`: `injectTrustFooter` erweitern (Dedupe der Rechtslinks, reichhaltigerer Footer, Farbvariante)
- `src/landing-themes/theme-*/`: fehlende `meta.json`-Slots und dünne Sektionen ergänzen
- `scripts/check-themes.sh`: Prüfregel für doppelte Rechtslinks
- `docs/SERVER-SETUP.md` (neu) und `scripts/setup-bot-runner.sh` (standalone-fähig)
- Nach dem Deploy einmal Theme-Resync zum Landing-Server auslösen
