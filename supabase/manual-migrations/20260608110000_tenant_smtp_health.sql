-- APPLY MANUALLY via: bash scripts/migrate.sh
-- SMTP-Health-Counter pro Tenant. Wird vom Edge-Function-Helper
-- `verifyOrPause` gepflegt: zählt aufeinander folgende verify()-Fails.
-- Bei >= 3 Fails wird der Tenant via tenants.emails_paused = true
-- automatisch pausiert (siehe send-*-Edge-Functions).

CREATE TABLE IF NOT EXISTS public.tenant_smtp_health (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  consecutive_fails int NOT NULL DEFAULT 0,
  last_fail_at timestamptz,
  last_fail_error text,
  last_verify_at timestamptz,
  last_verify_ok boolean,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Wenn die Tabelle auf Bestandssystemen bereits von einer anderen Rolle
-- angelegt wurde, dürfen wir Owner/RLS/Policies ggf. nicht ändern.
-- Dann darf die Migration trotzdem nicht abbrechen, damit spätere Migrations
-- weiterlaufen können.
DO $$
BEGIN
  ALTER TABLE public.tenant_smtp_health OWNER TO CURRENT_USER;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping owner change for tenant_smtp_health: current user is not owner';
END $$;

GRANT SELECT ON public.tenant_smtp_health TO authenticated;
GRANT ALL    ON public.tenant_smtp_health TO service_role;

DO $$
BEGIN
  ALTER TABLE public.tenant_smtp_health ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping RLS enable for tenant_smtp_health: current user is not owner';
END $$;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Admins read smtp_health" ON public.tenant_smtp_health;
  CREATE POLICY "Admins read smtp_health"
    ON public.tenant_smtp_health
    FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping policy update for tenant_smtp_health: current user is not owner';
END $$;

DO $$
BEGIN
  COMMENT ON TABLE public.tenant_smtp_health IS
    'SMTP-Verify-Health-Counter pro Tenant. Bei >=3 consecutive_fails wird der Tenant auto-pausiert.';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping comment for tenant_smtp_health: current user is not owner';
END $$;
