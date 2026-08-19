-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Archiv für Alt-Bewerbungen.
--
-- Ziel: Die Bewerber-Liste und alle Auswertungen zeigen nur noch den aktuellen
-- Funnel. Alte Datensätze werden NICHT gelöscht, sondern archiviert — sie
-- bleiben über den Archiv-Filter jederzeit einsehbar.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_applications_is_archived
  ON public.applications(is_archived, created_at DESC);

COMMENT ON COLUMN public.applications.is_archived IS
  'TRUE = Alt-Bewerbung. In Liste/Statistik ausgeblendet, Daten bleiben erhalten.';

NOTIFY pgrst, 'reload schema';
