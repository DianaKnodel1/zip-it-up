#!/usr/bin/env bash
# =============================================================================
#  fix-domain-health-cron.sh — behebt die 401-Antworten der Domain-Health-Crons
# =============================================================================
#  Ursache: die beiden Cron-Jobs rufen
#     https://mb-portal.com/api/public/domain-health-cron?key=<CRON_SECRET>
#  auf. Steht dort noch der Platzhalter (oder ein falscher Wert), antwortet das
#  Portal mit 401 Unauthorized.
#
#  Verwendung (Portal-Server):
#     CRON_SECRET="dein_secret" bash scripts/fix-domain-health-cron.sh
#  Ohne Angabe wird CRON_SECRET aus /opt/apps/portal/.env.server bzw. .env gelesen.
#  Optional: PORTAL_COM / PORTAL_DE überschreiben die Domains.
# =============================================================================
set -uo pipefail

MODE="${1:-}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF_FILE="$REPO_DIR/scripts/backend-server.env"
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

: "${BACKEND_USER:=root}"
: "${BACKEND_DB_CONTAINER:=supabase-db}"
: "${BACKEND_DB_USER:=supabase_admin}"
: "${BACKEND_DB_NAME:=postgres}"
: "${PORTAL_COM:=mb-portal.com}"
: "${PORTAL_DE:=mb-portal.de}"

# CRON_SECRET ggf. aus Env-Dateien lesen
if [ -z "${CRON_SECRET:-}" ]; then
  for f in "$REPO_DIR/.env.server" "$REPO_DIR/.env"; do
    [ -f "$f" ] || continue
    val="$(grep -E '^CRON_SECRET=' "$f" | tail -1 | cut -d= -f2- | tr -d '"'"'"'')"
    [ -n "$val" ] && CRON_SECRET="$val" && break
  done
fi

if [ -z "${CRON_SECRET:-}" ] || [ "${CRON_SECRET}" = "<CRON_SECRET>" ]; then
  echo "✗ CRON_SECRET fehlt."
  echo "  → In /opt/apps/portal/.env.server eintragen (gleicher Wert wie im Portal-Prozess):"
  echo "      CRON_SECRET=\"<langer_zufallswert>\""
  echo "  → Danach das Portal neu deployen (sudo scripts/deploy.sh) und dieses Skript erneut starten."
  exit 1
fi

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }

if [ -n "${TARGET_DB_URL:-}" ]; then RUNNER="url"
elif [ "$MODE" = "--local" ]; then RUNNER="docker"
elif [ -n "${BACKEND_HOST:-}" ]; then RUNNER="ssh"
else echo "✗ Keine Verbindung konfiguriert (TARGET_DB_URL, --local oder BACKEND_HOST)." >&2; exit 1; fi

sql() {
  local q="$1"
  case "$RUNNER" in
    url)    printf '%s\n' "$q" | psql "$TARGET_DB_URL" -v ON_ERROR_STOP=0 -P pager=off 2>&1 ;;
    docker) printf '%s\n' "$q" | docker exec -i "$BACKEND_DB_CONTAINER" psql -U "$BACKEND_DB_USER" -d "$BACKEND_DB_NAME" -v ON_ERROR_STOP=0 -P pager=off 2>&1 ;;
    ssh)    printf '%s\n' "$q" | ssh -o StrictHostKeyChecking=accept-new "${BACKEND_USER}@${BACKEND_HOST}" \
              "docker exec -i $BACKEND_DB_CONTAINER psql -U $BACKEND_DB_USER -d $BACKEND_DB_NAME -v ON_ERROR_STOP=0 -P pager=off" 2>&1 ;;
  esac
}

echo "=============================================================="
echo " Domain-Health-Cron-Reparatur   Modus: $RUNNER"
echo "=============================================================="

log "0/3  Portal-Endpunkt direkt testen"
code_com=$(curl -s -o /dev/null -w '%{http_code}' "https://${PORTAL_COM}/api/public/domain-health-cron?key=${CRON_SECRET}")
echo "  https://${PORTAL_COM} → HTTP $code_com"
if [ "$code_com" = "401" ]; then
  echo "  ! Das Portal kennt dieses Secret nicht. Setze CRON_SECRET in .env.server und deploye neu."
  echo "    Abbruch — sonst schreiben wir wieder ein falsches Secret in den Cron."
  exit 1
fi

log "1/3  Alte Jobs entfernen"
sql "DO \$do\$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job
   WHERE jobname IN ('domain-health-cron','domain-health-cron-com','domain-health-cron-de');
END
\$do\$;"

log "2/3  Jobs mit echtem Secret neu anlegen"
sql "SELECT cron.schedule('domain-health-cron-com','*/5 * * * *',
  \$job\$ SELECT net.http_get(url := 'https://${PORTAL_COM}/api/public/domain-health-cron?key=${CRON_SECRET}', timeout_milliseconds := 30000); \$job\$);"
sql "SELECT cron.schedule('domain-health-cron-de','2-59/5 * * * *',
  \$job\$ SELECT net.http_get(url := 'https://${PORTAL_DE}/api/public/domain-health-cron?key=${CRON_SECRET}', timeout_milliseconds := 30000); \$job\$);"

log "3/3  Kontrolle"
sql "SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'domain-health%' ORDER BY jobname;"
sql "SELECT jobname FROM cron.job WHERE command LIKE '%<CRON_SECRET>%';"

echo
echo "Fertig. Die letzte Abfrage muss LEER sein."
echo "In ~6 Min pruefen: bash scripts/check-mail-health.sh  → keine 401 mehr in Schritt 4/8."
