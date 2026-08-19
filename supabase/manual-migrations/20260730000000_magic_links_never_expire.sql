-- APPLY MANUALLY auf Backend-DB.
-- Bewerbungs-/Interview-Magic-Links sollen dauerhaft gültig sein.
-- (Nur Auth-Links – E-Mail-Bestätigung & Passwort-Reset – laufen ab: 24 h,
--  gesteuert über die GoTrue-Einstellung mailer_otp_exp = 86400.)

UPDATE public.applications
   SET magic_token_expires_at = NULL
 WHERE magic_token IS NOT NULL
   AND magic_token_expires_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
