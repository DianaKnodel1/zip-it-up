#!/usr/bin/env bash
# =============================================================================
#  check-mail-health.sh — Diagnose: Mail-System, Cron-Jobs, Reminder
# =============================================================================
#  NUR LESEND (ausschliesslich SELECT). Aendert nichts.
#
#  Verwendung:
#    A) Lokal (Repo), via SSH auf den Backend-Server:
#         bash scripts/check-mail-health.sh
#       (nutzt scripts/backend-server.env: BACKEND_HOST/USER/DB_CONTAINER)
#
#    B) Direkt AUF dem Backend-Server:
#         bash scripts/check-mail-health.sh --local
#
#    C) Mit direkter DB-URL (ueberall):
#         TARGET_DB_URL="postgresql://postgres:pw@host:5432/postgres" \
#           bash scripts/check-mail-health.sh
# =============================================================================
set -uo pipefail

MODE="${1:-}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF_FILE="$REPO_DIR/scripts/backend-server.env"
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

: "${BACKEND_USER:=root}"
: "${BACKEND_DB_CONTAINER:=supabase-db}"
: "${BACKEND_DB_USER:=postgres}"
: "${BACKEND_DB_NAME:=postgres}"

log()  { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m  ! %s\033[0m\n" "$*"; }

# --- SQL-Runner bestimmen ----------------------------------------------------
if [ -n "${TARGET_DB_URL:-}" ]; then
  RUNNER="url"
elif [ "$MODE" = "--local" ]; then
  RUNNER="docker"
elif [ -n "${BACKEND_HOST:-}" ]; then
  RUNNER="ssh"
else
  echo "✗ Keine Verbindung konfiguriert." >&2
  echo "  → entweder TARGET_DB_URL setzen," >&2
  echo "  → oder scripts/backend-server.env mit BACKEND_HOST anlegen," >&2
  echo "  → oder das Skript direkt auf dem Backend-Server mit --local starten." >&2
  exit 1
fi

sql() {
  local q="$1"
  case "$RUNNER" in
    url)    psql "$TARGET_DB_URL" -v ON_ERROR_STOP=0 -P pager=off -c "$q" 2>&1 ;;
    docker) docker exec -i "$BACKEND_DB_CONTAINER" psql -U "$BACKEND_DB_USER" -d "$BACKEND_DB_NAME" -v ON_ERROR_STOP=0 -P pager=off -c "$q" 2>&1 ;;
    ssh)    ssh -o StrictHostKeyChecking=accept-new "${BACKEND_USER}@${BACKEND_HOST}" \
              "docker exec -i $BACKEND_DB_CONTAINER psql -U $BACKEND_DB_USER -d $BACKEND_DB_NAME -v ON_ERROR_STOP=0 -P pager=off -c \"${q//\"/\\\"}\"" 2>&1 ;;
  esac
}

echo "=============================================================="
echo " Mail- & Cron-Health   ($(date '+%Y-%m-%d %H:%M:%S'))   Modus: $RUNNER"
echo "=============================================================="

# --- 1) Cron-Jobs ------------------------------------------------------------
log "1/8  Registrierte Cron-Jobs"
sql "SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;"

log "1b/8  Duplikate (muss LEER sein)"
sql "SELECT jobname, count(*) AS anzahl FROM cron.job GROUP BY jobname HAVING count(*) > 1;"

log "1c/8  Jobs mit unersetztem URL-Platzhalter (muss LEER sein)"
sql "SELECT jobname FROM cron.job WHERE command LIKE '%<SUPABASE_URL>%' OR command LIKE '%<SERVICE_ROLE_KEY>%';"

# --- 2) Letzte Laeufe --------------------------------------------------------
log "2/8  Letzte Cron-Laeufe je Job"
sql "SELECT j.jobname,
            max(d.start_time) AS letzter_lauf,
            round(extract(epoch FROM (now() - max(d.start_time)))/60) AS vor_minuten,
            count(*) FILTER (WHERE d.status <> 'succeeded' AND d.start_time > now() - interval '24 hours') AS fehler_24h
       FROM cron.job j
       LEFT JOIN cron.job_run_details d ON d.jobid = j.jobid
      GROUP BY j.jobname ORDER BY j.jobname;"

log "2b/8  Fehlgeschlagene Laeufe (letzte 24h)"
sql "SELECT j.jobname, d.start_time, d.status, left(coalesce(d.return_message,''),160) AS meldung
       FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
      WHERE d.status <> 'succeeded' AND d.start_time > now() - interval '24 hours'
      ORDER BY d.start_time DESC LIMIT 20;"

# --- 3) Vault-Secret ---------------------------------------------------------
log "3/8  Vault-Secret fuer Cron-HTTP-Calls"
sql "SELECT name,
            CASE WHEN length(decrypted_secret) > 20 THEN 'OK (' || length(decrypted_secret) || ' Zeichen)'
                 ELSE 'ZU KURZ / LEER' END AS status
       FROM vault.decrypted_secrets WHERE name = 'reminders_service_role_key';"

# --- 4) pg_net Antworten -----------------------------------------------------
log "4/8  HTTP-Antworten der Cron-Calls (pg_net, letzte 20)"
sql "SELECT id, status_code, left(coalesce(content,''),120) AS antwort, created
       FROM net._http_response ORDER BY created DESC LIMIT 20;"

# --- 5) SMTP je Mandant ------------------------------------------------------
log "5/8  SMTP-Konfiguration je Mandant"
sql "SELECT id, name,
            coalesce(smtp_host,'—') AS host,
            smtp_port AS port,
            CASE WHEN coalesce(smtp_username,'') = '' THEN 'FEHLT' ELSE 'gesetzt' END AS smtp_user,
            CASE WHEN coalesce(smtp_password,'') = '' THEN 'FEHLT' ELSE 'gesetzt' END AS smtp_pass,
            emails_paused,
            coalesce(smtp_health_status,'—') AS health,
            coalesce(sender_email,'—') AS absender
       FROM tenants ORDER BY name;"

# --- 6) Mail-Versand ---------------------------------------------------------
log "6/8  E-Mail-Versand nach Status (letzte 24h / 7 Tage)"
sql "SELECT status,
            count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS letzte_24h,
            count(*) FILTER (WHERE created_at > now() - interval '7 days')  AS letzte_7t
       FROM email_send_log GROUP BY status ORDER BY status;"

log "6b/8  Versand je Template (letzte 7 Tage)"
sql "SELECT template_name, count(*) AS anzahl, max(created_at) AS zuletzt
       FROM email_send_log WHERE created_at > now() - interval '7 days'
      GROUP BY template_name ORDER BY zuletzt DESC LIMIT 30;"

log "6c/8  Fehlerhafte Sends (letzte 24h, sollte leer sein)"
sql "SELECT recipient_email, template_name, status, left(coalesce(error_message,''),140) AS fehler, created_at
       FROM email_send_log
      WHERE status IN ('failed','dlq','bounced') AND created_at > now() - interval '24 hours'
      ORDER BY created_at DESC LIMIT 30;"

log "6d/8  Geblockte Empfaenger (suppressed_emails)"
sql "SELECT source, reason, count(*) FROM suppressed_emails GROUP BY source, reason ORDER BY count(*) DESC LIMIT 20;"

# --- 7) Reminder-Ketten ------------------------------------------------------
log "7/8  Application-Reminder (letzte 7 Tage)"
sql "SELECT reminder_kind, status, count(*) AS anzahl, max(sent_at) AS zuletzt
       FROM application_reminder_log WHERE sent_at > now() - interval '7 days'
      GROUP BY reminder_kind, status ORDER BY zuletzt DESC;"

log "7b/8  Termin-Reminder (letzte 7 Tage)"
sql "SELECT status, count(*) AS anzahl, max(sent_at) AS zuletzt
       FROM appointment_reminder_log WHERE sent_at > now() - interval '7 days' GROUP BY status;"

log "7d/8  Erinnerungen letzte 24h: Ergebnis inkl. Blockade-Grund"
sql "SELECT template_name, status,
            coalesce(metadata->>'skip_reason','-') AS grund,
            count(*) AS anzahl, max(created_at) AS zuletzt
       FROM email_send_log
      WHERE created_at > now() - interval '24 hours'
      GROUP BY template_name, status, grund
      ORDER BY zuletzt DESC LIMIT 40;"

log "7c/8  Offene Invite-Resend-Queue"
sql "SELECT status, count(*), min(created_at) AS aeltester
       FROM invite_resend_queue GROUP BY status ORDER BY status;"

# --- 8) Datenlage ------------------------------------------------------------
log "7e/8  Schutz-Indizes gegen Doppelversand (muessen ALLE vorhanden sein)"
sql "SELECT i.want AS index_name,
            CASE WHEN c.relname IS NULL THEN 'FEHLT — scripts/migrate.sh ausfuehren!' ELSE 'ok' END AS status
       FROM (VALUES
              ('email_send_log_unique_active_event'),
              ('email_send_log_no_duplicate_sent'),
              ('applications_tenant_email_unique')
            ) AS i(want)
       LEFT JOIN pg_class c ON c.relname = i.want AND c.relkind = 'i'
      ORDER BY 2 DESC, 1;"

log "8/8  Datenbasis (gibt es ueberhaupt Kandidaten fuer Reminder?)"
sql "SELECT (SELECT count(*) FROM tenants)                              AS mandanten,
            (SELECT count(*) FROM applications)                         AS bewerbungen,
            (SELECT count(*) FROM applications WHERE tenant_id IS NULL) AS bewerbungen_ohne_mandant,
            (SELECT count(*) FROM interview_appointments WHERE starts_at > now()) AS kommende_termine;"

echo
echo "=============================================================="
echo " Fertig. Bitte die komplette Ausgabe zurueckschicken."
echo "=============================================================="
