-- Retire only the unused obsolete Auth login after the G10 ownership repair.
CREATE OR REPLACE FUNCTION public.admin_retire_merged_login_g10(_phase text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 master_id constant uuid:='d74aeb9b-b959-4c65-9393-871d79bee598';
 old_id constant uuid:='dff8cb9a-3548-4acc-ad8b-0216d9b4190b';
 login_id constant uuid:='def0faba-02ca-4bec-b8cb-9a2b2eab74d1';
 old_login constant uuid:='fa10d932-eea5-46e2-a3b0-9c5b806ecb66';
 journal_id constant uuid:='1c302f6c-fd28-4f35-a927-0959fb8597a0';
 m jsonb; o jsonb; journal jsonb; banned_until_value timestamptz; dep record; n bigint;
BEGIN
 IF _phase NOT IN('preflight','prepare','finish','status') THEN RAISE EXCEPTION 'Invalid retirement phase'; END IF;
 PERFORM pg_advisory_xact_lock(71361010);
 PERFORM id FROM profiles WHERE id IN(master_id,old_id) ORDER BY id FOR UPDATE;
 SELECT to_jsonb(p) INTO m FROM profiles p WHERE id=master_id;
 SELECT to_jsonb(p) INTO o FROM profiles p WHERE id=old_id;
 SELECT merged_data INTO journal FROM merge_history WHERE id=journal_id FOR UPDATE;
 SELECT banned_until INTO banned_until_value FROM auth.users WHERE id=old_login;
 IF m->>'user_id' IS DISTINCT FROM login_id::text OR m->>'status' IS DISTINCT FROM 'active'
   OR coalesce((m->>'is_archived')::boolean,false) OR m->>'merged_to_profile_id' IS NOT NULL
   OR o->>'user_id' IS DISTINCT FROM old_login::text OR o->>'status' IS DISTINCT FROM 'archived'
   OR (o->>'is_archived')::boolean IS DISTINCT FROM true OR o->>'merged_to_profile_id' IS DISTINCT FROM master_id::text
   OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=login_id AND lower(btrim(email))=lower(btrim(m->>'email'))
      AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()))
 THEN RAISE EXCEPTION 'Retirement master/alias changed'; END IF;
 IF journal->>'state'='complete' THEN
   IF banned_until_value IS NULL OR banned_until_value<=now() THEN RAISE EXCEPTION 'Retired login was re-enabled'; END IF;
   RETURN jsonb_build_object('state','complete','changed',0);
 END IF;
 IF _phase='status' THEN RETURN jsonb_build_object('state',coalesce(journal->>'state','not_started')); END IF;
 IF NOT EXISTS(SELECT 1 FROM merge_history WHERE id='ca2e06b2-5098-4fea-bbb4-c2958e31a610')
   OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=old_login AND deleted_at IS NULL AND last_sign_in_at IS NULL)
   OR EXISTS(SELECT 1 FROM auth.sessions WHERE user_id=old_login)
   OR (SELECT count(*) FROM profiles WHERE user_id=old_login)<>1
   OR (journal IS NULL AND banned_until_value>now())
   OR has_role_v2(old_login,'admin') OR has_role_v2(old_login,'super_admin')
 THEN RAISE EXCEPTION 'Retirement prerequisite/security state changed'; END IF;
 IF journal IS NOT NULL AND (journal->'master_before' IS DISTINCT FROM m OR journal->'archived_before' IS DISTINCT FROM o)
 THEN RAISE EXCEPTION 'Retirement profile snapshot drift'; END IF;
 -- Old login may own only its archived alias and immutable actor/audit history.
 FOR dep IN SELECT DISTINCT c.table_name,c.column_name FROM information_schema.columns c
 JOIN information_schema.tables t USING(table_schema,table_name)
 WHERE c.table_schema='public' AND t.table_type='BASE TABLE' AND c.udt_name='uuid'
  AND c.table_name !~ '(^_|backup|_archive$)'
  AND c.column_name IN('user_id','owner_user_id','auth_user_id')
 LOOP
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I=$1',dep.table_name,dep.column_name) INTO n USING old_login;
  IF dep.table_name='profiles' AND dep.column_name='user_id' THEN
    IF n<>1 THEN RAISE EXCEPTION 'Old login profile count changed'; END IF;
  ELSIF dep.table_name IN('access_grant_ledger','consent_logs','email_logs','telegram_logs','audit_logs','merge_history','client_duplicates') THEN
    NULL; -- Historical actor references retain the original Auth UUID.
  ELSIF n<>0 THEN RAISE EXCEPTION 'Old login still owns live data %.%',dep.table_name,dep.column_name;
  END IF;
 END LOOP;
 IF _phase IN('preflight','prepare') THEN
  IF _phase='prepare' AND journal IS NULL THEN
   INSERT INTO merge_history(id,master_profile_id,merged_profile_id,merged_data)
   VALUES(journal_id,master_id,old_id,jsonb_build_object('state','prepared','operation','G10_retire_login',
     'master_before',m,'archived_before',o,'old_auth_user_id',old_login,'previous_banned_until',banned_until_value,
     'merged_profile_ids',jsonb_build_array(old_id),'merged_auth_user_ids','[]'::jsonb,'login_email_changed',false));
  END IF;
  RETURN jsonb_build_object('state','prepared','user_id',old_login,'ban_needed',banned_until_value IS NULL OR banned_until_value<=now());
 END IF;
 IF journal IS NULL OR banned_until_value IS NULL OR banned_until_value<=now()
 THEN RAISE EXCEPTION 'Admin API retirement required before completion'; END IF;
 UPDATE merge_history SET merged_data=journal||jsonb_build_object('state','complete','completed_at',now(),'old_login_disabled',true) WHERE id=journal_id;
 INSERT INTO audit_logs(action,actor_type,actor_label,target_user_id,meta)
 VALUES('MERGED_LOGIN_RETIRED','system','Owner-approved archived login consolidation',old_login,
  jsonb_build_object('merge_history_id',journal_id,'master_profile_id',master_id,'active_login_unchanged',true,'auth_deleted',false));
 RETURN jsonb_build_object('state','complete','changed',1);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_retire_merged_login_g10(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_retire_merged_login_g10(text) TO service_role;