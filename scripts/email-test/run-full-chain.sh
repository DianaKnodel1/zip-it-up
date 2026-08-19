#!/usr/bin/env bash
# =============================================================================
# run-full-chain.sh — sendet alle automatischen Bewerber-/Mitarbeiter-Mails an
# EINEN Test-Bewerber. Die Cron-Funktionen werden vor dem echten Versand mit
# dry_run:true aufgerufen und prüfen, ob NUR der Test-Bewerber im aktuellen
# Zustand liegt. Liegen weitere Kandidaten im selben Zustand, bricht das
# Skript ab, damit keine Produktions-E-Mails versendet werden.
#
# Voraussetzungen (Env):
#   SUPABASE_URL        z.B. https://xxxx.supabase.co
#   SERVICE_ROLE        Service-Role-Key
#   DATABASE_URL        Postgres-Connection-String (für psql-State-Manipulation)
#   TEST_TENANT_ID      Tenant-UUID (aktiv, mit SMTP)
#   TEST_LANDING_ID     Landing-UUID (mit Domain / Buchungslink)
#   TEST_EMAIL          Empfänger, MUSS mit "test+" beginnen
#
# Optional:
#   SKIP="no_show_24h,password_reset"   Stufen überspringen (Kommaliste)
#   PAUSE_SECONDS=6                      Pause zwischen Sends (SMTP-Rate-Limit)
#   FORCE_SEND=true                     Umgeht dry_run-Sicherheitscheck (NICHT empfohlen)
#   PORTAL_URL          Basis-URL des Portals, z.B. https://portal.example.de
#                       Nur für die Interview-Stufe (KI-Gespräch). Fehlt sie,
#                       werden Stufe 9/10 automatisch übersprungen.
#
# Nutzung:
#   bash scripts/email-test/run-full-chain.sh
# =============================================================================
set -euo pipefail

SUITE_VERSION="2026-07-27.2"

: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${SERVICE_ROLE:?set SERVICE_ROLE}"
: "${DATABASE_URL:?set DATABASE_URL}"
: "${TEST_TENANT_ID:?set TEST_TENANT_ID}"
: "${TEST_EMAIL:?set TEST_EMAIL}"

# Broker/Fast-Track-Test: TEST_SOURCE_LANDING_ID = Vermittlung, TEST_TARGET_LANDING_ID = Fast-Track.
# Für den klassischen Einzel-Landing-Test reicht TEST_LANDING_ID (wird für beide verwendet).
TEST_SOURCE_LANDING_ID="${TEST_SOURCE_LANDING_ID:-${TEST_LANDING_ID:-}}"
TEST_TARGET_LANDING_ID="${TEST_TARGET_LANDING_ID:-${TEST_LANDING_ID:-$TEST_SOURCE_LANDING_ID}}"
: "${TEST_SOURCE_LANDING_ID:?set TEST_SOURCE_LANDING_ID (Broker/Vermittlung) oder TEST_LANDING_ID}"
: "${TEST_TARGET_LANDING_ID:?set TEST_TARGET_LANDING_ID (Fast-Track/Ziel) oder TEST_LANDING_ID}"
# Rückwärtskompat: TEST_LANDING_ID = Target (wird an SQL-Snippets als :landing_id gereicht)
TEST_LANDING_ID="$TEST_TARGET_LANDING_ID"

PAUSE_SECONDS="${PAUSE_SECONDS:-6}"
SKIP="${SKIP:-}"
FORCE_SEND="${FORCE_SEND:-false}"

# ---------- Sicherheits-Guard ------------------------------------------------
# Standard: nur test+Alias-Adressen, damit nie versehentlich echte Bewerber-
# Adressen getriggert werden. Explizit freigegebene Einzeladressen können in
# ALLOWED_TEST_EMAILS ergänzt werden (Leerzeichen-separiert).
ALLOWED_TEST_EMAILS="${ALLOWED_TEST_EMAILS:-jessikasemen@outlook.com Stefan.Weitzel43@outlook.de}"
if [[ "$TEST_EMAIL" != test+*@* ]] && [[ " $ALLOWED_TEST_EMAILS " != *" $TEST_EMAIL "* ]]; then
  echo "FEHLER: TEST_EMAIL muss mit 'test+' beginnen oder in ALLOWED_TEST_EMAILS stehen."
  echo "Aktuell: $TEST_EMAIL"
  echo "Erlaubte Einzeladressen: $ALLOWED_TEST_EMAILS"
  exit 1
fi

skip() { [[ ",$SKIP," == *",$1,"* ]]; }

psql_run() {
  local file="$1"; shift
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
    -v test_email="$TEST_EMAIL" \
    -v tenant_id="$TEST_TENANT_ID" \
    -v landing_id="$TEST_LANDING_ID" \
    -v source_landing_id="$TEST_SOURCE_LANDING_ID" \
    -v target_landing_id="$TEST_TARGET_LANDING_ID" \
    "$@" \
    -f "$file"
}

invoke_fn() {
  local fn="$1"
  local body="${2:-"{}"}"
  local resp status_line body_out status
  local -a extra_headers=()
  if [ -n "${CRON_SECRET:-}" ]; then
    extra_headers+=(-H "x-cron-secret: $CRON_SECRET")
  fi
  resp=$(curl -sS -X POST "$SUPABASE_URL/functions/v1/$fn" \
    -H "Authorization: Bearer $SERVICE_ROLE" \
    -H "Content-Type: application/json" \
    "${extra_headers[@]}" \
    -w $'\n__HTTP_STATUS__:%{http_code}' \
    -d "$body") || {
    echo "   ❌ curl-Fehler bei $fn" >&2
    return 1
  }
  status_line="${resp##*$'\n'__HTTP_STATUS__:}"
  body_out="${resp%$'\n'__HTTP_STATUS__:*}"
  status="$status_line"
  if [[ "$status" =~ ^[0-9]+$ ]] && (( status >= 400 )); then
    echo "   ❌ HTTP $status von $fn: $body_out" >&2
    return 1
  fi
  printf '%s' "$body_out"
}

require_success_response() {
  local out="$1"
  if ! echo "$out" | jq -e . >/dev/null 2>&1; then
    echo "   ❌ Ungültige Antwort: $out"
    return 1
  fi
  if echo "$out" | jq -e '(.error? != null) or (.success? == false)' >/dev/null; then
    echo "   ❌ Versand fehlgeschlagen: $out"
    return 1
  fi
  echo "$out"
}

# Query EINEN Spaltenwert aus der DB (quiet).
psql_value() {
  psql "$DATABASE_URL" -tA -q -v ON_ERROR_STOP=1 -c "$1"
}

# Sicherheitscheck: Cron-Funktion dry-run ausführen, prüfen, dass Test-E-Mail
# als einzige Kandidat vorhanden ist, dann echten Versand triggern.
# $1 = Stufen-Key, $2 = Beschreibung, $3 = Function-Name, $4 = Body-JSON
invoke_cron_safely() {
  local key="$1" desc="$2" fn="$3" body="$4"

  if [[ "$FORCE_SEND" == "true" ]]; then
    echo "   ⚠️  FORCE_SEND=true — Sicherheits-Check übersprungen!"
    local out
    out=$(invoke_fn "$fn" "$body")
    require_success_response "$out" >/dev/null || return 1
    echo "$out" | jq -c '{sent, skipped, failed, candidates}'
    return 0
  fi

  # 1) dry_run
  local dryBody
  dryBody=$(echo "$body" | jq -c '. + {dry_run:true}')
  local dryOut
  dryOut=$(invoke_fn "$fn" "$dryBody")
  require_success_response "$dryOut" >/dev/null || return 1

  local candidates
  candidates=$(echo "$dryOut" | jq -r --arg email "$TEST_EMAIL" --arg app "$APP_ID" '[.results[]? | select((.to == $email) or (.app == $app) or (.id == $app))] | length')
  local total
  total=$(echo "$dryOut" | jq -r '(.results | length) // 0')
  local target_status target_reason
  target_status=$(echo "$dryOut" | jq -r --arg email "$TEST_EMAIL" --arg app "$APP_ID" '[.results[]? | select((.to == $email) or (.app == $app) or (.id == $app))][0].status // "none"')
  target_reason=$(echo "$dryOut" | jq -r --arg email "$TEST_EMAIL" --arg app "$APP_ID" '[.results[]? | select((.to == $email) or (.app == $app) or (.id == $app))][0].reason // "none"')

  echo "   dry_run: candidates=$total, target=$candidates, status=$target_status, reason=$target_reason"

  if [[ "$candidates" != "1" || "$total" != "1" ]]; then
    echo "   ❌ Abbruch: $fn würde $candidates Mal an $TEST_EMAIL / App $APP_ID und insgesamt $total Mal senden."
    echo "   Ziel-Status: $target_status  Grund: $target_reason"
    echo "   Output: $dryOut"
    return 1
  fi

  if [[ "$target_status" != "would_send" ]]; then
    echo "   ❌ Abbruch: Ziel-Kandidat hat Status '$target_status' (Grund: $target_reason), kein 'would_send'."
    echo "   Output: $dryOut"
    return 1
  fi

  # 2) realer Versand
  local out
  out=$(invoke_fn "$fn" "$body")
  require_success_response "$out" >/dev/null || return 1
  local sent failed
  sent=$(echo "$out" | jq -r '(.sent // 0)')
  failed=$(echo "$out" | jq -r '(.failed // 0)')
  if [[ "$sent" != "1" || "$failed" != "0" ]]; then
    echo "   ❌ Versand nicht eindeutig erfolgreich: $out"
    return 1
  fi
  echo "$out" | jq -c '{sent, skipped, failed, candidates}'
}

STAGE=0
run_stage() {
  STAGE=$((STAGE + 1))
  local key="$1" desc="$2" cb="$3"
  if skip "$key"; then
    printf "⏭️  %2d/19 %-36s (SKIP)\n" "$STAGE" "$key"
    return 0
  fi
  printf "▶️  %2d/19 %-36s %s\n" "$STAGE" "$key" "$desc"
  if "$cb"; then
    printf "✅ %2d/19 %-36s → %s\n" "$STAGE" "$key" "$TEST_EMAIL"
  else
    printf "❌ %2d/19 %-36s (siehe Ausgabe oben)\n" "$STAGE" "$key"
    return 1
  fi
  sleep "$PAUSE_SECONDS"
}

SNIP="$(dirname "$0")/sql-snippets"

# Hilfs-Variablen, die mehrere Stufen brauchen
APP_ID=""
TENANT_DOMAIN=""

load_app_context() {
  APP_ID=$(psql_value "SELECT id FROM applications WHERE email = '$TEST_EMAIL' LIMIT 1;")
  # Domain-Priorität: Target-Landing (Fast-Track) → Source-Landing (Broker) → tenants.domain.
  # tenants.primary_domain existiert je nach Migrationsstand nicht – deshalb dynamisch prüfen.
  local has_primary
  has_primary=$(psql_value "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='tenants' AND column_name='primary_domain';")
  local tenant_dom
  if [[ "$has_primary" == "1" ]]; then
    tenant_dom=$(psql_value "SELECT COALESCE(primary_domain, domain) FROM tenants WHERE id = '$TEST_TENANT_ID' LIMIT 1;")
  else
    tenant_dom=$(psql_value "SELECT domain FROM tenants WHERE id = '$TEST_TENANT_ID' LIMIT 1;")
  fi
  local target_dom source_dom
  target_dom=$(psql_value "SELECT domain FROM landing_pages WHERE id = '$TEST_TARGET_LANDING_ID' LIMIT 1;")
  source_dom=$(psql_value "SELECT domain FROM landing_pages WHERE id = '$TEST_SOURCE_LANDING_ID' LIMIT 1;")
  TENANT_DOMAIN="${target_dom:-${source_dom:-$tenant_dom}}"
  echo "   App-ID: $APP_ID | Booking-Domain: $TENANT_DOMAIN"
}

preflight() {
  echo "Vorabcheck: Suite, Datenbank, Schema, Tenants und Landings …"

  local application_received_snippet="$SNIP/chain-01-application-received.sql"

  local missing_commands=()
  local command_name
  for command_name in jq curl psql; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      missing_commands+=("$command_name")
    fi
  done
  if (( ${#missing_commands[@]} > 0 )); then
    echo "FEHLER: Benötigte Programme fehlen: ${missing_commands[*]}"
    echo "Auf Ubuntu/Debian installieren mit:"
    echo "  apt-get update && apt-get install -y ${missing_commands[*]}"
    echo "Es wurden noch keine Testdaten verändert und keine Mail versendet."
    return 1
  fi

  # Der Runner und alle SQL-Snippets müssen immer als kompletter Ordner
  # synchronisiert werden. Alte Snippets verwendeten ON CONFLICT auf Spalten
  # ohne Unique-Constraint und dürfen nicht mehr ausgeführt werden.
  if grep -REqs --include='chain-*.sql' '^[[:space:]]*ON[[:space:]]+CONFLICT' "$SNIP"; then
    echo "FEHLER: Veraltete SQL-Snippets gefunden (ON CONFLICT)."
    echo "Bitte den kompletten Ordner scripts/email-test/ erneut synchronisieren."
    grep -REn --include='chain-*.sql' '^[[:space:]]*ON[[:space:]]+CONFLICT' "$SNIP" || true
    return 1
  fi

  # booking_status hat einen CHECK-Constraint: nur none/pending/scheduled/
  # cancelled/no_show/completed sind erlaubt. Alte Snippets nutzten 'confirmed'
  # oder 'accepted' und würden erst beim UPDATE scheitern.
  if grep -REqs --include='chain-*.sql' "booking_status[[:space:]]*=[[:space:]]*'(confirmed|accepted)'" "$SNIP"; then
    echo "FEHLER: Veraltete SQL-Snippets gefunden (booking_status confirmed/accepted)."
    echo "Bitte den kompletten Ordner scripts/email-test/ erneut synchronisieren."
    grep -REn --include='chain-*.sql' "booking_status[[:space:]]*=[[:space:]]*'(confirmed|accepted)'" "$SNIP" || true
    return 1
  fi

  # Stufe 1 muss booking_status='none' setzen und magic_token beim Insert
  # generieren, sonst überspringen send-appointment-reminders und die Rebook-
  # Stufen die Test-Bewerbung mit reason='no_magic_token'.
  if [[ ! -f "$application_received_snippet" ]] \
    || ! grep -Fqs "booking_status, magic_token, magic_token_expires_at" "$application_received_snippet" \
    || ! grep -Fqs "gen_random_bytes(24)" "$application_received_snippet"; then
    echo "FEHLER: Stufe 1 ist veraltet oder unvollständig synchronisiert."
    echo "Erwartet: booking_status='none' und magic_token werden im Test-Insert gesetzt."
    echo "Bitte den kompletten Ordner scripts/email-test/ erneut synchronisieren."
    echo "Backend-Prüfung:"
    echo "  grep -nE \"booking_status|magic_token\" $application_received_snippet"
    return 1
  fi

  psql_value "SELECT 1;" >/dev/null

  local missing_schema tenant_exists src_exists tgt_exists src_flow tgt_flow schedule_exists
  missing_schema=$(psql_value "
    WITH required(table_schema, table_name, column_name) AS (
      VALUES
        ('public','applications','id'),
        ('public','applications','email'),
        ('public','applications','tenant_id'),
        ('public','applications','broker_tenant_id'),
        ('public','applications','fasttrack_tenant_id'),
        ('public','applications','source_landing_id'),
        ('public','applications','target_landing_id'),
        ('public','applications','status'),
        ('public','applications','flow_type'),
        ('public','applications','booking_status'),
        ('public','applications','scheduled_at'),
        ('public','applications','created_at'),
        ('public','applications','updated_at'),
        ('public','application_reminder_log','application_id'),
        ('public','application_reminder_log','reminder_kind'),
        ('public','reminder_log','email'),
        ('public','reminder_log','reminder_type'),
        ('public','interview_appointments','application_id'),
        ('public','interview_appointments','schedule_id'),
        ('public','interview_appointments','starts_at'),
        ('public','interview_appointments','ends_at'),
        ('public','interview_appointments','status'),
        ('public','availability_schedules','id'),
        ('public','availability_schedules','landing_page_id'),
        ('public','availability_schedules','active'),
        ('public','landing_pages','id'),
        ('public','landing_pages','domain'),
        ('public','landing_pages','flow_type'),
        ('public','landing_pages','linked_fasttrack_landing_id'),
        ('public','tenants','id'),
        ('public','tenants','domain'),
        ('auth','users','email'),
        ('auth','users','email_confirmed_at'),
        ('auth','users','confirmed_at'),
        ('auth','users','created_at')
    )
    SELECT COALESCE(string_agg(r.table_schema || '.' || r.table_name || '.' || r.column_name, ', '), '')
      FROM required r
      LEFT JOIN information_schema.columns c
        ON c.table_schema = r.table_schema
       AND c.table_name = r.table_name
       AND c.column_name = r.column_name
     WHERE c.column_name IS NULL;")

  if [[ -n "$missing_schema" ]]; then
    echo "FEHLER: Der Datenbank fehlen für diese Tests benötigte Felder:"
    echo "   $missing_schema"
    echo "Bitte zuerst die fehlenden Migrationen einspielen; es wurde noch keine Mail versendet."
    return 1
  fi

  tenant_exists=$(psql_value "SELECT count(*) FROM tenants WHERE id = '$TEST_TENANT_ID';")
  src_exists=$(psql_value "SELECT count(*) FROM landing_pages WHERE id = '$TEST_SOURCE_LANDING_ID';")
  tgt_exists=$(psql_value "SELECT count(*) FROM landing_pages WHERE id = '$TEST_TARGET_LANDING_ID';")
  src_flow=$(psql_value "SELECT COALESCE(flow_type,'') FROM landing_pages WHERE id = '$TEST_SOURCE_LANDING_ID';")
  tgt_flow=$(psql_value "SELECT COALESCE(flow_type,'') FROM landing_pages WHERE id = '$TEST_TARGET_LANDING_ID';")
  schedule_exists=$(psql_value "SELECT count(*) FROM availability_schedules WHERE active = true AND landing_page_id IN (SELECT id FROM landing_pages WHERE id = '$TEST_TARGET_LANDING_ID' OR id = (SELECT linked_fasttrack_landing_id FROM landing_pages WHERE id = '$TEST_TARGET_LANDING_ID'));")

  if [[ "$tenant_exists" != "1" ]]; then
    echo "FEHLER: TEST_TENANT_ID wurde nicht gefunden."
    return 1
  fi
  if [[ "$src_exists" != "1" ]]; then
    echo "FEHLER: TEST_SOURCE_LANDING_ID ($TEST_SOURCE_LANDING_ID) wurde nicht gefunden."
    return 1
  fi
  if [[ "$tgt_exists" != "1" ]]; then
    echo "FEHLER: TEST_TARGET_LANDING_ID ($TEST_TARGET_LANDING_ID) wurde nicht gefunden."
    return 1
  fi
  if [[ "$schedule_exists" == "0" ]]; then
    echo "FEHLER: Für TEST_TARGET_LANDING_ID existiert kein aktiver Verfügbarkeitskalender (auch nicht über linked_fasttrack_landing_id)."
    return 1
  fi
  echo "   Source-Landing: $TEST_SOURCE_LANDING_ID (flow=$src_flow)"
  echo "   Target-Landing: $TEST_TARGET_LANDING_ID (flow=$tgt_flow)"
  if [[ "$TEST_SOURCE_LANDING_ID" != "$TEST_TARGET_LANDING_ID" && "$src_flow" != "broker" ]]; then
    echo "   ⚠️  Source-Landing hat flow_type='$src_flow' (erwartet: 'broker'). Test läuft trotzdem weiter."
  fi
  echo "Vorabcheck erfolgreich."
}

# ---------- Stufe 1: Bewerbung eingegangen ----------------------------------
stage_application_received() {
  psql_run "$SNIP/chain-01-application-received.sql" || return 1
  load_app_context || return 1
  if [[ -z "$APP_ID" || -z "$TENANT_DOMAIN" ]]; then
    echo "   ❌ Bewerbung oder Tenant-Domain konnte nicht geladen werden."
    return 1
  fi
  local link="https://portal.${TENANT_DOMAIN}/termin/buchen/${APP_ID}?ref=${APP_ID}"
  local out
  out=$(invoke_fn send-invitation-email \
    "$(jq -nc \
        --arg to "$TEST_EMAIL" \
        --arg link "$link" \
        --arg tid "$TEST_TENANT_ID" \
        --arg appId "$APP_ID" \
        '{to:$to, registrationLink:$link, tenantId:$tid, applicationId:$appId, firstName:"Test", lastName:"Kette", templateNameOverride:"application_received"}')")
  require_success_response "$out" | jq -c '{status: (.status // "?"), error: (.error // null), success: (.success // null)}'
}

# ---------- Stufe 2: Termin bestätigt ---------------------------------------
stage_booking_confirmation() {
  psql_run "$SNIP/chain-02-booking-confirmation.sql" || return 1
  invoke_cron_safely "booking_confirmation" "Terminbestätigung" "send-booking-confirmation" "{}"
}

# ---------- Stufe 3: Interview-Einladung 30min ------------------------------
stage_interview_invite_30min() {
  psql_run "$SNIP/chain-03-interview-invite-30min.sql" || return 1
  invoke_cron_safely "interview_invite_30min" "Interview-Einladung" "send-appointment-reminders" "{}"
}

# Body-JSON, das send-application-reminders auf genau den Test-Bewerber einschränkt.
reminder_body() {
  jq -nc --arg id "$APP_ID" --arg email "$TEST_EMAIL" '{application_id:$id, only_email:$email}'
}

# ---------- Stufe 4: No-Booking 24h -----------------------------------------
stage_no_booking_24h() {
  psql_run "$SNIP/chain-04-no-booking-24h.sql" || return 1
  invoke_cron_safely "no_booking_24h" "Kein Termin 24h" "send-application-reminders" "$(reminder_body)"
}

# ---------- Stufe 5: No-Booking 72h -----------------------------------------
stage_no_booking_72h() {
  psql_run "$SNIP/chain-05-no-booking-72h.sql" || return 1
  invoke_cron_safely "no_booking_72h" "Kein Termin 72h" "send-application-reminders" "$(reminder_body)"
}

# ---------- Stufe 6: No-Show 24h --------------------------------------------
stage_no_show_24h() {
  psql_run "$SNIP/chain-06-no-show-24h.sql" || return 1
  invoke_cron_safely "no_show_24h" "No-Show" "send-application-reminders" "$(reminder_body)"
}

# ---------- Stufe 7: Rebook 24h nach Absage ---------------------------------
stage_rebook_after_cancel_24h() {
  psql_run "$SNIP/chain-07-rebook-after-cancel-24h.sql" || return 1
  invoke_cron_safely "rebook_after_cancel_24h" "Rebook 24h" "send-application-reminders" "$(reminder_body)"
}

# ---------- Stufe 8: Rebook 72h nach Absage ---------------------------------
stage_rebook_after_cancel_72h() {
  psql_run "$SNIP/chain-08-rebook-after-cancel-72h.sql" || return 1
  invoke_cron_safely "rebook_after_cancel_72h" "Rebook 72h" "send-application-reminders" "$(reminder_body)"
}


# ---------- Stufe 9: Willkommens-/Registrierungs-Einladung ------------------
# ---------- Stufe 9: Termin wahrgenommen → KI-Interview ---------------------
# Führt das komplette Bewerbungsgespräch gegen /api/public/interview-chat und
# liest die KI-Entscheidung aus. WICHTIG: Der Endpunkt verschickt bei einer
# Zusage bewusst KEINE Mail mehr — das übernimmt Stufe 10 (Recruiter-Zusage).
portal_post() {
  local path="$1" body="$2"
  curl -sS -X POST "${PORTAL_URL%/}$path" \
    -H "Content-Type: application/json" \
    -d "$body"
}

stage_interview_ai_decision() {
  if [[ -z "${PORTAL_URL:-}" ]]; then
    echo "   ⏭️  PORTAL_URL nicht gesetzt — Interview-Stufe übersprungen."
    return 0
  fi
  psql_run "$SNIP/chain-10-interview-attended.sql" || return 1
  load_app_context || return 1

  local out
  out=$(portal_post /api/public/interview-chat \
    "$(jq -nc --arg id "$APP_ID" '{applicationId:$id, action:"init"}')") || return 1
  if echo "$out" | jq -e '.error? != null' >/dev/null; then
    echo "   ❌ Interview-Start fehlgeschlagen: $out"
    return 1
  fi
  echo "   Gruß der KI: $(echo "$out" | jq -r '.reply // "" | .[0:90]')"

  # Standardantworten, die die sechs Pflichtthemen des Prompts abdecken.
  local answers=(
    "Hallo, ich arbeite aktuell in Teilzeit im Einzelhandel und habe die Anzeige online gefunden."
    "Ich habe fünf Jahre Kundenservice-Erfahrung und arbeite sehr sorgfältig am PC."
    "Mich reizt das Homeoffice und die freie Zeiteinteilung, weil ich zwei Kinder habe."
    "Teilzeit mit 120 Stunden im Monat wäre für mich ideal."
    "Starten könnte ich ab dem Ersten des nächsten Monats, am liebsten vormittags."
    "Nein, danke — Sie haben alles beantwortet, ich habe keine Fragen mehr."
  )
  local ended="false" a
  for a in "${answers[@]}"; do
    out=$(portal_post /api/public/interview-chat \
      "$(jq -nc --arg id "$APP_ID" --arg t "$a" '{applicationId:$id, action:"message", text:$t}')") || return 1
    if echo "$out" | jq -e '.error? != null' >/dev/null; then
      echo "   ❌ Interview-Nachricht fehlgeschlagen: $out"
      return 1
    fi
    ended=$(echo "$out" | jq -r '.ended // false')
    [[ "$ended" == "true" ]] && break
    sleep 2
  done

  if [[ "$ended" != "true" ]]; then
    out=$(portal_post /api/public/interview-chat \
      "$(jq -nc --arg id "$APP_ID" '{applicationId:$id, action:"end"}')") || return 1
  fi

  local decision score
  decision=$(psql_value "SELECT COALESCE(ai_decision,'-') FROM applications WHERE email = '$TEST_EMAIL' LIMIT 1;")
  score=$(psql_value "SELECT COALESCE(interview_score::text,'-') FROM applications WHERE email = '$TEST_EMAIL' LIMIT 1;")
  echo "   KI-Entscheidung: $decision (Score $score) — Mailversand erfolgt bewusst erst durch die Recruiter-Zusage."
  if [[ "$decision" == "-" ]]; then
    echo "   ❌ Keine KI-Entscheidung gespeichert."
    return 1
  fi
  return 0
}

# ---------- Stufe 10: Recruiter-Zusage → Willkommens-Mail -------------------
# Bildet exakt ab, was advanceApplicationStage (vermittlung_zusage /
# fasttrack_angenommen) im Admin-Portal tut: Invitation-Token anlegen und
# die Willkommens-/Registrierungsmail mit genau diesem Token verschicken.
stage_zusage_after_interview() {
  psql_run "$SNIP/chain-11-recruiter-zusage.sql" || return 1
  load_app_context || return 1
  local token
  token=$(psql_value "SELECT t.token FROM invitation_tokens t JOIN applications a ON a.id = t.application_id WHERE a.email = '$TEST_EMAIL' ORDER BY t.created_at DESC LIMIT 1;")
  if [[ -z "$token" ]]; then
    echo "   ❌ Kein Invitation-Token erzeugt."
    return 1
  fi
  local link="https://portal.${TENANT_DOMAIN}/register?token=${token}"
  invoke_fn send-invitation-email \
    "$(jq -nc \
        --arg to "$TEST_EMAIL" \
        --arg link "$link" \
        --arg tid "$TEST_TENANT_ID" \
        --arg appId "$APP_ID" \
        '{to:$to, fullName:"Test Kette", firstName:"Test", lastName:"Kette", registrationLink:$link, tenantId:$tid, applicationId:$appId}')" \
    | jq -c '{status: (.status // "?"), error: (.error // null), success: (.success // null)}'
}

# ---------- Stufe 11: Willkommens-/Registrierungs-Einladung -----------------
stage_welcome_invitation() {
  psql_run "$SNIP/chain-09-welcome-invitation.sql" || return 1
  load_app_context || return 1
  local link="https://portal.${TENANT_DOMAIN}/register?app=${APP_ID}"
  invoke_fn send-invitation-email \
    "$(jq -nc \
        --arg to "$TEST_EMAIL" \
        --arg link "$link" \
        --arg tid "$TEST_TENANT_ID" \
        --arg appId "$APP_ID" \
        '{to:$to, registrationLink:$link, tenantId:$tid, applicationId:$appId, firstName:"Test", lastName:"Kette", templateNameOverride:"welcome"}')" \
    | jq -c '{status: (.status // "?"), error: (.error // null), success: (.success // null)}'
}

# ---------- Stufe 10: E-Mail-Bestätigung (Signup) ---------------------------
stage_signup_confirmation() {
  invoke_fn send-signup-confirmation \
    "$(jq -nc \
        --arg email "$TEST_EMAIL" \
        --arg tid "$TEST_TENANT_ID" \
        '{email:$email, password:"Test1234!", tenant_id:$tid, full_name:"Test Kette"}')" \
    | jq -c '{success: (.success // null), user_id: (.user_id // null), error: (.error // null)}'
}

# ---------- Stufe 11: E-Mail-Bestätigung erneut senden ----------------------
stage_signup_confirmation_resend() {
  invoke_fn resend-signup-confirmation \
    "$(jq -nc \
        --arg email "$TEST_EMAIL" \
        --arg tid "$TEST_TENANT_ID" \
        '{email:$email, tenant_id:$tid}')" \
    | jq -c '{success: (.success // null), error: (.error // null)}'
}

# ---------- Stufe 12: Passwort zurücksetzen ---------------------------------
stage_password_reset() {
  load_app_context
  invoke_fn send-password-reset \
    "$(jq -nc \
        --arg email "$TEST_EMAIL" \
        --arg host "$TENANT_DOMAIN" \
        '{email:$email, host:$host}')" \
    | jq -c '{ok: (.ok // null)}'
}

# ---------- Stufe 13: Einladung noch offen (Drip) ---------------------------
# Hinweis: Diese Stufe wird aktuell vom Edge-Function "send-reminders" immer
# übersprungen, da der automatische invite-Reminder deaktiviert ist.
stage_reminder_invite() {
  psql_run "$SNIP/chain-13-reminder-invite.sql" || return 1
  local out
  out=$(invoke_fn send-reminders \
    "$(jq -nc --arg email "$TEST_EMAIL" '{dry_run:true, only_type:"invite", only_email:$email, ignore_quiet_hours:true}')") || return 1
  require_success_response "$out" >/dev/null || return 1
  echo "$out" | jq -c '{by_type, skipped: .skipped, sent: .sent}'
}

# ---------- Stufe 14: Registrierung abschließen (Drip) ----------------------
stage_reminder_complete_registration() {
  psql_run "$SNIP/chain-14-reminder-complete-registration.sql" || return 1
  local out sent failed
  out=$(invoke_fn send-reminders \
    "$(jq -nc --arg email "$TEST_EMAIL" '{dry_run:false, only_type:"confirm_email", only_email:$email, ignore_quiet_hours:true}')") || return 1
  require_success_response "$out" >/dev/null || return 1
  sent=$(echo "$out" | jq -r '.sent // 0')
  failed=$(echo "$out" | jq -r '.failed // 0')
  if [[ "$sent" != "1" || "$failed" != "0" ]]; then
    echo "   ❌ Registrierungsmail nicht eindeutig erfolgreich: $out"
    return 1
  fi
  echo "$out" | jq -c '{by_type, skipped: .skipped, sent: .sent}'
}

# ---------- Zusage erteilt, aber keine Registrierung (24h / 72h) ------------
stage_registration_pending_24h() {
  psql_run "$SNIP/chain-15-registration-pending-24h.sql" || return 1
  load_app_context || return 1
  invoke_cron_safely "registration_pending_24h" "Zusage ohne Registrierung 24h" \
    "send-application-reminders" "$(reminder_body)"
}

stage_registration_pending_72h() {
  psql_run "$SNIP/chain-16-registration-pending-72h.sql" || return 1
  load_app_context || return 1
  invoke_cron_safely "registration_pending_72h" "Zusage ohne Registrierung 72h" \
    "send-application-reminders" "$(reminder_body)"
}

# ---------- Registriert, aber Ausweis/Vertrag fehlen ------------------------
stage_onboarding_incomplete() {
  psql_run "$SNIP/chain-17-onboarding-incomplete.sql" || return 1
  local out sent failed
  out=$(invoke_fn send-reminders \
    "$(jq -nc --arg email "$TEST_EMAIL" '{dry_run:false, only_type:"complete_registration", only_email:$email, ignore_quiet_hours:true}')") || return 1
  require_success_response "$out" >/dev/null || return 1
  sent=$(echo "$out" | jq -r '.sent // 0')
  failed=$(echo "$out" | jq -r '.failed // 0')
  if [[ "$sent" != "1" || "$failed" != "0" ]]; then
    echo "   ❌ Onboarding-Erinnerung nicht eindeutig erfolgreich: $out"
    return 1
  fi
  echo "$out" | jq -c '{by_type, skipped: .skipped, sent: .sent}'
}

# ============================================================================
echo "=========================================================================="
echo "E-Mail-Test-Suite: $SUITE_VERSION"
echo "E-Mail-Kette starten für: $TEST_EMAIL"
echo "Tenant:  $TEST_TENANT_ID (Broker/Source-Tenant)"
echo "Source:  $TEST_SOURCE_LANDING_ID (Vermittlung)"
echo "Target:  $TEST_TARGET_LANDING_ID (Fast-Track / Ziel)"
echo "Pause zwischen Mails: ${PAUSE_SECONDS}s   SKIP=$SKIP"
echo "=========================================================================="

preflight

# Den vorhandenen Bewerbungskontext auch bei einem fortgesetzten Lauf laden.
# Bisher geschah das nur in Stufe 1; wurde diese per SKIP übersprungen, blieb
# APP_ID leer und die Reminder-Function filterte nach application_id="".
load_app_context
if [[ -z "$APP_ID" ]]; then
  echo "FEHLER: Keine Test-Bewerbung für $TEST_EMAIL gefunden."
  exit 1
fi

run_stage application_received          "Bewerbung eingegangen"            stage_application_received
run_stage booking_confirmation          "Termin bestätigt"                 stage_booking_confirmation
run_stage interview_invite_30min        "Interview-Einladung 30min"        stage_interview_invite_30min
run_stage no_booking_24h                "Kein Termin – 24h Erinnerung"     stage_no_booking_24h
run_stage no_booking_72h                "Kein Termin – 72h Erinnerung"     stage_no_booking_72h
run_stage no_show_24h                   "No-Show – erneut buchen"          stage_no_show_24h
run_stage rebook_after_cancel_24h       "Rebook 24h nach Absage"           stage_rebook_after_cancel_24h
run_stage rebook_after_cancel_72h       "Rebook 72h nach Absage"           stage_rebook_after_cancel_72h
run_stage interview_ai_decision         "Termin wahrgenommen + KI-Interview" stage_interview_ai_decision
run_stage zusage_after_interview        "Recruiter-Zusage → Willkommen"    stage_zusage_after_interview
run_stage welcome_invitation            "Willkommens-/Registrierungs-Mail" stage_welcome_invitation
run_stage signup_confirmation           "E-Mail-Bestätigung"               stage_signup_confirmation
run_stage signup_confirmation_resend    "Bestätigung erneut senden"        stage_signup_confirmation_resend
run_stage password_reset                "Passwort zurücksetzen"            stage_password_reset
run_stage reminder_invite               "Einladung noch offen"             stage_reminder_invite
run_stage reminder_complete_registration "Registrierung abschließen"       stage_reminder_complete_registration
run_stage registration_pending_24h      "Zusage – keine Registrierung 24h" stage_registration_pending_24h
run_stage registration_pending_72h      "Zusage – keine Registrierung 72h" stage_registration_pending_72h
run_stage onboarding_incomplete         "Ausweis/Vertrag fehlen"           stage_onboarding_incomplete

echo ""
echo "=========================================================================="
echo "Fertig. Cleanup (Zeiten zurücksetzen, Logs leeren)? [y/N]"
read -r ans
if [[ "$ans" =~ ^[Yy]$ ]]; then
  psql_run "$SNIP/chain-99-cleanup.sql"
  echo "Cleanup ausgeführt."
else
  echo "Cleanup übersprungen. Manuell: psql \"\$DATABASE_URL\" -f $SNIP/chain-99-cleanup.sql"
fi
