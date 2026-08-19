-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Automatische Auftragszuweisung 15 Minuten vor Termin.

ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS auto_assigned_at timestamptz;

CREATE INDEX IF NOT EXISTS bookings_assignment_id_idx
  ON public.bookings (assignment_id);

CREATE INDEX IF NOT EXISTS bookings_date_time_idx
  ON public.bookings (booking_date, booking_time);

CREATE INDEX IF NOT EXISTS task_assignments_user_template_idx
  ON public.task_assignments (user_id, task_template_id);
