-- Stufe 2: Termin bestätigt
-- Buchungs-Status auf 'confirmed', Termin in 2 Tagen.
-- Reminder-Log leeren, damit die Confirmation-Mail feuern darf.

BEGIN;

UPDATE applications
   SET booking_status = 'scheduled',
       scheduled_at = now() + interval '2 days',
       updated_at = now()
 WHERE email = :'test_email';

DELETE FROM application_reminder_log
 WHERE application_id IN (SELECT id FROM applications WHERE email = :'test_email')
   AND reminder_kind = 'booking_confirmation';

-- Pro Testlauf genau einen frischen Termin anlegen. application_id besitzt
-- absichtlich keinen UNIQUE-Constraint, deshalb kein ON CONFLICT verwenden.
DELETE FROM interview_appointments
 WHERE application_id IN (SELECT id FROM applications WHERE email = :'test_email');

INSERT INTO interview_appointments (
  tenant_id, application_id, schedule_id, starts_at, ends_at, status, created_at, updated_at
)
SELECT a.tenant_id, a.id, s.id,
       now() + interval '2 days', now() + interval '2 days' + interval '20 minutes',
       'scheduled', now(), now()
  FROM applications a
  JOIN availability_schedules s
    ON s.landing_page_id IN (
      SELECT id FROM landing_pages
       WHERE id = :'target_landing_id'::uuid
          OR id = (SELECT linked_fasttrack_landing_id FROM landing_pages WHERE id = :'target_landing_id'::uuid)
    )
   AND s.active = true
 WHERE a.email = :'test_email'
 ORDER BY s.created_at
 LIMIT 1;

COMMIT;
