-- APPLY MANUALLY via: bash scripts/migrate.sh
-- 1) Zuweisungsgruppen (automatisch/manuell)
-- 2) Bot-Profil je Auftragsvorlage + Proxy-Pool
-- 3) Stil-Korrekturen für den KI-Chat-Vorschlag

-- ----------------------------------------------------- Zuweisungsgruppen
ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS assignment_group text NOT NULL DEFAULT 'manuell';

ALTER TABLE public.task_assignments
  DROP CONSTRAINT IF EXISTS task_assignments_group_chk;
ALTER TABLE public.task_assignments
  ADD CONSTRAINT task_assignments_group_chk
  CHECK (assignment_group IN ('automatisch', 'manuell')) NOT VALID;

ALTER TABLE public.task_templates
  ADD COLUMN IF NOT EXISTS assignment_mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS bot_profile_id uuid;

ALTER TABLE public.task_templates
  DROP CONSTRAINT IF EXISTS task_templates_assignment_mode_chk;
ALTER TABLE public.task_templates
  ADD CONSTRAINT task_templates_assignment_mode_chk
  CHECK (assignment_mode IN ('auto', 'manuell')) NOT VALID;

-- Bank-/KYC-Vorlagen laufen ausschließlich manuell.
UPDATE public.task_templates
   SET assignment_mode = 'manuell'
 WHERE title ~* '(dkb|deutsche bank|consorsbank|comdirect|santander|bank|konto)';

-- Auto-Zuweisung überspringt manuelle Vorlagen und markiert die Gruppe.
CREATE OR REPLACE FUNCTION public.auto_assign_default_task_on_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tenant_id uuid;
  _booking_index int;
  _template_id uuid;
  _mode text;
  _already_assigned int;
BEGIN
  SELECT tenant_id INTO _tenant_id FROM public.profiles WHERE user_id = NEW.user_id;
  IF _tenant_id IS NULL THEN RETURN NEW; END IF;

  SELECT count(*) INTO _booking_index FROM public.bookings WHERE user_id = NEW.user_id;
  IF _booking_index IS NULL OR _booking_index < 1 THEN _booking_index := 1; END IF;

  SELECT task_template_id INTO _template_id
  FROM public.tenant_default_tasks
  WHERE tenant_id = _tenant_id AND sort_order = _booking_index
  LIMIT 1;

  IF _template_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(assignment_mode, 'auto') INTO _mode
  FROM public.task_templates WHERE id = _template_id;
  IF _mode = 'manuell' THEN RETURN NEW; END IF;

  -- Dublettenschutz: nie zweimal dieselbe Vorlage pro Mitarbeiter.
  SELECT count(*) INTO _already_assigned FROM public.task_assignments
  WHERE user_id = NEW.user_id AND task_template_id = _template_id;
  IF _already_assigned > 0 THEN RETURN NEW; END IF;

  INSERT INTO public.task_assignments (user_id, task_template_id, status, assignment_group)
  VALUES (NEW.user_id, _template_id, 'zugewiesen', 'automatisch');

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------- Proxy-Pool
CREATE TABLE IF NOT EXISTS public.bot_proxies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text,
  provider text NOT NULL DEFAULT 'nsocks',
  kind text NOT NULL DEFAULT 'http',            -- http | socks5
  host text NOT NULL,
  port integer NOT NULL,
  username text,
  password text,
  country text DEFAULT 'DE',
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  use_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (host, port, username)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bot_proxies TO authenticated;
GRANT ALL ON public.bot_proxies TO service_role;

ALTER TABLE public.bot_proxies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bot_proxies_admin_all" ON public.bot_proxies;
CREATE POLICY "bot_proxies_admin_all" ON public.bot_proxies
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.bot_runs
  ADD COLUMN IF NOT EXISTS proxy_id uuid REFERENCES public.bot_proxies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proxy_session text;

-- ------------------------------------------------- Stil-Korrekturen (KI)
CREATE TABLE IF NOT EXISTS public.ai_style_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL,
  target_user_id uuid,
  suggestion text NOT NULL,
  final_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.ai_style_corrections TO authenticated;
GRANT ALL ON public.ai_style_corrections TO service_role;

ALTER TABLE public.ai_style_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_style_corrections_own" ON public.ai_style_corrections;
CREATE POLICY "ai_style_corrections_own" ON public.ai_style_corrections
  FOR ALL TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE INDEX IF NOT EXISTS ai_style_corrections_idx
  ON public.ai_style_corrections (author_id, target_user_id, created_at DESC);

-- ------------------------------------------------------- Bot-Profile (5)
-- Globale Profile (tenant_id IS NULL) dürfen nur einmal je Anbieter existieren.
-- Altdaten können durch frühere, nullable UNIQUE-Constraints doppelt vorhanden
-- sein. Referenzen zuerst auf das älteste Profil zusammenführen, dann bereinigen.
DO $$
DECLARE
  duplicate record;
  canonical_id uuid;
BEGIN
  FOR duplicate IN
    SELECT provider_key
      FROM public.bot_profiles
     WHERE tenant_id IS NULL
     GROUP BY provider_key
    HAVING count(*) > 1
  LOOP
    SELECT id INTO canonical_id
      FROM public.bot_profiles
     WHERE tenant_id IS NULL AND provider_key = duplicate.provider_key
     ORDER BY created_at, id
     LIMIT 1;

    UPDATE public.bot_runs
       SET profile_id = canonical_id
     WHERE profile_id IN (
       SELECT id FROM public.bot_profiles
        WHERE tenant_id IS NULL
          AND provider_key = duplicate.provider_key
          AND id <> canonical_id
     );

    UPDATE public.task_templates
       SET bot_profile_id = canonical_id
     WHERE bot_profile_id IN (
       SELECT id FROM public.bot_profiles
        WHERE tenant_id IS NULL
          AND provider_key = duplicate.provider_key
          AND id <> canonical_id
     );

    DELETE FROM public.bot_profiles
     WHERE tenant_id IS NULL
       AND provider_key = duplicate.provider_key
       AND id <> canonical_id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS bot_profiles_global_provider_uidx
  ON public.bot_profiles (provider_key) WHERE tenant_id IS NULL;

INSERT INTO public.bot_profiles (name, provider_key, start_url, description, handoff_note, steps)
VALUES
(
  'DKB – Girokonto',
  'dkb',
  'https://dein-antrag.dkb.de/girokonto-start/',
  'Füllt die Antragsstrecke bis zur Legitimation aus.',
  'Bot stoppt vor der Legitimation (VideoIdent/TAN). Diese Schritte werden manuell abgeschlossen.',
  '[
    {"action":"goto","value":"https://dein-antrag.dkb.de/girokonto-start/","label":"Antragsstrecke öffnen"},
    {"action":"click","selector":"button:has-text(\"Alle akzeptieren\")","optional":true,"label":"Cookie-Banner"},
    {"action":"fill","selector":"input[name*=\"vorname\" i]","value":"{{first_name}}","label":"Vorname"},
    {"action":"fill","selector":"input[name*=\"nachname\" i]","value":"{{last_name}}","label":"Nachname"},
    {"action":"fill","selector":"input[type=\"email\"]","value":"{{email}}","label":"E-Mail"},
    {"action":"fill","selector":"input[name*=\"geburt\" i]","value":"{{birth_date}}","label":"Geburtsdatum"},
    {"action":"fill","selector":"input[name*=\"stra\" i]","value":"{{street}}","label":"Straße"},
    {"action":"fill","selector":"input[name*=\"plz\" i]","value":"{{zip}}","label":"PLZ"},
    {"action":"fill","selector":"input[name*=\"ort\" i]","value":"{{city}}","label":"Ort"},
    {"action":"fill","selector":"input[type=\"tel\"]","value":"{{phone}}","optional":true,"label":"Telefon"},
    {"action":"screenshot","label":"Stand vor Legitimation sichern"},
    {"action":"handoff","value":"Legitimation erforderlich – manueller Abschluss.","label":"Übergabe"}
  ]'::jsonb
),
(
  'Consorsbank – Girokonto',
  'consorsbank',
  'https://www.consorsbank.de/ev/Girokonto',
  'Füllt die Antragsstrecke bis zur Legitimation aus.',
  'Bot stoppt vor der Legitimation (VideoIdent/TAN). Diese Schritte werden manuell abgeschlossen.',
  '[
    {"action":"goto","value":"https://www.consorsbank.de/ev/Girokonto","label":"Antragsstrecke öffnen"},
    {"action":"click","selector":"button:has-text(\"Akzeptieren\")","optional":true,"label":"Cookie-Banner"},
    {"action":"click","selector":"a:has-text(\"Konto eröffnen\")","optional":true,"label":"Antrag starten"},
    {"action":"fill","selector":"input[name*=\"firstName\" i]","value":"{{first_name}}","label":"Vorname"},
    {"action":"fill","selector":"input[name*=\"lastName\" i]","value":"{{last_name}}","label":"Nachname"},
    {"action":"fill","selector":"input[type=\"email\"]","value":"{{email}}","label":"E-Mail"},
    {"action":"fill","selector":"input[name*=\"birth\" i]","value":"{{birth_date}}","label":"Geburtsdatum"},
    {"action":"fill","selector":"input[name*=\"street\" i]","value":"{{street}}","label":"Straße"},
    {"action":"fill","selector":"input[name*=\"zip\" i]","value":"{{zip}}","label":"PLZ"},
    {"action":"fill","selector":"input[name*=\"city\" i]","value":"{{city}}","label":"Ort"},
    {"action":"screenshot","label":"Stand vor Legitimation sichern"},
    {"action":"handoff","value":"Legitimation erforderlich – manueller Abschluss.","label":"Übergabe"}
  ]'::jsonb
),
(
  'comdirect – Girokonto',
  'comdirect',
  'https://www.comdirect.de/konto/girokonto.html',
  'Füllt die Antragsstrecke bis zur Legitimation aus.',
  'Bot stoppt vor der Legitimation (VideoIdent/TAN). Diese Schritte werden manuell abgeschlossen.',
  '[
    {"action":"goto","value":"https://www.comdirect.de/konto/girokonto.html","label":"Produktseite öffnen"},
    {"action":"click","selector":"button:has-text(\"Alle akzeptieren\")","optional":true,"label":"Cookie-Banner"},
    {"action":"click","selector":"a:has-text(\"Jetzt eröffnen\")","label":"Antrag starten"},
    {"action":"fill","selector":"input[name*=\"vorname\" i]","value":"{{first_name}}","label":"Vorname"},
    {"action":"fill","selector":"input[name*=\"nachname\" i]","value":"{{last_name}}","label":"Nachname"},
    {"action":"fill","selector":"input[type=\"email\"]","value":"{{email}}","label":"E-Mail"},
    {"action":"fill","selector":"input[name*=\"geburt\" i]","value":"{{birth_date}}","label":"Geburtsdatum"},
    {"action":"fill","selector":"input[name*=\"stra\" i]","value":"{{street}}","label":"Straße"},
    {"action":"fill","selector":"input[name*=\"plz\" i]","value":"{{zip}}","label":"PLZ"},
    {"action":"fill","selector":"input[name*=\"ort\" i]","value":"{{city}}","label":"Ort"},
    {"action":"screenshot","label":"Stand vor Legitimation sichern"},
    {"action":"handoff","value":"Legitimation erforderlich – manueller Abschluss.","label":"Übergabe"}
  ]'::jsonb
),
(
  'Santander – Girokonto',
  'santander',
  'https://www.santander.de/privatkunden/konten-karten/girokonto/',
  'Füllt die Antragsstrecke bis zur Legitimation aus.',
  'Bot stoppt vor der Legitimation (VideoIdent/TAN). Diese Schritte werden manuell abgeschlossen.',
  '[
    {"action":"goto","value":"https://www.santander.de/privatkunden/konten-karten/girokonto/","label":"Produktseite öffnen"},
    {"action":"click","selector":"button:has-text(\"Akzeptieren\")","optional":true,"label":"Cookie-Banner"},
    {"action":"click","selector":"a:has-text(\"Jetzt eröffnen\")","optional":true,"label":"Antrag starten"},
    {"action":"fill","selector":"input[name*=\"vorname\" i]","value":"{{first_name}}","label":"Vorname"},
    {"action":"fill","selector":"input[name*=\"nachname\" i]","value":"{{last_name}}","label":"Nachname"},
    {"action":"fill","selector":"input[type=\"email\"]","value":"{{email}}","label":"E-Mail"},
    {"action":"fill","selector":"input[name*=\"geburt\" i]","value":"{{birth_date}}","label":"Geburtsdatum"},
    {"action":"fill","selector":"input[name*=\"stra\" i]","value":"{{street}}","label":"Straße"},
    {"action":"fill","selector":"input[name*=\"plz\" i]","value":"{{zip}}","label":"PLZ"},
    {"action":"fill","selector":"input[name*=\"ort\" i]","value":"{{city}}","label":"Ort"},
    {"action":"screenshot","label":"Stand vor Legitimation sichern"},
    {"action":"handoff","value":"Legitimation erforderlich – manueller Abschluss.","label":"Übergabe"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- Deutsche Bank: Startpunkt und Übergabehinweis überarbeiten.
UPDATE public.bot_profiles
   SET start_url = 'https://www.deutsche-bank.de/pk/konto-und-karte/girokonto.html',
       description = 'Füllt die Antragsstrecke bis zur Legitimation aus.',
       handoff_note = 'Bot stoppt vor der Legitimation (VideoIdent/photoTAN). Diese Schritte werden manuell abgeschlossen.'
 WHERE provider_key = 'deutsche_bank';
