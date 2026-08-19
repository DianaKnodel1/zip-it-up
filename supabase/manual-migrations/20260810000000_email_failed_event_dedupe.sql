-- Eine technische Retry-Serie ist ein Versandereignis und erhält genau eine
-- aktive Protokollzeile. Ältere doppelte Fehler bleiben als superseded erhalten.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY metadata->>'event_key'
           ORDER BY created_at DESC, id DESC
         ) AS rn
    FROM public.email_send_log
   WHERE metadata->>'event_key' IS NOT NULL
     AND status IN ('pending', 'sent', 'failed')
)
UPDATE public.email_send_log l
   SET status = 'superseded'
  FROM ranked r
 WHERE l.id = r.id
   AND r.rn > 1;

DROP INDEX IF EXISTS public.email_send_log_unique_active_event;

CREATE UNIQUE INDEX email_send_log_unique_active_event
  ON public.email_send_log ((metadata->>'event_key'))
  WHERE metadata->>'event_key' IS NOT NULL
    AND status IN ('pending', 'sent', 'failed');

COMMENT ON INDEX public.email_send_log_unique_active_event IS
  'Genau eine aktive Protokollzeile je fachlichem E-Mail-Ereignis, inklusive kontrollierter Fehler-Retries.';