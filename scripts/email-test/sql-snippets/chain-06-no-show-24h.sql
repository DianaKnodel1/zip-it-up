-- Stufe 6: No-Show — Termin verstrichen, nicht erschienen

BEGIN;

UPDATE applications
   SET scheduled_at = now() - interval '25 hours',
       booking_status = 'no_show',
       updated_at = now()
 WHERE email = :'test_email';

UPDATE interview_appointments
   SET starts_at = now() - interval '25 hours',
       ends_at = now() - interval '24 hours',
       status = 'no_show',
       updated_at = now() - interval '25 hours'
 WHERE application_id IN (SELECT id FROM applications WHERE email = :'test_email');

DELETE FROM application_reminder_log
 WHERE application_id IN (SELECT id FROM applications WHERE email = :'test_email')
   AND reminder_kind = 'no_show_24h';

COMMIT;
