-- APPLY MANUALLY:
--   sed "s|<SUPABASE_URL>|api.dein-backend.de|g" \
--     supabase/manual-migrations/20260724000000_recreate_cron_jobs_clean.sql \
--     | docker exec -i supabase-db psql -U postgres -d postgres
--
-- Räumt DUPLIKATE der pg_cron-Jobs auf und legt jeden Job GENAU EINMAL neu an.
-- Ursache der bisherigen Fehler ("Quote command returned error"): mehrere
-- Job-Instanzen pro Name, davon eine mit ungültigem/leerem URL-Placeholder.
--
-- Reihenfolge:
--   1) Alle Instanzen der betroffenen Namen per jobid unschedulen
--   2) Vault-Secret prüfen (RAISE bei NULL)
--   3) Jobs jeweils 1x neu registrieren

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 1) Duplikate hart entfernen (per jobid, nicht per name)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT jobid, jobname FROM cron.job
    WHERE jobname IN (
      'send-appointment-reminders',
      'send-application-reminders',
      'process-invite-resend-queue',
      'auto_complete_appointments'
    )
  LOOP
    BEGIN
      PERFORM cron.unschedule(r.jobid);
      RAISE NOTICE 'unscheduled % (jobid=%)', r.jobname, r.jobid;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'could not unschedule % (jobid=%): %', r.jobname, r.jobid, SQLERRM;
    END;
  END LOOP;
END$$;

-- 2) Preflight: Service-Role Key im Vault muss existieren
DO $$
DECLARE k text;
BEGIN
  SELECT decrypted_secret INTO k
  FROM vault.decrypted_secrets
  WHERE name = 'reminders_service_role_key'
  LIMIT 1;
  IF k IS NULL OR length(k) < 20 THEN
    RAISE EXCEPTION 'Vault secret reminders_service_role_key fehlt/leer – bitte per vault.create_secret(<key>, ''reminders_service_role_key'') anlegen und Migration neu ausführen.';
  END IF;
END$$;

-- 3) Jobs neu registrieren – je 1x

SELECT cron.schedule(
  'send-appointment-reminders',
  '*/10 * * * *',
  $CRON$
  SELECT net.http_post(
    url := 'https://<SUPABASE_URL>/functions/v1/send-appointment-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reminders_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $CRON$
);

SELECT cron.schedule(
  'send-application-reminders',
  '*/5 * * * *',
  $CRON$
  SELECT net.http_post(
    url := 'https://<SUPABASE_URL>/functions/v1/send-application-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reminders_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $CRON$
);

SELECT cron.schedule(
  'process-invite-resend-queue',
  '*/15 * * * *',
  $CRON$
  SELECT net.http_post(
    url := 'https://<SUPABASE_URL>/functions/v1/process-invite-resend-queue',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reminders_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $CRON$
);

-- auto_complete_appointments: reine SQL-Funktion, kein HTTP nötig
SELECT cron.schedule(
  'auto_complete_appointments',
  '*/10 * * * *',
  $CRON$ SELECT public.auto_complete_past_appointments(); $CRON$
);

NOTIFY pgrst, 'reload schema';

-- Verifizieren:
--   SELECT jobname, count(*) FROM cron.job GROUP BY jobname ORDER BY jobname;
--   (jeder betroffene Name muss genau 1x auftauchen)
