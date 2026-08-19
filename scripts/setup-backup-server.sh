#!/usr/bin/env bash
# =============================================================================
#  setup-backup-server.sh — Erst-Setup für den dedizierten Backup-Server
#
#  AUF DEM NEUEN BACKUP-SERVER ALS ROOT AUSFÜHREN:
#    SSH_PUBLIC_KEY="ssh-rsa AAAA..." bash setup-backup-server.sh
#
#  ODER vorab einfach nur anlegen:
#    bash setup-backup-server.sh
#  und dann auf den anderen Servern ssh-copy-id ausführen.
# =============================================================================
set -euo pipefail

BACKUP_USER="${BACKUP_USER:-backup}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/portal}"
SSH_KEY_FILE="${SSH_KEY_FILE:-/tmp/backup-server-key.pub}"

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }

log "1/4  System aktualisieren und rsync installieren"
if command -v apt-get >/dev/null; then
  apt-get update
  apt-get install -y rsync cron openssh-server
elif command -v dnf >/dev/null; then
  dnf install -y rsync cronie openssh-server
else
  echo "Weder apt noch dnf gefunden — bitte rsync, cron und ssh manuell installieren" >&2
  exit 1
fi
ok "Pakete vorhanden"

log "2/4  Backup-User ${BACKUP_USER} anlegen"
if id -u "${BACKUP_USER}" >/dev/null 2>&1; then
  ok "User ${BACKUP_USER} existiert bereits"
else
  useradd -m -s /bin/bash -d "/home/${BACKUP_USER}" "${BACKUP_USER}"
  ok "User ${BACKUP_USER} angelegt"
fi

mkdir -p "${BACKUP_DIR}/daily" "${BACKUP_DIR}/monthly" "${BACKUP_DIR}/logs"
chown -R "${BACKUP_USER}:${BACKUP_USER}" "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"
ok "Backup-Verzeichnis ${BACKUP_DIR} angelegt"

log "3/4  SSH-Key für rsync einrichten"
mkdir -p "/home/${BACKUP_USER}/.ssh"
chmod 700 "/home/${BACKUP_USER}/.ssh"

if [ -f "$SSH_KEY_FILE" ]; then
  cat "$SSH_KEY_FILE" >> "/home/${BACKUP_USER}/.ssh/authorized_keys"
elif [ -n "${SSH_PUBLIC_KEY:-}" ]; then
  echo "$SSH_PUBLIC_KEY" >> "/home/${BACKUP_USER}/.ssh/authorized_keys"
fi

touch "/home/${BACKUP_USER}/.ssh/authorized_keys"
chmod 600 "/home/${BACKUP_USER}/.ssh/authorized_keys"
chown -R "${BACKUP_USER}:${BACKUP_USER}" "/home/${BACKUP_USER}/.ssh"
ok "authorized_keys aktualisiert"

log "4/4  rsync-Wrapper einschränken (optional, sicherer)"
# Wenn der public key noch nicht vorhanden ist, wird das im nächsten Schritt
# manuell ergänzt. Bei existierendem Key kann er auf "command=\"rsync --server ...\""
# beschränkt werden — dazu bitte die Anleitung in docs/DISASTER-RECOVERY.md befolgen.

ok "Backup-Server bereit"
info() { printf "  · %s\n" "$*"; }
info "Nun auf dem Portal-/Backend-Server ausführen:"
info "  ssh-copy-id -i ~/.ssh/id_rsa.pub ${BACKUP_USER}@<backup-server-ip>"
info "Danach kann scripts/backup.sh dort gestartet werden."
