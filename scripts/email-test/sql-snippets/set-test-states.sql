-- State-Snippets für einen Test-Bewerber, damit alle Cron-Gates sofort feuern.
-- IMMER erst SELECT ausführen, um die Ziel-Row zu prüfen, DANN das UPDATE.
-- Ersetze 'test+kind@deine-domain.de' durch die tatsächliche Test-Adresse.

-- =====================================================================
-- 0) Ziel-Row identifizieren
-- =====================================================================
-- SELECT id, email, status, booking_status, created_at, updated_at
-- FROM applications
-- WHERE email = 'test+kind@deine-domain.de'
-- ORDER BY created_at DESC LIMIT 5;

-- =====================================================================
-- #4 no_booking_24h  →  applications.created_at auf -25h
-- =====================================================================
-- UPDATE applications
--   SET created_at = now() - interval '25 hours'
-- WHERE email = 'test+nobooking24@deine-domain.de'
--   AND booking_status IS DISTINCT FROM 'confirmed';

-- =====================================================================
-- #5 no_booking_72h  →  applications.created_at auf -73h
-- =====================================================================
-- UPDATE applications
--   SET created_at = now() - interval '73 hours'
-- WHERE email = 'test+nobooking72@deine-domain.de'
--   AND booking_status IS DISTINCT FROM 'confirmed';

-- =====================================================================
-- #6 no_show_24h  →  interview_appointments in Vergangenheit + no_show
-- =====================================================================
-- UPDATE interview_appointments
--   SET starts_at = now() - interval '25 hours',
--       ends_at   = now() - interval '24 hours',
--       status    = 'no_show'
-- WHERE application_id = (SELECT id FROM applications WHERE email='test+noshow@deine-domain.de' LIMIT 1);

-- =====================================================================
-- #7 rebook_after_cancel_24h  →  Termin auf cancelled, updated_at -25h
-- =====================================================================
-- UPDATE interview_appointments
--   SET status = 'cancelled', updated_at = now() - interval '25 hours'
-- WHERE application_id = (SELECT id FROM applications WHERE email='test+rebook24@deine-domain.de' LIMIT 1);

-- =====================================================================
-- #3 interview_invite_30min  →  scheduled_at now()+30min, damit Fenster greift
-- =====================================================================
-- UPDATE interview_appointments
--   SET starts_at = now() + interval '30 minutes',
--       ends_at   = now() + interval '50 minutes',
--       status    = 'scheduled'
-- WHERE application_id = (SELECT id FROM applications WHERE email='test+invite30@deine-domain.de' LIMIT 1);

-- =====================================================================
-- #13 reminder invite (send-reminders) → Bewerbung angenommen aber kein Account
-- Der aktuelle Versand nutzt status='akzeptiert' und created_at als Zeitbasis.
-- =====================================================================
-- UPDATE applications
--   SET status = 'akzeptiert', created_at = now() - interval '4 days'
-- WHERE email = 'test+invitedrip@deine-domain.de';

-- =====================================================================
-- Cleanup: Zeiten wieder auf jetzt zurücksetzen (Test beenden)
-- =====================================================================
-- UPDATE applications SET created_at = now()
-- WHERE email LIKE 'test+%@deine-domain.de';
--
-- UPDATE interview_appointments SET starts_at = now() + interval '2 days',
--                                    ends_at   = now() + interval '2 days' + interval '20 minutes',
--                                    status    = 'scheduled',
--                                    updated_at = now()
-- WHERE application_id IN (SELECT id FROM applications WHERE email LIKE 'test+%@deine-domain.de');

-- =====================================================================
-- Test-Log leeren (damit derselbe Kind erneut feuern darf)
-- =====================================================================
-- DELETE FROM application_reminder_log
-- WHERE application_id IN (SELECT id FROM applications WHERE email LIKE 'test+%@deine-domain.de');
