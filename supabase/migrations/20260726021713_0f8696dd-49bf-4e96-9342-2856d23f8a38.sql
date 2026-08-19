CREATE OR REPLACE FUNCTION public.__tmp_import_sql(p_sql text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$ BEGIN EXECUTE p_sql; END; $fn$;
REVOKE ALL ON FUNCTION public.__tmp_import_sql(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.__tmp_import_sql(text) TO sandbox_exec;