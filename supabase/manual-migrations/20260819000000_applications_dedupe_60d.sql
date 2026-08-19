-- Doppelbewerbungen (Doppelklick / Doppel-Absenden) verhindern,
-- echte Wiederbewerbungen nach 60 Tagen aber weiterhin erlauben.
--
-- Der strenge Index applications_tenant_email_unique aus
-- 20260817000000 konnte nicht angelegt werden, weil es historische
-- Mehrfachbewerbungen gibt. Statt dessen: Eindeutigkeit pro
-- 60-Tage-Bucket (immutable Ausdruck, daher indexierbar).

DROP INDEX IF EXISTS public.applications_tenant_email_unique;

-- Kein UNIQUE-Index auf historische Bewerbungen: bestehende Doppelzeilen im
-- selben Zeitraum sind gueltige Altdaten und wuerden den Deploy abbrechen.
-- Neue Doppel-Absendungen werden atomar im Applications-Endpunkt erkannt und
-- auf die vorhandene Bewerbung zurueckgefuehrt.

NOTIFY pgrst, 'reload schema';
