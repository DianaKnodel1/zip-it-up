-- APPLY MANUALLY via: bash scripts/migrate.sh (oder Supabase SQL Editor)
-- ============================================================================
-- Einmaliger Abgleich: Vermittlungs-Landing und verknüpfte Fast-Track-Landing
-- sollen identische Termin-Verfügbarkeiten haben.
-- Führend ist die Vermittlungs-Landing (source), da sie auf Fast-Track weiterleitet.
-- Neue Änderungen werden ab jetzt automatisch aus dem Portal gespiegelt.
-- ============================================================================

DO $$
DECLARE
  pair   RECORD;
  src_s  public.availability_schedules%ROWTYPE;
  tgt_id uuid;
BEGIN
  FOR pair IN
    SELECT lp.id AS source_id, lp.linked_fasttrack_landing_id AS target_id
      FROM public.landing_pages lp
     WHERE lp.linked_fasttrack_landing_id IS NOT NULL
  LOOP
    SELECT * INTO src_s
      FROM public.availability_schedules
     WHERE landing_page_id = pair.source_id
     ORDER BY active DESC, created_at ASC
     LIMIT 1;
    CONTINUE WHEN NOT FOUND;

    SELECT id INTO tgt_id
      FROM public.availability_schedules
     WHERE landing_page_id = pair.target_id
     ORDER BY created_at ASC
     LIMIT 1;

    IF tgt_id IS NULL THEN
      INSERT INTO public.availability_schedules
        (tenant_id, landing_page_id, name, timezone, slot_duration_minutes,
         buffer_before_minutes, buffer_after_minutes, min_notice_hours,
         max_days_ahead, active)
      VALUES
        (src_s.tenant_id, pair.target_id, src_s.name || ' (synchronisiert)', src_s.timezone,
         src_s.slot_duration_minutes, src_s.buffer_before_minutes, src_s.buffer_after_minutes,
         src_s.min_notice_hours, src_s.max_days_ahead, src_s.active)
      RETURNING id INTO tgt_id;
    ELSE
      UPDATE public.availability_schedules
         SET timezone               = src_s.timezone,
             slot_duration_minutes  = src_s.slot_duration_minutes,
             buffer_before_minutes  = src_s.buffer_before_minutes,
             buffer_after_minutes   = src_s.buffer_after_minutes,
             min_notice_hours       = src_s.min_notice_hours,
             max_days_ahead         = src_s.max_days_ahead,
             active                 = src_s.active,
             updated_at             = now()
       WHERE id = tgt_id;
    END IF;

    DELETE FROM public.availability_rules WHERE schedule_id = tgt_id;
    INSERT INTO public.availability_rules (schedule_id, weekday, start_time, end_time)
    SELECT tgt_id, weekday, start_time, end_time
      FROM public.availability_rules WHERE schedule_id = src_s.id;

    DELETE FROM public.availability_exceptions WHERE schedule_id = tgt_id;
    INSERT INTO public.availability_exceptions
      (schedule_id, exception_date, is_blocked, start_time, end_time, note)
    SELECT tgt_id, exception_date, is_blocked, start_time, end_time, note
      FROM public.availability_exceptions WHERE schedule_id = src_s.id;

    RAISE NOTICE 'Terminplan % -> Landing % gespiegelt (Schedule %)', src_s.id, pair.target_id, tgt_id;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
