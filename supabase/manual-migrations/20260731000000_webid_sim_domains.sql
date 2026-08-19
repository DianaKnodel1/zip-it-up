-- WebID-Simulationsdomains: Verwaltung der registrierten Simulationsdomains.
-- Wird vom webid-sim-server (Bun-Proxy) via anon-Key + RLS gelesen.

CREATE TABLE IF NOT EXISTS public.webid_sim_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL UNIQUE,
  display_name text NOT NULL,
  target_origin text NOT NULL DEFAULT 'https://webid-gateway.de',
  logo_url text,
  topbar_text text NOT NULL DEFAULT 'SIMULATIONSUMGEBUNG – Keine echte Identifikation. Zu Schulungszwecken.',
  is_active boolean NOT NULL DEFAULT true,
  allow_submit boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.webid_sim_domains TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webid_sim_domains TO authenticated;
GRANT ALL ON public.webid_sim_domains TO service_role;

ALTER TABLE public.webid_sim_domains ENABLE ROW LEVEL SECURITY;

-- anon darf nur aktive Domains sehen (für den Proxy-Lookup)
DROP POLICY IF EXISTS "webid_sim_domains_anon_read_active" ON public.webid_sim_domains;
CREATE POLICY "webid_sim_domains_anon_read_active" ON public.webid_sim_domains
  FOR SELECT TO anon
  USING (is_active = true);

-- Admins verwalten
DROP POLICY IF EXISTS "webid_sim_domains_admin_all" ON public.webid_sim_domains;
CREATE POLICY "webid_sim_domains_admin_all" ON public.webid_sim_domains
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS webid_sim_domains_active_idx ON public.webid_sim_domains (domain) WHERE is_active;

CREATE OR REPLACE FUNCTION public._webid_sim_domains_touch() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS webid_sim_domains_touch ON public.webid_sim_domains;
CREATE TRIGGER webid_sim_domains_touch BEFORE UPDATE ON public.webid_sim_domains
  FOR EACH ROW EXECUTE FUNCTION public._webid_sim_domains_touch();