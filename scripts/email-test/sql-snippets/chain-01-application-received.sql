-- Stufe 1: Bewerbung eingegangen
-- Legt den Test-Bewerber im Vermittlungs-Flow an (Source = Broker, Target = Fast-Track)
-- und leert die Reminder-Logs.
-- Erwartete psql-Variablen: :test_email, :tenant_id, :source_landing_id, :target_landing_id, :landing_id

BEGIN;

-- Alte Reminder-Log-Einträge vom Test-Bewerber löschen
DELETE FROM application_reminder_log
WHERE application_id IN (
  SELECT id FROM applications WHERE email = :'test_email'
);
DELETE FROM reminder_log
WHERE email = :'test_email';

-- Alte Testtermine entfernen. So bekommt jeder Durchlauf eine neue Appointment-ID
-- und kollidiert nicht mit früheren Versand-Logs der Terminbestätigung.
DELETE FROM interview_appointments
WHERE application_id IN (
  SELECT id FROM applications WHERE email = :'test_email'
);

-- Alte Bewerbungen dieses Test-Users vollständig entfernen (kein unique constraint auf email vorhanden).
DELETE FROM applications WHERE email = :'test_email';

-- Nur für diesen isolierten Test-Insert werden User-Trigger übersprungen. Auf älteren
-- Installationen enthält ein Applications-Trigger noch ein ungültiges ON CONFLICT,
-- das den Insert sonst abbricht. Die Routing-Tenants setzen wir deshalb explizit.
SET LOCAL session_replication_role = replica;

-- Bewerber neu anlegen. tenant_id = Broker-/Source-Tenant, source_landing_id = Vermittlung,
-- target_landing_id = Fast-Track. Routing-Tenants werden direkt aus den Landings gelesen.
INSERT INTO applications (
  email, first_name, last_name, full_name, tenant_id,
  broker_tenant_id, fasttrack_tenant_id,
  source_landing_id, target_landing_id, status, flow_type,
  booking_status, magic_token, magic_token_expires_at,
  created_at, updated_at
)
VALUES (
  :'test_email', 'Test', 'Kette', 'Test Kette', :'tenant_id'::uuid,
  (SELECT tenant_id FROM landing_pages WHERE id = :'source_landing_id'::uuid),
  (SELECT tenant_id FROM landing_pages WHERE id = :'target_landing_id'::uuid),
  :'source_landing_id'::uuid, :'target_landing_id'::uuid, 'neu', 'broker',
  'none', encode(gen_random_bytes(24), 'hex'), now() + interval '30 days',
  now(), now()
);

COMMIT;

-- Kontrolle: alle Routing-Spalten müssen jetzt gefüllt sein.
SELECT id, email, tenant_id, broker_tenant_id, fasttrack_tenant_id,
       source_landing_id, target_landing_id, flow_type, status, booking_status
FROM applications WHERE email = :'test_email';
