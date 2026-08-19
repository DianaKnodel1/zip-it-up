-- APPLY MANUALLY via: bash scripts/migrate.sh  (oder im Supabase SQL Editor)
-- Multi-Domain-Fallback: aktive Versand-Domain pro Tenant.
-- primary_domain gesetzt → neue Mails nutzen diese Domain.
-- primary_domain NULL    → Fallback auf tenants.domain.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS primary_domain text;

COMMENT ON COLUMN public.tenants.primary_domain IS
  'Aktive Versand-Domain für neue Mails. NULL = nutzt tenants.domain. Muss in domain oder domain_aliases enthalten sein.';

-- PostgreSQL kann bei CREATE OR REPLACE VIEW keine Spalten mitten in einer
-- bestehenden View einfuegen. Die abhaengigen RPCs werden direkt danach
-- wieder aufgebaut; spaetere Migrationen erweitern die View weiter.
DROP VIEW IF EXISTS public.tenants_public CASCADE;

CREATE VIEW public.tenants_public
WITH (security_invoker=on) AS
SELECT id, name, domain, domain_aliases, primary_domain, primary_color, logo_url,
  team_leader_name, team_leader_title, team_leader_avatar_url,
  team_leader_online, team_leader_response_time,
  whatsapp_number, company_ceo_name, company_address, company_city,
  company_signature_url, hero_title, hero_subtitle, features, is_active,
  ai_enabled
FROM public.tenants
WHERE is_active = true;

GRANT SELECT ON public.tenants_public TO anon, authenticated, service_role;

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
