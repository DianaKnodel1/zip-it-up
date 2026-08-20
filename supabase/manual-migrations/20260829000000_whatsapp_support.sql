-- APPLY MANUALLY via Supabase SQL Editor (bash scripts/migrate.sh).
-- ============================================================================
-- Globaler WhatsApp-Support-Button: Nummer/Link + Ein-/Ausschalter.
-- Liegt in der Singleton-Tabelle system_settings. Damit auch nicht
-- eingeloggte Bewerber (/bewerbung, /register) den Button sehen, gibt es eine
-- SECURITY-DEFINER-Funktion, die NUR diese beiden Felder herausgibt.
-- ============================================================================

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS whatsapp_number  text,
  ADD COLUMN IF NOT EXISTS whatsapp_enabled boolean NOT NULL DEFAULT false;

INSERT INTO public.system_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_public_whatsapp_support()
RETURNS TABLE(whatsapp_number text, whatsapp_enabled boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE WHEN s.whatsapp_enabled THEN s.whatsapp_number ELSE NULL END,
    COALESCE(s.whatsapp_enabled, false)
  FROM public.system_settings AS s
  WHERE s.id = 1
$$;

REVOKE ALL ON FUNCTION public.get_public_whatsapp_support() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_whatsapp_support()
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
