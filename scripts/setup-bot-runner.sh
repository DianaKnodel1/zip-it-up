#!/usr/bin/env bash
# Installiert/aktualisiert den Playwright Bot-Runner auf dem Portal-Server.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/apps/portal}"
RUNNER_DIR="$PROJECT_DIR/bot-runner"
ENV_FILE="$PROJECT_DIR/.env.server"
[ -f "$ENV_FILE" ] || ENV_FILE="$PROJECT_DIR/.env"

if [ ! -d "$RUNNER_DIR" ]; then
  echo "Bot-Runner-Verzeichnis fehlt: $RUNNER_DIR" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "Umgebungsdatei fehlt: $ENV_FILE" >&2
  exit 1
fi

cd "$RUNNER_DIR"

echo "==> [1/3] Abhängigkeiten installieren (kann 1-3 Minuten dauern) ..."
if ! command -v npm >/dev/null 2>&1; then
  echo "npm fehlt – installiere Node.js/npm ..."
  apt-get update
  apt-get install -y nodejs npm
fi

# Bun 1.4 kann auf frischen Servern ohne Lockdatei bei der Paketauflösung
# ohne Ausgabe hängen bleiben. npm installiert dieselben reinen JS-Pakete
# zuverlässig; ausgeführt wird der Runner anschließend weiterhin mit Bun.
if ! timeout 600 npm install --omit=dev --no-audit --no-fund --loglevel=notice; then
  echo "Abhängigkeitsinstallation nach 10 Minuten abgebrochen oder fehlgeschlagen." >&2
  echo "Bitte Netzwerk/DNS prüfen: curl -I https://registry.npmjs.org/playwright" >&2
  exit 1
fi
echo "==> Abhängigkeiten fertig."

# Browser und Systembibliotheken nur bei der ersten Installation laden.
echo "==> [2/3] Chromium laden (kann 3-8 Minuten dauern, keine Ausgabe = laeuft) ..."
if [ ! -d "${PLAYWRIGHT_BROWSERS_PATH:-/root/.cache/ms-playwright}" ]; then
  bun x playwright install --with-deps chromium
else
  bun x playwright install chromium
fi
echo "==> Chromium fertig."

echo "==> [3/3] systemd-Dienst einrichten ..."


cat > /etc/systemd/system/bot-runner.service <<EOF
[Unit]
Description=Portal Bot Runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$RUNNER_DIR
EnvironmentFile=$ENV_FILE
Environment=HEADLESS=true
Environment=REQUIRE_PROXY=true
ExecStart=/usr/local/bin/bun run server.ts
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable bot-runner.service
systemctl restart bot-runner.service

for _ in $(seq 1 15); do
  if systemctl is-active --quiet bot-runner.service; then
    echo "Bot-Runner ist aktiv."
    exit 0
  fi
  sleep 1
done

systemctl status bot-runner.service --no-pager || true
exit 1