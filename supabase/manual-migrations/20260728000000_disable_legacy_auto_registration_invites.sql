-- APPLY MANUALLY: bash scripts/migrate.sh
-- ============================================================================
-- Stoppt alte automatische Registrierungs-/Willkommens-Einladungen.
-- Registrierungsmails dürfen nur noch nach expliziter Recruiter-Zusage über
-- advanceApplicationStage/sendRegistrationInviteAfterAiAccept rausgehen.
-- ============================================================================

UPDATE public.invite_resend_queue
   SET status = 'skipped',
       last_error = 'legacy_auto_invites_disabled'
 WHERE status = 'queued';

-- Fast-Track/Broker-Formular-Submits wurden historisch teils direkt als
-- status='akzeptiert' gespeichert. Das ist keine echte Zusage und darf keine
-- Registrierungs-Automatik auslösen.
UPDATE public.applications
   SET status = 'neu'
 WHERE status = 'akzeptiert'
   AND COALESCE(stage, 'vermittlung_neu') NOT IN ('vermittlung_zusage', 'fasttrack_angenommen')
   AND NOT EXISTS (
     SELECT 1 FROM public.invitation_tokens it WHERE it.application_id = applications.id
   );

NOTIFY pgrst, 'reload schema';