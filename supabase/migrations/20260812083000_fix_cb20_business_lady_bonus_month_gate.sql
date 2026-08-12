-- CB20 "Бизнес-леди" grants a time-limited Gorbova Club BUSINESS bonus.
-- This package is not a monthly club purchase, so its explicitly allowed
-- modules must not require an order for each module's content_month.
--
-- Scope guard: exactly one known active rule must still carry the stale flag.
DO $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.access_rules
  SET
    conditions = conditions - 'match_purchase_month',
    updated_at = now()
  WHERE id = '48512164-8d47-4e95-ae12-77676f6a60f0'::uuid
    AND product_id = '3e43fb28-8322-41bc-bfee-714731bdc630'::uuid
    AND tariff_id = '767bb895-30fa-49c9-8f31-d0794590020a'::uuid
    AND target_ref = '8b1fb03e-8743-4654-a07f-b6c03ca7517b'
    AND grant_target_type = 'training_content'
    AND is_active = true
    AND conditions->>'rule_purpose' = 'bonus'
    AND conditions->>'access_mode' = 'partial'
    AND conditions->>'match_purchase_month' = 'true';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION
      'Expected to update exactly one CB20 Business Lady bonus rule, updated %',
      v_updated;
  END IF;
END
$$;

-- Rollback (manual, if required):
-- UPDATE public.access_rules
-- SET conditions = jsonb_set(conditions, '{match_purchase_month}', 'true'::jsonb),
--     updated_at = now()
-- WHERE id = '48512164-8d47-4e95-ae12-77676f6a60f0'::uuid;
