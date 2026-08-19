-- Empfänger-basierte Failure-Suppression
-- Ersetzt die tenant-weite Auto-Pause: statt beim ersten SMTP-Hänger
-- ALLE Mails eines Tenants zu stoppen, wird nur die konkrete Adresse
-- nach 3 aufeinanderfolgenden Fehlversuchen gesperrt.

CREATE TABLE IF NOT EXISTS public.email_recipient_failures (
  recipient_email     text PRIMARY KEY,
  tenant_id           uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_failed_at      timestamptz,
  last_error          text,
  suppressed_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recipient_failures_suppressed
  ON public.email_recipient_failures (suppressed_at) WHERE suppressed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recipient_failures_tenant
  ON public.email_recipient_failures (tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_recipient_failures TO authenticated;
GRANT ALL ON public.email_recipient_failures TO service_role;

ALTER TABLE public.email_recipient_failures ENABLE ROW LEVEL SECURITY;

-- Admin-only Zugriff (Verwaltung via Admin-UI)
DROP POLICY IF EXISTS "Admins können Suppression sehen" ON public.email_recipient_failures;
CREATE POLICY "Admins können Suppression sehen"
  ON public.email_recipient_failures
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins können Suppression bearbeiten" ON public.email_recipient_failures;
CREATE POLICY "Admins können Suppression bearbeiten"
  ON public.email_recipient_failures
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Alle aktuell auto-pausierten Tenants sofort entpausen.
-- Die Auto-Pause-Logik wird entfernt; die neue Suppression greift pro Empfänger.
UPDATE public.tenants
   SET emails_paused        = false,
       emails_paused_at     = NULL,
       emails_paused_reason = NULL,
       emails_paused_by     = NULL
 WHERE emails_paused = true
   AND (emails_paused_by IS NULL OR emails_paused_by = 'auto:smtp_verify');

-- Health-Zähler zurücksetzen, damit nichts sofort wieder greift
UPDATE public.tenant_smtp_health SET consecutive_fails = 0
 WHERE consecutive_fails > 0;
