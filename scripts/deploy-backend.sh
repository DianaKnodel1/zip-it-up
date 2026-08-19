#!/usr/bin/env bash
# =============================================================================
#  deploy-backend.sh — Backend (self-hosted Supabase auf Server .123) updaten
# =============================================================================
#  Läuft LOKAL auf deinem Rechner. Macht via SSH auf dem Backend-Server:
#    1) rsync + apply neuer SQL-Migrations (supabase/manual-migrations/*.sql)
#    2) rsync Edge Functions (supabase/functions/*) + Container-Restart
#    3) Health-Check
#
#  Voraussetzung (einmalig):
#    ssh-copy-id root@<BACKEND_HOST>
#    cp scripts/backend-server.env.example scripts/backend-server.env
#    # scripts/backend-server.env mit deinen Werten füllen (wird nicht ins Git commited)
#
#  Verwendung:
#    bash scripts/deploy-backend.sh            # deployen
#    bash scripts/deploy-backend.sh --dry-run  # nur anzeigen, nichts tun
# =============================================================================
set -euo pipefail

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then DRY_RUN=1; fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF_FILE="$REPO_DIR/scripts/backend-server.env"

if [ ! -f "$CONF_FILE" ]; then
  echo "✗ $CONF_FILE fehlt." >&2
  echo "  → cp scripts/backend-server.env.example scripts/backend-server.env" >&2
  echo "  → dann Werte eintragen (BACKEND_HOST, BACKEND_USER, ...)" >&2
  exit 1
fi
# shellcheck disable=SC1090
. "$CONF_FILE"

: "${BACKEND_HOST:?BACKEND_HOST fehlt in $CONF_FILE}"
: "${BACKEND_USER:=root}"
: "${BACKEND_SUPABASE_DIR:=/opt/supabase}"
: "${BACKEND_DB_CONTAINER:=supabase-db}"
: "${BACKEND_FUNCTIONS_CONTAINER:=supabase-edge-functions}"
: "${BACKEND_HEALTH_URL:=}"

SSH="ssh -o StrictHostKeyChecking=accept-new ${BACKEND_USER}@${BACKEND_HOST}"
RSYNC_FLAGS="-avz --human-readable"
if [ "$DRY_RUN" = "1" ]; then
  RSYNC_FLAGS="$RSYNC_FLAGS --dry-run"
  SSH_DRY="echo [dry-run] ssh:"
else
  SSH_DRY=""
fi

log()  { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m  ! %s\033[0m\n" "$*"; }
info() { printf "  · %s\n" "$*"; }

# ── 0/4  SSH-Check ─────────────────────────────────────────────────────────
log "0/4  Verbindung zum Backend prüfen"
info "Backend: ${BACKEND_USER}@${BACKEND_HOST}"
info "Supabase-Dir: ${BACKEND_SUPABASE_DIR}"
if ! $SSH "true" 2>/dev/null; then
  echo "  ✗ SSH auf ${BACKEND_HOST} nicht möglich." >&2
  echo "    → einmalig: ssh-copy-id ${BACKEND_USER}@${BACKEND_HOST}" >&2
  exit 1
fi
$SSH "test -d ${BACKEND_SUPABASE_DIR}" || {
  echo "  ✗ ${BACKEND_SUPABASE_DIR} existiert nicht auf dem Backend." >&2
  exit 1
}
ok "SSH funktioniert"

# ── 1/4  SQL-Migrations ────────────────────────────────────────────────────
log "1/4  SQL-Migrations"
MIG_SRC="$REPO_DIR/supabase/manual-migrations/"
MIG_DST="${BACKEND_SUPABASE_DIR}/manual-migrations/"
STATE_FILE="${BACKEND_SUPABASE_DIR}/.migrations-applied"

if [ ! -d "$MIG_SRC" ]; then
  warn "Kein Ordner supabase/manual-migrations/ — Migrations übersprungen"
else
  info "rsync → ${BACKEND_HOST}:${MIG_DST}"
  $SSH "mkdir -p ${MIG_DST}"
  # shellcheck disable=SC2086
  rsync $RSYNC_FLAGS "$MIG_SRC" "${BACKEND_USER}@${BACKEND_HOST}:${MIG_DST}"

  if [ "$DRY_RUN" = "1" ]; then
    info "[dry-run] würde neue *.sql via docker exec ${BACKEND_DB_CONTAINER} anwenden"
  else
    # Alles serverseitig in einer Session: State-File lesen, Backup, Migrations anwenden
    $SSH bash -s <<REMOTE_MIG
set -euo pipefail
STATE="${STATE_FILE}"
MIG_DIR="${MIG_DST}"
DB_CT="${BACKEND_DB_CONTAINER}"
touch "\$STATE"

# Liste neuer Migrations bestimmen
NEW=\$(ls "\$MIG_DIR"/*.sql 2>/dev/null | sort | while read f; do
  n=\$(basename "\$f")
  grep -qxF "\$n" "\$STATE" || echo "\$f"
done)

if [ -z "\$NEW" ]; then
  echo "  · keine neuen Migrations"
  exit 0
fi

echo "  · neue Migrations:"
echo "\$NEW" | sed 's|^|      |'

# Backup vor dem ersten Apply
mkdir -p "${BACKEND_SUPABASE_DIR}/backups"
STAMP=\$(date +%Y%m%d-%H%M%S)
BACKUP="${BACKEND_SUPABASE_DIR}/backups/pre-deploy-\${STAMP}.sql.gz"
echo "  · pg_dump → \$BACKUP"
docker exec "\$DB_CT" pg_dump -U postgres -d postgres | gzip > "\$BACKUP"

# Jede Migration einzeln anwenden
echo "\$NEW" | while read sql; do
  name=\$(basename "\$sql")
  echo "  · apply: \$name"
  # supabase_admin ist Owner aller public.* Objekte in Self-Hosted Supabase.
  # postgres hat oft nur eingeschränkte Rechte → "must be owner of ..."-Fehler.
  docker exec -i "\$DB_CT" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < "\$sql"
  echo "\$name" >> "\$STATE"
  echo "    ✓ \$name"
done

# Kritische Sperre unabhängig von einer evtl. vorbefüllten State-Datei prüfen.
DEDUPE_MIG="\$MIG_DIR/20260807010000_email_dedupe_repair.sql"
DEDUPE_INDEX=\$(docker exec "\$DB_CT" psql -U supabase_admin -d postgres -tAc "select to_regclass('public.email_send_log_no_duplicate_sent') is not null" | tr -d '[:space:]')
if [ "\$DEDUPE_INDEX" != "t" ] && [ -f "\$DEDUPE_MIG" ]; then
  echo "  · kritische Doppelversand-Sperre fehlt — wende Reparatur an"
  docker exec -i "\$DB_CT" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < "\$DEDUPE_MIG"
  grep -qxF "\$(basename "\$DEDUPE_MIG")" "\$STATE" || basename "\$DEDUPE_MIG" >> "\$STATE"
  echo "    ✓ Doppelversand-Sperre aktiv"
fi
REMOTE_MIG
  fi
  ok "Migrations aktuell"
fi

# ── 1b/4  API-Schema-Cache neu laden ───────────────────────────────────────
# Ohne Reload meldet das Portal nach jeder Spalten-Migration:
# "Could not find the '<spalte>' column ... in the schema cache".
log "1b/4  API-Schema-Cache neu laden"
if [ "$DRY_RUN" = "1" ]; then
  info "[dry-run] würde PostgREST-Schema-Cache neu laden"
else
  $SSH "docker exec -i ${BACKEND_DB_CONTAINER:-supabase-db} psql -U supabase_admin -d postgres -c \"NOTIFY pgrst, 'reload schema';\"" >/dev/null 2>&1 \
    && ok "NOTIFY pgrst gesendet" || warn "NOTIFY pgrst fehlgeschlagen"
  $SSH "docker restart ${BACKEND_REST_CONTAINER:-supabase-rest}" >/dev/null 2>&1 \
    && ok "PostgREST neu gestartet" || warn "PostgREST-Container nicht gefunden — nur NOTIFY genutzt"
fi

# ── 2/4  Edge Functions ────────────────────────────────────────────────────
log "2/4  Edge Functions"
FN_SRC="$REPO_DIR/supabase/functions/"
FN_DST="${BACKEND_SUPABASE_DIR}/volumes/functions/"

if [ ! -d "$FN_SRC" ]; then
  warn "Kein Ordner supabase/functions/ — übersprungen"
else
  info "rsync → ${BACKEND_HOST}:${FN_DST}  (--delete)"
  $SSH "mkdir -p ${FN_DST}"
  # shellcheck disable=SC2086
  rsync $RSYNC_FLAGS --delete \
    --exclude='.DS_Store' \
    "$FN_SRC" "${BACKEND_USER}@${BACKEND_HOST}:${FN_DST}"

  if [ "$DRY_RUN" = "1" ]; then
    info "[dry-run] würde Container '${BACKEND_FUNCTIONS_CONTAINER}' neu starten"
  else
    info "prüfe Function-Entrypoints"
    $SSH bash -s <<REMOTE_FN_CHECK
set -euo pipefail
FN_DIR="${FN_DST}"
missing=0
    for fn in main send-chat-reminder send-invitation-email send-application-reminders send-appointment-reminders send-booking-confirmation send-reminders send-signup-confirmation resend-signup-confirmation send-password-reset process-invite-resend-queue email-preview email-resend smtp-test; do
  if [ ! -f "\$FN_DIR/\$fn/index.ts" ]; then
    echo "  ✗ fehlt: \$FN_DIR/\$fn/index.ts" >&2
    missing=1
  else
    echo "  · ok: \$fn/index.ts"
  fi
done
if [ "\$missing" = "1" ]; then
  echo "Edge Function Deploy abgebrochen: mindestens ein Entrypoint fehlt." >&2
  exit 1
fi
REMOTE_FN_CHECK
    info "restart container: ${BACKEND_FUNCTIONS_CONTAINER}"
    $SSH "docker restart ${BACKEND_FUNCTIONS_CONTAINER}" >/dev/null
  fi
  ok "Edge Functions deployed"
fi

# ── 3/4  Health-Check ──────────────────────────────────────────────────────
log "3/4  Health-Check"
if [ "$DRY_RUN" = "1" ]; then
  info "[dry-run] übersprungen"
else
  info "docker ps (Supabase-Container):"
  $SSH "docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'supabase|NAMES' || true"

  if [ -n "$BACKEND_HEALTH_URL" ]; then
    info "curl ${BACKEND_HEALTH_URL}"
    for _ in 1 2 3 4 5; do
      code="$(curl -s -o /dev/null -w '%{http_code}' \
                ${BACKEND_ANON_KEY:+-H "apikey: ${BACKEND_ANON_KEY}"} \
                "$BACKEND_HEALTH_URL" || echo 000)"
      # 401 = Kong antwortet, nur ohne apikey → Backend ist erreichbar
      if [ "$code" != "000" ] && [ "$code" -lt 500 ]; then
        ok "Backend antwortet (HTTP $code)"
        break
      fi
      warn "HTTP $code — retry"
      sleep 2
    done
  else
    warn "BACKEND_HEALTH_URL nicht gesetzt — HTTP-Check übersprungen"
  fi

fi

log "4/4  Fertig ✅"
[ "$DRY_RUN" = "1" ] && echo "  (dry-run — es wurde nichts geändert)"
exit 0
