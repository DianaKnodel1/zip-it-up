-- APPLY MANUALLY via: bash scripts/migrate.sh (nach 20260815000000)
-- RLS/Policies für die Rolle admin_mitarbeiter.

CREATE OR REPLACE FUNCTION public.is_admin_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _user_id
       AND role IN ('admin'::public.app_role, 'admin_mitarbeiter'::public.app_role)
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_staff(uuid) TO authenticated;

-- Voller Zugriff auf Aufträge + Chat
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'chat_conversations','chat_messages','task_assignments','task_templates',
    'task_steps','task_questions','task_submissions','submission_answers',
    'task_progress','step_feedback','bookings','time_slots','notifications',
    'activity_log'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Admin staff full access" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Admin staff full access" ON public.%I FOR ALL TO authenticated
         USING (public.is_admin_staff(auth.uid()))
         WITH CHECK (public.is_admin_staff(auth.uid()))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- Lesezugriff auf Stammdaten, die für Zuweisung/Chat nötig sind
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','tenants','user_roles','sms_channels','sms_assignments'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Admin staff read" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Admin staff read" ON public.%I FOR SELECT TO authenticated
         USING (public.is_admin_staff(auth.uid()))', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.admin_get_email_confirmations()
 RETURNS TABLE(user_id uuid, email_confirmed boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT u.id, (u.email_confirmed_at IS NOT NULL) AS email_confirmed
    FROM auth.users u;
END;
$function$;

NOTIFY pgrst, 'reload schema';
