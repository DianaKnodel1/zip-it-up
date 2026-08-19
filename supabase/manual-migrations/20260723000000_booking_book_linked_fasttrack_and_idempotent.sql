-- Eigenes Buchungssystem: Buchung stabilisieren.
-- - Nutzt dieselbe Kalender-Priorität wie get_schedule_for_application:
--   target_landing_id → linked_fasttrack_landing_id der Source-Landing → source_landing_id.
-- - Bereits gebuchte Bewerbungen werden idempotent bestätigt statt in einen Fehler-/Loop zu laufen.

CREATE OR REPLACE FUNCTION public.book_appointment_by_token(
  _magic_token text,
  _starts_at   timestamptz,
  _applicant_timezone text DEFAULT NULL
) RETURNS TABLE(appointment_id uuid, cancel_token uuid, starts_at timestamptz, ends_at timestamptz, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app          public.applications%ROWTYPE;
  sch          public.availability_schedules%ROWTYPE;
  ends_at_v    timestamptz;
  new_id       uuid;
  new_token    uuid;
  existing_id  uuid;
  existing_token uuid;
  existing_starts timestamptz;
  existing_ends timestamptz;
BEGIN
  SELECT * INTO app
    FROM public.applications
   WHERE magic_token = _magic_token
     AND (magic_token_expires_at IS NULL OR magic_token_expires_at > now())
   LIMIT 1;
  IF NOT FOUND THEN
    appointment_id := NULL; cancel_token := NULL; starts_at := NULL; ends_at := NULL;
    error := 'application_not_found'; RETURN NEXT; RETURN;
  END IF;

  SELECT id, cancel_token, starts_at, ends_at
    INTO existing_id, existing_token, existing_starts, existing_ends
    FROM public.interview_appointments
   WHERE application_id = app.id AND status = 'scheduled'
   ORDER BY created_at DESC
   LIMIT 1;
  IF existing_id IS NOT NULL THEN
    appointment_id := existing_id;
    cancel_token := existing_token;
    starts_at := existing_starts;
    ends_at := existing_ends;
    error := NULL;
    RETURN NEXT; RETURN;
  END IF;

  SELECT s.* INTO sch
    FROM (
      SELECT 1 AS ord, app.target_landing_id AS landing_page_id
       WHERE app.target_landing_id IS NOT NULL
      UNION ALL
      SELECT 2 AS ord, lp_src.linked_fasttrack_landing_id AS landing_page_id
        FROM public.landing_pages lp_src
       WHERE lp_src.id = app.source_landing_id
         AND lp_src.linked_fasttrack_landing_id IS NOT NULL
      UNION ALL
      SELECT 3 AS ord, app.source_landing_id AS landing_page_id
       WHERE app.source_landing_id IS NOT NULL
    ) candidates
    JOIN public.landing_pages lp
      ON lp.id = candidates.landing_page_id
     AND lp.booking_mode = 'internal'
    JOIN public.availability_schedules s
      ON s.landing_page_id = lp.id
     AND s.active = true
   ORDER BY candidates.ord
   LIMIT 1;
  IF NOT FOUND THEN
    error := 'no_schedule_configured'; RETURN NEXT; RETURN;
  END IF;

  ends_at_v := _starts_at + make_interval(mins => sch.slot_duration_minutes);

  BEGIN
    INSERT INTO public.interview_appointments
      (tenant_id, application_id, schedule_id, starts_at, ends_at, applicant_timezone)
    VALUES
      (app.tenant_id, app.id, sch.id, _starts_at, ends_at_v, _applicant_timezone)
    RETURNING id, cancel_token INTO new_id, new_token;
  EXCEPTION WHEN exclusion_violation OR unique_violation THEN
    error := 'slot_taken'; RETURN NEXT; RETURN;
  END;

  UPDATE public.applications
     SET booking_status = 'scheduled',
         scheduled_at   = _starts_at,
         updated_at     = now()
   WHERE id = app.id;

  appointment_id := new_id;
  cancel_token   := new_token;
  starts_at      := _starts_at;
  ends_at        := ends_at_v;
  error          := NULL;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.book_appointment_by_token(text, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_appointment_by_token(text, timestamptz, text)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';