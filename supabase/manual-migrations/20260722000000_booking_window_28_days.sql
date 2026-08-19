-- 4-Wochen-Fenster + Mehrfachbuchung erlauben.
-- 1) Default max_days_ahead zurück auf 28 (kompletter Monat auf einen Blick).
-- 2) Slot-Overlap-Constraint entfernen, damit mehrere Bewerber denselben Slot buchen können.
-- 3) get_free_appointment_slots: Konfliktprüfung gegen bestehende Buchungen entfernen.

ALTER TABLE public.availability_schedules
  ALTER COLUMN max_days_ahead SET DEFAULT 28;

UPDATE public.availability_schedules
   SET max_days_ahead = 28
 WHERE max_days_ahead <> 28;

ALTER TABLE public.interview_appointments
  DROP CONSTRAINT IF EXISTS interview_appointments_no_overlap;

CREATE OR REPLACE FUNCTION public.get_free_appointment_slots(
  _schedule_id uuid,
  _from_date date,
  _to_date   date
) RETURNS TABLE(slot_start timestamptz, slot_end timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sch      public.availability_schedules%ROWTYPE;
  d        date;
  wday     int;
  rule     record;
  slot_len interval;
  cursor_t timestamptz;
  end_t    timestamptz;
  window_start timestamptz;
  window_end   timestamptz;
  min_start timestamptz;
  max_end   timestamptz;
  full_block boolean;
BEGIN
  SELECT * INTO sch FROM public.availability_schedules WHERE id = _schedule_id AND active;
  IF NOT FOUND THEN RETURN; END IF;

  slot_len := make_interval(mins => sch.slot_duration_minutes);
  min_start := now() + make_interval(hours => sch.min_notice_hours);
  max_end   := now() + make_interval(days  => sch.max_days_ahead);

  IF _from_date IS NULL THEN _from_date := (now() AT TIME ZONE sch.timezone)::date; END IF;
  IF _to_date   IS NULL THEN _to_date   := _from_date + sch.max_days_ahead; END IF;

  d := _from_date;
  WHILE d <= _to_date LOOP
    wday := EXTRACT(DOW FROM d)::int;

    SELECT bool_or(is_blocked) INTO full_block
      FROM public.availability_exceptions
     WHERE schedule_id = _schedule_id AND exception_date = d AND is_blocked = true;
    IF COALESCE(full_block, false) THEN
      d := d + 1; CONTINUE;
    END IF;

    FOR rule IN
      SELECT start_time, end_time FROM public.availability_rules
       WHERE schedule_id = _schedule_id AND weekday = wday
      UNION ALL
      SELECT start_time, end_time FROM public.availability_exceptions
       WHERE schedule_id = _schedule_id AND exception_date = d AND is_blocked = false
    LOOP
      window_start := (d + rule.start_time) AT TIME ZONE sch.timezone;
      window_end   := (d + rule.end_time)   AT TIME ZONE sch.timezone;
      cursor_t := window_start;

      WHILE cursor_t + slot_len <= window_end LOOP
        end_t := cursor_t + slot_len;
        IF cursor_t >= min_start AND end_t <= max_end THEN
          -- Mehrfachbuchung erlaubt: KEINE Konfliktprüfung gegen bestehende Termine.
          slot_start := cursor_t;
          slot_end := end_t;
          RETURN NEXT;
        END IF;
        cursor_t := cursor_t + slot_len;
      END LOOP;
    END LOOP;

    d := d + 1;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.get_free_appointment_slots(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_free_appointment_slots(uuid, date, date)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
