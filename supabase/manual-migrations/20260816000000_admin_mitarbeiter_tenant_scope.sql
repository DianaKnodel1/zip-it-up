-- APPLY MANUALLY via: bash scripts/deploy-backend-local.sh
-- Admin-Mitarbeiter auf bestimmte Tenants (Marken) einschränken.
-- Ohne Eintrag in staff_tenant_access sieht der Mitarbeiter weiterhin alle Chats.

CREATE TABLE IF NOT EXISTS public.staff_tenant_access (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id)
);

GRANT SELECT ON public.staff_tenant_access TO authenticated;
GRANT ALL    ON public.staff_tenant_access TO service_role;
ALTER TABLE public.staff_tenant_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read own tenant access" ON public.staff_tenant_access;
CREATE POLICY "Staff read own tenant access" ON public.staff_tenant_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins manage tenant access" ON public.staff_tenant_access;
CREATE POLICY "Admins manage tenant access" ON public.staff_tenant_access
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Darf _user_id auf Daten von _tenant_id zugreifen?
-- Volladmins: immer. Admin-Mitarbeiter: nur die zugewiesenen Tenants
-- (bzw. alle, solange nichts zugewiesen ist).
CREATE OR REPLACE FUNCTION public.staff_can_access_tenant(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin'::public.app_role)
    OR (
      public.is_admin_staff(_user_id)
      AND (
        NOT EXISTS (SELECT 1 FROM public.staff_tenant_access WHERE user_id = _user_id)
        OR EXISTS (
          SELECT 1 FROM public.staff_tenant_access
           WHERE user_id = _user_id AND tenant_id = _tenant_id
        )
      )
    )
$$;
GRANT EXECUTE ON FUNCTION public.staff_can_access_tenant(uuid, uuid) TO authenticated;

-- Chats: nur Gespräche von Mitarbeitern aus erlaubten Tenants
DROP POLICY IF EXISTS "Admin staff full access" ON public.chat_conversations;
CREATE POLICY "Admin staff full access" ON public.chat_conversations
  FOR ALL TO authenticated
  USING (
    public.is_admin_staff(auth.uid())
    AND public.staff_can_access_tenant(
      auth.uid(),
      (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = chat_conversations.user_id)
    )
  )
  WITH CHECK (
    public.is_admin_staff(auth.uid())
    AND public.staff_can_access_tenant(
      auth.uid(),
      (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = chat_conversations.user_id)
    )
  );

DROP POLICY IF EXISTS "Admin staff full access" ON public.chat_messages;
CREATE POLICY "Admin staff full access" ON public.chat_messages
  FOR ALL TO authenticated
  USING (
    public.is_admin_staff(auth.uid())
    AND (
      public.staff_can_access_tenant(
        auth.uid(), (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = chat_messages.sender_id))
      OR public.staff_can_access_tenant(
        auth.uid(), (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = chat_messages.receiver_id))
    )
  )
  WITH CHECK (
    public.is_admin_staff(auth.uid())
    AND (
      public.staff_can_access_tenant(
        auth.uid(), (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = chat_messages.sender_id))
      OR public.staff_can_access_tenant(
        auth.uid(), (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = chat_messages.receiver_id))
    )
  );

NOTIFY pgrst, 'reload schema';
