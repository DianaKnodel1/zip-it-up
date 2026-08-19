# Bot-Runner

Eigener Dienst, der Bot-Läufe aus der Queue (`bot_runs`) abarbeitet.
Läuft **nicht** im Portal-Worker, sondern als Bun-Prozess mit Playwright.

## Installation (Portal-Server)

```bash
cd /opt/apps/portal/bot-runner
bun install
bunx playwright install --with-deps chromium
```

## Start

```bash
SUPABASE_URL=https://<backend-host> \
SERVICE_ROLE_KEY=<service-role-key> \
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
Environment=SUPABASE_URL=https://<backend-host>
Environment=SERVICE_ROLE_KEY=<service-role-key>
Environment=HEADLESS=true
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

Platzhalter kommen aus `input_data` (Profildaten des Mitarbeiters) und
`credentials` (u. a. das generierte `{{password}}`).
`"optional": true` überspringt einen Schritt, wenn das Element fehlt.

## Grenzen

Captchas, VideoIdent/PostIdent, photoTAN und SMS-TAN werden **nicht**
automatisiert. Dafür ist der `handoff`-Schritt da: Der Lauf geht auf
`waiting_admin`, ein Admin übernimmt ihn unter `/admin/bots`.