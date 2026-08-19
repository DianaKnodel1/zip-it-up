#!/usr/bin/env bash
# =============================================================================
#  check-mail-templates.sh — prueft ALLE Mail-Vorlagen je Mandant gegen den
#  aktuellen Code-Stand.  NUR LESEND, verschickt nichts.
#
#  Portal-Server:  bash scripts/check-mail-templates.sh
#  Backend-Server: bash scripts/check-mail-templates.sh --local
#  Direkte DB:     TARGET_DB_URL=postgres://... bash scripts/check-mail-templates.sh
# =============================================================================
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF_FILE="$REPO_DIR/scripts/backend-server.env"
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

: "${BACKEND_USER:=root}"
: "${BACKEND_DB_CONTAINER:=supabase-db}"
: "${BACKEND_DB_USER:=supabase_admin}"
: "${BACKEND_DB_NAME:=postgres}"

LOCAL=0
[ "${1:-}" = "--local" ] && LOCAL=1

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

echo "================================================================"
echo " 1) Welche Vorlagen sind je Mandant individuell gesetzt?"
echo "    (std = Standardvorlage aus dem Code, immer aktuell)"
echo "================================================================"
sqlt "
SELECT rpad(name, 22)
  || ' invite:'      || CASE WHEN reminder_invite_body      IS NULL THEN 'std' ELSE 'EIGEN' END
  || ' confirm:'     || CASE WHEN reminder_confirm_body     IS NULL THEN 'std' ELSE 'EIGEN' END
  || ' completion:'  || CASE WHEN reminder_completion_body  IS NULL THEN 'std' ELSE 'EIGEN' END
  || ' nobooking:'   || CASE WHEN reminder_no_booking_body  IS NULL THEN 'std' ELSE 'EIGEN' END
  || ' recovery:'    || CASE WHEN reminder_recovery_body    IS NULL THEN 'std' ELSE 'EIGEN' END
  || ' appreceived:' || CASE WHEN application_received_body IS NULL THEN 'std' ELSE 'EIGEN' END
  || ' booking:'     || CASE WHEN booking_confirmation_body IS NULL THEN 'std' ELSE 'EIGEN' END
  || ' magiclink:'   || CASE WHEN bewerbung_magic_link_body IS NULL THEN 'std' ELSE 'EIGEN' END
FROM tenants ORDER BY name;"

echo
echo "================================================================"
echo " 2) VERALTET: eigene 'Registrierung abschliessen'-Vorlage ohne"
echo "    Platzhalter {{missing_documents}} (zeigt nicht, was fehlt)"
echo "================================================================"
sqlt "
SELECT name FROM tenants
 WHERE reminder_completion_body IS NOT NULL
   AND reminder_completion_body NOT LIKE '%missing_documents%'
 ORDER BY name;" | sed 's/^/  ! /'

echo
echo "================================================================"
echo " 3) Eigene Vorlagen ohne jeden Platzhalter/Link"
echo "================================================================"
for col in reminder_invite_body reminder_completion_body reminder_no_booking_body \
           application_received_body booking_confirmation_body bewerbung_magic_link_body \
           reminder_app_no_booking_body reminder_app_no_show_body \
           reminder_app_registration_body reminder_app_rebook_body; do
  out=$(sqlt "SELECT name FROM tenants WHERE $col IS NOT NULL AND $col NOT LIKE '%{{%' ORDER BY name;")
  [ -n "$out" ] && echo "  ! $col: $(echo "$out" | tr '\n' ' ')"
done

echo
echo "================================================================"
echo " 4) Unbekannte Platzhalter in eigenen Vorlagen"
echo "================================================================"
sqlt "
WITH t AS (
  SELECT name, unnest(ARRAY[
    reminder_invite_body, reminder_confirm_body, reminder_completion_body,
    reminder_no_booking_body, reminder_recovery_body, application_received_body,
    booking_confirmation_body, bewerbung_magic_link_body,
    reminder_app_no_booking_body, reminder_app_no_show_body,
    reminder_app_registration_body, reminder_app_rebook_body,
    reminder_chat_body, reminder_appointment_body
  ]) AS body FROM tenants
), ph AS (
  SELECT name, (regexp_matches(body, '\{\{\s*([a-z_]+)\s*\}\}', 'g'))[1] AS key
    FROM t WHERE body IS NOT NULL
)
SELECT DISTINCT name || ' -> {{' || key || '}}' FROM ph
 WHERE key NOT IN (
   'tenant_name','company_name','sender_name','support_email','first_name','last_name',
   'full_name','email','portal_link','login_link','confirmation_link','booking_link',
   'magic_link','cancel_link','reschedule_link','appointment_date','appointment_time',
   'missing_documents','missing_list','cta'
 ) ORDER BY 1;" | sed 's/^/  ! /'

echo
echo "Fertig - keine Zeile mit '!' = alle Vorlagen auf aktuellem Stand."
