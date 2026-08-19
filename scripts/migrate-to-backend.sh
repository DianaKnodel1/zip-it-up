#!/usr/bin/env bash
# apply-manual-migrations.sh — Hilfsskript für den Benutzer
set -euo pipefail

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }

CONTAINER=$(docker ps --format "{{.Names}}" | grep -E "db|postgres" | head -n 1)
if [ -z "$CONTAINER" ]; then
  echo "Fehler: Kein Datenbank-Container gefunden."
  exit 1
fi

MIG_DIR="./supabase/manual-migrations"
STATE_FILE="/tmp/migrations_applied.log"
touch "$STATE_FILE"

log "Starte manuelle Migrations auf Datenbank-Container: $CONTAINER"

for sql in $(ls "$MIG_DIR"/*.sql 2>/dev/null | sort); do
  name=$(basename "$sql")
  if ! grep -qxF "$name" "$STATE_FILE"; then
    echo "Applying $name..."
    # Wir nutzen den bereits bekannten Superuser supabase_admin
    cat "$sql" | docker exec -i -u postgres "$CONTAINER" psql -d postgres -U supabase_admin > /dev/null
    echo "$name" >> "$STATE_FILE"
    ok "$name applied"
  else
    echo "Skipping $name (already applied)"
  fi
done

ok "Alle Migrations erfolgreich angewendet! ✅"
