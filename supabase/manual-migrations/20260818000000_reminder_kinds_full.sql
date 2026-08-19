-- Reminder-Arten vollstaendig zulassen.
--
-- WICHTIG: 20260817000000 hat den CHECK neu gesetzt und dabei die seit
-- 20260713/20260715 verwendeten Arten 'registration_pending_*' und
-- 'rebook_after_cancel_*' verloren. Deren Log-Eintraege scheitern seitdem am
-- Constraint — die Erinnerungen zur offenen Registrierung liefen dadurch ins
-- Leere. Diese Migration stellt die vollstaendige Liste her und ergaenzt die
-- neuen Sofort-Stufen 'no_show_30min' und 'registration_pending_2h'.

ALTER TABLE public.application_reminder_log
  DROP CONSTRAINT IF EXISTS application_reminder_log_reminder_kind_check;

ALTER TABLE public.application_reminder_log
  ADD CONSTRAINT application_reminder_log_reminder_kind_check
  CHECK (reminder_kind IN (
    'no_booking_24h',
    'no_booking_72h',
    'no_show_30min',
    'no_show_24h',
    'interview_invite_30min',
    'interview_reminder_24h',
    'booking_confirmation',
    'registration_pending_2h',
    'registration_pending_24h',
    'registration_pending_72h',
    'registration_abandoned_24h',
    'rebook_after_cancel_24h',
    'rebook_after_cancel_72h'
  )) NOT VALID;

NOTIFY pgrst, 'reload schema';
