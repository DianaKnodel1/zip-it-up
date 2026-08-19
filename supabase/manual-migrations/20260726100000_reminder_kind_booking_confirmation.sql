-- Erlaubt 'booking_confirmation' als reminder_kind in application_reminder_log.
-- Ohne diese Erweiterung schlägt der Retry-Cap/Give-Up-Insert aus
-- send-booking-confirmation gegen den CHECK-Constraint fehl.

ALTER TABLE public.application_reminder_log
  DROP CONSTRAINT IF EXISTS application_reminder_log_reminder_kind_check;

ALTER TABLE public.application_reminder_log
  ADD CONSTRAINT application_reminder_log_reminder_kind_check
  CHECK (reminder_kind IN (
    'no_booking_24h',
    'no_booking_72h',
    'no_show_24h',
    'interview_invite_30min',
    'booking_confirmation'
  ));

NOTIFY pgrst, 'reload schema';
