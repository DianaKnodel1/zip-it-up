-- Stufe 5: 72h nach Bewerbung, kein Termin gebucht

BEGIN;

UPDATE applications
   SET created_at = now() - interval '73 hours',
       booking_status = 'none',
       scheduled_at = NULL,
       updated_at = now()
 WHERE email = :'test_email';

DELETE FROM application_reminder_log
 WHERE application_id IN (SELECT id FROM applications WHERE email = :'test_email')
   AND reminder_kind = 'no_booking_72h';

COMMIT;
