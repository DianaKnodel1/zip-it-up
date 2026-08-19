-- Kurzstatus der SMTP-Prüfung direkt am Mandanten (wird von den Dry-Run-Checks
-- und der Go-Live-Checkliste gelesen). Fehlte bisher auf self-hosted Backends.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS smtp_health_status text;

COMMENT ON COLUMN public.tenants.smtp_health_status IS
  'Letzter bekannter SMTP-Status des Mandanten (ok / failed / null = ungeprueft).';