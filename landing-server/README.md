# Landing-Server (Server 1)

Hostet **alle Landing Pages** dynamisch aus der DB. Keine ZIPs, kein FTP, kein
manueller Server-Setup pro Kunde.

## Wie es funktioniert

```
Request kunde.de:443
        │
        ▼
   Caddy  ── on_demand_tls ──►  /_internal/ask?domain=kunde.de  (Bun, 127.0.0.1:3001)
        │                       └─► SELECT 1 FROM landing_pages WHERE domain=$1 AND is_published
        │
        ▼  (Cert holen, falls Domain bekannt)
   Caddy reverse_proxy ──►  Bun-Renderer (127.0.0.1:3001)
                            └─► liest Theme + Branding + Slots aus DB
                            └─► rendert HTML/CSS/JS, liefert aus
```

## Erst-Setup auf einer frischen Linux-Kiste (Server 1)

```bash
ssh root@<server-1-ip>
git clone <dieses-repo>
cd <repo>/landing-server

# .env aus den self-hosted Supabase-Daten setzen
export SUPABASE_URL=https://supabase.deine-domain.de
export SUPABASE_PUBLISHABLE_KEY=eyJ...                # anon/publishable key
export PORTAL_API_ENDPOINT=https://mb-portal.com/api/public/applications
export ACME_EMAIL=admin@mb-portal.com                 # für Let's Encrypt
export LANDING_SERVER_TOKEN=<Token aus /admin/infrastructure>

bash setup.sh
```

## Warum steht mein Server im Portal auf "offline"?

Der Landing-Renderer meldet sich nicht von selbst. Das macht der
**Heartbeat-Agent** (`agent.js`, systemd-Unit `landing-agent.service`): er
pingt minütlich `/api/public/landing-server-heartbeat` mit dem Bootstrap-Token
des Servers. Ohne Token bzw. ohne laufenden Agent bleibt `last_heartbeat_at`
leer und die Infrastruktur-Seite zeigt nach 5 Minuten "Offline" — auch wenn die
Landing Pages einwandfrei ausgeliefert werden.

Nachrüsten auf einem bestehenden Server:

```bash
cd /opt/apps/landing-server
echo 'LANDING_SERVER_TOKEN=<Token aus /admin/infrastructure>' >> .env
systemctl enable --now landing-agent
journalctl -u landing-agent -f
```

Der Agent meldet zusätzlich, ob der Renderer gesund ist, und führt den
Theme-Resync aus, wenn er im Portal angefordert wurde. Themes, Assets und
Landing-Daten holt der Renderer ohnehin live vom Portal bzw. aus der DB — der
Resync ist deshalb nur ein Cache-Flush (`POST /_internal/flush`, nur lokal
erreichbar); schlägt er fehl, startet der Agent `landing.service` neu.

Das war's. Setup installiert Bun + Caddy, legt systemd-Services `landing.service`
und `caddy.service` an, schreibt Caddyfile und startet alles.

## Workflow danach

1. **Admin im Portal** → "Neue Landing" → Domain z.B. `digital-dgigmbh.com` → Save.
2. **Kunde** setzt A-Record `digital-dgigmbh.com → <IP Server 1>`.
3. Erster Request → Caddy holt SSL automatisch → Seite ist live.

## Lokal testen

```bash
cd landing-server
bun install
SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... PORT=3001 bun run server.ts
curl -H "Host: digital-dgigmbh.com" http://127.0.0.1:3001/
```

## Updates ausrollen

```bash
ssh root@<server-1>
cd /opt/apps/landing-server && git pull && bun install
systemctl restart landing
```

## Was hier NICHT lebt

- Bewerbungs-Endpoint (`/api/public/applications`) → läuft weiterhin auf Server 2 (Portal).
- DB & Auth → Server 3 (Supabase).
- Tenant-Resolution / Mitarbeiter-Portal → Server 2.
