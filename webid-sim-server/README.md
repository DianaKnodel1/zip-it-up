# WebID-Simulationsumgebung

Transparenter Reverse-Proxy vor `webid-gateway.de` (oder anderer konfigurierter
Origin) mit fest eingeblendeten Simulations-Kennzeichnungen. Nur für interne
Awareness- und Schulungszwecke.

## Prinzip

```
https://webid.uwk-consulting.de/service/status/cn/000631/aid/620631658
          │
          ▼  Bun-Proxy (127.0.0.1:3002)
          │
          ▼  https://webid-gateway.de/service/status/cn/000631/aid/620631658
```

Domain wird 1:1 gegen die Original-URL ausgetauscht, Pfad und Query bleiben.
HTML wird gestreamt, das Simulations-Overlay wird server-seitig injiziert.

## Sichtbare Kennzeichnungen

- Topbar (nicht ausblendbar, hoher Kontrast)
- Hinweis-Popup beim ersten Aufruf (Session)
- Titel-Präfix `[SIMULATION]`
- Logo unten rechts
- Ersetztes Favicon

## Sicherheitsleitplanken (Defaults)

- POST-Requests werden geblockt (keine echten Submits an WebID).
  Auf Wunsch pro Domain aktivierbar (`allow_submit`).
- Nur Whitelist-Pfade (`/service/*`, Assets); alles andere → 404.
- Rate-Limit pro IP.
- `X-Robots-Tag: noindex, nofollow`.
- Kein Logging von Bodies/Query-Strings.

## Umgebungsvariablen

```
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
PORT=3002
ACME_EMAIL=admin@example.com
DEFAULT_TARGET_ORIGIN=https://webid-gateway.de   # optional
```

## Deployment

Analog `landing-server/`:

```
bash webid-sim-server/setup.sh
```

Domains werden im Portal unter `/admin/webid-sim` gepflegt.
