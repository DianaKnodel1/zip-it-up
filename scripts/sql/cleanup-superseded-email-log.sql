-- Altlasten-Cleanup: "pending"-Zeilen im email_send_log, für die es später
-- einen finalen Versand (sent/failed/dlq/bounced) an denselben Empfänger mit
-- demselben Template gibt, auf 'superseded' setzen.
--
-- Wirkung: Dashboard/E-Mail-Center zählen diese Retry-Artefakte nicht mehr als
-- "Warteschlange". Echte Hänger (kein späterer finaler Versand) bleiben sichtbar.
--
-- Ausführen auf Backend 123:
--   psql "$DATABASE_URL" -f scripts/sql/cleanup-superseded-email-log.sql

-- 1) Vorschau
SELECT p.id, p.template_name, p.recipient_email, p.created_at
FROM email_send_log p
WHERE p.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM email_send_log f
    WHERE f.template_name = p.template_name
      AND lower(f.recipient_email) = lower(p.recipient_email)
      AND f.status IN ('sent', 'failed', 'dlq', 'bounced', 'complained', 'suppressed')
      AND f.created_at >= p.created_at
  )
ORDER BY p.created_at DESC;

-- 2) Update
UPDATE email_send_log p
SET status = 'superseded'
WHERE p.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM email_send_log f
    WHERE f.template_name = p.template_name
      AND lower(f.recipient_email) = lower(p.recipient_email)
      AND f.status IN ('sent', 'failed', 'dlq', 'bounced', 'complained', 'suppressed')
      AND f.created_at >= p.created_at
  );

-- 3) Kontrolle: welche echten Hänger bleiben?
SELECT template_name, recipient_email, created_at, error_message
FROM email_send_log
WHERE status = 'pending'
ORDER BY created_at DESC;
