-- Cleanup: setzt den Test-Bewerber und seine Termine auf einen neutralen Zustand
-- und leert alle Reminder-Log-Einträge.

BEGIN;

UPDATE applications
   SET created_at = now(),
       updated_at = now(),
       booking_status = NULL,
       scheduled_at = NULL,
       is_test = false,
       interview_status = 'pending',
       interview_messages = '[]'::jsonb
 WHERE email = :'test_email';

UPDATE interview_appointments
   SET starts_at = now() + interval '7 days',
       ends_at = now() + interval '7 days' + interval '20 minutes',
       status = 'scheduled',
       updated_at = now()
 WHERE application_id IN (SELECT id FROM applications WHERE email = :'test_email');

DELETE FROM application_reminder_log
 WHERE application_id IN (SELECT id FROM applications WHERE email = :'test_email');

DELETE FROM reminder_log
 WHERE email = :'test_email';

DELETE FROM invitation_tokens
 WHERE application_id IN (SELECT id FROM applications WHERE email = :'test_email');

-- Onboarding-Teststand zuruecksetzen (Stufe "Ausweis/Vertrag fehlen").
UPDATE profiles
   SET onboarding_status = 'nicht_gestartet',
       updated_at = now()
 WHERE user_id IN (SELECT id FROM auth.users WHERE email = :'test_email');

DELETE FROM kyc_verifications
 WHERE user_id IN (SELECT id FROM auth.users WHERE email = :'test_email');

COMMIT;

SELECT 'cleanup done' AS status, email, booking_status, created_at
  FROM applications WHERE email = :'test_email';
