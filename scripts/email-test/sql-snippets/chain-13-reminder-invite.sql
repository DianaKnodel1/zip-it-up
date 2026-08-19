-- Stufe 13: Legacy-Invite-Reminder (aktuell absichtlich deaktiviert).

BEGIN;

UPDATE applications
   SET status = 'akzeptiert',
       created_at = now() - interval '4 days',
       updated_at = now() - interval '4 days'
 WHERE email = :'test_email';

DELETE FROM reminder_log
 WHERE email = :'test_email'
   AND reminder_type = 'invite';

COMMIT;
