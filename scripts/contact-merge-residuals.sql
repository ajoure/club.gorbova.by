-- Canonical Lovable Cloud only. Exact reviewed G1/G10; no Auth mutation.
-- Each operation is separate and atomic. Journals contain DB snapshots, never print PII.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $merge$
DECLARE
  do_execute boolean := /* EXECUTE_FLAG */ false;
  operation text := /* OPERATION */ 'G1';
  master_id uuid; old_id uuid; login_id uuid; old_login uuid; history_id uuid;
  master_before jsonb; old_before jsonb; auth_digest text; dep record; n bigint;
  row_before jsonb; row_after jsonb; rows_before jsonb := '{}'::jsonb; rows_after jsonb := '{}'::jsonb;
  allowed_profile jsonb; allowed_user jsonb; expected_n integer; changed integer;
BEGIN
  IF operation = 'G1' THEN
    master_id := 'e12d151d-f872-4726-8940-51d726e8e7bc';
    old_id := '2c41efeb-d7f1-42f0-b595-75e5c4f386e4';
    login_id := '1c3485af-3963-4139-9b8b-e8c71ec5fc02'; old_login := login_id;
    history_id := 'df5b6679-34c8-4991-936e-f62da2e99301';
    allowed_profile := '{"referral_partners.profile_id":1}';
    allowed_user := '{"payments_v2.user_id":1,"profiles.user_id":1,"telegram_access_audit.user_id":11,"telegram_logs.user_id":7,"telegram_messages.user_id":3,"tenant_memberships.user_id":1,"user_roles_v2.user_id":1}';
  ELSIF operation = 'G10' THEN
    master_id := 'd74aeb9b-b959-4c65-9393-871d79bee598';
    old_id := 'dff8cb9a-3548-4acc-ad8b-0216d9b4190b';
    login_id := 'def0faba-02ca-4bec-b8cb-9a2b2eab74d1'; old_login := 'fa10d932-eea5-46e2-a3b0-9c5b806ecb66';
    history_id := 'ca2e06b2-5098-4fea-bbb4-c2958e31a610';
    allowed_profile := '{"access_grant_ledger.profile_id":1,"client_duplicates.profile_id":1,"email_logs.profile_id":3}';
    allowed_user := '{"access_grant_ledger.user_id":2,"consent_logs.user_id":1,"email_logs.user_id":3,"entitlements.user_id":1,"payments_v2.user_id":1,"profiles.user_id":1,"subscriptions_v2.user_id":1,"telegram_logs.user_id":3}';
  ELSE RAISE EXCEPTION 'Unknown reviewed operation'; END IF;
  PERFORM pg_advisory_xact_lock(71360000 + CASE WHEN operation='G1' THEN 1 ELSE 10 END);
  PERFORM id FROM public.profiles WHERE id IN (master_id,old_id) ORDER BY id FOR UPDATE;
  SELECT to_jsonb(p) INTO master_before FROM public.profiles p WHERE id=master_id;
  SELECT to_jsonb(p) INTO old_before FROM public.profiles p WHERE id=old_id;
  IF master_before IS NULL OR old_before IS NULL
    OR coalesce((master_before->>'is_archived')::boolean,false)
    OR master_before->>'status' = 'banned'
    OR master_before->>'merged_to_profile_id' IS NOT NULL
    OR old_before->>'status' IS DISTINCT FROM 'archived'
    OR NOT coalesce((old_before->>'is_archived')::boolean,false)
    OR old_before->>'telegram_user_id' IS NOT NULL
  THEN RAISE EXCEPTION 'Reviewed identity changed'; END IF;
  IF EXISTS (SELECT 1 FROM public.merge_history WHERE id=history_id) THEN
    IF master_before->>'user_id' IS DISTINCT FROM login_id::text
      OR old_before->>'merged_to_profile_id' IS DISTINCT FROM master_id::text
      OR (operation='G1' AND old_before->>'user_id' IS NOT NULL)
      OR (operation='G10' AND (
        EXISTS(SELECT 1 FROM public.payments_v2 WHERE user_id=old_login)
        OR EXISTS(SELECT 1 FROM public.subscriptions_v2 WHERE user_id=old_login)
        OR EXISTS(SELECT 1 FROM public.entitlements WHERE user_id=old_login)))
    THEN RAISE EXCEPTION 'Replay ownership mismatch'; END IF;
    RETURN;
  END IF;
  IF old_before->>'user_id' IS DISTINCT FROM old_login::text
    OR (SELECT count(*) FROM public.profiles WHERE user_id=old_login) <> 1
    OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=old_login AND deleted_at IS NULL
      AND (banned_until IS NULL OR banned_until<=now()))
    OR public.has_role_v2(old_login,'admin') OR public.has_role_v2(old_login,'super_admin')
  THEN RAISE EXCEPTION 'Old Auth ownership or security state changed'; END IF;
  SELECT md5(string_agg(to_jsonb(u)::text,',' ORDER BY id)) INTO auth_digest
    FROM auth.users u WHERE id IN (login_id,old_login);

  -- Current complete ownership inventory. Audit actor/history references remain historical.
  FOR dep IN
    SELECT DISTINCT c.table_name,c.column_name FROM information_schema.columns c
    JOIN information_schema.tables t USING(table_schema,table_name)
    WHERE c.table_schema='public' AND t.table_type='BASE TABLE' AND c.udt_name='uuid'
      AND c.table_name !~ '(^_|backup|_archive$)'
      AND (c.column_name IN ('profile_id','user_id','contact_id','owner_profile_id','linked_profile_id','matched_profile_id','master_profile_id','merged_profile_id')
        OR EXISTS (SELECT 1 FROM pg_constraint fk JOIN pg_class rel ON rel.oid=fk.conrelid
          JOIN pg_namespace ns ON ns.oid=rel.relnamespace
          JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attnum=ANY(fk.conkey)
          WHERE fk.contype='f' AND fk.confrelid='public.profiles'::regclass
          AND ns.nspname=c.table_schema AND rel.relname=c.table_name AND att.attname=c.column_name))
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I=$1',dep.table_name,dep.column_name) INTO n USING old_id;
    expected_n := coalesce((allowed_profile->>(dep.table_name||'.'||dep.column_name))::int,0);
    IF n<>expected_n THEN RAISE EXCEPTION 'Profile dependency changed %.%: % vs %',dep.table_name,dep.column_name,n,expected_n; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I=$1',dep.table_name,dep.column_name) INTO n USING old_login;
    expected_n := coalesce((allowed_user->>(dep.table_name||'.'||dep.column_name))::int,0);
    IF n<>expected_n THEN RAISE EXCEPTION 'Auth dependency changed %.%: % vs %',dep.table_name,dep.column_name,n,expected_n; END IF;
  END LOOP;

  IF operation='G1' THEN
    IF master_before->>'user_id' IS NOT NULL OR master_before->>'status' IS DISTINCT FROM 'imported'
      OR old_before->>'merged_to_profile_id' IS NOT NULL
      OR nullif(lower(btrim(master_before->>'email')),'') IS NULL
      OR lower(btrim(master_before->>'email')) IS DISTINCT FROM lower(btrim(old_before->>'email'))
      OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=login_id AND lower(btrim(email))=lower(btrim(master_before->>'email')))
      OR NOT EXISTS (SELECT 1 FROM public.referral_partners WHERE id='abcde024-a56d-4d2d-9939-9395d3ca5626' AND profile_id=old_id AND status='closed')
      OR NOT EXISTS (SELECT 1 FROM public.referral_partners WHERE id='71d63f4d-6c27-4091-86bc-f994bbd8c374' AND profile_id=master_id AND status='active')
    THEN RAISE EXCEPTION 'G1 login or closed referral alias changed'; END IF;
    IF NOT do_execute THEN RETURN; END IF;
    UPDATE public.profiles SET user_id=NULL,merged_to_profile_id=master_id,duplicate_flag='none' WHERE id=old_id;
    UPDATE public.profiles SET user_id=login_id,status='active' WHERE id=master_id;
    IF (SELECT to_jsonb(p)-ARRAY['user_id','status','updated_at'] FROM public.profiles p WHERE id=master_id)
      IS DISTINCT FROM (master_before-ARRAY['user_id','status','updated_at'])
      OR (SELECT to_jsonb(p)-ARRAY['user_id','merged_to_profile_id','duplicate_flag','updated_at'] FROM public.profiles p WHERE id=old_id)
      IS DISTINCT FROM (old_before-ARRAY['user_id','merged_to_profile_id','duplicate_flag','updated_at'])
    THEN RAISE EXCEPTION 'G1 unexpected profile changes'; END IF;
  ELSE
    IF master_before->>'user_id' IS DISTINCT FROM login_id::text
      OR master_before->>'status' IS DISTINCT FROM 'active'
      OR old_before->>'merged_to_profile_id' IS DISTINCT FROM master_id::text
      OR (SELECT count(*) FROM public.profiles WHERE user_id=login_id)<>1
      OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=login_id AND lower(btrim(email))=lower(btrim(master_before->>'email')))
      OR NOT EXISTS (SELECT 1 FROM public.orders_v2 WHERE id='828ed0df-b37f-43fe-a9ba-f5e9bf7fae04'
        AND user_id=login_id AND profile_id=master_id AND status='paid' AND is_deleted IS NOT TRUE)
      OR EXISTS (SELECT 1 FROM public.entitlements WHERE user_id=login_id AND product_code='consultation')
    THEN RAISE EXCEPTION 'G10 master purchase identity/collision changed'; END IF;
    FOR dep IN SELECT * FROM (VALUES
      ('payments_v2','92825c91-9282-404b-8c35-a00685e4228e'::uuid,'succeeded'),
      ('subscriptions_v2','23a959b9-189e-43ed-855b-c564d078a77d'::uuid,'expired'),
      ('entitlements','1b7b04f6-4788-4eba-8966-f660c6c063a9'::uuid,'expired')
    ) x(table_name,row_id,expected_status)
    LOOP
      EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 FOR UPDATE',dep.table_name) INTO row_before USING dep.row_id;
      IF row_before IS NULL OR row_before->>'user_id' IS DISTINCT FROM old_login::text
        OR row_before->>'status' IS DISTINCT FROM dep.expected_status
        OR (row_before->>'order_id' IS NOT NULL AND row_before->>'order_id'<>'828ed0df-b37f-43fe-a9ba-f5e9bf7fae04')
        OR (dep.table_name IN ('subscriptions_v2','entitlements') AND row_before->>'profile_id' IS DISTINCT FROM master_id::text)
        OR (dep.table_name='subscriptions_v2' AND ((row_before->>'access_end_at')::timestamptz IS DISTINCT FROM '2026-08-09T07:38:29.802Z'::timestamptz OR (row_before->>'auto_renew')::boolean IS DISTINCT FROM false))
        OR (dep.table_name='entitlements' AND ((row_before->>'expires_at')::timestamptz IS DISTINCT FROM '2026-08-09T07:38:29.802Z'::timestamptz OR row_before->>'product_code' IS DISTINCT FROM 'consultation'))
      THEN RAISE EXCEPTION 'G10 reviewed row changed: %',dep.table_name; END IF;
      rows_before := rows_before||jsonb_build_object(dep.table_name,row_before);
      IF do_execute THEN
        EXECUTE format('UPDATE public.%I SET user_id=$1 WHERE id=$2',dep.table_name) USING login_id,dep.row_id;
        GET DIAGNOSTICS changed=ROW_COUNT;
        IF changed<>1 THEN RAISE EXCEPTION 'Unexpected G10 write count'; END IF;
        EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1',dep.table_name) INTO row_after USING dep.row_id;
        IF row_after->>'user_id' IS DISTINCT FROM login_id::text OR (row_after-ARRAY['user_id','updated_at']) IS DISTINCT FROM (row_before-ARRAY['user_id','updated_at'])
        THEN RAISE EXCEPTION 'G10 changed money/status/window beyond ownership'; END IF;
        rows_after:=rows_after||jsonb_build_object(dep.table_name,row_after);
      END IF;
    END LOOP;
    IF NOT do_execute THEN RETURN; END IF;
    IF (SELECT to_jsonb(p) FROM public.profiles p WHERE id=master_id) IS DISTINCT FROM master_before
      OR (SELECT to_jsonb(p) FROM public.profiles p WHERE id=old_id) IS DISTINCT FROM old_before
    THEN RAISE EXCEPTION 'G10 unexpected profile mutation'; END IF;
  END IF;
  IF (SELECT md5(string_agg(to_jsonb(u)::text,',' ORDER BY id)) FROM auth.users u WHERE id IN(login_id,old_login)) IS DISTINCT FROM auth_digest
  THEN RAISE EXCEPTION 'Unexpected Auth mutation'; END IF;
  INSERT INTO public.merge_history(id,master_profile_id,merged_profile_id,merged_data)
  VALUES(history_id,master_id,old_id,jsonb_build_object('batch_id','archived-active-20260911-'||operation,
    'merged_profile_ids',jsonb_build_array(old_id),'merged_auth_user_ids','[]'::jsonb,
    'master_before',master_before,'merged_profiles_snapshot',jsonb_build_array(old_before),
    'rows_before',rows_before,'rows_after',rows_after,'login_email_changed',false,
    'rollback_strategy','exact_rows_journal','operation',operation));
  INSERT INTO public.audit_logs(action,actor_type,actor_label,target_user_id,meta)
  VALUES('CONTACT_MERGED','system','Owner-approved archived account consolidation',login_id,
    jsonb_build_object('merge_history_id',history_id,'operation',operation,'can_unmerge',false,
      'master_profile_id',master_id,'merged_profile_ids',jsonb_build_array(old_id),
      'payments_transferred',CASE WHEN operation='G10' THEN 1 ELSE 0 END,
      'subscriptions_transferred',CASE WHEN operation='G10' THEN 1 ELSE 0 END,
      'entitlements_transferred',CASE WHEN operation='G10' THEN 1 ELSE 0 END));
END;
$merge$;
SELECT id,merged_data->>'operation' AS operation FROM public.merge_history
  WHERE id IN ('df5b6679-34c8-4991-936e-f62da2e99301','ca2e06b2-5098-4fea-bbb4-c2958e31a610');
COMMIT;
