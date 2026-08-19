# Bot absichern (Proxy, Captcha, eigener Server) + KI-Chat entlasten

Vier Themen, in dieser Reihenfolge umsetzbar.

## 1. Bot auf eigenem Server

Der Runner wird heute im Portal-Deploy (`scripts/deploy.sh`) mitinstalliert. Sobald der neue Server da ist:

- Neuer Schalter `BOT_RUNNER_HOST` in `scripts/deploy.sh`: ist er gesetzt, wird der Runner **nicht** lokal installiert, sondern per SSH auf dem Bot-Server aktualisiert und neu gestartet; ist er leer, bleibt alles wie bisher.
- `scripts/setup-bot-runner.sh` bekommt einen Erst-Setup-Modus für eine frische VM (Bun, Playwright/Chromium, `.env.server`-Vorlage mit `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REQUIRE_PROXY=true`).
- Kurzanleitung in `bot-runner/README.md` (3 Befehle für die neue Maschine).

## 2. Proxy-Prüfung („geht mein Proxy?")

Heute kann man einen Proxy anlegen, aber nicht testen — ein kaputter Proxy fällt erst beim Lauf auf.

- **Runner:** neuer Modus `bun run server.ts --proxy-test <proxy-id>` sowie eine Queue-Tabellenspalte, damit der Test aus dem Portal ausgelöst werden kann. Der Test öffnet über den Proxy eine IP-Prüfseite, liest die ausgehende IP + Land aus und schreibt Ergebnis, Antwortzeit und Fehlertext nach `bot_proxies`.
- **Migration:** `bot_proxies` erhält `last_check_at`, `last_check_ok`, `last_check_ip`, `last_check_error`.
- **UI (`/admin/bots` → Proxys):** Button „Testen" pro Proxy, Ampel-Badge (grün mit IP/Land, rot mit Fehlertext, grau = nie getestet) und Hinweis, wenn der letzte Test älter als 24 h ist.
- **Vor jedem Lauf:** der Runner prüft den Proxy kurz vor dem Start; schlägt er fehl, geht der Lauf mit klarer Meldung („Proxy X nicht erreichbar") auf `failed`, statt über eine falsche IP zu laufen.

## 3. Fehlerbild heute (geprüft im Code)

- **Warteschlange bleibt stehen:** solange kein Runner-Dienst läuft, holt niemand die Läufe ab. Deshalb kommt Punkt 1 zuerst; zusätzlich zeigt die Bots-Seite künftig „Runner zuletzt gesehen vor X Min." (Heartbeat), damit du sofort siehst, ob der Dienst lebt.
- **SOCKS5 mit Benutzer/Passwort funktioniert in Chromium nicht** — der Runner ignoriert die Zugangsdaten stillschweigend. Künftig: klare Warnung im Proxy-Formular und Fehlermeldung statt stiller Fehlfunktion. Empfehlung: HTTP-Proxy mit Sticky-Session.
- **Die Bank-Profile sind Platzhalter.** Die Selektoren (`input[name*="vorname"]` usw.) sind geraten und treffen die echten Antragsstrecken von DKB, comdirect, Consorsbank, Santander und Deutsche Bank sehr wahrscheinlich nicht. Ohne echte Aufnahme läuft kein Antrag durch.

## 4. Captcha & echte Antragsstrecken

Captchas lassen sich nicht „einbauen" — sie sind genau die Sperre, die Automatisierung verhindern soll. Realistischer Umgang:

- **Erkennen statt lösen:** der Runner prüft nach jedem Schritt auf Captcha-Merkmale (reCAPTCHA-/hCaptcha-/Turnstile-Frames, „Ich bin kein Roboter", Bot-Blockseiten). Trifft eines zu, geht der Lauf sofort auf `waiting_admin` mit Screenshot, Live-URL und Grund „Captcha – bitte manuell lösen" — statt blind weiterzuklicken und zu scheitern.
- **Weniger Captchas provozieren:** echter User-Agent, deutsche Sprache/Zeitzone (schon da), menschliche Tippgeschwindigkeit statt Sofort-Ausfüllen, kleine zufällige Pausen, ein Lauf pro Proxy-Session, keine parallelen Läufe auf dieselbe Bank.
- **Echte Profile aufnehmen:** pro Bank einmal die Antragsstrecke mit sichtbarem Browser (`HEADLESS=false`) durchgehen und die echten Selektoren in das Profil übernehmen. Dafür kommt ein Trockenlauf-Modus: Lauf startet mit `dry_run`, füllt Testdaten, macht nach jedem Schritt einen Screenshot und schreibt am Ende einen Bericht, welche Selektoren gefunden wurden und welche nicht — sichtbar unter `/admin/bots`.
- Jede Bank bleibt ein eigenes Profil; die Schritte werden pro Bank einzeln korrigiert, beginnend mit der, die du zuerst brauchst.

## 5. KI-Chat: dich als Teamleiter entlasten

Heute gibt es den öffentlichen Support-Chat (`/api/public/ai-chat`) und den Antwortvorschlag im Admin-Chat (Stil wird automatisch gelernt). Ausbaustufen:

1. **Wissensbasis statt Allgemeinplätze:** Die KI bekommt bei jeder Antwort den Kontext des Mitarbeiters (offene Aufträge, Termin, Onboarding-Status) plus eine gepflegte FAQ-Tabelle. Damit beantwortet sie „Wo finde ich meinen Auftrag?", „Wann ist mein Termin?", „Wie läuft die Legitimation?" selbstständig und korrekt.
2. **Auto-Antwort mit Freigabe:** Für erkannte Standardfragen antwortet die KI direkt im Mitarbeiter-Chat (als „Assistent" gekennzeichnet). Alles Unsichere landet als Vorschlag bei dir — ein Klick zum Senden.
3. **Eskalation nach Regeln:** Beschwerden, Kündigung, Geld/Auszahlung, Ausweisdaten → nie automatisch, immer an dich, mit Kurz-Zusammenfassung des Anliegens.
4. **Sammelantworten:** In der Chat-Übersicht zeigt die KI dir für jeden offenen Chat einen Ein-Zeilen-Vorschlag, so kannst du 20 Chats in wenigen Minuten abarbeiten.
5. **Nachtmodus:** Außerhalb deiner Zeiten antwortet die KI immer selbst („Dein Teamleiter meldet sich morgen früh") plus hilfreiche Info — keine offenen Nachrichten über Nacht.

Vorschlag: Stufe 1 + 2 + 3 zuerst, das nimmt den Großteil der Routine ab.

## Technische Details

- Neue Migration für `bot_proxies`-Prüffelder und ein `dry_run`-Flag auf `bot_runs`.
- `bot-runner/server.ts`: Proxy-Vorabtest, Captcha-Detektor, Tippsimulation, Heartbeat, Dry-Run-Bericht.
- `scripts/deploy.sh` / `scripts/setup-bot-runner.sh`: Remote-Installation über `BOT_RUNNER_HOST`.
- `src/routes/admin.bots.tsx`: Proxy-Test-Button, Ampeln, Runner-Heartbeat, Dry-Run-Start.
- KI-Chat: Kontext-Loader + Regelwerk in den bestehenden Server-Funktionen (`ai-chat-helper.functions.ts`, `api/public/ai-chat.ts`), FAQ-Tabelle mit Admin-Pflege.
