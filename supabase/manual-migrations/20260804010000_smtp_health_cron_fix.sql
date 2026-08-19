-- Repariert den smtp-health-cron-Job: die vorherige Migration hat die
-- Platzhalter <SUPABASE_URL>/<CRON_SECRET> nicht ersetzt.

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
