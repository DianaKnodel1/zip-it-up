# Server-Setup: WebID-Server und Bot-Server

Zwei getrennte Server, je ein Dienst. Beide laufen unabhängig vom Portal-Server.

| Server | Zweck | Empfehlung |
|---|---|---|
| WebID-Server | Simulations-Proxy für die Legitimation (`webid-sim-server`) | 2 vCPU, 4 GB RAM, Ubuntu 22.04/24.04 |
| Bot-Server | Playwright-Bot-Runner (`bot-runner`) | 4 vCPU, 8 GB RAM, 40 GB SSD, Ubuntu 22.04/24.04 |

Beide Server brauchen Root-Zugang (SSH) und ausgehendes Internet.

---

## 1. WebID-Server

### 1.1 DNS
Für jede Simulationsdomain einen A-Record auf die IP des WebID-Servers setzen.

### 1.2 Installation
```bash
ssh root@<WEBID-SERVER-IP>
apt-get update && apt-get install -y git curl
git clone https://github.com/DianaKnodel1/zip-it-up.git /opt/src/portal
cd /opt/src/portal/webid-sim-server

SUPABASE_URL=https://<backend-host> \
SUPABASE_PUBLISHABLE_KEY=<anon-key> \
ACME_EMAIL=admin@<deine-domain> \
bash setup.sh
```

Das Skript installiert Bun + Caddy, legt `/opt/apps/webid-sim` an, schreibt `.env`,
startet `webid-sim.service` (127.0.0.1:3002) und Caddy mit automatischem HTTPS.

### 1.3 Prüfen
```bash
curl http://127.0.0.1:3002/_health      # -> ok
systemctl status webid-sim caddy --no-pager
journalctl -u webid-sim -f
```

### 1.4 Im Portal
`/admin/webid-sim` öffnen, Domain anlegen, DNS auf diesen Server zeigen lassen.
Beim ersten Aufruf holt Caddy das Zertifikat automatisch (on-demand TLS).

### 1.5 Updates
```bash
cd /opt/src/portal && git pull
cd webid-sim-server && cp -a . /opt/apps/webid-sim/ && systemctl restart webid-sim
```

---

## 2. Bot-Server

### 2.1 Installation
```bash
ssh root@<BOT-SERVER-IP>
apt-get update && apt-get install -y git curl unzip
curl -fsSL https://bun.sh/install | bash && ln -sf /root/.bun/bin/bun /usr/local/bin/bun

git clone https://github.com/DianaKnodel1/zip-it-up.git /opt/apps/portal
cd /opt/apps/portal

cat > /opt/apps/portal/.env.server <<'EOF'
SUPABASE_URL=https://<backend-host>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
EOF
chmod 600 /opt/apps/portal/.env.server

bash scripts/setup-bot-runner.sh
```

Das Skript installiert die Abhängigkeiten, lädt Chromium inkl. Systembibliotheken,
schreibt `/etc/systemd/system/bot-runner.service` und startet den Dienst.

### 2.2 Prüfen
```bash
systemctl status bot-runner --no-pager
journalctl -u bot-runner -f
```
Im Log muss `polling bot_runs` bzw. ein Lauf-Start erscheinen. Danach im Portal
unter `/admin/bots` einen Lauf starten — der Status wechselt von
„In Warteschlange" auf „Läuft".

### 2.3 Proxy (Pflicht)
`REQUIRE_PROXY=true` ist gesetzt: ohne aktiven Proxy startet kein Lauf.
Proxys im Portal unter `/admin/bots` hinterlegen und dort mit „Proxy testen" prüfen.

### 2.4 Updates
```bash
cd /opt/apps/portal && git pull && bash scripts/setup-bot-runner.sh
```

---

## 3. Häufige Fehler

| Symptom | Ursache / Lösung |
|---|---|
| `Unit bot-runner.service could not be found` | `scripts/setup-bot-runner.sh` wurde noch nicht ausgeführt |
| Lauf bleibt „In Warteschlange" | Bot-Runner-Dienst läuft nicht oder kein aktiver Proxy hinterlegt |
| `bun: command not found` | Bun installieren und nach `/usr/local/bin/bun` verlinken |
| Caddy-Zertifikat fehlt | DNS zeigt noch nicht auf den WebID-Server, Port 80/443 offen? |
| Playwright-Fehler zu fehlenden Bibliotheken | `bunx playwright install --with-deps chromium` erneut ausführen |
