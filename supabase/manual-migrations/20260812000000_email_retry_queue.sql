-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Automatischer Nachversand ("Retry-Warteschlange") für E-Mails, die wegen
-- einer vorübergehenden Störung nicht rausgingen (SMTP-Timeout, Stundenlimit,
-- Mandanten-Pause, Sendefenster).
--
-- Der Worker `email-retry-cron` liest genau diese Spalten:
--   retry_count        Anzahl bisheriger automatischer Versuche
--   next_retry_at      frühester Zeitpunkt des nächsten Versuchs (Backoff)
--   retry_locked_until Sperre gegen parallele Läufe (verhindert Doppelversand)
--   retry_reason       maschinenlesbarer Grund, warum die Zeile in der Queue liegt

ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS retry_reason text;

COMMENT ON COLUMN public.email_send_log.retry_count IS
  'Anzahl automatischer Nachversand-Versuche (email-retry-cron). Ab 5 -> status dlq.';
COMMENT ON COLUMN public.email_send_log.next_retry_at IS
  'Frühester Zeitpunkt für den nächsten automatischen Versuch (Backoff 10m/30m/2h/6h).';
COMMENT ON COLUMN public.email_send_log.retry_locked_until IS
  'Laufsperre, damit zwei Cron-Läufe dieselbe Zeile nicht doppelt senden.';

CREATE INDEX IF NOT EXISTS idx_email_send_log_retry_queue
  ON public.email_send_log (next_retry_at, created_at)
  WHERE status IN ('pending', 'failed', 'skipped');

NOTIFY pgrst, 'reload schema';