-- APPLY MANUALLY: bash scripts/migrate.sh
-- ============================================================================
-- Wissensbasis für die KI-Antwortvorschläge im Teamleiter-Chat.
-- Die KI antwortet nie selbst – diese Einträge verbessern nur den Vorschlag,
-- den der Admin/Teamleiter prüft und selbst absendet.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.chat_faq (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  question    text NOT NULL,
  answer      text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_faq TO authenticated;
GRANT ALL ON public.chat_faq TO service_role;

ALTER TABLE public.chat_faq ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins verwalten die FAQ" ON public.chat_faq;
CREATE POLICY "Admins verwalten die FAQ"
  ON public.chat_faq
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS chat_faq_active_idx ON public.chat_faq (is_active, sort_order);

COMMENT ON TABLE public.chat_faq IS
  'Frage/Antwort-Paare, die die KI für Antwortvorschläge im Teamleiter-Chat nutzen darf.';
