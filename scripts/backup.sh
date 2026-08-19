#!/usr/bin/env bash
# =============================================================================
#  backup.sh — Sichert Portal, Backend, Landing, Bot, WebID in ein Archiv
#  und kopiert es per rsync auf einen separaten Backup-Server.
#
#  AUF DEM SERVER, DER GESICHERT WERDEN SOLL, ALS ROOT AUSFÜHREN:
#    bash scripts/backup.sh full
#    bash scripts/backup.sh db       # nur Datenbank
#
#  Voraussetzung: scripts/backup.env mit BACKUP_HOST und BACKUP_USER.
#  Alternativ die Werte als Umgebungsvariablen setzen.
# =============================================================================
set -euo pipefail

cd "$(cd "$(dirname "$0")/.." && pwd)"

# ── Konfiguration ───────────────────────────────────────────────────────────
CONF_FILE="scripts/backup.env"
[ -f "$CONF_FILE" ] || { echo "✗ $CONF_FILE fehlt. Kopiere von backup.env.example." >&2; exit 1; }
# shellcheck disable=SC1090
. "$CONF_FILE"

# Verpflichtend
: "${BACKUP_HOST:?BACKUP_HOST fehlt in $CONF_FILE}"
: "${BACKUP_USER:?BACKUP_USER fehlt in $CONF_FILE}"
: "${BACKUP_DIR:?BACKUP_DIR fehlt in $CONF_FILE}"

# Defaults
BACKUP_MODE="${1:-full}"
SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
PROJECT_DIR="${PROJECT_DIR:-/opt/apps/portal}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_PREFIX="${BACKUP_PREFIX:-portal}"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
SSH="ssh ${SSH_OPTS} ${BACKUP_USER}@${BACKUP_HOST}"
RSYNC="rsync -avz --human-readable --progress"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP_BASE="${TMPDIR:-/tmp}/portal-backup-${STAMP}"
mkdir -p "$TMP_BASE"
REPORT_FILE="${TMP_BASE}/report.json"

log()  { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m  ! %s\033[0m\n" "$*"; }
info() { printf "  · %s\n" "$*"; }

# ── 1/5  Backup-Server vorbereiten ───────────────────────────────────────────
log "1/5  Backup-Server ${BACKUP_HOST} vorbereiten"
if ! $SSH "mkdir -p ${BACKUP_DIR}/daily ${BACKUP_DIR}/monthly ${BACKUP_DIR}/logs"; then
  echo "✗ SSH auf ${BACKUP_USER}@${BACKUP_HOST} nicht möglich." >&2
  echo "   → einmalig: ssh-copy-id ${BACKUP_USER}@${BACKUP_HOST}" >&2
  exit 1
fi
ok "Backup-Server erreichbar"

# ── 2/5  Datenbank-Dump ──────────────────────────────────────────────────────
log "2/5  Datenbank-Dump"
DUMP_FILE="${TMP_BASE}/db.dump"
if docker ps --format '{{.Names}}' | grep -qx "${DB_CONTAINER}"; then
  info "pg_dump aus Container ${DB_CONTAINER}"
  docker exec "${DB_CONTAINER}" pg_dump -U postgres -Fc postgres > "${DUMP_FILE}"
  ok "Datenbank-Dump: $(du -h "${DUMP_FILE}" | cut -f1)"
else
  warn "Container ${DB_CONTAINER} nicht gefunden — versuche lokale pg_dump"
  if command -v pg_dump >/dev/null; then
    pg_dump -Fc postgres > "${DUMP_FILE}" || warn "pg_dump fehlgeschlagen"
  else
    warn "Weder Container noch pg_dump verfügbar — Datenbank wird übersprungen"
  fi
fi

# ── 3/5  Volumes & Konfiguration sammeln ───────────────────────────────────
log "3/5  Volumes & Konfiguration sammeln"
mkdir -p "${TMP_BASE}/config"

[ -f "${PROJECT_DIR}/.env" ] && cp -a "${PROJECT_DIR}/.env" "${TMP_BASE}/config/dotenv"
[ -f "${PROJECT_DIR}/.env.server" ] && cp -a "${PROJECT_DIR}/.env.server" "${TMP_BASE}/config/dotenv-server"
[ -d /etc/nginx ] && cp -a /etc/nginx "${TMP_BASE}/config/nginx" || true
[ -d /etc/systemd/system ] && cp -a /etc/systemd/system "${TMP_BASE}/config/systemd" || true

# Supabase-Config, Volumes, Edge-Functions
if [ -d "${SUPABASE_DIR}" ]; then
  info "Sichere ${SUPABASE_DIR}"
  mkdir -p "${TMP_BASE}/supabase"
  # Wichtige Teile, nicht den ganzen Docker-Container-Layer-Cache
  for sub in volumes .env docker docker-compose.yml docker-compose.yaml; do
    [ -e "${SUPABASE_DIR}/${sub}" ] && cp -a "${SUPABASE_DIR}/${sub}" "${TMP_BASE}/supabase/${sub}" 2>/dev/null || true
  done
  ok "Supabase-Config und Volumes kopiert"
else
  warn "${SUPABASE_DIR} nicht gefunden — übersprungen"
fi

# Landing-Server Code und Assets (falls auf anderem Server, läuft dort eigenes Backup)
if [ -d /opt/apps/landing ]; then
  info "Sichere Landing-Server /opt/apps/landing"
  cp -a /opt/apps/landing "${TMP_BASE}/landing" || warn "Landing-Server kopieren fehlgeschlagen"
fi

# Bot-Runner (ist im Repo enthalten, aber lokale .env/state nützlich)
if [ -d /opt/apps/portal/bot-runner ]; then
  info "Sichere Bot-Runner Config"
  cp -a /opt/apps/portal/bot-runner "${TMP_BASE}/bot-runner" || warn "Bot-Runner kopieren fehlgeschlagen"
fi

# WebID-Sim
if [ -d /opt/apps/webid-sim ]; then
  info "Sichere WebID-Sim Config"
  cp -a /opt/apps/webid-sim "${TMP_BASE}/webid-sim" || warn "WebID-Sim kopieren fehlgeschlagen"
fi

# ── 4/5  Archiv bauen, Checksumme, ggf. verschlüsseln ────────────────────────
log "4/5  Archiv bauen und Checksumme"
ARCHIVE_NAME="${BACKUP_PREFIX}-${STAMP}-${BACKUP_MODE}.tar.gz"
ARCHIVE_PATH="${TMP_BASE}/${ARCHIVE_NAME}"

# tar excludes: Docker-Layer, node_modules, Logs, Cache
find "${TMP_BASE}" -maxdepth 1 -mindepth 1 -not -name "${ARCHIVE_NAME}" \
  | tar -czf "${ARCHIVE_PATH}" -C "${TMP_BASE}" -T - \
    --exclude='node_modules' --exclude='.next' --exclude='.output' \
    --exclude='*.log' --exclude='logs' --exclude='.cache' --exclude='tmp' \
    2>/dev/null || true

# Falls leer (z. B. nur Config ohne DB): leeres tar erlaubt, aber warnen
if [ ! -f "${ARCHIVE_PATH}" ] || [ "$(stat -c%s "${ARCHIVE_PATH}" 2>/dev/null || echo 0)" -lt 100 ]; then
  warn "Archiv ist sehr klein oder leer — Konfiguration fehlerhaft?"
fi

# Checksumme
sha256sum "${ARCHIVE_PATH}" > "${ARCHIVE_PATH}.sha256"
ok "Archiv: $(du -h "${ARCHIVE_PATH}" | cut -f1)"

# Verschlüsselung (optional, empfohlen)
if [ -n "${AGE_PUBLIC_KEY:-}" ] && command -v age >/dev/null; then
  info "Verschlüssele Archiv mit age"
  age -r "${AGE_PUBLIC_KEY}" -o "${ARCHIVE_PATH}.age" "${ARCHIVE_PATH}"
  rm -f "${ARCHIVE_PATH}"
  ARCHIVE_PATH="${ARCHIVE_PATH}.age"
  sha256sum "${ARCHIVE_PATH}" > "${ARCHIVE_PATH}.sha256"
  ok "Verschlüsselt: $(du -h "${ARCHIVE_PATH}" | cut -f1)"
fi

# ── 5/5  Auf Backup-Server übertragen ──────────────────────────────────────
log "5/5  Auf Backup-Server übertragen und aufräumen"
$RSYNC "${ARCHIVE_PATH}" "${ARCHIVE_PATH}.sha256" \
  "${BACKUP_USER}@${BACKUP_HOST}:${BACKUP_DIR}/daily/"

# Aufbewahrung auf dem Backup-Server: täglich 14 Tage, monatlich 3 Monate
$SSH "bash -s" <<EOF
set -euo pipefail
D="${BACKUP_DIR}/daily"
M="${BACKUP_DIR}/monthly"
# Tages-Backups löschen, die älter als ${BACKUP_RETENTION_DAYS} Tage sind
find "\$D" -type f -name '${BACKUP_PREFIX}-*' -mtime +${BACKUP_RETENTION_DAYS} -delete 2>/dev/null || true
# Monats-Backup am ersten Tag des Monats behalten
if [ "$(date +%d)" = "01" ]; then
  latest=\$(ls -1t "\$D" | head -n1)
  [ -n "\$latest" ] && cp -a "\$D/\$latest" "\$M/" 2>/dev/null || true
fi
# Monats-Backups älter als 90 Tage löschen
find "\$M" -type f -mtime +90 -delete 2>/dev/null || true
EOF

# Report schreiben (lokal + remote)
SIZE=$(du -h "${ARCHIVE_PATH}" | cut -f1)
END=$(date -Iseconds)
cat > "${REPORT_FILE}" <<EOF
{
  "host": "$(hostname)",
  "timestamp": "${END}",
  "mode": "${BACKUP_MODE}",
  "archive": "${ARCHIVE_NAME}${AGE_PUBLIC_KEY:+.age}",
  "size": "${SIZE}",
  "retention_days": ${BACKUP_RETENTION_DAYS},
  "backup_host": "${BACKUP_HOST}"
}
EOF

$RSYNC "${REPORT_FILE}" "${BACKUP_USER}@${BACKUP_HOST}:${BACKUP_DIR}/logs/report-${STAMP}.json"

# Lokale Temp-Dateien aufräumen
rm -rf "${TMP_BASE}"

ok "Backup abgeschlossen: ${BACKUP_DIR}/daily/${ARCHIVE_NAME}${AGE_PUBLIC_KEY:+.age}"
info "Letzter Status: ${BACKUP_DIR}/logs/report-${STAMP}.json"
