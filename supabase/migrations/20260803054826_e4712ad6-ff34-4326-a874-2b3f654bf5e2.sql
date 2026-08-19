
CREATE OR REPLACE FUNCTION public.is_admin_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin'::public.app_role, 'admin_mitarbeiter'::public.app_role)
  )
$$;

-- Chat: voller Lese-/Schreibzugriff
DROP POLICY IF EXISTS "Staff manage conversations" ON public.chat_conversations;
CREATE POLICY "Staff manage conversations" ON public.chat_conversations FOR ALL TO authenticated
  USING (public.is_admin_staff(auth.uid())) WITH CHECK (public.is_admin_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff manage chat" ON public.chat_messages;
CREATE POLICY "Staff manage chat" ON public.chat_messages FOR ALL TO authenticated
  USING (public.is_admin_staff(auth.uid())) WITH CHECK (public.is_admin_staff(auth.uid()));

-- Aufträge
DROP POLICY IF EXISTS "Staff manage assignments" ON public.task_assignments;
CREATE POLICY "Staff manage assignments" ON public.task_assignments FOR ALL TO authenticated
  USING (public.is_admin_staff(auth.uid())) WITH CHECK (public.is_admin_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff manage task_templates" ON public.task_templates;
CREATE POLICY "Staff manage task_templates" ON public.task_templates FOR ALL TO authenticated
  USING (public.is_admin_staff(auth.uid())) WITH CHECK (public.is_admin_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff manage task_steps" ON public.task_steps;
CREATE POLICY "Staff manage task_steps" ON public.task_steps FOR ALL TO authenticated
  USING (public.is_admin_staff(auth.uid())) WITH CHECK (public.is_admin_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff manage task_questions" ON public.task_questions;
CREATE POLICY "Staff manage task_questions" ON public.task_questions FOR ALL TO authenticated
  USING (public.is_admin_staff(auth.uid())) WITH CHECK (public.is_admin_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff manage submissions" ON public.task_submissions;
CREATE POLICY "Staff manage submissions" ON public.task_submissions FOR ALL TO authenticated
  USING (public.is_admin_staff(auth.uid())) WITH CHECK (public.is_admin_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff manage answers" ON public.submission_answers;
CREATE POLICY "Staff manage answers" ON public.submission_answers FOR ALL TO authenticated
  USING (public.is_admin_staff(auth.uid())) WITH CHECK (public.is_admin_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff manage progress" ON public.task_progress;
CREATE POLICY "Staff manage progress" ON public.task_progress FOR ALL TO authenticated
  USING (public.is_admin_staff(auth.uid())) WITH CHECK (public.is_admin_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff manage step_feedback" ON public.step_feedback;
CREATE POLICY "Staff manage step_feedback" ON public.step_feedback FOR ALL TO authenticated
  USING (public.is_admin_staff(auth.uid())) WITH CHECK (public.is_admin_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff manage bookings" ON public.bookings;
CREATE POLICY "Staff manage bookings" ON public.bookings FOR ALL TO authenticated
  USING (public.is_admin_staff(auth.uid())) WITH CHECK (public.is_admin_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff manage time_slots" ON public.time_slots;
CREATE POLICY "Staff manage time_slots" ON public.time_slots FOR ALL TO authenticated
  USING (public.is_admin_staff(auth.uid())) WITH CHECK (public.is_admin_staff(auth.uid()));

-- Lesezugriffe
DROP POLICY IF EXISTS "Staff read profiles" ON public.profiles;
CREATE POLICY "Staff read profiles" ON public.profiles FOR SELECT TO authenticated
  USING (public.is_admin_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff read tenants" ON public.tenants;
CREATE POLICY "Staff read tenants" ON public.tenants FOR SELECT TO authenticated
  USING (public.is_admin_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff read roles" ON public.user_roles;
CREATE POLICY "Staff read roles" ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_admin_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff read sms_channels" ON public.sms_channels;
CREATE POLICY "Staff read sms_channels" ON public.sms_channels FOR SELECT TO authenticated
  USING (public.is_admin_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff read sms_assignments" ON public.sms_assignments;
CREATE POLICY "Staff read sms_assignments" ON public.sms_assignments FOR SELECT TO authenticated
  USING (public.is_admin_staff(auth.uid()));

-- Benachrichtigungen + Protokoll
DROP POLICY IF EXISTS "Staff manage notifications" ON public.notifications;
CREATE POLICY "Staff manage notifications" ON public.notifications FOR ALL TO authenticated
  USING (public.is_admin_staff(auth.uid())) WITH CHECK (public.is_admin_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff insert activity_log" ON public.activity_log;
CREATE POLICY "Staff insert activity_log" ON public.activity_log FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff read activity_log" ON public.activity_log;
CREATE POLICY "Staff read activity_log" ON public.activity_log FOR SELECT TO authenticated
  USING (public.is_admin_staff(auth.uid()));

-- E-Mail-Bestätigungsstatus auch für Admin-Mitarbeiter lesbar
CREATE OR REPLACE FUNCTION public.admin_get_email_confirmations()
RETURNS TABLE(user_id uuid, email_confirmed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT u.id, (u.email_confirmed_at IS NOT NULL) AS email_confirmed
    FROM auth.users u;
END;
$$;
