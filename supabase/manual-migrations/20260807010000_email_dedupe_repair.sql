-- Erneute, idempotente Absicherung des automatischen E-Mail-Versands.
-- Eigene Datei, damit Installationen, die die vorherige Migration beim
-- Erst-Bootstrap nur als erledigt markiert haben, die Sperre sicher erhalten.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY template_name,
                        lower(recipient_email),
                        COALESCE(metadata->>'application_id', ''),
                        COALESCE(metadata->>'resend_nonce', ''),
                        (created_at AT TIME ZONE 'Europe/Berlin')::date
           ORDER BY created_at
         ) AS rn
    FROM public.email_send_log
   WHERE status = 'sent'
)
UPDATE public.email_send_log l
   SET status = 'superseded'
  FROM ranked r
 WHERE l.id = r.id
   AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS email_send_log_no_duplicate_sent
  ON public.email_send_log (
    template_name,
    lower(recipient_email),
    COALESCE(metadata->>'application_id', ''),
    COALESCE(metadata->>'resend_nonce', ''),
    ((created_at AT TIME ZONE 'Europe/Berlin')::date)
  )
  WHERE status = 'sent';

DELETE FROM public.application_reminder_log a
 USING public.application_reminder_log b
 WHERE a.application_id = b.application_id
   AND a.reminder_kind = b.reminder_kind
   AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS application_reminder_log_unique_kind
  ON public.application_reminder_log (application_id, reminder_kind);