#!/usr/bin/env bash
# =============================================================================
#  backup-status.sh — Gibt JSON-Status zum letzten Backup zurück
#  AUF DEM SERVER ALS ROOT AUSFÜHREN.
# =============================================================================
set -euo pipefail

CONF_FILE="${1:-$(cd "$(dirname "$0")/.." && pwd)/scripts/backup.env}"
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

BACKUP_HOST="${BACKUP_HOST:-}"
BACKUP_USER="${BACKUP_USER:-backup}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/portal}"

if [ -n "$BACKUP_HOST" ]; then
  # Report vom Backup-Server holen
  latest=$(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 "${BACKUP_USER}@${BACKUP_HOST}" \
    "ls -1t ${BACKUP_DIR}/logs/report-*.json 2>/dev/null | head -n1" 2>/dev/null || true)
  if [ -n "$latest" ]; then
    ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 "${BACKUP_USER}@${BACKUP_HOST}" \
      "cat ${latest}" 2>/dev/null && exit 0
  fi
fi

# Fallback: lokal letzten Report suchen
latest=$(find /var/backups/portal/logs /tmp -name 'report-*.json' 2>/dev/null | sort -r | head -n1 || true)
if [ -n "$latest" ] && [ -f "$latest" ]; then
  cat "$latest"
  exit 0
fi

# Nichts gefunden
printf '{"status":"unknown","message":"Kein Backup-Report gefunden"}\n'
