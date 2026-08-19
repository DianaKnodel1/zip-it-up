-- APPLY MANUALLY: bash scripts/migrate.sh
-- ============================================================================
-- Ergebnis des Registrierungs-Einladungsversands ("Willkommen im Team") an der
-- Bewerbung festhalten, damit ein fehlgeschlagener Versand nicht mehr
-- unsichtbar in den Server-Logs verschwindet.
-- ============================================================================

ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS invite_mail_status text;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS invite_mail_error text;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS invite_mail_at timestamptz;

COMMENT ON COLUMN public.applications.invite_mail_status IS
  'sent | failed | skipped — Ergebnis des letzten Registrierungs-Einladungsversands';

NOTIFY pgrst, 'reload schema';
