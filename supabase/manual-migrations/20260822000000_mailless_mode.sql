-- Mailless Mode: Portal verschickt keine Bewerber-Mails mehr.
-- Kommunikation läuft über Calendly (Mail + SMS) bzw. /bewerbung.
-- Nur Passwort-Reset bleibt aktiv (bypassMailless in send-guard.ts).
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS mailless_mode boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tenants.mailless_mode IS
  'true = Portal sendet keine Bewerber-Mails (Calendly/SMS übernimmt). Nur Passwort-Reset umgeht diesen Schalter.';

-- Bestandsmandanten ebenfalls umstellen.
UPDATE public.tenants SET mailless_mode = true WHERE mailless_mode IS DISTINCT FROM true;
