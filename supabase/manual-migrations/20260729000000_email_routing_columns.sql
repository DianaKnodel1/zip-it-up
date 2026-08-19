-- APPLY MANUALLY.
-- Klare SMTP-Trennung: Bewerbung kennt IMMER Broker-Tenant (Vermittlung) UND
-- Fast-Track-Tenant (Portal). Damit routet jede E-Mail deterministisch auf
-- den richtigen SMTP — unabhängig davon, was der Frontend-Code mitschickt.
--
-- Regeln:
--   broker_tenant_id    = tenant der source_landing (dort wurde beworben)
--                         Fallback: applications.tenant_id.
--   fasttrack_tenant_id = tenant der target_landing bzw.
--                         source_landing.linked_fasttrack_landing.tenant.
--
-- Beide Spalten sind nullable — Broker-only-Setups ohne Fast-Track bleiben
-- funktionsfähig (Registrierungsmails werden dann skipped statt falsch
-- geroutet).

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS broker_tenant_id     uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fasttrack_tenant_id  uuid REFERENCES public.tenants(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.applications.broker_tenant_id IS
  'Vermittlungs-Tenant (source_landing). Absender für: application_received, no_booking, no_show, interview_invite, booking_confirmation.';
COMMENT ON COLUMN public.applications.fasttrack_tenant_id IS
  'Fast-Track-/Portal-Tenant (target_landing bzw. linked_fasttrack_landing). Absender für: welcome/registration_complete, email_verify, chat_reminder, no_order_7d.';

CREATE INDEX IF NOT EXISTS applications_broker_tenant_idx    ON public.applications(broker_tenant_id);
CREATE INDEX IF NOT EXISTS applications_fasttrack_tenant_idx ON public.applications(fasttrack_tenant_id);

-- Backfill broker_tenant_id: bevorzugt source_landing.tenant_id, fallback applications.tenant_id
UPDATE public.applications a
   SET broker_tenant_id = COALESCE(sl.tenant_id, a.tenant_id)
  FROM public.landing_pages sl
 WHERE a.broker_tenant_id IS NULL
   AND a.source_landing_id = sl.id;

UPDATE public.applications a
   SET broker_tenant_id = a.tenant_id
 WHERE a.broker_tenant_id IS NULL
   AND a.tenant_id IS NOT NULL;

-- Backfill fasttrack_tenant_id:
--   1) direkte target_landing.tenant_id
--   2) source_landing.linked_fasttrack_landing.tenant_id
UPDATE public.applications a
   SET fasttrack_tenant_id = tl.tenant_id
  FROM public.landing_pages tl
 WHERE a.fasttrack_tenant_id IS NULL
   AND a.target_landing_id = tl.id
   AND COALESCE(tl.flow_type, '') <> 'broker';

UPDATE public.applications a
   SET fasttrack_tenant_id = ft.tenant_id
  FROM public.landing_pages sl
  JOIN public.landing_pages ft ON ft.id = sl.linked_fasttrack_landing_id
 WHERE a.fasttrack_tenant_id IS NULL
   AND a.source_landing_id = sl.id
   AND COALESCE(ft.flow_type, '') <> 'broker';

-- Trigger: bei INSERT/UPDATE der Landing-Beziehungen die Tenant-Felder pflegen.
CREATE OR REPLACE FUNCTION public.applications_sync_routing_tenants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_source_tenant   uuid;
  v_target_tenant   uuid;
  v_target_flow     text;
  v_linked_id       uuid;
  v_linked_tenant   uuid;
  v_linked_flow     text;
BEGIN
  IF NEW.source_landing_id IS NOT NULL THEN
    SELECT tenant_id, linked_fasttrack_landing_id
      INTO v_source_tenant, v_linked_id
      FROM public.landing_pages WHERE id = NEW.source_landing_id;
  END IF;

  IF NEW.target_landing_id IS NOT NULL THEN
    SELECT tenant_id, COALESCE(flow_type,'')
      INTO v_target_tenant, v_target_flow
      FROM public.landing_pages WHERE id = NEW.target_landing_id;
  END IF;

  IF v_linked_id IS NOT NULL THEN
    SELECT tenant_id, COALESCE(flow_type,'')
      INTO v_linked_tenant, v_linked_flow
      FROM public.landing_pages WHERE id = v_linked_id;
  END IF;

  -- broker: source-landing tenant, fallback applications.tenant_id
  NEW.broker_tenant_id := COALESCE(NEW.broker_tenant_id, v_source_tenant, NEW.tenant_id);

  -- fasttrack: direkt target (wenn kein broker), sonst über linked_fasttrack
  IF NEW.fasttrack_tenant_id IS NULL THEN
    IF v_target_tenant IS NOT NULL AND v_target_flow <> 'broker' THEN
      NEW.fasttrack_tenant_id := v_target_tenant;
    ELSIF v_linked_tenant IS NOT NULL AND v_linked_flow <> 'broker' THEN
      NEW.fasttrack_tenant_id := v_linked_tenant;
    END IF;
  END IF;

  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS applications_sync_routing_tenants_trg ON public.applications;
CREATE TRIGGER applications_sync_routing_tenants_trg
  BEFORE INSERT OR UPDATE OF source_landing_id, target_landing_id, tenant_id
  ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.applications_sync_routing_tenants();

-- Debug-View für den neuen "E-Mail-Routing"-Tab im Admin.
CREATE OR REPLACE VIEW public.v_application_email_routing AS
SELECT
  a.id                              AS application_id,
  a.email,
  a.full_name,
  a.flow_type,
  a.tenant_id                       AS legacy_tenant_id,
  a.broker_tenant_id,
  bt.name                           AS broker_tenant_name,
  bt.smtp_host IS NOT NULL          AS broker_smtp_ok,
  a.fasttrack_tenant_id,
  ft.name                           AS fasttrack_tenant_name,
  ft.smtp_host IS NOT NULL          AS fasttrack_smtp_ok,
  a.source_landing_id,
  a.target_landing_id,
  a.created_at
FROM public.applications a
LEFT JOIN public.tenants bt ON bt.id = a.broker_tenant_id
LEFT JOIN public.tenants ft ON ft.id = a.fasttrack_tenant_id;

GRANT SELECT ON public.v_application_email_routing TO authenticated;

NOTIFY pgrst, 'reload schema';
