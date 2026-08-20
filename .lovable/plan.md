# Server-Setup-Anleitung finalisieren

Ziel: `docs/SERVER-SETUP.md` wird zu einer Copy-Paste-fähigen, Schritt-für-Schritt-Anleitung für den WebID-Server und den Bot-Server, abgestimmt auf die gewählten Server-Spezifikationen.

## Ausgangslage

- Vorhanden: `docs/SERVER-SETUP.md` (Rohfassung), `scripts/setup-bot-runner.sh`, `webid-sim-server/setup.sh`, `bot-runner/README.md`.
- Gewählte Servergrößen:
  - **WebID-Server:** Cloud M (2 vCPU / 4 GB RAM)
  - **Bot-Server:** Cloud L (3 vCPU / 6 GB RAM / 80 GB NVMe)
  - Betriebssystem: **Ubuntu 22.04 LTS oder 24.04 LTS** auf beiden Servern (beide getestet, 22.04 als primäre Empfehlung).

## Lieferumfang

### 1. WebID-Server (Cloud M)

- DNS: A-Records für jede Simulationsdomain auf die WebID-IP setzen.
- Grundabsicherung: SSH-Key statt Passwort, Firewall (nur 22/80/443 eingehend, alles andere raus).
- Installation: `git clone`, `.env` mit `SUPABASE_URL` und `SUPABASE_PUBLISHABLE_KEY`, `bash webid-sim-server/setup.sh`.
- Prüfung: `curl http://127.0.0.1:3002/_health`, `systemctl status webid-sim caddy`.
- Update-Prozess: `git pull` + Neustart der Services.

### 2. Bot-Server (Cloud L)

- Grundabsicherung: SSH-Key, Firewall (nur SSH ausgehend/incoming, kein eingehender Webverkehr nötig).
- Standalone-fähige Installation: `git clone`, `bash scripts/setup-bot-runner.sh` (Bun + Playwright + Chromium-Deps + systemd-Service).
- `.env.server` mit `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `HEADLESS=true`, `REQUIRE_PROXY=true`.
- Proxy-Zwang: ohne aktiven Proxy startet kein Lauf.
- Prüfung: `systemctl status bot-runner`, `journalctl -u bot-runner -f`.
- Update-Prozess: `git pull` + `bash scripts/setup-bot-runner.sh`.

### 3. Häufige Fehler

Tabelle mit Symptomen, Ursachen und Lösungen (z.B. `bun: command not found`, fehlende Caddy-Zertifikate, Playwright-Deps, Proxy fehlt, Service not found).

### 4. Skript-Anpassung

- `scripts/setup-bot-runner.sh` so erweitern, dass es auf einem frischen, leeren Server ohne manuelle Vorarbeit läuft (Bun installieren, Repo-Pfad konfigurierbar, `PROJECT_DIR` per ENV überschreibbar).
- `docs/SERVER-SETUP.md` ersetzt/ergänzt die vorhandene Rohfassung vollständig.

## Technische Details

- Keine Änderungen am Portal-Frontend, Backend-Migrationen oder Datenbank erforderlich.
- Keine Änderungen an der Bot-Runner-Logik selbst (nur Setup/Installations-Routine).
- Nach dem Deploy muss der Landing-Server **nicht** neu gestartet werden (nur bei Theme-Änderungen).

## Abgrenzung

- Backup/Disaster-Recovery ist bereits in `docs/DISASTER-RECOVERY.md` abgedeckt und wird hier nicht wiederholt.
- Die Bot-Runner-DSL und -Sicherheitsregeln (Captcha/VideoIdent-Handoff) bleiben unverändert.
