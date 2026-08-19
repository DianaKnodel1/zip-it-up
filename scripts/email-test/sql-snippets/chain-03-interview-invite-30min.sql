-- Stufe 3: Interview-Einladung 30 Minuten vor Termin
-- scheduled_at ins 25–40min-Fenster legen, Log leeren.

BEGIN;

UPDATE applications
   SET scheduled_at = now() + interval '30 minutes',
       booking_status = 'scheduled',
       updated_at = now()
 WHERE email = :'test_email';

UPDATE interview_appointments
   SET starts_at = now() + interval '30 minutes',
       ends_at = now() + interval '50 minutes',
       status = 'scheduled',
       updated_at = now()
 WHERE application_id IN (SELECT id FROM applications WHERE email = :'test_email');

DELETE FROM application_reminder_log
 WHERE application_id IN (SELECT id FROM applications WHERE email = :'test_email')
   AND reminder_kind = 'interview_invite_30min';

COMMIT;
