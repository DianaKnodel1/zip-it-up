ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS webid_start_url text;