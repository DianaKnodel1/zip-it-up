-- APPLY MANUALLY via: bash scripts/migrate.sh (oder scripts/deploy-backend.sh)
-- Problem: public.bookings.user_id hat KEINEN Foreign Key auf auth.users,
-- daher wurden Termine/Aufträge beim Löschen eines Mitarbeiters nicht entfernt
-- und erschienen in der Termin-Übersicht als "Unbekannt".

-- 1) Bestehende verwaiste Buchungen aufräumen
DELETE FROM public.bookings b
 WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = b.user_id);

-- 2) Cascade-Funktion um Buchungen (und andere user_id-Tabellen ohne FK) erweitern
CREATE OR REPLACE FUNCTION public.admin_delete_user_cascade(_user_id uuid, _actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  sql TEXT;
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Nicht autorisiert';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Admin-Accounts können nicht über diese Funktion gelöscht werden.';
  END IF;

  -- a) Termine/Buchungen des Mitarbeiters explizit löschen (kein FK vorhanden)
  BEGIN
    DELETE FROM public.bookings WHERE user_id = _user_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skip bookings: %', SQLERRM;
  END;

  -- b) Alle Tabellen mit FK auf auth.users
  FOR rec IN
    SELECT tc.table_schema, tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema   = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema   = 'public'
      AND ccu.table_schema  = 'auth'
      AND ccu.table_name    = 'users'
      AND tc.table_name    <> 'profiles'
  LOOP
    sql := format('DELETE FROM %I.%I WHERE %I = $1',
                  rec.table_schema, rec.table_name, rec.column_name);
    BEGIN
      EXECUTE sql USING _user_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skip %.% (%): %', rec.table_schema, rec.table_name, rec.column_name, SQLERRM;
    END;
  END LOOP;

  UPDATE public.profiles SET team_leader_id = NULL WHERE team_leader_id = _user_id;

  BEGIN
    DELETE FROM public.chat_messages WHERE sender_id = _user_id OR receiver_id = _user_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    DELETE FROM public.activity_log WHERE actor_id = _user_id OR entity_id = _user_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  DELETE FROM public.profiles WHERE user_id = _user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_user_cascade(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user_cascade(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
