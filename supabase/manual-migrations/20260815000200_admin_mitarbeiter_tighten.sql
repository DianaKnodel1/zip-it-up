-- APPLY MANUALLY via: bash scripts/deploy-backend-local.sh
-- Enger Zuschnitt für admin_mitarbeiter: NUR Chat (lesen/schreiben) und
-- Aufträge zuweisen. Alles andere wird wieder entzogen.

-- Nur-Staff-Check (ohne Admin), damit wir Admin-Policies nicht anfassen.
CREATE OR REPLACE FUNCTION public.is_admin_staff_only(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _user_id AND role = 'admin_mitarbeiter'::public.app_role
  )
$$;
GRANT EXECUTE ON FUNCTION public.is_admin_staff_only(uuid) TO authenticated;

-- 1) Zugriffe entziehen, die für Chat/Zuweisung nicht nötig sind
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bookings','time_slots'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Admin staff full access" ON public.%I', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['sms_channels','sms_assignments'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Admin staff read" ON public.%I', t);
  END LOOP;
END $$;

-- 2) Vorlagen/Bausteine nur lesen (Zuweisen ja, Bauen/Ändern nein)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['task_templates','task_steps','task_questions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Admin staff full access" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admin staff read" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Admin staff read" ON public.%I FOR SELECT TO authenticated
         USING (public.is_admin_staff(auth.uid()))', t);
  END LOOP;
END $$;

-- 3) Aktivitätsprotokoll: nur eigene Einträge schreiben, kein Vollzugriff
DROP POLICY IF EXISTS "Admin staff full access" ON public.activity_log;
DROP POLICY IF EXISTS "Admin staff read" ON public.activity_log;
DROP POLICY IF EXISTS "Admin staff insert" ON public.activity_log;
CREATE POLICY "Admin staff read" ON public.activity_log
  FOR SELECT TO authenticated USING (public.is_admin_staff(auth.uid()));
CREATE POLICY "Admin staff insert" ON public.activity_log
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_staff(auth.uid()));

NOTIFY pgrst, 'reload schema';