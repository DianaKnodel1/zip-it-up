-- Stufe: Mitarbeiter hat sich registriert, aber Onboarding ist unvollstaendig
-- (kein unterschriebener Vertrag, kein verifizierter Ausweis) -> "Registrierung abschliessen".
-- Voraussetzung: auth.users-Eintrag zur Testadresse (Stufe signup_confirmation).

BEGIN;

-- Account muss bestaetigt sein, sonst greift complete_registration nicht.
UPDATE auth.users
   SET email_confirmed_at = COALESCE(email_confirmed_at, now() - interval '3 days'),
       created_at = LEAST(created_at, now() - interval '3 days')
 WHERE email = :'test_email';

-- Profil anlegen, falls die Registrierung im Test nie durchlaufen wurde.
INSERT INTO profiles (user_id, full_name, tenant_id, onboarding_status, status, created_at, updated_at)
SELECT u.id, 'Test Kette', :'tenant_id'::uuid, 'in_bearbeitung', 'registriert',
       now() - interval '3 days', now()
  FROM auth.users u
 WHERE u.email = :'test_email'
   AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = u.id);

UPDATE profiles
   SET onboarding_status = 'in_bearbeitung',
       status = 'registriert',
       tenant_id = COALESCE(tenant_id, :'tenant_id'::uuid),
       contract_signed_at = NULL,
       created_at = LEAST(created_at, now() - interval '3 days'),
       updated_at = now()
 WHERE user_id IN (SELECT id FROM auth.users WHERE email = :'test_email');

-- Ausweis/KYC bewusst unvollstaendig lassen.
DELETE FROM kyc_verifications
 WHERE user_id IN (SELECT id FROM auth.users WHERE email = :'test_email');

DELETE FROM reminder_log
 WHERE email = :'test_email'
   AND reminder_type = 'complete_registration';

COMMIT;

SELECT p.user_id, p.onboarding_status, p.status, p.contract_signed_at, p.created_at
  FROM profiles p
  JOIN auth.users u ON u.id = p.user_id
 WHERE u.email = :'test_email';
