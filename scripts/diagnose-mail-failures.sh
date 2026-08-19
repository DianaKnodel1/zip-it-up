#!/usr/bin/env bash
# =============================================================================
#  diagnose-mail-failures.sh — zeigt die KONKRETEN Fehlermeldungen hinter den
#  fehlgeschlagenen Mail-Sendungen (z. B. "0 gesendet / 26 fehlgeschlagen").
#  NUR LESEND, verschickt nichts.
#
#  Backend-Server: bash scripts/diagnose-mail-failures.sh --local
#  Portal-Server:  bash scripts/diagnose-mail-failures.sh
#  Direkte DB:     TARGET_DB_URL=postgres://... bash scripts/diagnose-mail-failures.sh
# =============================================================================
set -uo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF_FILE="$REPO_DIR/scripts/backend-server.env"
[ -f "$CONF_FILE" ] && . "$CONF_FILE"
: "${BACKEND_USER:=root}"; : "${BACKEND_DB_CONTAINER:=supabase-db}"
: "${BACKEND_DB_USER:=supabase_admin}"; : "${BACKEND_DB_NAME:=postgres}"
LOCAL=0; [ "${1:-}" = "--local" ] && LOCAL=1
if   [ -n "${TARGET_DB_URL:-}" ]; then RUNNER="url"
elif [ "$LOCAL" = "1" ];         then RUNNER="docker"
elif [ -n "${BACKEND_HOST:-}" ]; then RUNNER="ssh"
else echo "x Keine DB-Verbindung (TARGET_DB_URL, --local oder BACKEND_HOST)." >&2; exit 1; fi

sqlt() {
  local q="$1"
  case "$RUNNER" in
    url)    printf '%s\n' "$q" | psql "$TARGET_DB_URL" -At -F '|' -P pager=off 2>/dev/null ;;
    docker) printf '%s\n' "$q" | docker exec -i "$BACKEND_DB_CONTAINER" psql -U "$BACKEND_DB_USER" -d "$BACKEND_DB_NAME" -At -F '|' -P pager=off 2>/dev/null ;;
    ssh)    printf '%s\n' "$q" | ssh -o StrictHostKeyChecking=accept-new "${BACKEND_USER}@${BACKEND_HOST}" \
              "docker exec -i $BACKEND_DB_CONTAINER psql -U $BACKEND_DB_USER -d $BACKEND_DB_NAME -At -F '|' -P pager=off" 2>/dev/null ;;
  esac
}
hd(){ echo; echo "═══ $1 ═══"; }

echo "=============================================================="
echo " MAIL-FEHLER-DIAGNOSE  $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================================================="

hd "Fehler pro Vorlage (30 Tage)"
sqlt "SELECT rpad(coalesce(template_name,'(null)'),34)||' '||rpad(status,12)||' '||count(*)
        FROM email_send_log
       WHERE created_at > now() - interval '30 days'
         AND status NOT IN ('sent','delivered')
       GROUP BY 1,2 ORDER BY count(*) DESC;" | sed 's/^/  /'

hd "Haeufigste Fehlermeldungen (30 Tage, gruppiert)"
sqlt "SELECT count(*)||'x  '||left(regexp_replace(coalesce(error_message,'(keine Meldung)'),'\s+',' ','g'),150)
        FROM email_send_log
       WHERE created_at > now() - interval '30 days'
         AND status NOT IN ('sent','delivered')
       GROUP BY 2 ORDER BY count(*) DESC LIMIT 15;" | sed 's/^/  /'

hd "Fehler pro Mandant (30 Tage)"
sqlt "SELECT rpad(coalesce(t.name,'(ohne Mandant)'),26)||' '||count(*)||' Fehler  | letzter: '
            ||to_char(max(l.created_at),'DD.MM. HH24:MI')
        FROM email_send_log l LEFT JOIN tenants t ON t.id = l.tenant_id
       WHERE l.created_at > now() - interval '30 days'
         AND l.status NOT IN ('sent','delivered')
       GROUP BY 1 ORDER BY count(*) DESC;" | sed 's/^/  /'

hd "Fehlversuche pro Zeitraum (aktuell vs. historisch)"
sqlt "SELECT 'letzte 24h: '||count(*) FILTER (WHERE created_at > now() - interval '24 hours')
          ||' | 7 Tage: '||count(*) FILTER (WHERE created_at > now() - interval '7 days')
          ||' | 30 Tage: '||count(*) FILTER (WHERE created_at > now() - interval '30 days')
          ||' | gesamt: '||count(*)
          ||' | aeltester: '||to_char(min(created_at),'DD.MM.YYYY')
          ||' | neuester: '||to_char(max(created_at),'DD.MM.YYYY HH24:MI')
        FROM email_send_log WHERE status NOT IN ('sent','delivered');" | sed 's/^/  /'

hd "Letzte 15 Fehlversuche im Detail"
sqlt "SELECT to_char(created_at,'DD.MM.YYYY HH24:MI')||' | '||rpad(coalesce(template_name,'-'),28)
            ||' | '||rpad(status,10)||' | '||left(regexp_replace(coalesce(error_message,'-'),'\s+',' ','g'),110)
        FROM email_send_log
       WHERE status NOT IN ('sent','delivered')
       ORDER BY created_at DESC LIMIT 15;" | sed 's/^/  /'

hd "Mandanten-Versandfaehigkeit (Ursache Nr. 1)"
sqlt "SELECT rpad(name,26)||' smtp='||CASE WHEN coalesce(smtp_host,'')<>'' THEN 'ja ' ELSE 'NEIN' END
            ||' | pausiert='||rpad(coalesce(emails_paused::text,'?'),5)
            ||' | status='||coalesce(smtp_health_status,'-')
        FROM tenants ORDER BY name;" | sed 's/^/  /'

echo
echo "Lesart:  'authentication failed (535)' = SMTP-Passwort falsch."
echo "         'smtp=NEIN'                    = keine Zugangsdaten hinterlegt."
echo "         'pausiert=true'                = Versand automatisch gestoppt."
echo "         '554 ... too many messages'    = Provider-Ratelimit, kein Code-Fehler."
echo "         Sind die 30-Tage-Bloecke leer, sind ALLE Fehler aelter als 30 Tage."
echo "         Andere Meldungen bitte an Lovable schicken — das waere ein Code-Fehler."
