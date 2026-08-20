-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Fix: upsert(..., { onConflict: "user_id" }) auf chat_conversations schlug fehl
-- ("there is no unique or exclusion constraint matching the ON CONFLICT specification").
-- Ursache: kein Unique-Index auf user_id.

-- 1) Dubletten pro user_id zusammenführen (neueste Zeile gewinnt)
WITH ranked AS (
  SELECT id,
         user_id,
         row_number() OVER (
           PARTITION BY user_id
           ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC
         ) AS rn
  FROM public.chat_conversations
)
DELETE FROM public.chat_conversations c
USING ranked r
WHERE c.id = r.id
  AND r.rn > 1;

-- 2) Unique-Index auf user_id
CREATE UNIQUE INDEX IF NOT EXISTS chat_conversations_user_id_key
  ON public.chat_conversations (user_id);
