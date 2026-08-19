#!/usr/bin/env bash
# =============================================================================
#  diagnose-duplicates.sh — beantwortet zwei Fragen, ohne irgendetwas zu ändern:
#    1) Welche Mails gingen doppelt raus und WARUM (anderer Vorgang, Handversand
#       oder echter Code-Fehler)?
#    2) Warum haben einzelne Bewerber gar keine Mail bekommen?
#
#  NUR LESEND. Verschickt nichts, ändert nichts.
#
#  Backend-Server: bash scripts/diagnose-duplicates.sh --local
#  Portal-Server:  bash scripts/diagnose-duplicates.sh
#  Direkte DB:     TARGET_DB_URL=postgres://... bash scripts/diagnose-duplicates.sh
# =============================================================================
set -uo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF_FILE="$REPO_DIR/scripts/backend-server.env"
[ -f "$CONF_FILE" ] && . "$CONF_FILE"
: "${BACKEND_USER:=root}"; : "${BACKEND_DB_CONTAINER:=supabase-db}"
: "${BACKEND_DB_USER:=supabase_admin}"; : "${BACKEND_DB_NAME:=postgres}"
: "${DAYS:=7}"
LOCAL=0; [ "${1:-}" = "--local" ] && LOCAL=1
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

VORGANG="coalesce(metadata->>'application_id', metadata->>'appointment_id', '')"
TRIGGER="coalesce(metadata->>'trigger', case when metadata->>'manual_send' = 'true' then 'manual' else 'cron' end)"

echo "=============================================================="
echo " DOPPELVERSAND- UND ZUSTELL-DIAGNOSE  $(date '+%Y-%m-%d %H:%M:%S')"
echo " Zeitraum: letzte $DAYS Tage  ·  rein lesend"
echo "=============================================================="

hd "1) Doppelgruppen mit Einstufung"
sqlt "
WITH base AS (
  SELECT template_name,
         lower(recipient_email) AS rcpt,
         $VORGANG AS vorgang,
         $TRIGGER AS ausloeser,
         created_at
    FROM email_send_log
   WHERE status = 'sent'
     AND created_at > now() - interval '$DAYS days'
), grp AS (
  SELECT template_name, rcpt,
         count(*) AS mails,
         count(DISTINCT nullif(vorgang,'')) AS vorgaenge,
         count(*) FILTER (WHERE ausloeser = 'manual') AS handversand,
         max(created_at) AS letzte,
         min(created_at) AS erste
    FROM base
   GROUP BY 1,2
  HAVING count(*) > 1
)
SELECT rpad(rcpt,36)||' '||rpad(template_name,38)||' x'||mails
       ||'  | '||CASE
            WHEN vorgaenge >= mails THEN 'ERWARTBAR (verschiedene Vorgaenge)'
            WHEN handversand > 0    THEN 'HANDVERSAND (bewusst ausgeloest)'
            ELSE 'ECHTE DOPPELUNG -> pruefen'
          END
       ||'  | Abstand: '||to_char(letzte - erste,'HH24:MI')
       ||'  | zuletzt '||to_char(letzte,'DD.MM. HH24:MI')
  FROM grp
 ORDER BY CASE WHEN vorgaenge >= mails THEN 3 WHEN handversand > 0 THEN 2 ELSE 1 END, mails DESC
 LIMIT 40;" | sed 's/^/  /'

hd "2) Einzelzeilen der als ECHTE DOPPELUNG eingestuften Gruppen"
sqlt "
WITH base AS (
  SELECT id, template_name, lower(recipient_email) AS rcpt,
         $VORGANG AS vorgang, $TRIGGER AS ausloeser, created_at,
         coalesce(metadata->>'source','-') AS quelle
    FROM email_send_log
   WHERE status = 'sent' AND created_at > now() - interval '$DAYS days'
), bad AS (
  SELECT template_name, rcpt FROM base
   GROUP BY 1,2
  HAVING count(*) > count(DISTINCT nullif(vorgang,''))
     AND count(*) FILTER (WHERE ausloeser='manual') = 0
     AND count(*) > 1
)
SELECT to_char(b.created_at,'DD.MM. HH24:MI:SS')||' | '||rpad(b.rcpt,32)||' | '||rpad(b.template_name,36)
       ||' | Vorgang '||coalesce(nullif(left(b.vorgang,8),''),'(keiner)')||' | '||rpad(b.quelle,30)||' | '||b.ausloeser
  FROM base b JOIN bad ON bad.template_name=b.template_name AND bad.rcpt=b.rcpt
 ORDER BY b.rcpt, b.template_name, b.created_at
 LIMIT 60;" | sed 's/^/  /'

hd "3) Warum kamen Mails nicht an — Ursachen gruppiert"
sqlt "
WITH f AS (
  SELECT coalesce(t.name,'(ohne Mandant)') AS mandant,
         CASE
          WHEN l.error_message ILIKE '%535%' OR l.error_message ILIKE '%authentication failed%'
            THEN 'SMTP-Passwort falsch -> im Portal neu hinterlegen'
          WHEN l.error_message ILIKE '%smtp_incomplete%' OR l.error_message ILIKE '%no credentials%'
            THEN 'Keine SMTP-Zugangsdaten hinterlegt'
          WHEN l.error_message ILIKE '%554%' OR l.error_message ILIKE '%too many messages%' OR l.error_message ILIKE '%rate%'
            THEN 'Provider-Limit erreicht -> wird nachgeholt'
          WHEN l.error_message ILIKE '%550%' OR l.error_message ILIKE '%does not exist%' OR l.error_message ILIKE '%unknown user%'
            THEN 'Adresse existiert nicht (Tippfehler beim Bewerber)'
          WHEN l.error_message ILIKE '%timeout%' OR l.error_message ILIKE '%ETIMEDOUT%' OR l.error_message ILIKE '%ECONN%'
            THEN 'Verbindung zum Mailserver gescheitert'
          WHEN l.error_message ILIKE '%tenant_paused%' THEN 'Versand fuer Mandant pausiert'
          ELSE 'Sonstiges: '||left(regexp_replace(coalesce(l.error_message,'(keine Meldung)'),'[[:space:]]+',' ','g'),70)
         END AS ursache
    FROM email_send_log l LEFT JOIN tenants t ON t.id = l.tenant_id
   WHERE l.created_at > now() - interval '$DAYS days'
     AND l.status IN ('failed','bounced','dlq')
)
SELECT rpad(mandant,26)||' | '||lpad(count(*)::text,4)||'x | '||ursache
  FROM f GROUP BY mandant, ursache ORDER BY count(*) DESC LIMIT 25;" | sed 's/^/  /'

hd "4) Betroffene Empfaenger ohne jede erfolgreiche Mail"
sqlt "
WITH f AS (
  SELECT lower(l.recipient_email) AS rcpt, l.created_at
    FROM email_send_log l
   WHERE l.created_at > now() - interval '$DAYS days'
     AND l.status IN ('failed','bounced','dlq')
     AND NOT EXISTS (
          SELECT 1 FROM email_send_log s
           WHERE lower(s.recipient_email) = lower(l.recipient_email)
             AND s.status = 'sent'
             AND s.created_at > now() - interval '$DAYS days')
)
SELECT rpad(rcpt,36)||' | '||count(*)||' Fehlversuche | zuletzt '
       ||to_char(max(created_at),'DD.MM. HH24:MI')
  FROM f GROUP BY rcpt ORDER BY count(*) DESC LIMIT 30;" | sed 's/^/  /'


hd "5) Versandfaehigkeit je Mandant"
sqlt "SELECT rpad(name,26)||' smtp='||CASE WHEN coalesce(smtp_host,'')<>'' AND coalesce(smtp_password,'')<>'' THEN 'ja ' ELSE 'NEIN' END
            ||' | pausiert='||rpad(coalesce(emails_paused::text,'?'),5)
        FROM tenants ORDER BY name;" | sed 's/^/  /'

echo
echo "Lesart:"
echo "  ERWARTBAR       = zwei getrennte Bewerbungen/Termine derselben Person — kein Fehler."
echo "  HANDVERSAND     = jemand hat 'Jetzt senden' geklickt, obwohl der Cron schon gesendet hatte."
echo "  ECHTE DOPPELUNG = Sperre hat versagt. Zeilen aus Block 2 bitte an Lovable schicken."
echo "  Block 3/4 zeigen, warum einzelne Bewerber gar keine Mail bekommen haben."