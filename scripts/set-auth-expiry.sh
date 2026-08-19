#!/usr/bin/env bash
# =============================================================================
#  Setzt die Gültigkeitsdauer der Auth-Links (Bestätigung, Passwort-Reset,
#  Magic Link, Invite) auf dem self-hosted Supabase-Backend.
#
#  Standard: 86400 Sekunden = 24 Stunden.
#
#  Verwendung (vom Portal-Host, mit scripts/backend-server.env):
#    bash scripts/set-auth-expiry.sh            # 86400
#    bash scripts/set-auth-expiry.sh 604800     # 7 Tage
# =============================================================================
set -euo pipefail

EXP="${1:-86400}"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF_FILE="$REPO_DIR/scripts/backend-server.env"
[ -f "$CONF_FILE" ] || { echo "✗ $CONF_FILE fehlt" >&2; exit 1; }
# shellcheck disable=SC1090
. "$CONF_FILE"

: "${BACKEND_HOST:?BACKEND_HOST fehlt}"
: "${BACKEND_USER:=root}"
: "${BACKEND_SUPABASE_DIR:=/opt/supabase}"

SSH="ssh -o StrictHostKeyChecking=accept-new ${BACKEND_USER}@${BACKEND_HOST}"
# BACKEND_SUPABASE_DIR kann /opt/supabase oder /opt/supabase/docker sein
case "$BACKEND_SUPABASE_DIR" in
  */docker) ENV_FILE="${BACKEND_SUPABASE_DIR}/.env" ;;
  *)        ENV_FILE="${BACKEND_SUPABASE_DIR}/docker/.env" ;;
esac


echo "▸ Setze Auth-Link-Gültigkeit auf ${EXP}s auf ${BACKEND_HOST}"

$SSH "bash -s" <<REMOTE
set -euo pipefail
ENV_FILE='${ENV_FILE}'
EXP='${EXP}'

cp "\$ENV_FILE" "\$ENV_FILE.bak.\$(date +%Y%m%d-%H%M%S)"

set_var() {
  local key="\$1" val="\$2"
  if grep -qE "^\${key}=" "\$ENV_FILE"; then
    sed -i "s|^\${key}=.*|\${key}=\${val}|" "\$ENV_FILE"
  else
    printf '%s=%s\n' "\$key" "\$val" >> "\$ENV_FILE"
  fi
  echo "  · \${key}=\${val}"
}

set_var GOTRUE_MAILER_OTP_EXP "\$EXP"
set_var MAILER_OTP_EXP "\$EXP"

cd "\$(dirname "\$ENV_FILE")"
docker compose up -d --force-recreate auth >/dev/null 2>&1 || docker restart supabase-auth >/dev/null
sleep 3
docker exec supabase-auth env | grep -E 'MAILER_OTP_EXP' || true
REMOTE

echo "✓ Fertig — Auth-Links sind jetzt ${EXP}s gültig"
