#!/usr/bin/env bash
# =============================================================================
#  install-backup-orchestrator.sh — Richtet den zentralen Backup-Orchestrator
#  auf dem Backup-Server ein.
#
#  AUF DEM BACKUP-SERVER ALS ROOT:
#    bash scripts/install-backup-orchestrator.sh
# =============================================================================
set -euo pipefail

cd "$(cd "$(dirname "$0")/.." && pwd)" 2>/dev/null || cd /opt/apps/portal

if [ ! -f "scripts/backup-orchestrator.env" ]; then
  echo "✗ scripts/backup-orchestrator.env fehlt. Kopiere scripts/backup-orchestrator.env.example und fülle es aus." >&2
  exit 1
fi

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }

log "1/3  Abhängigkeiten installieren"
if command -v apt-get >/dev/null; then apt-get update && apt-get install -y rsync openssh-client; fi
if command -v dnf >/dev/null; then dnf install -y rsync openssh-clients; fi
ok "rsync/ssh vorhanden"

log "2/3  systemd-Units kopieren"
cp "scripts/systemd/backup-orchestrator.service" /etc/systemd/system/
cp "scripts/systemd/backup-orchestrator.timer" /etc/systemd/system/
ok "Units installiert"

log "3/3  Timer aktivieren"
systemctl daemon-reload
systemctl enable backup-orchestrator.timer
systemctl start backup-orchestrator.timer
ok "Timer aktiviert"

systemctl status backup-orchestrator.timer --no-pager
ok "Nächstes Backup: systemctl list-timers backup-orchestrator.timer"
