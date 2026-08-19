-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Bot-Automatisierung: Profile (welcher Anbieter, welche Schritte) + Läufe (Queue).
-- Der bot-runner (Bun + Playwright, eigener Dienst) arbeitet die Queue via service_role ab.

-- ---------------------------------------------------------------- Profile
CREATE TABLE IF NOT EXISTS public.bot_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  partner_company_id uuid REFERENCES public.partner_companies(id) ON DELETE SET NULL,
  name text NOT NULL,
  provider_key text NOT NULL,
  start_url text NOT NULL,
  description text,
  -- Schritt-Liste (DSL). Beispiel:
  -- [{"action":"fill","selector":"#email","value":"{{email}}","label":"E-Mail"}]
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Felder, die der Bot vorab generiert: ["email_alias","password"]
  generate_fields jsonb NOT NULL DEFAULT '["email_alias","password"]'::jsonb,
  handoff_note text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bot_profiles TO authenticated;
GRANT ALL ON public.bot_profiles TO service_role;

ALTER TABLE public.bot_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bot_profiles_admin_all" ON public.bot_profiles;
CREATE POLICY "bot_profiles_admin_all" ON public.bot_profiles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------- Läufe
-- status: queued | running | waiting_admin | done | failed | cancelled
CREATE TABLE IF NOT EXISTS public.bot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.bot_profiles(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  user_id uuid,
  assignment_id uuid REFERENCES public.task_assignments(id) ON DELETE SET NULL,
  vorgangsnummer text,
  status text NOT NULL DEFAULT 'queued',
  current_step integer NOT NULL DEFAULT 0,
  total_steps integer NOT NULL DEFAULT 0,
  -- Vom Bot erzeugte / verwendete Zugangsdaten (nur Admin lesbar).
  credentials jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Eingabedaten aus dem Profil des Mitarbeiters (Name, Adresse, Geburtsdatum …).
  input_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  log jsonb NOT NULL DEFAULT '[]'::jsonb,
  handoff_reason text,
  handoff_url text,
  screenshot_path text,
  last_error text,
  claimed_by uuid,
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bot_runs TO authenticated;
GRANT ALL ON public.bot_runs TO service_role;

ALTER TABLE public.bot_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bot_runs_admin_all" ON public.bot_runs;
CREATE POLICY "bot_runs_admin_all" ON public.bot_runs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Mitarbeiter sehen nur Status ihres eigenen Laufs — NIE die Zugangsdaten.
-- Dafür eine View ohne credentials-Spalte.
CREATE OR REPLACE VIEW public.bot_runs_employee
WITH (security_invoker = true) AS
  SELECT id, profile_id, user_id, assignment_id, vorgangsnummer, status,
         current_step, total_steps, handoff_reason, created_at, updated_at, finished_at
  FROM public.bot_runs;

GRANT SELECT ON public.bot_runs_employee TO authenticated;

DROP POLICY IF EXISTS "bot_runs_owner_read" ON public.bot_runs;
CREATE POLICY "bot_runs_owner_read" ON public.bot_runs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS bot_runs_queue_idx ON public.bot_runs (status, created_at)
  WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS bot_runs_user_idx ON public.bot_runs (user_id);

CREATE OR REPLACE FUNCTION public._bot_touch() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS bot_profiles_touch ON public.bot_profiles;
CREATE TRIGGER bot_profiles_touch BEFORE UPDATE ON public.bot_profiles
  FOR EACH ROW EXECUTE FUNCTION public._bot_touch();

DROP TRIGGER IF EXISTS bot_runs_touch ON public.bot_runs;
CREATE TRIGGER bot_runs_touch BEFORE UPDATE ON public.bot_runs
  FOR EACH ROW EXECUTE FUNCTION public._bot_touch();

-- ------------------------------------------------- Atomarer Queue-Zugriff
-- Verhindert, dass zwei Runner denselben Lauf greifen.
CREATE OR REPLACE FUNCTION public.bot_claim_next_run(_worker text)
RETURNS SETOF public.bot_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.bot_runs r
     SET status = 'running',
         started_at = COALESCE(r.started_at, now()),
         log = r.log || jsonb_build_array(
           jsonb_build_object('at', now(), 'msg', 'Übernommen von ' || _worker))
   WHERE r.id = (
     SELECT id FROM public.bot_runs
      WHERE status = 'queued'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING r.*;
END; $$;

REVOKE ALL ON FUNCTION public.bot_claim_next_run(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_claim_next_run(text) TO service_role;

-- --------------------------------------------- Startprofil Deutsche Bank
-- Nur Schritte, die realistisch automatisierbar sind. Danach Übergabe an Admin,
-- weil VideoIdent + photoTAN zwingend einen Menschen erfordern.
INSERT INTO public.bot_profiles (name, provider_key, start_url, description, handoff_note, steps)
VALUES (
  'Deutsche Bank – Girokonto',
  'deutsche_bank',
  'https://www.deutsche-bank.de/pk/konto-und-karte/girokonto.html',
  'Füllt die Antragsstrecke bis zur Legitimation aus. VideoIdent und photoTAN müssen vom Admin manuell abgeschlossen werden.',
  'Bot stoppt vor der Legitimation. Admin muss VideoIdent-Termin durchführen und die photoTAN-Aktivierung abschließen.',
  '[
    {"action":"goto","value":"https://www.deutsche-bank.de/pk/konto-und-karte/girokonto.html","label":"Startseite öffnen"},
    {"action":"click","selector":"button:has-text(\"Alle akzeptieren\")","optional":true,"label":"Cookie-Banner"},
    {"action":"click","selector":"a:has-text(\"Jetzt eröffnen\")","label":"Antrag starten"},
    {"action":"fill","selector":"input[name=\"firstName\"]","value":"{{first_name}}","label":"Vorname"},
    {"action":"fill","selector":"input[name=\"lastName\"]","value":"{{last_name}}","label":"Nachname"},
    {"action":"fill","selector":"input[name=\"email\"]","value":"{{email}}","label":"E-Mail"},
    {"action":"fill","selector":"input[name=\"birthDate\"]","value":"{{birth_date}}","label":"Geburtsdatum"},
    {"action":"fill","selector":"input[name=\"street\"]","value":"{{street}}","label":"Straße"},
    {"action":"fill","selector":"input[name=\"zip\"]","value":"{{zip}}","label":"PLZ"},
    {"action":"fill","selector":"input[name=\"city\"]","value":"{{city}}","label":"Ort"},
    {"action":"screenshot","label":"Stand vor Legitimation sichern"},
    {"action":"handoff","value":"VideoIdent + photoTAN erforderlich – bitte manuell abschließen.","label":"Übergabe an Admin"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;