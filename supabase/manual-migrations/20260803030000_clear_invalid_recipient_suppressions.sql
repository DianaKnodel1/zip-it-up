-- SMTP-Login-, Verbindungs- und Gatewayfehler sind Absender-/Serverprobleme.
-- Frühere Versionen haben sie fälschlich als Empfängerfehler gezählt und damit
-- gültige Bewerberadressen nach drei Versuchen gesperrt.
UPDATE public.email_recipient_failures
   SET consecutive_failures = 0,
       suppressed_at = NULL,
       updated_at = now()
 WHERE suppressed_at IS NOT NULL
   AND lower(coalesce(last_error, '')) ~
       '(invalid login|535|eauth|authentication failed|greeting never received|timeout|etimedout|econn|gateway|502|503|504)';

-- Automatische Empfängersperren gelten je Absender-Mandant. Eine Störung bei
-- W3 Personal darf dieselbe Adresse bei BV-Agentur/Personalservice nicht sperren.
-- Manuelle globale Sperren liegen bereits separat in suppressed_emails.
DELETE FROM public.email_recipient_failures WHERE tenant_id IS NULL;

ALTER TABLE public.email_recipient_failures
  DROP CONSTRAINT IF EXISTS email_recipient_failures_pkey;

ALTER TABLE public.email_recipient_failures
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE public.email_recipient_failures
  ADD CONSTRAINT email_recipient_failures_pkey PRIMARY KEY (recipient_email, tenant_id);