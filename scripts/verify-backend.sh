#!/usr/bin/env bash
# verify-backend.sh — Checks if database schema is up-to-date

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/apps/portal}"
ENV_FILE="$PROJECT_DIR/.env.server"
[ -f "$ENV_FILE" ] || ENV_FILE="$PROJECT_DIR/.env"

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m  ! %s\033[0m\n" "$*"; }

env_file_value() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^${key}=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/'
}

TARGET_DB_URL="$(env_file_value TARGET_DB_URL || true)"

if [ -z "$TARGET_DB_URL" ]; then
  warn "TARGET_DB_URL not found in $ENV_FILE"
  echo "Please run: echo 'TARGET_DB_URL=postgresql://postgres:PASSWORD@190.97.167.123:5432/postgres' >> $ENV_FILE"
  exit 1
fi

log "Checking Database Connection..."
if ! psql "$TARGET_DB_URL" -tAc 'select 1' >/dev/null 2>&1; then
  warn "Cannot connect to database. Check credentials and network."
  exit 1
fi
ok "Connected to Database."

log "Checking Schema Status..."

check_table() {
  local table="$1"
  if [ "$(psql "$TARGET_DB_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_name = '$table' AND table_schema = 'public';")" = "1" ]; then
    ok "Table '$table' exists."
    return 0
  else
    warn "Table '$table' is MISSING."
    return 1
  fi
}

check_column() {
  local table="$1"
  local col="$2"
  if [ "$(psql "$TARGET_DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name = '$table' AND column_name = '$col';")" = "1" ]; then
    ok "Column '$table.$col' exists."
    return 0
  else
    warn "Column '$table.$col' is MISSING."
    return 1
  fi
}

FAILED=0

# Critical tables/columns from recent migrations
check_table "bot_proxies" || FAILED=1
check_table "ai_style_corrections" || FAILED=1
check_table "landing_pages" || FAILED=1
check_table "partner_companies" || FAILED=1
check_column "task_assignments" "assignment_group" || FAILED=1
check_column "task_templates" "assignment_mode" || FAILED=1
check_column "tenants" "mailless_mode" || FAILED=1
check_column "tenants" "team_leader_name" || FAILED=1
check_column "tenants" "whatsapp_number" || FAILED=1


if [ "$FAILED" -eq 1 ]; then
  log "RESULT: Backend is NOT up-to-date."
  echo "Please run 'bash $PROJECT_DIR/scripts/deploy.sh' to apply migrations."
  exit 1
else
  log "RESULT: Backend is UP-TO-DATE. All schema changes applied."
  exit 0
fi
