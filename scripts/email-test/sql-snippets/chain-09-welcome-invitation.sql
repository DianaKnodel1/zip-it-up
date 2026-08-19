-- Stufe 9: Willkommens-/Registrierungs-Einladung
-- Bewerbung "angenommen" markieren.

BEGIN;

UPDATE applications
   SET status = 'akzeptiert',
       booking_status = 'completed',
       updated_at = now()
 WHERE email = :'test_email';

DELETE FROM application_reminder_log
 WHERE application_id IN (SELECT id FROM applications WHERE email = :'test_email')
   AND reminder_kind IN ('welcome_invitation', 'reminder_invite');

COMMIT;
