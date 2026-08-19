#!/usr/bin/env bash
# =============================================================================
#  check-impressum.sh — prueft je Landing Page, ob das Impressum vollstaendig
#  ist.  Das Impressum wird zentral erzeugt (legal-content.js) und sieht auf
#  ALLEN Landings identisch aus — Unterschiede entstehen nur durch fehlende
#  Firmendaten.  NUR LESEND.
#
#  Portal-Server:  bash scripts/check-impressum.sh
#  Backend-Server: bash scripts/check-impressum.sh --local
#  Direkte DB:     TARGET_DB_URL=postgres://... bash scripts/check-impressum.sh
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

echo "=============================================================="
echo " IMPRESSUM-CHECK  $(date '+%F %T')"
echo " Layout ist ueberall identisch (zentraler Generator)."
echo " Geprueft werden nur die Pflichtangaben nach § 5 DDG."
echo "=============================================================="
echo

sqlt "
WITH b AS (
  SELECT lp.domain, lp.slug, lp.theme_id, lp.is_published,
         nullif(trim(coalesce(lp.branding->>'firmenname','')),'')        AS firmenname,
         nullif(trim(coalesce(lp.branding->>'strasse','')),'')           AS strasse,
         nullif(trim(coalesce(lp.branding->>'plz','')),'')               AS plz,
         nullif(trim(coalesce(lp.branding->>'stadt','')),'')             AS stadt,
         nullif(trim(coalesce(lp.branding->>'email','')),'')             AS email,
         nullif(trim(coalesce(lp.branding->>'geschaeftsfuehrer','')),'') AS gf,
         nullif(trim(coalesce(lp.branding->>'registergericht','')),'')   AS reg,
         nullif(trim(coalesce(lp.branding->>'hrb','')),'')               AS hrb,
         nullif(trim(coalesce(lp.branding->>'ust_id','')),'')            AS ust
  FROM landing_pages lp
)
SELECT rpad(coalesce(domain, slug), 34)
    || CASE WHEN is_published THEN ' live ' ELSE ' ---- ' END
    || CASE
         WHEN concat_ws(', ',
                CASE WHEN firmenname IS NULL THEN 'Firmenname' END,
                CASE WHEN strasse    IS NULL THEN 'Strasse'    END,
                CASE WHEN plz        IS NULL THEN 'PLZ'        END,
                CASE WHEN stadt      IS NULL THEN 'Stadt'      END,
                CASE WHEN email      IS NULL THEN 'E-Mail'     END,
                CASE WHEN gf         IS NULL THEN 'Geschaeftsfuehrer' END) = ''
         THEN 'OK   vollstaendig'
         ELSE '!!   FEHLT: ' || concat_ws(', ',
                CASE WHEN firmenname IS NULL THEN 'Firmenname' END,
                CASE WHEN strasse    IS NULL THEN 'Strasse'    END,
                CASE WHEN plz        IS NULL THEN 'PLZ'        END,
                CASE WHEN stadt      IS NULL THEN 'Stadt'      END,
                CASE WHEN email      IS NULL THEN 'E-Mail'     END,
                CASE WHEN gf         IS NULL THEN 'Geschaeftsfuehrer' END)
       END
    || CASE
         WHEN concat_ws(', ',
                CASE WHEN reg IS NULL THEN 'Registergericht' END,
                CASE WHEN hrb IS NULL THEN 'HRB' END,
                CASE WHEN ust IS NULL THEN 'USt-IdNr.' END) = '' THEN ''
         ELSE '   (optional offen: ' || concat_ws(', ',
                CASE WHEN reg IS NULL THEN 'Registergericht' END,
                CASE WHEN hrb IS NULL THEN 'HRB' END,
                CASE WHEN ust IS NULL THEN 'USt-IdNr.' END) || ')'
       END
FROM b ORDER BY domain NULLS LAST, slug;"

echo
echo "Legende:  live = veroeffentlicht | !! = Pflichtangabe fehlt"
echo "Fehlende Werte im Landing-Generator unter 'Rechtliches' nachtragen,"
echo "danach die Landing neu veroeffentlichen."
