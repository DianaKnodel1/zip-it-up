#!/usr/bin/env bash
# =============================================================================
#  REMOTE-DEPLOY.SH — Automatisiertes Full-Stack Deployment von .124 -> .123
# =============================================================================

set -euo pipefail

BACKEND_IP="190.97.167.123"
BACKEND_USER="root"
PROJECT_DIR="/opt/apps/portal"

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }
err() { printf "\033[1;31m  ✗ %s\033[0m\n" "$*"; exit 1; }

cd "$PROJECT_DIR"

log "1/4  Lokal auf .124: Git Pull & Build"
git fetch --all
git reset --hard origin/main
bun install --frozen-lockfile
NODE_OPTIONS="--max-old-space-size=4096" bun run build
ok "Build auf .124 abgeschlossen"

log "2/4  Synchronisierung der Dateien nach .123"
ssh "$BACKEND_USER@$BACKEND_IP" "mkdir -p '$PROJECT_DIR/.output' '$PROJECT_DIR/supabase' '$PROJECT_DIR/scripts'"
rsync -avz --delete .output/ "$BACKEND_USER@$BACKEND_IP:$PROJECT_DIR/.output/"
rsync -avz supabase/ "$BACKEND_USER@$BACKEND_IP:$PROJECT_DIR/supabase/"
rsync -avz scripts/ "$BACKEND_USER@$BACKEND_IP:$PROJECT_DIR/scripts/"
ok "Dateien auf .123 synchronisiert"

log "3/4  Datenbank-Migrationen auf .123 ausführen"
bash scripts/sync-to-backend.sh
ok "Datenbank ist aktuell"

log "4/4  Dienst auf .123 neu starten (falls vorhanden)"
ssh "$BACKEND_USER@$BACKEND_IP" "systemctl restart portal.service 2>/dev/null || echo 'Kein systemd Dienst auf .123 - überspringe Restart'"

ok "Full-Stack Deployment von .124 auf .123 abgeschlossen! ✅"
