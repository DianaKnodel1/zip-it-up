#!/usr/bin/env bash
# Dry-Run gegen alle Cron-Endpunkte. Sendet NICHTS, listet nur, wer dran wäre.
set -euo pipefail

: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${SERVICE_ROLE:?set SERVICE_ROLE}"

for fn in send-application-reminders send-appointment-reminders send-booking-confirmation send-reminders; do
  echo ""
  echo "=== $fn ==="
  curl -s -X POST "$SUPABASE_URL/functions/v1/$fn" \
    -H "Authorization: Bearer $SERVICE_ROLE" \
    -H "Content-Type: application/json" \
    -d '{"dry_run": true}' \
    | jq '{candidates, todo, sent, skipped, failed, results: (.results // [] | map({id: (.id // .app), kind, status, to, reason}))}'
done
