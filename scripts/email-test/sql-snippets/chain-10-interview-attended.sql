-- Stufe 10: Bewerber nimmt den Termin wahr → KI-Interview kann starten.
-- Setzt den Test-Bewerber auf "Termin läuft gerade", markiert ihn als Testdatensatz
-- (umgeht das Termin-Gate im Interview-Endpunkt) und leert einen evtl. vorhandenen
-- Interview-Verlauf, damit action:"init" nicht mit 409 abbricht.

BEGIN;

UPDATE applications
   SET is_test = true,
       booking_status = 'scheduled',
       scheduled_at = now() - interval '5 minutes',
       status = 'neu',
       interview_status = 'pending',
       interview_messages = '[]'::jsonb,
       interview_summary = NULL,
       interview_score = NULL,
       interview_recommendation = NULL,
       interview_started_at = NULL,
       interview_completed_at = NULL,
       ai_decision = NULL,
       ai_reason = NULL,
       updated_at = now()
 WHERE email = :'test_email';

UPDATE interview_appointments
   SET starts_at = now() - interval '5 minutes',
       ends_at = now() + interval '25 minutes',
       status = 'scheduled',
       updated_at = now()
 WHERE application_id IN (SELECT id FROM applications WHERE email = :'test_email');

-- Alte Einladung entfernen: die Zusage-Stufe prüft auf "already_invited".
DELETE FROM invitation_tokens
 WHERE application_id IN (SELECT id FROM applications WHERE email = :'test_email');

COMMIT;

SELECT id, email, is_test, booking_status, scheduled_at, interview_status
  FROM applications WHERE email = :'test_email';
