#!/usr/bin/env bash
# =============================================================================
#  smtp-probe.sh — prueft vom Backend-Server aus, ob die SMTP-Server der
#  Mandanten ueberhaupt erreichbar sind (Port offen? Greeting? AUTH-Login?).
#  NUR LESEND, verschickt keine Mail.
#
#  Backend-Server: bash scripts/smtp-probe.sh --local
#                  bash scripts/smtp-probe.sh --local "LH Marketing"
#  Portal-Server:  bash scripts/smtp-probe.sh
# =============================================================================
set -uo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF_FILE="$REPO_DIR/scripts/backend-server.env"
[ -f "$CONF_FILE" ] && . "$CONF_FILE"
: "${BACKEND_USER:=root}"; : "${BACKEND_DB_CONTAINER:=supabase-db}"
: "${BACKEND_DB_USER:=supabase_admin}"; : "${BACKEND_DB_NAME:=postgres}"
LOCAL=0; [ "${1:-}" = "--local" ] && { LOCAL=1; shift; }
FILTER="${1:-}"
if   [ -n "${TARGET_DB_URL:-}" ]; then RUNNER="url"
elif [ "$LOCAL" = "1" ];         then RUNNER="docker"
elif [ -n "${BACKEND_HOST:-}" ]; then RUNNER="ssh"
else echo "x Keine DB-Verbindung (TARGET_DB_URL, --local oder BACKEND_HOST)." >&2; exit 1; fi

sqlt() {
  local q="$1"
  case "$RUNNER" in
    url)    printf '%s\n' "$q" | psql "$TARGET_DB_URL" -At -F '|' -P pager=off 2>/dev/null ;;
    docker) printf '%s\n' "$q" | docker exec -i "$BACKEND_DB_CONTAINER" psql -U "$BACKEND_DB_USER" -d "$BACKEND_DB_NAME" -At -F '|' -P pager=off 2>/dev/null ;;
    ssh)    printf '%s\n' "$q" | ssh -o StrictHostKeyChecking=accept-new "${BACKEND_USER}@${BACKEND_HOST}" \
              "docker exec -i $BACKEND_DB_CONTAINER psql -U $BACKEND_DB_USER -d $BACKEND_DB_NAME -At -F '|' -P pager=off" 2>/dev/null ;;
  esac
}

# Port offen?
probe_port() {
  local host="$1" port="$2"
  if command -v nc >/dev/null 2>&1; then
    nc -z -w5 "$host" "$port" >/dev/null 2>&1 && echo "offen" || echo "BLOCKIERT/keine Antwort"
  else
    timeout 5 bash -c "exec 3<>/dev/tcp/$host/$port" >/dev/null 2>&1 && echo "offen" || echo "BLOCKIERT/keine Antwort"
  fi
}

# Greeting lesen (465 = direkt TLS, sonst Klartext)
probe_greeting() {
  local host="$1" port="$2"
  command -v openssl >/dev/null 2>&1 || { echo "(openssl fehlt)"; return; }
  local out
  if [ "$port" = "465" ]; then
    out=$(printf 'QUIT\r\n' | timeout 10 openssl s_client -quiet -crlf -connect "$host:$port" 2>/dev/null | head -3)
  else
    out=$(printf 'EHLO probe\r\nQUIT\r\n' | timeout 10 openssl s_client -quiet -crlf -starttls smtp -connect "$host:$port" 2>/dev/null | head -3)
  fi
  [ -z "$out" ] && echo "(keine Antwort innerhalb 10 s)" || echo "$out" | tr -d '\r' | paste -sd' / ' -
}

echo "=============================================================="
echo " SMTP-ERREICHBARKEIT  $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================================================="

WHERE="smtp_host IS NOT NULL AND smtp_host <> ''"
[ -n "$FILTER" ] && WHERE="$WHERE AND name ILIKE '%${FILTER//\'/}%'"

ROWS=$(sqlt "SELECT name||'|'||smtp_host||'|'||coalesce(smtp_port::text,'')||'|'||coalesce(smtp_username,'')||'|'||coalesce(sender_email,'')
               FROM tenants WHERE $WHERE ORDER BY name;")

[ -z "$ROWS" ] && { echo "  Keine Mandanten mit SMTP-Daten gefunden."; exit 0; }

while IFS='|' read -r name host port user sender; do
  [ -z "$name" ] && continue
  echo
  echo "── $name ──"
  echo "  Host: $host   konfigurierter Port: ${port:-—}"
  echo "  Login: ${user:-—}   Absender: ${sender:-—}"
  if [ -n "$sender" ] && [ -n "$user" ] && [ "$sender" != "$user" ]; then
    echo "  ! Absender weicht vom SMTP-Login ab — viele Provider lehnen das mit 535/553 ab."
  fi
  for p in 465 587 25; do
    printf '  Port %-4s: %s' "$p" "$(probe_port "$host" "$p")"
    if [ "$p" = "${port:-}" ]; then printf '   <-- konfiguriert'; fi
    echo
  done
  echo "  Greeting (${port:-587}): $(probe_greeting "$host" "${port:-587}")"
  case "${port:-}" in
    465) echo "  Erwartung: 465 = implizites SSL." ;;
    587|25) echo "  Erwartung: ${port} = STARTTLS." ;;
    *) echo "  ! Ungewoehnlicher Port ${port:-—} — ueblich sind 465 (SSL) oder 587 (STARTTLS)." ;;
  esac
done <<< "$ROWS"

echo
echo "Deutung:"
echo "  • Port BLOCKIERT  -> Firewall/Hoster sperrt ausgehendes SMTP oder Host falsch."
echo "  • Port offen, kein Greeting -> falscher Verschluesselungsmodus (465 vs. 587)."
echo "  • Greeting da, Versand scheitert -> Zugangsdaten (535) oder Absenderadresse."
