#!/usr/bin/env bash
# =============================================================================
#  fix-mail-crons.sh — repariert die Mail-/Reminder-Crons auf dem Backend
# =============================================================================
#  Behebt:
#    1) Cron-Jobs mit unersetztem <SUPABASE_URL>-Platzhalter → echte URL
#    2) Doppelt registrierten Job send-reminders-hourly (kaputtes Duplikat weg)
#    3) Fehlende Spalte tenants.smtp_health_status
#
#  Verwendung (vom Portal-Server aus, nutzt scripts/backend-server.env):
#      bash scripts/fix-mail-crons.sh
#  Direkt auf dem Backend-Server:
#      bash scripts/fix-mail-crons.sh --local
#  Mit direkter DB-URL:
#      TARGET_DB_URL="postgresql://..." bash scripts/fix-mail-crons.sh
#
#  Ziel-URL überschreibbar:  API_URL="https://api.mb-portal.com" bash ...
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
: "${API_URL:=https://api.mb-portal.com}"

# Host ohne Schema — die Cron-Kommandos bauen 'https://<SUPABASE_URL>/functions/v1/...'
API_HOST="${API_URL#https://}"
API_HOST="${API_HOST#http://}"
API_HOST="${API_HOST%/}"

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }

if [ -n "${TARGET_DB_URL:-}" ]; then RUNNER="url"
elif [ "$MODE" = "--local" ]; then RUNNER="docker"
elif [ -n "${BACKEND_HOST:-}" ]; then RUNNER="ssh"
else
  echo "✗ Keine Verbindung konfiguriert (TARGET_DB_URL, --local oder BACKEND_HOST)." >&2
  exit 1
fi

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
echo " Mail-Cron-Reparatur   Ziel-Host: $API_HOST   Modus: $RUNNER"
echo "=============================================================="

# --- 1) Kaputte/duplizierte Mail-Crons entfernen -----------------------------
log "1/4  Kaputte/Duplikat-Jobs entfernen"
sql "DO \$\$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT jobid, jobname FROM cron.job
     WHERE jobname IN (
       'send-reminders-hourly',
       'send-appointment-reminders',
       'send-application-reminders',
       'process-invite-resend-queue',
       'email-retry-queue'
     )
  LOOP
    BEGIN
      PERFORM cron.unschedule(r.jobid);
      RAISE NOTICE 'entfernt: % (jobid %)', r.jobname, r.jobid;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'konnte % (jobid %) nicht entfernen: %', r.jobname, r.jobid, SQLERRM;
    END;
  END LOOP;
END\$\$;"

# --- 2) Jobs sauber neu anlegen ---------------------------------------------
log "2/4  Mail-/Reminder-Crons mit echtem Host neu anlegen"
sql "CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO \$\$
DECLARE k text;
BEGIN
  SELECT decrypted_secret INTO k
    FROM vault.decrypted_secrets
   WHERE name = 'reminders_service_role_key'
   LIMIT 1;

  IF k IS NULL OR length(k) < 20 THEN
    RAISE EXCEPTION 'Vault secret reminders_service_role_key fehlt oder ist leer.';
  END IF;
END\$\$;

SELECT cron.schedule(
  'send-reminders-hourly',
  '15 * * * *',
  \$CRON\$
  SELECT net.http_post(
    url := 'https://${API_HOST}/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reminders_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  \$CRON\$
);

SELECT cron.schedule(
  'send-appointment-reminders',
  '*/10 * * * *',
  \$CRON\$
  SELECT net.http_post(
    url := 'https://${API_HOST}/functions/v1/send-appointment-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reminders_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  \$CRON\$
);

SELECT cron.schedule(
  'send-application-reminders',
  '*/30 * * * *',
  \$CRON\$
  SELECT net.http_post(
    url := 'https://${API_HOST}/functions/v1/send-application-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reminders_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  \$CRON\$
);

SELECT cron.schedule(
  'process-invite-resend-queue',
  '*/15 * * * *',
  \$CRON\$
  SELECT net.http_post(
    url := 'https://${API_HOST}/functions/v1/process-invite-resend-queue',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reminders_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  \$CRON\$
);

-- Automatischer Nachversand: holt Mails nach, die wegen einer vorübergehenden
-- Störung (SMTP-Timeout, Stundenlimit, Mail-Pause, Sendefenster) liegen blieben.
SELECT cron.schedule(
  'email-retry-queue',
  '*/10 * * * *',
  \$CRON\$
  SELECT net.http_post(
    url := 'https://${API_HOST}/functions/v1/email-resend',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reminders_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{\"retry_queue\": true, \"limit\": 40}'::jsonb,
    timeout_milliseconds := 120000
  );
  \$CRON\$
);"

# --- 3) Fehlende Spalte ------------------------------------------------------
log "3/4  tenants.smtp_health_status sicherstellen"
sql "ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS smtp_health_status text;
     NOTIFY pgrst, 'reload schema';"

# --- 4) Kontrolle ------------------------------------------------------------
log "4/4  Kontrolle"
sql "SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;"
sql "SELECT jobname, count(*) AS anzahl FROM cron.job GROUP BY jobname HAVING count(*) > 1;"
sql "SELECT jobname FROM cron.job WHERE command LIKE '%<SUPABASE_URL>%' OR command LIKE '%<SERVICE_ROLE_KEY>%';"

echo
echo "Fertig. Die beiden letzten Abfragen muessen LEER sein."
echo "Danach ca. 30 Min warten und 'bash scripts/check-mail-health.sh' erneut laufen lassen."