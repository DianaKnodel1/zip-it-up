#!/usr/bin/env bash
# =============================================================================
#  smtp-deno-probe.sh — reproduziert den SMTP-Login GENAU so wie die Edge
#  Function (Deno + nodemailer) und zeigt zusaetzlich, ob das gespeicherte
#  Passwort/Benutzername unsichtbare Zeichen enthaelt (Copy&Paste-Fehler).
#
#  NUR auf dem Backend-Server ausfuehren:
#     bash scripts/smtp-deno-probe.sh "LH"
# =============================================================================
set -uo pipefail
FILTER="${1:-}"
DB_CONTAINER="${BACKEND_DB_CONTAINER:-supabase-db}"
DB_USER="${BACKEND_DB_USER:-supabase_admin}"
DB_NAME="${BACKEND_DB_NAME:-postgres}"

FN_CONTAINER="$(docker ps --format '{{.Names}}' | grep -Ei 'edge|functions' | head -1)"
[ -z "$FN_CONTAINER" ] && { echo "x Kein Edge-Functions-Container gefunden."; exit 1; }
echo "Edge-Container: $FN_CONTAINER"
echo

WHERE="TRUE"
[ -n "$FILTER" ] && WHERE="name ILIKE '%$FILTER%'"

echo "== 1) Gespeicherte Zugangsdaten auf unsichtbare Zeichen pruefen =="
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -P pager=off -c "
SELECT name,
       smtp_host, smtp_port,
       smtp_username,
       length(smtp_username) AS user_len,
       (smtp_username <> btrim(smtp_username)) AS user_has_spaces,
       length(smtp_password) AS pw_len,
       (smtp_password <> btrim(smtp_password)) AS pw_has_spaces,
       (smtp_password ~ '[^\x20-\x7E]') AS pw_has_weird_chars,
       encode(convert_to(left(smtp_password,2),'UTF8'),'hex') AS pw_first2_hex,
       encode(convert_to(right(smtp_password,2),'UTF8'),'hex') AS pw_last2_hex
FROM tenants WHERE $WHERE;"
echo

echo "== 2) Login-Test aus dem Edge-Container (identisch zur Edge Function) =="
ROWS="$(docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -At -F '|' -P pager=off -c \
  "SELECT name, smtp_host, smtp_port, smtp_username, smtp_password, sender_email
   FROM tenants WHERE $WHERE AND smtp_host IS NOT NULL AND smtp_password IS NOT NULL;")"
[ -z "$ROWS" ] && { echo "  (keine Tenants mit SMTP-Daten gefunden)"; exit 0; }

while IFS='|' read -r NAME HOST PORT USER PASS SENDER; do
  [ -z "$HOST" ] && continue
  echo "--- $NAME  ($USER @ $HOST:$PORT) ---"
  if [ -n "$SENDER" ] && [ -n "$USER" ] && [ "$SENDER" != "$USER" ]; then
    echo "  Hinweis: Absender ($SENDER) weicht vom SMTP-Login ($USER) ab."
  fi
  docker exec -i \
    -e P_HOST="$HOST" -e P_PORT="$PORT" -e P_USER="$USER" -e P_PASS="$PASS" \
    "$FN_CONTAINER" sh -lc '
set -u
EDGE_BIN="$(command -v edge-runtime || command -v /usr/local/bin/edge-runtime || true)"
if [ -z "$EDGE_BIN" ]; then
  echo "  edge-runtime: NICHT-GEFUNDEN"
  exit 0
fi
echo "  runtime: $($EDGE_BIN --version 2>&1 | tr "\n" " " | sed "s/[[:space:]]*$//")"

MAIN_DIR="$(mktemp -d /tmp/smtp-probe-main.XXXXXX)"
cat > "$MAIN_DIR/index.ts" <<TS
import nodemailer from "https://esm.sh/nodemailer@6.9.14";

const host = Deno.env.get("P_HOST") ?? "";
const configuredPort = Number(Deno.env.get("P_PORT") ?? "587");
const user = Deno.env.get("P_USER") ?? "";
const pass = Deno.env.get("P_PASS") ?? "";
const ports = [...new Set([configuredPort, configuredPort === 587 ? 465 : 587])];

function classify(message: string) {
  const m = message.toLowerCase();
  if (m.includes("535") || m.includes("auth") || m.includes("login")) return "AUTH_ERROR";
  if (m.includes("timeout") || m.includes("etimedout")) return "TIMEOUT";
  if (m.includes("econnrefused") || m.includes("connection refused")) return "CONNECTION_REFUSED";
  if (m.includes("enotfound") || m.includes("getaddrinfo")) return "DNS_ERROR";
  if (m.includes("certificate") || m.includes("tls") || m.includes("ssl")) return "TLS_ERROR";
  return "SMTP_ERROR";
}

for (const p of ports) {
  const mode = p === 465 ? "SSL" : "STARTTLS";
  const transporter = nodemailer.createTransport({
    host,
    port: p,
    secure: p === 465,
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  try {
    await Promise.race([
      transporter.verify(),
      new Promise((_r, reject) => setTimeout(() => reject(new Error("verify timeout 12s")), 12000)),
    ]);
    console.log("PROBE_RESULT  Port " + p + " (" + mode + "): LOGIN OK");
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    console.log("PROBE_RESULT  Port " + p + " (" + mode + "): FEHLER [" + classify(message) + "] -> " + message);
  }
}
Deno.exit(0);
TS

OUT="$("$EDGE_BIN" start --main-service "$MAIN_DIR" -p 9997 2>&1)"
rm -rf "$MAIN_DIR"
RESULTS="$(printf "%s\n" "$OUT" | grep "PROBE_RESULT" | sed "s/^.*PROBE_RESULT//" | sed "s/^/ /")"
if [ -n "$RESULTS" ]; then
  printf "%s\n" "$RESULTS"
else
  echo "  Kein Ergebnis. Runtime-Ausgabe:"
  printf "%s\n" "$OUT" | tail -30 | sed "s/^/    /"
fi'
  echo
done <<< "$ROWS"

echo "Fertig. Deutung:"
echo "  * 535 auth failed  -> Zugangsdaten/Postfach-Freigabe beim Provider (nicht der Code)."
echo "  * timeout/ECONN    -> Der Edge-Container kommt nicht raus (Firewall/Docker-Netz)."
echo "  * pw_has_spaces=t oder pw_has_weird_chars=t -> Passwort wurde falsch eingefuegt."
