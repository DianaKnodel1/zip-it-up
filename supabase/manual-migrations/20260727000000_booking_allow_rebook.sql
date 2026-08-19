-- APPLY MANUALLY via Supabase SQL Editor (bash scripts/migrate.sh).
-- ============================================================================
-- Umbuchen erlauben: `book_appointment_by_token` storniert einen bestehenden
-- 'scheduled' Termin und legt einen neuen an – bis 15 Minuten vor Slot.
-- Zusätzlich wird der Interview-Status zurückgesetzt, damit die KI den neuen
-- Termin akzeptiert (Bewerber, die schon einmal ins Interview gelaufen sind,
-- aber nicht abgeschlossen haben, dürfen wieder rein).
-- ============================================================================

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
  app             public.applications%ROWTYPE;
  sch             public.availability_schedules%ROWTYPE;
  ends_at_v       timestamptz;
  new_id          uuid;
  new_token       uuid;
BEGIN
  -- 15 Minuten Vorlaufzeit hart erzwingen (Umbuchen bis kurz vor Termin).
  IF _starts_at < now() + interval '15 minutes' THEN
    appointment_id := NULL; cancel_token := NULL; starts_at := NULL; ends_at := NULL;
    error := 'slot_too_soon'; RETURN NEXT; RETURN;
  END IF;

  SELECT a.* INTO app
    FROM public.applications AS a
   WHERE a.magic_token = _magic_token
     AND (a.magic_token_expires_at IS NULL OR a.magic_token_expires_at > now())
   LIMIT 1;

  IF NOT FOUND THEN
    appointment_id := NULL; cancel_token := NULL; starts_at := NULL; ends_at := NULL;
    error := 'application_not_found'; RETURN NEXT; RETURN;
  END IF;

  -- Aktive Termine derselben Bewerbung stornieren (Umbuchen unbegrenzt erlaubt).
  UPDATE public.interview_appointments AS ia
     SET status = 'cancelled', cancelled_at = now()
   WHERE ia.application_id = app.id
     AND ia.status = 'scheduled';

  -- Passendes Schedule (Fast-Track bevorzugt).
  SELECT s.* INTO sch
    FROM (
      SELECT 1 AS ord, app.target_landing_id AS landing_page_id
       WHERE app.target_landing_id IS NOT NULL
      UNION ALL
      SELECT 2 AS ord, lp_src.linked_fasttrack_landing_id AS landing_page_id
        FROM public.landing_pages AS lp_src
       WHERE lp_src.id = app.source_landing_id
         AND lp_src.linked_fasttrack_landing_id IS NOT NULL
      UNION ALL
      SELECT 3 AS ord, app.source_landing_id AS landing_page_id
       WHERE app.source_landing_id IS NOT NULL
    ) AS candidates
    JOIN public.landing_pages AS lp
      ON lp.id = candidates.landing_page_id
     AND lp.booking_mode = 'internal'
    JOIN public.availability_schedules AS s
      ON s.landing_page_id = lp.id
     AND s.active = true
   ORDER BY candidates.ord
   LIMIT 1;

  IF NOT FOUND THEN
    error := 'no_schedule_configured'; RETURN NEXT; RETURN;
  END IF;

  ends_at_v := _starts_at + make_interval(mins => sch.slot_duration_minutes);

  BEGIN
    INSERT INTO public.interview_appointments AS ia
      (tenant_id, application_id, schedule_id, starts_at, ends_at, applicant_timezone)
    VALUES
      (app.tenant_id, app.id, sch.id, _starts_at, ends_at_v, _applicant_timezone)
    RETURNING ia.id, ia.cancel_token INTO new_id, new_token;
  EXCEPTION WHEN exclusion_violation OR unique_violation THEN
    error := 'slot_taken'; RETURN NEXT; RETURN;
  END;

  -- Applikation aktualisieren + Interview-Status resetten, damit der neue
  -- Termin ein sauberes Interview erlaubt (kein "already_completed"-Block).
  UPDATE public.applications AS a
     SET booking_status         = 'scheduled',
         scheduled_at           = _starts_at,
         interview_started_at   = NULL,
         interview_completed_at = NULL,
         updated_at             = now()
   WHERE a.id = app.id;

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
