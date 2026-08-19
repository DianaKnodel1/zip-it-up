#!/usr/bin/env bash
# =============================================================================
#  tenant-pause-status.sh — Warum ist der Mail-Versand eines Mandanten pausiert?
# =============================================================================
#  Standardlauf: NUR LESEND. Aendert nichts.
#  Mit --release "<Name>": hebt die Pause fuer diesen Mandanten auf.
#
#  Verwendung:
#    bash scripts/tenant-pause-status.sh                  # anzeigen (SSH)
#    bash scripts/tenant-pause-status.sh --local          # auf dem Backend-Server
#    bash scripts/tenant-pause-status.sh --release "UWK"  # Pause aufheben
#
#  Pausen-Ausloeser laut Code:
#    manuell            -> Admin -> Mandanten -> "Mail-Versand pausieren"
#    auto:domain_down   -> ALLE Domains des Mandanten nicht erreichbar
#    auto:smtp_verify   -> im Code derzeit deaktiviert (if (false && fails >= 5))
#
#  Freigabe:
#    - Ein erfolgreicher SMTP-Test im Admin hebt AUTOMATISCHE Pausen
#      (auto:*, unbekannt) sofort auf und setzt den Health-Counter zurueck.
#    - MANUELLE Pausen (manual:admin) bleiben bestehen und muessen ueber
#      "Versand fortsetzen" oder --release freigegeben werden.
#    - Neue SMTP-Daten allein heben KEINE Pause auf.
# =============================================================================
set -uo pipefail

MODE=""
RELEASE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --local)   MODE="--local"; shift ;;
    --release) RELEASE="${2:-}"; shift 2 ;;
    *)         shift ;;
  esac
done

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF_FILE="$REPO_DIR/scripts/backend-server.env"
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

: "${BACKEND_USER:=root}"
: "${BACKEND_DB_CONTAINER:=supabase-db}"
: "${BACKEND_DB_USER:=supabase_admin}"
: "${BACKEND_DB_NAME:=postgres}"

log()  { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m  ! %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }

if [ -n "${TARGET_DB_URL:-}" ]; then
  RUNNER="url"
elif [ "$MODE" = "--local" ]; then
  RUNNER="docker"
elif [ -n "${BACKEND_HOST:-}" ]; then
  RUNNER="ssh"
else
  echo "✗ Keine Verbindung konfiguriert." >&2
  echo "  → TARGET_DB_URL setzen, scripts/backend-server.env anlegen," >&2
  echo "    oder das Skript auf dem Backend-Server mit --local starten." >&2
  exit 1
fi

# SQL kommt ueber STDIN -> keine Shell-Expansion von $$, Quotes o.ae.
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
echo " Mandanten-Mailpause   ($(date '+%Y-%m-%d %H:%M:%S'))   Modus: $RUNNER"
echo "=============================================================="

# ---------------------------------------------------------------- 1. Uebersicht
log "1/5  Pausierte Mandanten"
sqlq "
SELECT name,
       CASE
         WHEN emails_paused_by IS NULL OR emails_paused_by = '' THEN 'manuell'
         WHEN emails_paused_by LIKE 'auto:%' THEN emails_paused_by
         ELSE 'manuell (' || emails_paused_by || ')'
       END AS ausloeser,
       COALESCE(emails_paused_reason, '—') AS grund,
       to_char(emails_paused_at, 'YYYY-MM-DD HH24:MI') AS seit,
       is_active AS aktiv
  FROM public.tenants
 WHERE emails_paused = true
 ORDER BY emails_paused_at DESC NULLS LAST;
"

# ------------------------------------------------------------- 2. Aktivitaeten
log "2/5  Auto-Pausen im Aktivitätsprotokoll (letzte 30 Tage)"
sqlq "
SELECT to_char(l.created_at, 'YYYY-MM-DD HH24:MI') AS zeit,
       COALESCE(t.name, l.entity_id::text) AS mandant,
       l.comment
  FROM public.activity_log l
  LEFT JOIN public.tenants t ON t.id = l.entity_id
 WHERE l.action = 'emails_auto_pausiert'
   AND l.created_at > now() - interval '30 days'
 ORDER BY l.created_at DESC
 LIMIT 25;
"

# ------------------------------------------------------------- 3. SMTP-Health
log "3/5  SMTP-Zustand je Mandant"
sqlq "
SELECT t.name,
       COALESCE(h.consecutive_fails, 0) AS fehler_in_folge,
       COALESCE(h.last_verify_ok::text, '—') AS letzte_pruefung_ok,
       to_char(h.last_verify_at, 'YYYY-MM-DD HH24:MI') AS geprueft_am,
       COALESCE(left(h.last_fail_error, 60), '—') AS letzter_fehler,
       COALESCE(t.smtp_health_status, '—') AS status,
       (t.smtp_host IS NOT NULL AND t.smtp_username IS NOT NULL
        AND t.smtp_password IS NOT NULL AND t.sender_email IS NOT NULL) AS smtp_vollstaendig
  FROM public.tenants t
  LEFT JOIN public.tenant_smtp_health h ON h.tenant_id = t.id
 WHERE t.is_active = true
 ORDER BY t.name;
"

# ------------------------------------------------- 4. Domains der Pausierten
log "4/5  Domain-Erreichbarkeit der pausierten Mandanten (live)"
DOMLIST="$(sqlq "
\\pset tuples_only on
\\pset format unaligned
SELECT DISTINCT t.name || '|' || d
  FROM public.tenants t,
       LATERAL unnest(
         ARRAY[t.primary_domain, t.domain] ||
         COALESCE(t.domain_aliases, ARRAY[]::text[])
       ) AS d
 WHERE t.emails_paused = true
   AND d IS NOT NULL AND d <> '';
")"

if [ -z "$(printf '%s' "$DOMLIST" | tr -d '[:space:]')" ]; then
  ok "Keine pausierten Mandanten mit Domains — nichts zu prüfen."
else
  printf '%s\n' "$DOMLIST" | while IFS='|' read -r tname dom; do
    [ -z "${dom:-}" ] && continue
    dom="$(printf '%s' "$dom" | tr -d '[:space:]' | sed -E 's#^https?://##; s#/.*$##')"
    [ -z "$dom" ] && continue
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -L "https://$dom" 2>/dev/null || echo 000)"
    if [ "$code" = "000" ]; then
      warn "$tname  $dom  → nicht erreichbar"
    else
      ok "$tname  $dom  → HTTP $code"
    fi
  done
fi

# ---------------------------------------------------------------- 5. Freigabe
log "5/5  Freigabe"
if [ -z "$RELEASE" ]; then
  echo "  Nur Anzeige — es wurde nichts geändert."
  echo "  Zum Freigeben:  bash scripts/tenant-pause-status.sh --release \"UWK\""
  exit 0
fi

echo "  Treffer für Suchbegriff \"$RELEASE\":"
sqlq "
SELECT name,
       COALESCE(emails_paused_by, 'manuell') AS ausloeser,
       COALESCE(emails_paused_reason, '—')   AS grund
  FROM public.tenants
 WHERE emails_paused = true
   AND name ILIKE '%${RELEASE}%';
"
printf "\n  Pause für diese Mandanten wirklich aufheben? [j/N] "
read -r answer
case "$answer" in
  j|J|y|Y) ;;
  *) echo "  Abgebrochen — nichts geändert."; exit 0 ;;
esac

sqlq "
WITH target AS (
  SELECT id, name FROM public.tenants
   WHERE emails_paused = true AND name ILIKE '%${RELEASE}%'
),
upd AS (
  UPDATE public.tenants t
     SET emails_paused = false,
         emails_paused_at = NULL,
         emails_paused_reason = NULL,
         emails_paused_by = NULL,
         updated_at = now()
    FROM target
   WHERE t.id = target.id
  RETURNING t.id, t.name
),
health AS (
  UPDATE public.tenant_smtp_health h
     SET consecutive_fails = 0, last_verify_ok = NULL, updated_at = now()
    FROM upd WHERE h.tenant_id = upd.id
  RETURNING 1
),
logged AS (
  INSERT INTO public.activity_log (action, entity_type, entity_id, comment)
  SELECT 'emails_reaktiviert', 'tenant', upd.id,
         'Mail-Versand manuell wieder freigegeben (tenant-pause-status.sh)'
    FROM upd
  RETURNING 1
)
SELECT name AS freigegeben FROM upd;
"

log "Kontrolle"
sqlq "
SELECT name, emails_paused, COALESCE(emails_paused_reason, '—') AS grund
  FROM public.tenants
 WHERE name ILIKE '%${RELEASE}%';
"
