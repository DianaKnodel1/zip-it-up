ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS webid_client_name text,
  ADD COLUMN IF NOT EXISTS webid_status text NOT NULL DEFAULT 'offen',
  ADD COLUMN IF NOT EXISTS webid_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS webid_confirmed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'task_assignments_webid_status_check'
  ) THEN
    ALTER TABLE public.task_assignments
      ADD CONSTRAINT task_assignments_webid_status_check
      CHECK (webid_status IN ('offen','gestartet','bestaetigt','geprueft'));
  END IF;
END $$;