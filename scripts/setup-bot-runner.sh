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
# Node.js 18 ist auf Ubuntu 22.04 Standard, Playwright braucht >= 20.
# Wir installieren Node.js 22 von Nodesource.
if ! node -v | grep -qE "v(2[0-9])" >/dev/null 2>&1; then
  echo "Node.js Version veraltet oder fehlt – installiere Node.js 22 ..."
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install nodejs -y
fi

if ! timeout 600 npm install --omit=dev --no-audit --no-fund --loglevel=notice; then
  echo "Abhängigkeitsinstallation nach 10 Minuten abgebrochen oder fehlgeschlagen." >&2
  echo "Bitte Netzwerk/DNS prüfen: curl -I https://registry.npmjs.org/playwright" >&2
  exit 1
fi
echo "==> Abhängigkeiten fertig."

# Browser und Systembibliotheken nur bei der ersten Installation laden.
echo "==> [2/3] Chromium laden (kann 3-8 Minuten dauern, keine Ausgabe = laeuft) ..."
if [ ! -d "${PLAYWRIGHT_BROWSERS_PATH:-/root/.cache/ms-playwright}" ]; then
  npx playwright install --with-deps chromium
else
  npx playwright install chromium
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
ExecStart=/usr/bin/npm start
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