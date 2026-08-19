-- APPLY MANUALLY:
--   sed "s|<SUPABASE_URL>|api.dein-backend.de|g; s|<CRON_SECRET>|$DEIN_SECRET|g" \
--     supabase/manual-migrations/20260804000000_smtp_pause_logic.sql \
--     | docker exec -i supabase-db psql -U postgres -d postgres
--
-- Neue Pausen-Logik:
--   1) Alt-Pausen aus dem Domain-Health-Job (auto:domain_down) aufheben.
--      Domain-Ausfall pausiert den Mail-Versand ab sofort nicht mehr.
--   2) SMTP-Health-Cron alle 30 Min registrieren. Er pausiert bei 3
--      SMTP-Fehlern in Folge und gibt automatisch wieder frei.

-- 1) Alt-Pausen aufheben ------------------------------------------------

-- actor_id ist NOT NULL -> Systemeintrag auf einen Admin schreiben.
-- Gibt es keinen Admin, wird das Protokoll uebersprungen.
INSERT INTO public.activity_log (actor_id, action, entity_type, entity_id, comment)
SELECT
  admin.user_id,
  'emails_reaktiviert',
  'tenant',
  t.id,
  'Automatisch freigegeben: Pause stammte aus dem Domain-Health-Job. '
  || 'Domain-Ausfall stoppt den Mail-Versand nicht mehr — nur noch SMTP-Fehler.'
FROM public.tenants t
CROSS JOIN LATERAL (
  SELECT ur.user_id
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
  ORDER BY ur.user_id
  LIMIT 1
) AS admin
WHERE t.emails_paused = true
  AND t.emails_paused_by = 'auto:domain_down';

UPDATE public.tenants
SET emails_paused = false,
    emails_paused_at = NULL,
    emails_paused_reason = NULL,
    emails_paused_by = NULL,
    updated_at = now()
WHERE emails_paused = true
  AND emails_paused_by = 'auto:domain_down';

-- SMTP-Health-Cron dynamisch registrieren -------------------------------
-- Host + Auth werden aus einem bestehenden Job bzw. dem Vault gelesen,
-- damit keine Platzhalter (<SUPABASE_URL>/<CRON_SECRET>) uebrig bleiben.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $SMTPCRON$
DECLARE
  r        record;
  base_url text;
  key      text;
BEGIN
  -- 1) alte/kaputte Instanzen entfernen
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'smtp-health-cron' LOOP
    BEGIN
      PERFORM cron.unschedule(r.jobid);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  -- 2) Basis-URL aus einem funktionierenden Edge-Function-Job ableiten
  SELECT (regexp_match(command, 'https://[^/'']+/functions/v1/'))[1]
    INTO base_url
  FROM cron.job
  WHERE command LIKE '%/functions/v1/%'
    AND command NOT LIKE '%<SUPABASE_URL>%'
  ORDER BY jobid
  LIMIT 1;

  IF base_url IS NULL THEN
    RAISE NOTICE 'smtp-health-cron: keine Basis-URL gefunden – Job wird NICHT registriert. Bitte scripts/fix-mail-crons.sh ausfuehren.';
    RETURN;
  END IF;

  -- 3) Service-Role-Key aus dem Vault
  SELECT decrypted_secret INTO key
  FROM vault.decrypted_secrets
  WHERE name = 'reminders_service_role_key'
  LIMIT 1;

  IF key IS NULL OR length(key) < 20 THEN
    RAISE NOTICE 'smtp-health-cron: Vault-Secret reminders_service_role_key fehlt – Job wird NICHT registriert.';
    RETURN;
  END IF;

  PERFORM cron.schedule(
    'smtp-health-cron',
    '*/30 * * * *',
    format(
      $CMD$SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb, timeout_milliseconds := 55000);$CMD$,
      base_url || 'smtp-health-cron',
      json_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || key,
        'apikey', key
      )::text
    )
  );
  RAISE NOTICE 'smtp-health-cron registriert auf %', base_url || 'smtp-health-cron';
END
$SMTPCRON$;
