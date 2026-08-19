-- Stufe 11: Recruiter erteilt die Zusage (das, was im Admin-Portal der
-- Stage-Wechsel auf vermittlung_zusage / fasttrack_angenommen auslöst).
-- Erzeugt genau einen frischen invitation_token — die Mail selbst verschickt
-- danach run-full-chain.sh über send-invitation-email.

BEGIN;

DELETE FROM invitation_tokens
 WHERE application_id IN (SELECT id FROM applications WHERE email = :'test_email');

INSERT INTO invitation_tokens (token, email, tenant_id, application_id)
SELECT encode(gen_random_bytes(24), 'hex'),
       lower(trim(a.email)),
       COALESCE(a.fasttrack_tenant_id, a.tenant_id),
       a.id
  FROM applications a
 WHERE a.email = :'test_email'
 LIMIT 1;

UPDATE applications
   SET status = 'akzeptiert',
       booking_status = 'completed',
       ai_decision = COALESCE(ai_decision, 'zusage'),
       updated_at = now()
 WHERE email = :'test_email';

COMMIT;

SELECT t.token, t.email, t.tenant_id, t.application_id
  FROM invitation_tokens t
  JOIN applications a ON a.id = t.application_id
 WHERE a.email = :'test_email';
