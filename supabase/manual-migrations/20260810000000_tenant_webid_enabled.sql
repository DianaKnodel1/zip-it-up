-- WebID-Modul pro Unternehmen (Tenant) ein-/ausschaltbar.
-- Anwenden:
--   psql "$DATABASE_URL" -f supabase/manual-migrations/20260810000000_tenant_webid_enabled.sql

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS webid_enabled boolean NOT NULL DEFAULT false;

-- Öffentliche View neu aufbauen, damit das Portal den Schalter lesen kann.
DROP VIEW IF EXISTS public.tenants_public CASCADE;

CREATE VIEW public.tenants_public
WITH (security_invoker = on) AS
SELECT id, name, domain, domain_aliases, primary_color, logo_url,
  team_leader_name, team_leader_title, team_leader_avatar_url,
  team_leader_online, team_leader_response_time,
  whatsapp_number, company_ceo_name, company_address, company_city,
  company_signature_url, hero_title, hero_subtitle, features, is_active,
  ai_enabled, portal_theme, webid_enabled
FROM public.tenants
WHERE is_active = true;

GRANT SELECT ON public.tenants_public TO anon, authenticated;
GRANT SELECT ON public.tenants_public TO service_role;

CREATE OR REPLACE FUNCTION public.get_public_tenant_by_domain(_domain text)
RETURNS SETOF public.tenants_public
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  WITH q AS (SELECT lower(trim(_domain)) AS d),
       base AS (SELECT d, regexp_replace(d, '\.[a-z]{2,10}$', '') AS base FROM q)
  SELECT tp.* FROM public.tenants_public tp, base
   WHERE tp.is_active = true
     AND (
       tp.domain = base.d
       OR base.d = ANY(tp.domain_aliases)
       OR regexp_replace(tp.domain, '\.[a-z]{2,10}$', '') = base.base
       OR EXISTS (
         SELECT 1 FROM unnest(tp.domain_aliases) a
          WHERE regexp_replace(a, '\.[a-z]{2,10}$', '') = base.base
       )
     )
   ORDER BY (tp.domain = base.d) DESC,
            (base.d = ANY(tp.domain_aliases)) DESC
   LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public.get_first_active_public_tenant()
RETURNS SETOF public.tenants_public
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT * FROM public.tenants_public WHERE is_active = true ORDER BY name LIMIT 1;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_public_tenant_by_domain(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_first_active_public_tenant() TO anon, authenticated;
