-- Add one known attribution label; no historical rows or funnel logic change.
-- Managed production applies this exact GitHub migration through Lovable only.
DO $migration$
DECLARE
  v_oid oid := 'public.submit_site_questionnaire(uuid,uuid,uuid,uuid,jsonb,text,text,uuid,text)'::regprocedure;
  v_proc pg_proc%ROWTYPE;
  v_after pg_proc%ROWTYPE;
  v_definition text;
BEGIN
  SELECT * INTO STRICT v_proc FROM pg_proc WHERE oid = v_oid;
  IF md5(v_proc.prosrc) = '8c5d623cb3c84fd7741ad3e893f6e593' THEN RETURN; END IF;
  IF md5(v_proc.prosrc) <> '10378f20d4b2ca9836a6e5be304e84de' THEN
    RAISE EXCEPTION 'questionnaire_webinar_source_definition_drift';
  END IF;
  v_definition := replace(pg_get_functiondef(v_oid),
    $old$('reels','Рилс','instagram'), ('direct','Директ','instagram')$old$,
    $new$('reels','Рилс','instagram'), ('direct','Директ','instagram'),
    ('platforma','Продающий вебинар','veb')$new$);
  EXECUTE v_definition;
  SELECT * INTO STRICT v_after FROM pg_proc WHERE oid = v_oid;
  IF md5(v_after.prosrc) <> '8c5d623cb3c84fd7741ad3e893f6e593'
     OR v_after.proowner IS DISTINCT FROM v_proc.proowner
     OR v_after.prosecdef IS DISTINCT FROM v_proc.prosecdef
     OR v_after.proconfig IS DISTINCT FROM v_proc.proconfig
     OR v_after.proacl IS DISTINCT FROM v_proc.proacl THEN
    RAISE EXCEPTION 'questionnaire_webinar_source_verification_failed';
  END IF;
END;
$migration$;
