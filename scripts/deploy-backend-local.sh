#!/usr/bin/env bash
# =============================================================================
#  deploy-backend-local.sh — Backend-Deploy DIREKT AUF DEM BACKEND-SERVER
#  (kein SSH, keine backend-server.env noetig)
#
#    1) neue SQL-Migrations aus supabase/manual-migrations/ anwenden (mit Backup)
#    2) Edge Functions nach /opt/supabase/volumes/functions/ kopieren
#    3) Edge-Container neu starten + Status zeigen
#
#  Verwendung (auf dem Backend-Server):
#     cd /opt/apps/portal-migrations && bash scripts/deploy-backend-local.sh
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SUPABASE_DIR="${BACKEND_SUPABASE_DIR:-/opt/supabase}"
DB_CT="${BACKEND_DB_CONTAINER:-supabase-db}"
FN_CT="${BACKEND_FUNCTIONS_CONTAINER:-supabase-edge-functions}"
REST_CT="${BACKEND_REST_CONTAINER:-supabase-rest}"

log()  { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m  ! %s\033[0m\n" "$*"; }
info() { printf "  · %s\n" "$*"; }

[ -d "$SUPABASE_DIR" ] || { echo "✗ $SUPABASE_DIR existiert nicht — laeuft dieses Skript wirklich auf dem Backend-Server?" >&2; exit 1; }
docker inspect "$DB_CT" >/dev/null 2>&1 || { echo "✗ Container $DB_CT nicht gefunden." >&2; exit 1; }

# ── 1/3  SQL-Migrations ────────────────────────────────────────────────────
log "1/3  SQL-Migrations"
MIG_SRC="$REPO_DIR/supabase/manual-migrations"
STATE="$SUPABASE_DIR/.migrations-applied"
touch "$STATE"

if [ ! -d "$MIG_SRC" ]; then
  warn "Kein Ordner supabase/manual-migrations/ — uebersprungen"
else
  NEW="$(ls "$MIG_SRC"/*.sql 2>/dev/null | sort | while read -r f; do
    grep -qxF "$(basename "$f")" "$STATE" || echo "$f"
  done)"
  if [ -z "$NEW" ]; then
    info "keine neuen Migrations"
  else
    echo "$NEW" | sed 's|^|      |'
    mkdir -p "$SUPABASE_DIR/backups"
    BACKUP="$SUPABASE_DIR/backups/pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz"
    info "pg_dump → $BACKUP"
    docker exec "$DB_CT" pg_dump -U postgres -d postgres | gzip > "$BACKUP"
    echo "$NEW" | while read -r sql; do
      name="$(basename "$sql")"
      info "apply: $name"
      # Eine Migration ist atomar: Bei einem Fehler wird die komplette Datei
      # zurueckgerollt, statt das Schema halb geaendert zu hinterlassen.
      docker exec -i "$DB_CT" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 --single-transaction < "$sql"
      echo "$name" >> "$STATE"
      ok "$name"
    done
  fi
  ok "Migrations aktuell"
fi

# ── 1b/3  API-Schema-Cache neu laden ───────────────────────────────────────
# PostgREST cached das Schema. Ohne Reload meldet das Portal nach jeder
# Spalten-Migration: "Could not find the '<spalte>' column ... in the schema cache".
log "1b/3  API-Schema-Cache neu laden"
docker exec -i "$DB_CT" psql -U supabase_admin -d postgres -c "NOTIFY pgrst, 'reload schema';" >/dev/null 2>&1 \
  && ok "NOTIFY pgrst gesendet" || warn "NOTIFY pgrst fehlgeschlagen"
if docker inspect "$REST_CT" >/dev/null 2>&1; then
  docker restart "$REST_CT" >/dev/null && ok "Container $REST_CT neu gestartet"
else
  warn "Container $REST_CT nicht gefunden — nur NOTIFY genutzt"
fi

# ── 2/3  Edge Functions ────────────────────────────────────────────────────
log "2/3  Edge Functions"
FN_SRC="$REPO_DIR/supabase/functions"
FN_DST="$SUPABASE_DIR/volumes/functions"

if [ ! -d "$FN_SRC" ]; then
  warn "Kein Ordner supabase/functions/ — uebersprungen"
else
  for fn in main send-chat-reminder send-invitation-email send-application-reminders \
            send-appointment-reminders send-booking-confirmation send-reminders \
            send-signup-confirmation resend-signup-confirmation send-password-reset \
            process-invite-resend-queue email-preview email-resend smtp-test; do
    [ -f "$FN_SRC/$fn/index.ts" ] || { echo "  ✗ fehlt: $FN_SRC/$fn/index.ts" >&2; exit 1; }
  done
  mkdir -p "$FN_DST"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude='.DS_Store' "$FN_SRC/" "$FN_DST/"
  else
    rm -rf "$FN_DST" && mkdir -p "$FN_DST" && cp -a "$FN_SRC/." "$FN_DST/"
  fi
  info "restart container: $FN_CT"
  docker restart "$FN_CT" >/dev/null
  ok "Edge Functions deployed"
fi

# ── 3/3  Status ────────────────────────────────────────────────────────────
log "3/3  Status"

# Pflichtspalten pruefen — schlaegt an, wenn eine Migration nie gelaufen ist
MISSING="$(docker exec -i "$DB_CT" psql -U supabase_admin -d postgres -tAc "
  SELECT string_agg(x.t || '.' || x.c, ', ')
  FROM (VALUES
    ('tenants','webid_enabled'),
    ('tenants','allowed_employment_types'),
    ('tenants','emails_paused'),
    ('tenants','mailless_mode'),
    ('tenants','bewerbung_magic_link_subject'),
    ('email_send_log','message_id')
  ) AS x(t,c)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name=x.t AND column_name=x.c
  );" 2>/dev/null | tr -d '[:space:]')"
if [ -n "$MISSING" ]; then
  warn "Fehlende Spalten: $MISSING"
  warn "→ betroffene Migration erneut anwenden (Eintrag aus $STATE entfernen und Skript neu starten)"
else
  ok "Schema vollstaendig"
fi

docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'supabase|NAMES' || true
echo
ok "Fertig ✅"
