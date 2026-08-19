#!/usr/bin/env bash
# =============================================================================
#  cleanup-duplicate-mails.sh — findet doppelt protokollierte Mail-Versände
#  (dieselbe Vorlage, derselbe Empfänger, mehrfach am selben Tag) und markiert
#  die überzähligen Zeilen als "duplicate".
#
#  Standard = NUR ANZEIGEN. Es wird nichts verändert, solange nicht --apply
#  angegeben wird. Die erste Zeile je Vorgang bleibt IMMER erhalten, die
#  Historie bleibt vollständig nachvollziehbar (Status "duplicate" statt Löschen).
#
#  Backend-Server: bash scripts/cleanup-duplicate-mails.sh --local
#                  bash scripts/cleanup-duplicate-mails.sh --local --apply
#  Portal-Server:  bash scripts/cleanup-duplicate-mails.sh
#  Direkte DB:     TARGET_DB_URL=postgres://... bash scripts/cleanup-duplicate-mails.sh
# =============================================================================
set -uo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF_FILE="$REPO_DIR/scripts/backend-server.env"
[ -f "$CONF_FILE" ] && . "$CONF_FILE"
: "${BACKEND_USER:=root}"; : "${BACKEND_DB_CONTAINER:=supabase-db}"
: "${BACKEND_DB_USER:=supabase_admin}"; : "${BACKEND_DB_NAME:=postgres}"

LOCAL=0; APPLY=0
for arg in "$@"; do
  case "$arg" in
    --local) LOCAL=1 ;;
    --apply) APPLY=1 ;;
  esac
done

if   [ -n "${TARGET_DB_URL:-}" ]; then RUNNER="url"
elif [ "$LOCAL" = "1" ];         then RUNNER="docker"
elif [ -n "${BACKEND_HOST:-}" ]; then RUNNER="ssh"
else echo "x Keine DB-Verbindung (TARGET_DB_URL, --local oder BACKEND_HOST)." >&2; exit 1; fi

sqlt() {
  local q="$1"
  case "$RUNNER" in
    url)    printf '%s\n' "$q" | psql "$TARGET_DB_URL" -At -F '|' -P pager=off 2>&1 ;;
    docker) printf '%s\n' "$q" | docker exec -i "$BACKEND_DB_CONTAINER" psql -U "$BACKEND_DB_USER" -d "$BACKEND_DB_NAME" -At -F '|' -P pager=off 2>&1 ;;
    ssh)    printf '%s\n' "$q" | ssh -o StrictHostKeyChecking=accept-new "${BACKEND_USER}@${BACKEND_HOST}" \
              "docker exec -i $BACKEND_DB_CONTAINER psql -U $BACKEND_DB_USER -d $BACKEND_DB_NAME -At -F '|' -P pager=off" 2>&1 ;;
  esac
}
hd(){ echo; echo "═══ $1 ═══"; }

echo "=============================================================="
echo " DOPPELVERSAND-BEREINIGUNG  $(date '+%Y-%m-%d %H:%M:%S')"
echo " Modus: $([ "$APPLY" = "1" ] && echo 'ÄNDERN (--apply)' || echo 'nur anzeigen')"
echo "=============================================================="

# Gruppierung: gleiche Vorlage + gleicher Empfänger + gleicher Kalendertag
# UND — sofern vorhanden — derselbe Vorgang (Termin bzw. Bewerbung).
# Dadurch gilt eine legitime Wiederholung zu einem ANDEREN Vorgang (z.B. eine
# zweite Terminbestätigung nach Umbuchung am selben Tag) nicht als Duplikat.
VORGANG="coalesce(metadata->>'appointment_id', metadata->>'application_id', '')"
GROUP="template_name, lower(recipient_email), (created_at AT TIME ZONE 'Europe/Berlin')::date, $VORGANG"
PART="PARTITION BY template_name, lower(recipient_email),
                   (created_at AT TIME ZONE 'Europe/Berlin')::date,
                   $VORGANG
      ORDER BY created_at ASC"

hd "Betroffene Empfänger (Top 40)"
sqlt "SELECT rpad(lower(recipient_email),38)||' '||rpad(coalesce(template_name,'(null)'),36)||' '||
             to_char((created_at AT TIME ZONE 'Europe/Berlin')::date,'DD.MM.YYYY')||'  x'||count(*)
        FROM email_send_log
       WHERE status = 'sent'
       GROUP BY $GROUP, recipient_email
      HAVING count(*) > 1
       ORDER BY count(*) DESC
       LIMIT 40;"

hd "Gesamtzahl überzähliger Zeilen"
sqlt "SELECT 'Gruppen mit Duplikaten: '||count(*)||'   überzählige Zeilen: '||coalesce(sum(n-1),0)
        FROM (SELECT count(*) AS n FROM email_send_log
               WHERE status='sent' GROUP BY $GROUP HAVING count(*)>1) s;"

hd "Reminder-Protokoll (application_reminder_log)"
sqlt "SELECT rpad(recipient_email,38)||' '||rpad(reminder_kind,34)||'  x'||count(*)
        FROM application_reminder_log
       WHERE status='sent'
       GROUP BY application_id, reminder_kind, recipient_email
      HAVING count(*) > 1
       ORDER BY count(*) DESC LIMIT 20;"

if [ "$APPLY" != "1" ]; then
  echo
  echo "→ Es wurde NICHTS verändert."
  echo "  Zum Markieren der überzähligen Zeilen:"
  echo "     bash scripts/cleanup-duplicate-mails.sh $([ "$LOCAL" = "1" ] && echo '--local ')--apply"
  exit 0
fi

hd "Sicherung anlegen"
sqlt "CREATE TABLE IF NOT EXISTS public.email_send_log_dedupe_backup
        (LIKE public.email_send_log INCLUDING ALL);
      INSERT INTO public.email_send_log_dedupe_backup
      SELECT * FROM public.email_send_log l
       WHERE l.status='sent'
         AND l.id IN (
           SELECT id FROM (
             SELECT id, row_number() OVER ($PART) AS rn
               FROM public.email_send_log WHERE status='sent') x
            WHERE rn > 1)
         AND NOT EXISTS (SELECT 1 FROM public.email_send_log_dedupe_backup b WHERE b.id = l.id);
      SELECT 'Gesicherte Zeilen: '||count(*) FROM public.email_send_log_dedupe_backup;"

hd "Überzählige Zeilen als 'duplicate' markieren"
sqlt "UPDATE public.email_send_log
         SET status = 'duplicate',
             error_message = coalesce(error_message,'')||' [automatisch als Doppelversand markiert]'
       WHERE status='sent'
         AND id IN (
           SELECT id FROM (
             SELECT id, row_number() OVER ($PART) AS rn
               FROM public.email_send_log WHERE status='sent') x
            WHERE rn > 1);
      SELECT 'Markierte Zeilen: '||count(*) FROM public.email_send_log WHERE status='duplicate';"

echo
echo "✓ Fertig. Sicherung liegt in public.email_send_log_dedupe_backup."
