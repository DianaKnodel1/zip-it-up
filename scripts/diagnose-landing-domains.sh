#!/usr/bin/env bash
# Prüft für einzelne Landing-Domains, ob sie in der Datenbank sauber
# hinterlegt sind (Theme, Server, Status) und ob der Landing-Server antwortet.
#
# Aufruf:  scripts/diagnose-landing-domains.sh bv-agentur.com mm-personalvermittlung.de
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.server ] && set -a && . ./.env.server && set +a
: "${TARGET_DB_URL:?TARGET_DB_URL fehlt (in .env.server eintragen)}"

DOMAINS=("$@")
[ ${#DOMAINS[@]} -eq 0 ] && { echo "Bitte mindestens eine Domain angeben."; exit 1; }

for D in "${DOMAINS[@]}"; do
  echo "──────────────────────────────────────────────"
  echo "▸ $D"
  psql "$TARGET_DB_URL" -X -q -v d="$D" <<'SQL'
SELECT lp.domain, lp.slug, lp.theme_id, lp.status, lp.published_at,
       lp.server_id, ls.name AS server_name, ls.ip_address, ls.last_heartbeat_at
  FROM public.landing_pages lp
  LEFT JOIN public.landing_servers ls ON ls.id = lp.server_id
 WHERE lp.domain = :'d';
SQL
  echo "  HTTP: $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$D/" || echo 'keine Antwort')"
done
echo "──────────────────────────────────────────────"
echo "Leere Ausgabe = Domain existiert nicht in landing_pages."
echo "theme_id leer  = Theme fehlt → Seite im Generator erneut veröffentlichen."
echo "server_id leer = keinem Server zugewiesen → Seite erneut veröffentlichen."
