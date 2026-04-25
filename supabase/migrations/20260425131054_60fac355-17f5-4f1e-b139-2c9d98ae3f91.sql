DO $$
DECLARE _result jsonb;
BEGIN
  _result := public.apply_rev_7101ed3c('REVISION-7101ed3c-20260425T130602Z');
  RAISE NOTICE 'REVISION RESULT: %', _result;
END $$;