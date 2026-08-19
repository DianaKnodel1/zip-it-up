-- Trust / Compliance Felder für Landing Pages.
-- Ergänzt Ansprechpartner, AGB/Widerruf, Öffnungszeiten und setzt den
-- Recruiter-Default von "Sabine Schneider" auf NULL — kein Fake-Name mehr,
-- wenn der Tenant nichts konfiguriert hat.

ALTER TABLE public.landing_pages
  ADD COLUMN IF NOT EXISTS contact_person_name text,
  ADD COLUMN IF NOT EXISTS contact_person_role text,
  ADD COLUMN IF NOT EXISTS contact_person_phone text,
  ADD COLUMN IF NOT EXISTS contact_person_email text,
  ADD COLUMN IF NOT EXISTS contact_person_avatar_url text,
  ADD COLUMN IF NOT EXISTS opening_hours text,
  ADD COLUMN IF NOT EXISTS agb_url text,
  ADD COLUMN IF NOT EXISTS widerruf_url text;

-- Recruiter-Name: Default entfernen, damit neue Landings keinen Platzhalter-Namen zeigen.
ALTER TABLE public.landing_pages
  ALTER COLUMN recruiter_name DROP DEFAULT;

-- Bestehende Landings, die den Default nie überschrieben haben, auf NULL setzen,
-- damit der Booking-Header "unser Recruiting-Team" statt "Sabine Schneider" zeigt.
UPDATE public.landing_pages
  SET recruiter_name = NULL
  WHERE recruiter_name = 'Sabine Schneider';

COMMENT ON COLUMN public.landing_pages.contact_person_name IS
  'Klarname des Ansprechpartners direkt am Bewerbungsformular. Wird nur angezeigt, wenn gesetzt.';
COMMENT ON COLUMN public.landing_pages.recruiter_name IS
  'Name der KI-Recruiterin für Bewerbungsgespräche. NULL = generisches "unser Recruiting-Team" im Booking-Header.';

NOTIFY pgrst, 'reload schema';
