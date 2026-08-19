# Bot-Runner

Eigener Dienst, der Bot-Läufe aus der Queue (`bot_runs`) abarbeitet.
Läuft **nicht** im Portal-Worker, sondern als Bun-Prozess mit Playwright.

## Installation (Portal-Server)

```bash
cd /opt/apps/portal
bash scripts/setup-bot-runner.sh
```

## Start

```bash
SUPABASE_URL=https://<backend-host> \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
HEADLESS=true \
bun run server.ts
```

Als systemd-Dienst (`/etc/systemd/system/bot-runner.service`):

```ini
[Unit]
Description=Portal Bot Runner
After=network.target

[Service]
WorkingDirectory=/opt/apps/portal/bot-runner
EnvironmentFile=/opt/apps/portal/.env.server
Environment=HEADLESS=true
Environment=REQUIRE_PROXY=true
ExecStart=/usr/local/bin/bun run server.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now bot-runner
journalctl -u bot-runner -f
```

## Schritt-DSL

Ein Profil besteht aus einer Liste von Schritten:

```json
[
  { "action": "goto",  "value": "https://example.com/registrierung", "label": "Startseite" },
  { "action": "fill",  "selector": "#firstname", "value": "{{first_name}}" },
  { "action": "fill",  "selector": "#password",  "value": "{{password}}" },
  { "action": "click", "selector": "button[type=submit]" },
  { "action": "wait",  "selector": "#confirmation", "timeout": 30000 },
  { "action": "screenshot" },
  { "action": "handoff", "label": "VideoIdent muss manuell durchgeführt werden" }
]
```

Mit `{"action":"advance","value":"10"}` folgt der Runner begrenzt den üblichen
Weiter-/Bestätigen-Schaltflächen bis zur Bestätigung oder Legitimation. Mit
`{"action":"extract","selector":"body","pattern":"Vorgangsnummer..."}` liest der
Runner die von der Bank erzeugte Vorgangsnummer aus und speichert sie am Lauf und Auftrag.

Platzhalter kommen aus `input_data` (Profildaten des Mitarbeiters) und
`credentials` (u. a. das generierte `{{password}}`).
`"optional": true` überspringt einen Schritt, wenn das Element fehlt.

## Grenzen

Captchas, VideoIdent/PostIdent, photoTAN und SMS-TAN werden **nicht**
automatisiert. Dafür ist der `handoff`-Schritt da: Der Lauf geht auf
`waiting_admin`, ein Admin übernimmt ihn unter `/admin/bots`.