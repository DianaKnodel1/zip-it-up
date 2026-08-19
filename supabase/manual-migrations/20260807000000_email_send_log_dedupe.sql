-- Doppelversand-Sperre auf Datenbankebene.
--
-- Bisher hing die Sperre allein am Anwendungs-Code (Vorgangsprotokoll +
-- 20-Stunden-Fenster). Läuft ein Cron mehrfach parallel oder ist eine alte
-- Funktionsversion deployed, greift sie nicht. Der eindeutige Index unten macht
-- dieselbe Mail (gleiche Vorlage, gleicher Empfänger, gleicher Vorgang,
-- gleiches Kalenderdatum) technisch unmöglich.

-- 1) Alte Duplikate zusammenfassen, damit der Index angelegt werden kann.
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

-- 2) Eindeutiger Index nur für tatsächlich versendete Mails.
CREATE UNIQUE INDEX IF NOT EXISTS email_send_log_no_duplicate_sent
  ON public.email_send_log (
    template_name,
    lower(recipient_email),
    COALESCE(metadata->>'application_id', ''),
    COALESCE(metadata->>'resend_nonce', ''),
    ((created_at AT TIME ZONE 'Europe/Berlin')::date)
  )
  WHERE status = 'sent';

-- 3) Idempotenz der Erinnerungen absichern.
--    Vorher evtl. vorhandene Doppelzeilen entfernen (jüngste gewinnt).
DELETE FROM public.application_reminder_log a
 USING public.application_reminder_log b
 WHERE a.application_id = b.application_id
   AND a.reminder_kind  = b.reminder_kind
   AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS application_reminder_log_unique_kind
  ON public.application_reminder_log (application_id, reminder_kind);