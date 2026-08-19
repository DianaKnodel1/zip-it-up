#!/usr/bin/env bash
# =============================================================================
#  backup-orchestrator.sh — Zentraler Backup-Orchestrator (läuft auf dem Backup-Server)
#
#  Zieht von allen Produktions-Servern die kritischen Daten per rsync/ssh und
#  schreibt danach einen Status in die Supabase-Datenbank.
#
#  Voraussetzung:
#    - Backup-Server hat per SSH-Key Zugriff auf alle SERVER_* (als root)
#    - scripts/backup-orchestrator.env ist angelegt (siehe backup-orchestrator.env.example)
#
#  AUF DEM BACKUP-SERVER ALS ROOT:
#    bash scripts/backup-orchestrator.sh
# =============================================================================
set -euo pipefail

START_MS=$(date +%s%3N)

cd "$(cd "$(dirname "$0")/.." && pwd)" 2>/dev/null || cd /opt/apps/portal

CONF_FILE="scripts/backup-orchestrator.env"
[ -f "$CONF_FILE" ] || { echo "✗ $CONF_FILE fehlt." >&2; exit 1; }
# shellcheck disable=SC1090
. "$CONF_FILE"

: "${BACKUP_DIR:?BACKUP_DIR fehlt in $CONF_FILE}"
: "${DB_HOST:?DB_HOST fehlt in $CONF_FILE}"
: "${DB_CONTAINER:?DB_CONTAINER fehlt in $CONF_FILE}"

BACKUP_MODE="${1:-full}"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP_BASE="${BACKUP_DIR}/daily/.tmp-${STAMP}"
RUN_DIR="${BACKUP_DIR}/daily/${STAMP}"
mkdir -p "$RUN_DIR" "${BACKUP_DIR}/monthly" "${BACKUP_DIR}/logs"

BACKUP_STATUS="success"
BACKUP_MESSAGE="OK"
SIZE="0"

log()  { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m  ! %s\033[0m\n" "$*"; }
info() { printf "  · %s\n" "$*"; }

ssh_run() {
  local host="$1"; shift
  ssh ${SSH_OPTS} "root@${host}" "$@"
}

write_db_status() {
  END_MS=$(date +%s%3N)
  DURATION=$((END_MS - START_MS))
  SQL="INSERT INTO public.backup_status (host, archive, size, mode, status, backup_host, duration_ms) VALUES
    ('backup-orchestrator', '${STAMP}', '${SIZE}', '${BACKUP_MODE}', '${BACKUP_STATUS}', '${BACKUP_DIR}', ${DURATION});"
  ssh ${SSH_OPTS} "root@${DB_HOST}" "docker exec ${DB_CONTAINER} psql -U postgres -d postgres -c \"$SQL\"" >/dev/null 2>&1 || warn "Backup-Status nicht in DB geschrieben"
}

trap 'BACKUP_STATUS="error"; BACKUP_MESSAGE="Orchestrator abgebrochen"; write_db_status' ERR EXIT

# ── 1/3  Datenbank-Dump auf Backend-Server anlegen und holen ───────────────
log "1/3  Datenbank-Dump von ${DB_HOST} holen"
DUMP_REMOTE="/tmp/portal-db-${STAMP}.dump"
ssh_run "${DB_HOST}" "docker exec ${DB_CONTAINER} pg_dump -U postgres -Fc postgres > ${DUMP_REMOTE}"
scp ${SSH_OPTS} "root@${DB_HOST}:${DUMP_REMOTE}" "${RUN_DIR}/db.dump"
ssh_run "${DB_HOST}" "rm -f ${DUMP_REMOTE}"
ok "Datenbank-Dump: $(du -h "${RUN_DIR}/db.dump" | cut -f1)"

# ── 2/3  Volumes & Configs von Backend-Server holen ─────────────────────────
log "2/3  Backend-Volumes & Configs von ${DB_HOST} holen"
mkdir -p "${RUN_DIR}/backend"
rsync -avz -e "ssh ${SSH_OPTS}" "root@${DB_HOST}:/opt/supabase" "${RUN_DIR}/backend/" \
  --exclude='docker/*' --exclude='*.log' --exclude='tmp' || warn "Backend-Supabase sync fehlgeschlagen"
rsync -avz -e "ssh ${SSH_OPTS}" "root@${DB_HOST}:/opt/apps/portal" "${RUN_DIR}/backend/" \
  --exclude='node_modules' --exclude='dist' --exclude='.output' --exclude='*.log' || warn "Backend-Portal sync fehlgeschlagen"
ok "Backend-Dateien gesichert"

# ── 3/3  Weitere Server holen ───────────────────────────────────────────────
log "3/3  Weitere Produktions-Server sichern"

pull_server() {
  local name="$1"; local host="$2"; local src_dir="$3"
  [ -z "${host}" ] && return
  info "Sichere ${name} (${host}:${src_dir})"
  mkdir -p "${RUN_DIR}/${name}"
  if rsync -avz -e "ssh ${SSH_OPTS}" "root@${host}:${src_dir}/" "${RUN_DIR}/${name}/" \
    --exclude='node_modules' --exclude='dist' --exclude='.output' --exclude='*.log' --exclude='tmp'; then
    ok "${name} gesichert"
  else
    warn "${name} nicht erreichbar oder leer"
  fi
}

pull_server "portal" "${SERVER_PORTAL_HOST:-}" "/opt/apps/portal"
pull_server "landing" "${SERVER_LANDING_HOST:-}" "/opt/apps/landing"
pull_server "bot" "${SERVER_BOT_HOST:-}" "/opt/apps"
pull_server "webid" "${SERVER_WEBID_HOST:-}" "/opt/apps/webid-sim"

# ── Aufräumen & Archivierung ───────────────────────────────────────────────
log "Archiv bauen und Aufbewahrung"
ARCHIVE_NAME="portal-${STAMP}-${BACKUP_MODE}.tar.gz"
ARCHIVE_PATH="${BACKUP_DIR}/daily/${ARCHIVE_NAME}"

tar -czf "${ARCHIVE_PATH}" -C "${RUN_DIR}" . 2>/dev/null || warn "tar meldete Fehler"
rm -rf "${RUN_DIR}"

if [ -f "${ARCHIVE_PATH}" ]; then
  SIZE=$(du -h "${ARCHIVE_PATH}" | cut -f1)
  sha256sum "${ARCHIVE_PATH}" > "${ARCHIVE_PATH}.sha256"
  ok "Archiv: ${SIZE}"
else
  BACKUP_STATUS="error"
  BACKUP_MESSAGE="Archiv konnte nicht gebaut werden"
  exit 1
fi

# Aufbewahrung
find "${BACKUP_DIR}/daily" -type f -name 'portal-*' -mtime +${BACKUP_RETENTION_DAYS:-14} -delete 2>/dev/null || true
if [ "$(date +%d)" = "01" ]; then
  cp -a "${ARCHIVE_PATH}" "${BACKUP_DIR}/monthly/" 2>/dev/null || true
fi
find "${BACKUP_DIR}/monthly" -type f -mtime +90 -delete 2>/dev/null || true

# Report
REPORT="${BACKUP_DIR}/logs/report-${STAMP}.json"
cat > "$REPORT" <<EOF
{
  "host": "backup-orchestrator",
  "timestamp": "$(date -Iseconds)",
  "mode": "${BACKUP_MODE}",
  "archive": "${ARCHIVE_NAME}",
  "size": "${SIZE}",
  "status": "success",
  "backup_host": "${BACKUP_DIR}"
}
EOF

BACKUP_STATUS="success"
BACKUP_MESSAGE="OK"
ok "Orchestrator-Backup abgeschlossen: ${ARCHIVE_PATH}"
info "Report: ${REPORT}"
