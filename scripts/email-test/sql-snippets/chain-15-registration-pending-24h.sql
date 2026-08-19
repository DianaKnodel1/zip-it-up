-- Stufe: Zusage erteilt, Bewerber hat sich NICHT im Portal registriert (24h).
-- Voraussetzung: chain-11 hat einen invitation_token angelegt.
-- Setzt den Token 25h zurueck, damit REG_PENDING_1_MIN (24h) greift,
-- und stellt sicher, dass kein Profil zur Testadresse existiert.

BEGIN;

UPDATE applications
   SET status = 'akzeptiert',
       booking_status = 'completed',
       is_test = true,
       updated_at = now()
 WHERE email = :'test_email';

UPDATE invitation_tokens
   SET created_at = now() - interval '25 hours',
       used = false,
       used_at = NULL
 WHERE application_id IN (SELECT id FROM applications WHERE email = :'test_email');

DELETE FROM application_reminder_log
 WHERE reminder_kind IN ('registration_pending_24h','registration_pending_72h')
   AND application_id IN (SELECT id FROM applications WHERE email = :'test_email');

COMMIT;

SELECT a.email,
       t.created_at AS token_created_at,
       round(extract(epoch FROM now() - t.created_at) / 3600) AS token_age_h
  FROM applications a
  JOIN invitation_tokens t ON t.application_id = a.id
 WHERE a.email = :'test_email';
