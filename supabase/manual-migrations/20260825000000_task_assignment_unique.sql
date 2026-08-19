-- Ein Mitarbeiter darf dieselbe Auftragsvorlage nur EINMAL erhalten.
-- 1) Bestehende Dubletten bereinigen (weitester Fortschritt / älteste bleibt).
-- 2) bookings.assignment_id auf die verbleibende Zuweisung umhängen.
-- 3) UNIQUE-Constraint setzen.

DO $$
DECLARE
  _dup RECORD;
  _keep uuid;
BEGIN
  FOR _dup IN
    SELECT user_id, task_template_id
    FROM public.task_assignments
    GROUP BY user_id, task_template_id
    HAVING count(*) > 1
  LOOP
    SELECT id INTO _keep
    FROM public.task_assignments
    WHERE user_id = _dup.user_id AND task_template_id = _dup.task_template_id
    ORDER BY
      CASE COALESCE(status::text, '')
        WHEN 'abgeschlossen' THEN 0
        WHEN 'erledigt'      THEN 0
        WHEN 'in_bearbeitung' THEN 1
        WHEN 'zugewiesen'    THEN 2
        ELSE 3
      END,
      created_at ASC
    LIMIT 1;

    UPDATE public.bookings b
       SET assignment_id = _keep
     WHERE b.assignment_id IN (
       SELECT id FROM public.task_assignments
       WHERE user_id = _dup.user_id
         AND task_template_id = _dup.task_template_id
         AND id <> _keep
     );

    DELETE FROM public.task_assignments
     WHERE user_id = _dup.user_id
       AND task_template_id = _dup.task_template_id
       AND id <> _keep;
  END LOOP;
END $$;

ALTER TABLE public.task_assignments
  DROP CONSTRAINT IF EXISTS task_assignments_user_template_uniq;
ALTER TABLE public.task_assignments
  ADD CONSTRAINT task_assignments_user_template_uniq
  UNIQUE (user_id, task_template_id);
