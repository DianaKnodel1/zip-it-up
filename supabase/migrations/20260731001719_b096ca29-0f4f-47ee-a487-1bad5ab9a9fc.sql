ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS allowed_employment_types text[] NOT NULL DEFAULT ARRAY['minijob','teilzeit','vollzeit']::text[];

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_allowed_employment_types_check;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_allowed_employment_types_check
  CHECK (
    array_length(allowed_employment_types, 1) >= 1
    AND allowed_employment_types <@ ARRAY['minijob','teilzeit','vollzeit']::text[]
  );

COMMENT ON COLUMN public.tenants.allowed_employment_types IS
  'Vertragsarten, die dieser Mandant bei der Registrierung anbietet.';