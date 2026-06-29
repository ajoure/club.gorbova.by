DO $$
DECLARE
  v_uid uuid := 'd27add9e-7f41-4c23-a765-0605b34513d8';
  v_order_ids uuid[] := ARRAY['b6b98d32-4633-4f06-bd17-556bfb756215'::uuid, '9ba42f71-6def-41ae-8385-ba1823f91430'::uuid];
BEGIN
  DELETE FROM subscriptions_v2 WHERE order_id = ANY(v_order_ids) OR user_id = v_uid;
  DELETE FROM access_grant_ledger WHERE order_id = ANY(v_order_ids) OR user_id = v_uid;
  DELETE FROM entitlements WHERE order_id = ANY(v_order_ids) OR user_id = v_uid;
  DELETE FROM audit_logs
    WHERE meta->>'order_id' = ANY(ARRAY[v_order_ids[1]::text, v_order_ids[2]::text])
       OR target_user_id = v_uid;
  DELETE FROM orders_v2 WHERE id = ANY(v_order_ids);
  DELETE FROM auth.users WHERE id = v_uid;
END $$;