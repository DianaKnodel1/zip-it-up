#!/usr/bin/env bash
# =============================================================================
#  restore.sh — Spielt ein Portal-Backup auf einem frischen Server ein.
#
#  AUF DEM NEUEN SERVER ALS ROOT AUSFÜHREN:
#    bash scripts/restore.sh /pfad/zu/portal-20260820-030000-full.tar.gz
#
#  Achtung: Bricht ab, wenn die Ziel-Datenbank bereits Daten enthält
#  (Schutz vor versehentlichem Überschreiben eines laufenden Systems).
# =============================================================================
set -euo pipefail

cd "$(cd "$(dirname "$0")/.." && pwd)"

ARCHIVE="${1:?"Archiv-Pfad fehlt: bash scripts/restore.sh <archiv>"}"
CONF_FILE="scripts/backup.env"
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
PROJECT_DIR="${PROJECT_DIR:-/opt/apps/portal}"
TMP_BASE="${TMPDIR:-/tmp}/portal-restore-$(date +%Y%m%d-%H%M%S)"

log()  { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m  ! %s\033[0m\n" "$*"; }
info() { printf "  · %s\n" "$*"; }

# ── 0/6  Prüfungen ───────────────────────────────────────────────────────────
log "0/6  Prüfungen"
if [ ! -f "$ARCHIVE" ]; then echo "✗ Archiv nicht gefunden: $ARCHIVE" >&2; exit 1; fi

# Prüfsumme prüfen, falls vorhanden
if [ -f "${ARCHIVE}.sha256" ]; then
  sha256sum -c "${ARCHIVE}.sha256" || { echo "✗ Checksumme stimmt nicht" >&2; exit 1; }
  ok "Checksumme OK"
fi

# Entschlüsseln, falls .age-Datei
if [[ "$ARCHIVE" == *.age ]]; then
  if ! command -v age >/dev/null; then
    echo "✗ age nicht installiert — Archiv kann nicht entschlüsselt werden" >&2; exit 1
  fi
  info "Entschlüssele Archiv"
  age -d -o "${TMP_BASE}.tar.gz" "$ARCHIVE"
  ARCHIVE="${TMP_BASE}.tar.gz"
fi

mkdir -p "$TMP_BASE"

# ── 1/6  Archiv entpacken ───────────────────────────────────────────────────
log "1/6  Archiv entpacken"
tar -xzf "$ARCHIVE" -C "$TMP_BASE"
# Archiv enthält ein Unterverzeichnis wie portal-2026...
EXTRACT_DIR="$(find "$TMP_BASE" -maxdepth 1 -type d | tail -n +2 | head -n1)"
[ -z "$EXTRACT_DIR" ] && EXTRACT_DIR="$TMP_BASE"
ok "Entpackt nach $EXTRACT_DIR"

# ── 2/6  Sicherheit: Datenbank leer? ─────────────────────────────────────────
log "2/6  Sicherheitscheck: Ziel-Datenbank leer?"
if docker ps --format '{{.Names}}' | grep -qx "${DB_CONTAINER}"; then
  DB_HAS_DATA=$(docker exec "${DB_CONTAINER}" psql -U postgres -d postgres -tAc \
    "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'pg_%';" 2>/dev/null || echo "0")
  if [ "${DB_HAS_DATA:-0}" -gt 0 ]; then
    warn "Datenbank enthält bereits ${DB_HAS_DATA} Tabellen im public-Schema!"
    warn "Restore auf einem laufenden System würde Daten überschreiben."
    read -rp "Trotzdem fortfahren? [NEIN/ja] " ANSWER
    if [ "$ANSWER" != "ja" ]; then
      echo "Abbruch." >&2; exit 1
    fi
  else
    ok "Datenbank ist leer"
  fi
else
  warn "Container ${DB_CONTAINER} nicht gestartet — bitte Supabase erst einrichten"
fi

# ── 3/6  Config-Dateien zurückspielen ───────────────────────────────────────
log "3/6  Config-Dateien zurückspielen"
[ -f "${EXTRACT_DIR}/config/dotenv" ] && cp -a "${EXTRACT_DIR}/config/dotenv" "${PROJECT_DIR}/.env" && ok "${PROJECT_DIR}/.env"
[ -f "${EXTRACT_DIR}/config/dotenv-server" ] && cp -a "${EXTRACT_DIR}/config/dotenv-server" "${PROJECT_DIR}/.env.server" && ok "${PROJECT_DIR}/.env.server"
[ -d "${EXTRACT_DIR}/config/nginx" ] && cp -a "${EXTRACT_DIR}/config/nginx" /etc/nginx && ok "/etc/nginx"
[ -d "${EXTRACT_DIR}/config/systemd" ] && cp -a "${EXTRACT_DIR}/config/systemd" /etc/systemd/system && ok "/etc/systemd/system"

# ── 4/6  Datenbank-Restore ──────────────────────────────────────────────────
log "4/6  Datenbank-Restore"
DUMP_FILE="$(find "${EXTRACT_DIR}" -name "db.dump" -o -name "db.dump.gz" | head -n1)"
if [ -n "$DUMP_FILE" ] && docker ps --format '{{.Names}}' | grep -qx "${DB_CONTAINER}"; then
  info "Restore aus ${DUMP_FILE}"
  docker exec -i "${DB_CONTAINER}" pg_restore -U postgres -d postgres --clean --if-exists < "$DUMP_FILE" \
    || warn "pg_restore meldete Fehler (teilweise schon vorhandene Objekte) — bitte Log prüfen"
  ok "Datenbank-Restore durchgeführt"
else
  warn "Kein Dump gefunden oder Container nicht bereit"
fi

# ── 5/6  Volumes & Code zurückspielen ───────────────────────────────────────
log "5/6  Volumes & Code zurückspielen"
[ -d "${EXTRACT_DIR}/supabase" ] && cp -a "${EXTRACT_DIR}/supabase"/* "${SUPABASE_DIR}/" && ok "Supabase-Volumes"
[ -d "${EXTRACT_DIR}/landing" ] && cp -a "${EXTRACT_DIR}/landing" /opt/apps/landing && ok "Landing-Server"
[ -d "${EXTRACT_DIR}/bot-runner" ] && cp -a "${EXTRACT_DIR}/bot-runner" "${PROJECT_DIR}/bot-runner" && ok "Bot-Runner"
[ -d "${EXTRACT_DIR}/webid-sim" ] && cp -a "${EXTRACT_DIR}/webid-sim" /opt/apps/webid-sim && ok "WebID-Sim"

# ── 6/6  Dienste neu laden ──────────────────────────────────────────────────
log "6/6  Dienste neu laden"
systemctl daemon-reload || warn "daemon-reload fehlgeschlagen"
for svc in nginx portal landing-server bot-runner webid-sim; do
  if systemctl list-unit-files "${svc}.service" >/dev/null 2>&1; then
    systemctl restart "${svc}.service" && ok "${svc} restarted" || warn "${svc} restart fehlgeschlagen"
  fi
done

# Supabase-Stack neu starten
if [ -f "${SUPABASE_DIR}/docker-compose.yml" ] || [ -f "${SUPABASE_DIR}/compose.yaml" ]; then
  (cd "${SUPABASE_DIR}" && docker compose down && docker compose up -d) || warn "Supabase-Stack restart fehlgeschlagen"
fi

ok "Restore abgeschlossen."
info "Nächste Schritte:"
info "  1. DNS A-Records auf $(hostname -I | awk '{print $1}') zeigen lassen"
info "  2. Portal login testen"
info "  3. Bewerbungsformular abschicken (Test-Eintrag)"
info "  4. Eine Landing-Page aufrufen"
info "  5. Mailversand testen (Admin → E-Mail-Vorschau)"

rm -rf "$TMP_BASE"
