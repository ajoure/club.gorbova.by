
DO $$
DECLARE
  v_product_id uuid := 'dd411e52-da58-43c1-a8c1-aec64adb36a7';
  v_order_ids uuid[] := ARRAY[
    '5a8b1d1d-9e4c-4b51-b485-59b9603e61c6'::uuid,
    'c943a252-0356-4fee-b847-d6b66044481e'::uuid,
    '52566a3e-f093-4309-97f4-3976f15b5066'::uuid,
    'd374d75a-78d7-4aff-bc82-bc977cb80671'::uuid];
BEGIN
  DELETE FROM entitlements WHERE product_id = v_product_id;
  DELETE FROM subscriptions_v2 WHERE product_id = v_product_id;
  DELETE FROM access_rules WHERE product_id = v_product_id;
  DELETE FROM orders_v2 WHERE id = ANY(v_order_ids);
  DELETE FROM tariffs WHERE product_id = v_product_id;
  DELETE FROM products_v2 WHERE id = v_product_id;

  INSERT INTO audit_logs(action, actor_type, actor_label, meta)
  VALUES('qa.welcome_test_cleanup','system','lovable-qa-2026-05',
    jsonb_build_object('product_id', v_product_id, 'orders_deleted', v_order_ids));
END $$;
