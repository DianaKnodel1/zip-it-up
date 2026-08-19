-- Auto-Sperre nur noch bei echten EMPFÄNGER-Problemen.
--
-- Bisher hat der Trigger jeden 'failed'-Eintrag gezählt — auch SMTP-Login-
-- fehler (535), Timeouts und Gateway-502. Eine Störung beim Absender hat so
-- gültige Bewerberadressen global gesperrt ("auto:3x_bounce_30d").

CREATE OR REPLACE FUNCTION public.auto_suppress_on_bounce()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_count int;
  v_infra text := '(invalid login|535|eauth|authentication failed|greeting never received|timeout|etimedout|econn|socket|gateway|502|503|504|rate limit|rate-limit|too many messages|throttl|quota exceeded|try again later|451|smtp_error|network)';
BEGIN
  IF NEW.status NOT IN ('bounced','dlq','failed') THEN
    RETURN NEW;
  END IF;
  IF NEW.recipient_email IS NULL OR length(NEW.recipient_email) < 3 THEN
    RETURN NEW;
  END IF;
  -- Absender-/Infrastrukturfehler sperren keine Empfänger.
  IF lower(coalesce(NEW.error_message, '')) ~ v_infra THEN
    RETURN NEW;
  END IF;

  v_tenant := NEW.tenant_id;
  IF v_tenant IS NULL THEN
    BEGIN
      v_tenant := (NEW.metadata->>'tenant_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_tenant := NULL;
    END;
  END IF;
  -- Ohne Mandantenbezug keine globale Sperre.
  IF v_tenant IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.email_send_log l
  WHERE lower(l.recipient_email) = lower(NEW.recipient_email)
    AND l.tenant_id = v_tenant
    AND l.status IN ('bounced','dlq','failed')
    AND lower(coalesce(l.error_message, '')) !~ v_infra
    AND l.created_at > now() - interval '30 days';

  IF v_count >= 3 THEN
    INSERT INTO public.suppressed_emails (tenant_id, email, reason, source)
    VALUES (v_tenant, lower(NEW.recipient_email), 'auto:3x_bounce_30d', 'trigger')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Bestehende Fehlsperren aufheben: alle automatischen Sperren, für die es in
-- den letzten 30 Tagen keine 3 echten Empfängerfehler gibt.
DELETE FROM public.suppressed_emails s
 WHERE s.source = 'trigger'
   AND (
     SELECT count(*) FROM public.email_send_log l
      WHERE lower(l.recipient_email) = lower(s.email)
        AND (s.tenant_id IS NULL OR l.tenant_id = s.tenant_id)
        AND l.status IN ('bounced','dlq','failed')
        AND lower(coalesce(l.error_message, '')) !~
            '(invalid login|535|eauth|authentication failed|greeting never received|timeout|etimedout|econn|socket|gateway|502|503|504|rate limit|rate-limit|too many messages|throttl|quota exceeded|try again later|451|smtp_error|network)'
        AND l.created_at > now() - interval '30 days'
   ) < 3;
