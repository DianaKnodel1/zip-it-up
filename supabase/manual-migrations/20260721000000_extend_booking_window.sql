-- Buchungsfenster verlängern: Bewerber sollen mindestens ~1 Monat im Voraus
-- Termine sehen und buchen können. Default 21 → 60 Tage; alle bestehenden
-- Schedules mit weniger als 60 Tagen werden hochgezogen.

ALTER TABLE public.availability_schedules
  ALTER COLUMN max_days_ahead SET DEFAULT 60;

UPDATE public.availability_schedules
   SET max_days_ahead = 60
 WHERE max_days_ahead < 60;

NOTIFY pgrst, 'reload schema';
