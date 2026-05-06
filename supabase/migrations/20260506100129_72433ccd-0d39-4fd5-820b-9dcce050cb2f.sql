-- module_scope_ids_repair_2026_05
-- Filter: product_id IN (...) AND meta->>'scope_resolution_mode'='module_scope_only'
--         AND meta.historical_module_product_ids contains the product_id itself
-- Action: replace historical_module_product_ids with [target training_module_id]
-- Preserves: scope_resolution_mode, status, expires_at, source_type, source_rule_id

DO $$
DECLARE
  m JSONB := jsonb_build_object(
    '064dd768-de8b-40db-89bc-f8d4a7e442ba', 'a4a5102d-fdb1-4171-a0de-f6e151155431',
    '64d9f812-617c-41a8-b3dc-bb113156d6f3', '8f71d4a8-2358-4a1a-9082-e4b501909bb1',
    '9187db54-8f57-42eb-bbcb-d7103d2459a9', '841650a9-9f83-4c6d-9093-32fa04f87712',
    '99f1f156-f384-417e-bdf8-9203eb3c9d42', 'b1199440-2fb7-49df-8034-7251f22d29f0',
    'abee24cd-5c8b-4111-a6cb-7dee7acf168c', '1ede03b4-03fc-4386-89a1-0f3f198d9ced',
    'd7effaf4-9be0-4ce2-971b-e02fe2a85a9a', '4c97d21c-ce30-4d96-8487-f810ae33b563',
    'f833c846-a78d-4096-9dac-b8417d588371', 'b7bae7fd-3a39-4438-8ec6-ced99f79c327'
  );
  r RECORD;
  new_arr JSONB;
  old_arr JSONB;
BEGIN
  FOR r IN
    SELECT e.id, e.user_id, e.product_id, e.meta
    FROM entitlements e
    WHERE e.product_id::text = ANY(ARRAY(SELECT jsonb_object_keys(m)))
      AND e.meta->>'scope_resolution_mode' = 'module_scope_only'
      AND e.meta->'historical_module_product_ids' @> to_jsonb(ARRAY[e.product_id::text])
  LOOP
    old_arr := r.meta->'historical_module_product_ids';
    new_arr := to_jsonb(ARRAY[(m->>(r.product_id::text))]);

    UPDATE entitlements
    SET meta = jsonb_set(
                  jsonb_set(meta,
                    '{historical_module_product_ids}', new_arr, true),
                  '{module_scope_ids_repaired_at}',
                  to_jsonb(now()::text), true)
    WHERE id = r.id;

    INSERT INTO audit_logs(action, actor_type, actor_label, target_user_id, meta)
    VALUES (
      'training_content.module_scope_ids_repaired',
      'system',
      'module_scope_ids_repair_2026_05',
      r.user_id,
      jsonb_build_object(
        'entitlement_id', r.id,
        'product_id', r.product_id,
        'old_historical_module_product_ids', old_arr,
        'new_historical_module_product_ids', new_arr
      )
    );
  END LOOP;
END $$;