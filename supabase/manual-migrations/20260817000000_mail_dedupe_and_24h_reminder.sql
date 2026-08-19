-- Doppel-Mails verhindern + Vortags-Erinnerung ermoeglichen.
--
-- 1) Neue Reminder-Art 'interview_reminder_24h' (Erinnerung am Vortag).
-- 2) Eindeutigkeit fuer Bewerbungen je Mandant + E-Mail innerhalb 60 Tagen:
--    zwei gleichzeitige Formular-Absendungen erzeugen sonst zwei Bewerbungen
--    und damit zwei Eingangsbestaetigungen.

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

-- Der finale 60-Tage-Dedupe-Index wird in 20260819000000 angelegt. Ein
-- zwischenzeitlicher strenger Index auf tenant_id + E-Mail wuerde bei legalen
-- historischen Wiederbewerbungen scheitern und den gesamten Deploy stoppen.

NOTIFY pgrst, 'reload schema';
