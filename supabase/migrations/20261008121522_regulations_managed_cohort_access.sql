-- Only the regulations finite-installment product predicate changes.
-- Existing managed, active tariff-scoped section rules are the product opt-in.
-- No product/rule/user/payment data or function owner/ACL is changed.
DO $migration$
DECLARE
  v_definition text;
  v_before text := $predicate$      AND sec.code IN ('ai_asset_classifier', 'ai_bank_statement_analysis',
                       'ai_act_reconciliation', 'ai_accounting_regulations')
      AND ar.product_id IN ('3e43fb28-8322-41bc-bfee-714731bdc630'::uuid,
                           '2b7bf6d4-ad8d-46ad-9399-7f96c307c596'::uuid)$predicate$;
  v_after text := $predicate$      AND (
        (sec.code IN ('ai_asset_classifier', 'ai_bank_statement_analysis', 'ai_act_reconciliation')
         AND ar.product_id IN ('3e43fb28-8322-41bc-bfee-714731bdc630'::uuid,
                              '2b7bf6d4-ad8d-46ad-9399-7f96c307c596'::uuid))
        OR (sec.code = 'ai_accounting_regulations' AND ar.product_id IS NOT NULL)
      )$predicate$;
BEGIN
  SELECT pg_get_functiondef('public.user_has_access_to_rule(uuid,uuid)'::regprocedure)
  INTO v_definition;
  -- Idempotency without accepting a subsequently changed implementation.
  IF strpos(v_definition, v_after) > 0 THEN
    IF md5(replace(v_definition, v_after, v_before)) <> 'e9417f737dc24c452c0f7e492f9edcb9' THEN
      RAISE EXCEPTION 'regulations_access_already_applied_but_source_drifted';
    END IF;
    RETURN;
  END IF;
  IF md5(v_definition) <> 'e9417f737dc24c452c0f7e492f9edcb9'
    OR strpos(v_definition, v_before) = 0 THEN
    RAISE EXCEPTION 'regulations_access_function_source_mismatch';
  END IF;
  EXECUTE replace(v_definition, v_before, v_after);
END;
$migration$;
