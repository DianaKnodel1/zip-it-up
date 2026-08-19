#!/usr/bin/env bash
# =============================================================================
#  install-backup-timer.sh — Richtet auf dem aktuellen Server die 6h-Sicherung ein
#
#  AUF DEM SERVER, DER GESICHERT WERDEN SOLL, ALS ROOT AUSFÜHREN:
#    bash scripts/install-backup-timer.sh
# =============================================================================
set -euo pipefail

cd "$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "scripts/backup.env" ]; then
  echo "✗ scripts/backup.env fehlt. Kopiere scripts/backup.env.example und fülle es aus." >&2
  exit 1
fi

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }

log "1/4  age (Verschlüsselung) installieren"
if ! command -v age >/dev/null; then
  if command -v apt-get >/dev/null; then apt-get update && apt-get install -y age; fi
  if command -v dnf >/dev/null; then dnf install -y age; fi
  if ! command -v age >/dev/null; then
    echo "age konnte nicht installiert werden. Fahre ohne Verschlüsselung fort (AGE_PUBLIC_KEY leer lassen)." >&2
  fi
fi
command -v age >/dev/null && ok "age installiert" || ok "age nicht nötig"

log "2/4  systemd-Units kopieren"
cp "scripts/systemd/backup.service" /etc/systemd/system/portal-backup.service
cp "scripts/systemd/backup.timer" /etc/systemd/system/portal-backup.timer
ok "Units installiert"

log "3/4  systemd neu laden und Timer aktivieren"
systemctl daemon-reload
systemctl enable portal-backup.timer
systemctl start portal-backup.timer
ok "Timer aktiviert"

log "4/4  Testlauf (nur Verbindung)"
if "scripts/backup-status.sh" >/dev/null 2>&1; then
  ok "Backup-Server erreichbar / Status abrufbar"
else
  echo "  ! Backup-Server noch nicht per ssh-copy-id eingerichtet." >&2
  echo "    Führe aus: ssh-copy-id -i ~/.ssh/id_rsa.pub backup@<BACKUP_HOST>" >&2
fi

systemctl status portal-backup.timer --no-pager
ok "Installation abgeschlossen. Nächstes Backup: systemctl list-timers portal-backup.timer"
