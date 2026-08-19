-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Rolle "admin_mitarbeiter": rechte Hand des Admins.
-- Rechte: alle Aufträge (zuweisen/prüfen) + alle Chats. Keine Einstellungen,
-- keine Tenants, keine Finanzen.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admin_mitarbeiter';
