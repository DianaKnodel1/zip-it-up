#!/usr/bin/env bash
# =============================================================================
# audit-chain-coverage.sh — Bestandsaufnahme OHNE Versand.
# Zeigt für jede Mail-Stufe, ob sie produktiv schon einmal erfolgreich
# rausgegangen ist, und wer aktuell in welchem Zustand hängt.
#
# Env: DATABASE_URL (Postgres)
#   optional: SUPABASE_URL + SERVICE_ROLE → zusätzlich Dry-Run der Cron-Endpunkte
# =============================================================================
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"

q() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "$1"; }

echo "=========================================================================="
echo "1) Abdeckung je Reminder-Typ (application_reminder_log, gesamt)"
echo "=========================================================================="
q "
WITH kinds(kind) AS (VALUES
  ('booking_confirmation'),('interview_invite_30min'),
  ('no_booking_24h'),('no_booking_72h'),('no_show_24h'),
  ('rebook_after_cancel_24h'),('rebook_after_cancel_72h'),
  ('registration_pending_24h'),('registration_pending_72h'))
SELECT k.kind,
       COUNT(l.*) FILTER (WHERE l.status = 'sent')   AS sent,
       COUNT(l.*) FILTER (WHERE l.status <> 'sent')  AS other,
       MAX(l.sent_at)                                AS last_event
  FROM kinds k
  LEFT JOIN application_reminder_log l ON l.reminder_kind = k.kind
 GROUP BY k.kind ORDER BY k.kind;"

echo "=========================================================================="
echo "2) SMTP-Versand je Template (email_send_log, letzte 14 Tage)"
echo "=========================================================================="
q "
SELECT COALESCE(template_name,'(ohne)') AS template, status, COUNT(*) AS n,
       MAX(created_at) AS last_send
  FROM email_send_log
 WHERE created_at > now() - interval '14 days'
 GROUP BY 1,2 ORDER BY 1,2;"

echo "=========================================================================="
echo "3) Fehlgeschlagene Sends (letzte 7 Tage)"
echo "=========================================================================="
q "
SELECT created_at, recipient_email, template_name, left(COALESCE(error_message,''),90) AS fehler
  FROM email_send_log
 WHERE status NOT IN ('sent','queued') AND created_at > now() - interval '7 days'
 ORDER BY created_at DESC LIMIT 30;"

echo "=========================================================================="
echo "4) Versandfähigkeit je Mandant"
echo "=========================================================================="
q "
SELECT name, is_active, emails_paused,
       (smtp_host IS NOT NULL AND smtp_username IS NOT NULL AND smtp_password IS NOT NULL) AS smtp_vollstaendig,
       COALESCE(smtp_health_status,'-') AS smtp_health
  FROM tenants ORDER BY name;"

echo "=========================================================================="
echo "5) Bewerber aktuell je Trichter-Zustand"
echo "=========================================================================="
q "
SELECT COALESCE(booking_status,'(null)') AS booking_status,
       COALESCE(status,'(null)')         AS status,
       COALESCE(ai_decision,'(null)')    AS ai_decision,
       COUNT(*) AS n
  FROM applications
 WHERE COALESCE(is_test,false) = false
 GROUP BY 1,2,3 ORDER BY n DESC LIMIT 25;"

echo "=========================================================================="
echo "6) KI-Interviews: Entscheidung vs. tatsächlich versendete Einladung"
echo "=========================================================================="
q "
SELECT a.ai_decision,
       COUNT(*) AS interviews,
       COUNT(t.token) AS mit_einladung
  FROM applications a
  LEFT JOIN invitation_tokens t ON t.application_id = a.id
 WHERE a.interview_status = 'done' AND COALESCE(a.is_test,false) = false
 GROUP BY 1 ORDER BY 1;"

if [[ -n "${SUPABASE_URL:-}" && -n "${SERVICE_ROLE:-}" ]]; then
  echo "=========================================================================="
  echo "7) Dry-Run der Cron-Endpunkte (kein Versand)"
  echo "=========================================================================="
  for fn in send-application-reminders send-appointment-reminders send-booking-confirmation send-reminders; do
    echo "--- $fn"
    curl -sS -X POST "$SUPABASE_URL/functions/v1/$fn" \
      -H "Authorization: Bearer $SERVICE_ROLE" -H "Content-Type: application/json" \
      -d '{"dry_run": true}' | jq -c '{candidates, todo, sent, skipped, failed}' 2>/dev/null || echo "  (keine JSON-Antwort)"
  done
fi
echo ""
echo "Fertig — es wurde keine E-Mail versendet."
