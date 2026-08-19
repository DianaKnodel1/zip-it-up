-- Stufe: Zusage erteilt, immer noch keine Registrierung (2. Nachfass, 72h).

BEGIN;

UPDATE applications
   SET status = 'akzeptiert',
       booking_status = 'completed',
       is_test = true,
       updated_at = now()
 WHERE email = :'test_email';

UPDATE invitation_tokens
   SET created_at = now() - interval '73 hours',
       used = false,
       used_at = NULL
 WHERE application_id IN (SELECT id FROM applications WHERE email = :'test_email');

-- nur die 72h-Sperre loesen; der 24h-Eintrag darf stehen bleiben,
-- sonst waere der Bewerber wieder fuer die 24h-Mail faellig.
DELETE FROM application_reminder_log
 WHERE reminder_kind = 'registration_pending_72h'
   AND application_id IN (SELECT id FROM applications WHERE email = :'test_email');

INSERT INTO application_reminder_log (application_id, tenant_id, reminder_kind, recipient_email, status)
SELECT a.id, COALESCE(a.fasttrack_tenant_id, a.tenant_id), 'registration_pending_24h', a.email, 'sent'
  FROM applications a
 WHERE a.email = :'test_email'
ON CONFLICT (application_id, reminder_kind) DO NOTHING;

COMMIT;

SELECT a.email, round(extract(epoch FROM now() - t.created_at) / 3600) AS token_age_h
  FROM applications a JOIN invitation_tokens t ON t.application_id = a.id
 WHERE a.email = :'test_email';
