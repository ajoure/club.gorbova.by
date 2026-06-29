DO $$
DECLARE
  v_oids uuid[] := ARRAY['d9c347b9-16b6-46c3-8fa6-eba61cd42fcc'::uuid,'608933c7-0c2f-4146-88cf-e6802373516f'::uuid];
  v_uids uuid[] := ARRAY['38d1a392-ea52-467c-a56e-86d372f959f1'::uuid,'23792d7a-556f-4a5e-a4b1-cc34b05bf76f'::uuid];
BEGIN
  DELETE FROM access_grant_ledger WHERE order_id = ANY(v_oids) OR user_id = ANY(v_uids);
  DELETE FROM entitlements WHERE order_id = ANY(v_oids) OR user_id = ANY(v_uids);
  DELETE FROM audit_logs
    WHERE (meta->>'order_id') = ANY(ARRAY[v_oids[1]::text, v_oids[2]::text])
       OR target_user_id = ANY(v_uids);
  DELETE FROM orders_v2 WHERE id = ANY(v_oids);
  DELETE FROM auth.users WHERE id = ANY(v_uids);
END $$;