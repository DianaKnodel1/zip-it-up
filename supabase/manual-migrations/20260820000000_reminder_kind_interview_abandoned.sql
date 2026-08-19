-- Neue Reminder-Stufe: Interview gestartet, aber nie abgeschlossen.
-- Ohne diese Art scheitert der Log-Eintrag am CHECK und die Mail geht nie raus.

ALTER TABLE public.application_reminder_log
  DROP CONSTRAINT IF EXISTS application_reminder_log_reminder_kind_check;

ALTER TABLE public.application_reminder_log
  ADD CONSTRAINT application_reminder_log_reminder_kind_check
  CHECK (reminder_kind IN (
    'no_booking_24h',
    'no_booking_72h',
    'no_show_30min',
    'no_show_24h',
    'interview_abandoned',
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