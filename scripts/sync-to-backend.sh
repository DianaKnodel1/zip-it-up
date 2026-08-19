#!/bin/bash
set -euo pipefail
BACKEND_IP="190.97.167.123"
BACKEND_USER="root"
REMOTE_PATH="/opt/apps/portal"

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }

log "1/3 Verzeichnis auf .123 sicherstellen"
ssh "$BACKEND_USER@$BACKEND_IP" "mkdir -p '$REMOTE_PATH/supabase/manual-migrations'"

log "2/3 Migrationen übertragen"
scp supabase/manual-migrations/*.sql "$BACKEND_USER@$BACKEND_IP:$REMOTE_PATH/supabase/manual-migrations/"

log "3/3 Migrationen anwenden"
ssh "$BACKEND_USER@$BACKEND_IP" "bash -s" <<'REMOTEOF'
  set -euo pipefail
  DOCKER_BIN=$(which docker || echo "/usr/bin/docker")
  CONTAINER=$($DOCKER_BIN ps --format "{{.Names}}" | grep -E "db|postgres" | head -n 1)
  STATE_FILE="/opt/apps/portal/.backend-migrations-applied"
  touch "$STATE_FILE"
  for sql in $(find /opt/apps/portal/supabase/manual-migrations -maxdepth 1 -type f -name '*.sql' | sort); do
    name=$(basename "$sql")
    if ! grep -qxF "$name" "$STATE_FILE"; then
      echo "Applying $name..."
      if $DOCKER_BIN exec -i -u postgres "$CONTAINER" psql -d postgres -U supabase_admin -v ON_ERROR_STOP=1 --single-transaction < "$sql"; then
        echo "$name" >> "$STATE_FILE"
      else
        exit 1
      fi
    fi
  done
REMOTEOF
ok "Backend aktualisiert"
