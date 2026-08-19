-- Atomare Sperre für konkrete E-Mail-Ereignisse.
-- Ein event_key hat genau eine Protokollzeile. Ein kontrollierter Retry setzt
-- dieselbe fehlgeschlagene Zeile wieder auf pending, statt eine neue anzulegen.

CREATE UNIQUE INDEX IF NOT EXISTS email_send_log_unique_active_event
  ON public.email_send_log ((metadata->>'event_key'))
  WHERE metadata->>'event_key' IS NOT NULL
    AND status IN ('pending', 'sent', 'failed');

COMMENT ON INDEX public.email_send_log_unique_active_event IS
  'Verhindert parallelen Doppelversand desselben fachlichen E-Mail-Ereignisses.';