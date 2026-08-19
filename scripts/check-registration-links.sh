#!/usr/bin/env bash
# =============================================================================
#  check-registration-links.sh — Zeigt, auf welches Portal Zusage-Links zeigen
# =============================================================================
#  NUR LESEND. Aendert nichts.
#
#  Hintergrund: Der Registrierungslink nach einer Zusage muss IMMER auf das
#  Fast-Track-Portal zeigen (dort findet das Interview statt und dort liegt das
#  Mitarbeiter-Portal) — niemals auf die Vermittlung.
#
#  Aufloesungskette (identisch zum Code, src/lib/portal-base.server.ts):
#    1. applications.fasttrack_tenant_id -> tenants.primary_domain/domain
#    2. applications.target_landing_id   -> Landing (nicht broker) -> Tenant-Domain
#    3. source_landing.linked_fasttrack_landing_id -> Landing -> Tenant-Domain
#
#  Verwendung:
#    bash scripts/check-registration-links.sh --local     # auf dem Backend-Server
#    bash scripts/check-registration-links.sh             # per SSH (backend-server.env)
#    DAYS=30 bash scripts/check-registration-links.sh --local
# =============================================================================
set -uo pipefail

MODE=""
[ "${1:-}" = "--local" ] && MODE="--local"
DAYS="${DAYS:-30}"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF_FILE="$REPO_DIR/scripts/backend-server.env"
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

: "${BACKEND_USER:=root}"
: "${BACKEND_DB_CONTAINER:=supabase-db}"
: "${BACKEND_DB_USER:=supabase_admin}"
: "${BACKEND_DB_NAME:=postgres}"

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }

if [ -n "${TARGET_DB_URL:-}" ]; then RUNNER="url"
elif [ "$MODE" = "--local" ]; then RUNNER="docker"
elif [ -n "${BACKEND_HOST:-}" ]; then RUNNER="ssh"
else
  echo "✗ Keine Verbindung konfiguriert (TARGET_DB_URL, backend-server.env oder --local)." >&2
  exit 1
fi

sqlin() {
  case "$RUNNER" in
    url)    psql "$TARGET_DB_URL" -v ON_ERROR_STOP=0 -P pager=off -f - 2>&1 ;;
    docker) docker exec -i "$BACKEND_DB_CONTAINER" psql -U "$BACKEND_DB_USER" -d "$BACKEND_DB_NAME" -v ON_ERROR_STOP=0 -P pager=off -f - 2>&1 ;;
    ssh)    ssh -o StrictHostKeyChecking=accept-new "${BACKEND_USER}@${BACKEND_HOST}" \
              "docker exec -i $BACKEND_DB_CONTAINER psql -U $BACKEND_DB_USER -d $BACKEND_DB_NAME -v ON_ERROR_STOP=0 -P pager=off -f -" 2>&1 ;;
  esac
}
sqlq() { sqlin <<< "$1"; }

echo "=============================================================="
echo " Registrierungs-Links   (letzte ${DAYS} Tage)   Modus: $RUNNER"
echo "=============================================================="

COMMON="
WITH base AS (
  SELECT a.id, a.email, a.created_at, a.status,
         bt.name AS vermittlung,
         COALESCE(
           ftt.primary_domain, ftt.domain,
           tlt.primary_domain, tlt.domain, tl.domain,
           lft.primary_domain, lft.domain, lf.domain
         ) AS fasttrack_domain,
         COALESCE(bt.primary_domain, bt.domain) AS vermittlung_domain
    FROM public.applications a
    LEFT JOIN public.tenants bt        ON bt.id = a.tenant_id
    LEFT JOIN public.tenants ftt       ON ftt.id = a.fasttrack_tenant_id
    LEFT JOIN public.landing_pages tl  ON tl.id = a.target_landing_id AND tl.flow_type IS DISTINCT FROM 'broker'
    LEFT JOIN public.tenants tlt       ON tlt.id = tl.tenant_id
    LEFT JOIN public.landing_pages sl  ON sl.id = a.source_landing_id
    LEFT JOIN public.landing_pages lf  ON lf.id = sl.linked_fasttrack_landing_id AND lf.flow_type IS DISTINCT FROM 'broker'
    LEFT JOIN public.tenants lft       ON lft.id = lf.tenant_id
   WHERE a.created_at > now() - interval '${DAYS} days'
)
"

log "1/3  Zusagen ohne aufloesbares Fast-Track-Portal (Link kann NICHT gesendet werden)"
sqlq "${COMMON}
SELECT email, vermittlung, to_char(created_at,'YYYY-MM-DD HH24:MI') AS bewerbung
  FROM base
 WHERE status = 'akzeptiert' AND fasttrack_domain IS NULL
 ORDER BY created_at DESC LIMIT 50;"

log "2/3  Zusagen: Ziel-Portal je Bewerbung (so sieht der Link kuenftig aus)"
sqlq "${COMMON}
SELECT email,
       vermittlung,
       CASE WHEN fasttrack_domain IS NULL THEN '—'
            WHEN length(fasttrack_domain) - length(replace(fasttrack_domain,'.','')) >= 2
              THEN 'https://' || fasttrack_domain
            ELSE 'https://portal.' || fasttrack_domain END AS portal_link_basis,
       CASE WHEN fasttrack_domain IS NOT NULL AND vermittlung_domain IS NOT NULL
                 AND fasttrack_domain <> vermittlung_domain
            THEN 'ok (Fast-Track ≠ Vermittlung)'
            WHEN fasttrack_domain IS NULL THEN 'FEHLT'
            ELSE 'gleich (Direktbewerbung)' END AS bewertung
  FROM base
 WHERE status = 'akzeptiert'
 ORDER BY created_at DESC LIMIT 50;"

log "3/3  Vermittlungs-Landings ohne verknuepfte Fast-Track-Seite (Ursache Nr. 1)"
sqlq "
SELECT lp.domain, t.name AS mandant
  FROM public.landing_pages lp
  LEFT JOIN public.tenants t ON t.id = lp.tenant_id
 WHERE lp.flow_type = 'broker' AND lp.linked_fasttrack_landing_id IS NULL
 ORDER BY lp.domain;"

echo
echo "Hinweis: fehlende Verknuepfung im Admin unter Landing-Generator setzen"
echo "         (Vermittlungsseite -> 'Fast-Track-Firma')."
