-- One reviewed archived/active pair. Auth changes ONLY through the Admin API.
CREATE OR REPLACE FUNCTION public.admin_archived_login_merge_g9(_phase text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 master_id constant uuid:='955b4b96-0894-425f-a8ae-b2e3c1a78678';
 old_id constant uuid:='4ae8d7b7-f9ed-4402-b7fc-09786f2f2fb8';
 login_id constant uuid:='c466a856-d643-4f4a-b39a-f13e7d841822';
 journal_id constant uuid:='e7106778-29a7-4f04-bb94-32b488ee1909';
 m jsonb; o jsonb; journal jsonb; auth_email text; auth_confirmed timestamptz;
 login_banned timestamptz; login_deleted timestamptz; previous_email text; next_email text;
 dep record; n bigint; expected bigint;
BEGIN
 IF _phase NOT IN ('preflight','prepare','finish','status') THEN RAISE EXCEPTION 'Invalid merge phase'; END IF;
 PERFORM pg_advisory_xact_lock(71360009);
 PERFORM id FROM profiles WHERE id IN(master_id,old_id) ORDER BY id FOR UPDATE;
 SELECT to_jsonb(p) INTO m FROM profiles p WHERE id=master_id;
 SELECT to_jsonb(p) INTO o FROM profiles p WHERE id=old_id;
 SELECT merged_data INTO journal FROM merge_history WHERE id=journal_id FOR UPDATE;
 IF journal->>'state'='complete' THEN
  IF m->>'user_id' IS DISTINCT FROM login_id::text OR o->>'user_id' IS NOT NULL
    OR o->>'merged_to_profile_id' IS DISTINCT FROM master_id::text
    OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=login_id AND lower(btrim(email))=lower(btrim(m->>'email')))
  THEN RAISE EXCEPTION 'Completed login merge drift'; END IF;
  RETURN jsonb_build_object('state','complete','changed',0);
 END IF;
 IF _phase='status' THEN RETURN jsonb_build_object('state',coalesce(journal->>'state','not_started')); END IF;
 IF m IS NULL OR o IS NULL OR m->>'status' IS DISTINCT FROM 'active'
   OR coalesce((m->>'is_archived')::boolean,false) OR m->>'merged_to_profile_id' IS NOT NULL
   OR m->>'user_id' IS NOT NULL OR o->>'status' IS DISTINCT FROM 'archived'
   OR (o->>'is_archived')::boolean IS DISTINCT FROM true OR o->>'merged_to_profile_id' IS NOT NULL
   OR o->>'user_id' IS DISTINCT FROM login_id::text
   OR o->>'telegram_user_id' IS NOT NULL OR m->>'telegram_user_id' IS NOT NULL
   OR length(regexp_replace(coalesce(m->>'phone',''),'\D','','g'))<7
   OR regexp_replace(m->>'phone','\D','','g') IS DISTINCT FROM regexp_replace(o->>'phone','\D','','g')
 THEN RAISE EXCEPTION 'Reviewed phone identity changed'; END IF;
 next_email:=lower(btrim(m->>'email'));
 IF next_email IS NULL OR next_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   OR EXISTS(SELECT 1 FROM auth.users WHERE lower(btrim(email))=next_email AND id<>login_id)
   OR EXISTS(SELECT 1 FROM profiles WHERE lower(btrim(email))=next_email AND id<>master_id)
   OR (SELECT count(*) FROM profiles WHERE user_id=login_id)<>1
   OR has_role_v2(login_id,'admin') OR has_role_v2(login_id,'super_admin')
   OR EXISTS(SELECT 1 FROM auth.sessions WHERE user_id=login_id)
 THEN RAISE EXCEPTION 'Login collision or security state changed'; END IF;
 SELECT email,email_confirmed_at,banned_until,deleted_at INTO auth_email,auth_confirmed,login_banned,login_deleted
 FROM auth.users WHERE id=login_id;
 IF auth_email IS NULL OR auth_confirmed IS NOT NULL OR login_deleted IS NOT NULL
   OR login_banned>now() OR EXISTS(SELECT 1 FROM auth.users WHERE id=login_id AND last_sign_in_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Reviewed unused Auth state changed'; END IF;
 previous_email:=coalesce(journal->>'old_login_email',lower(btrim(o->>'email')));
 IF journal IS NOT NULL AND (journal->>'new_login_email' IS DISTINCT FROM next_email
   OR journal->'master_before' IS DISTINCT FROM m OR journal->'archived_before' IS DISTINCT FROM o)
 THEN RAISE EXCEPTION 'Prepared profile snapshot drift'; END IF;
 -- Only profiles.user_id is a current owner. A journal created by this function is allowed.
 FOR dep IN SELECT DISTINCT c.table_name,c.column_name FROM information_schema.columns c
 JOIN information_schema.tables t USING(table_schema,table_name)
 WHERE c.table_schema='public' AND t.table_type='BASE TABLE' AND c.udt_name='uuid'
   AND c.table_name !~ '(^_|backup|_archive$)'
   AND (c.column_name IN ('profile_id','user_id','contact_id','owner_profile_id','linked_profile_id','matched_profile_id','master_profile_id','merged_profile_id')
    OR EXISTS(SELECT 1 FROM pg_constraint fk JOIN pg_class rel ON rel.oid=fk.conrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace
     JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attnum=ANY(fk.conkey)
     WHERE fk.contype='f' AND fk.confrelid='public.profiles'::regclass
       AND ns.nspname=c.table_schema AND rel.relname=c.table_name AND att.attname=c.column_name))
 LOOP
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I=$1',dep.table_name,dep.column_name) INTO n USING old_id;
  expected:=CASE WHEN dep.table_name='merge_history' AND dep.column_name='merged_profile_id' AND journal IS NOT NULL THEN 1 ELSE 0 END;
  IF n<>expected THEN RAISE EXCEPTION 'New archived dependency %.%',dep.table_name,dep.column_name; END IF;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I=$1',dep.table_name,dep.column_name) INTO n USING login_id;
  expected:=CASE WHEN dep.table_name='profiles' AND dep.column_name='user_id' THEN 1 ELSE 0 END;
  IF n<>expected THEN RAISE EXCEPTION 'New login dependency %.%',dep.table_name,dep.column_name; END IF;
 END LOOP;
 IF _phase IN ('preflight','prepare') THEN
  IF lower(btrim(auth_email)) NOT IN(previous_email,next_email) THEN RAISE EXCEPTION 'Auth email drift'; END IF;
  IF _phase='prepare' AND journal IS NULL THEN
   IF lower(btrim(auth_email)) IS DISTINCT FROM previous_email THEN RAISE EXCEPTION 'Unexpected unjournaled Auth change'; END IF;
   INSERT INTO merge_history(id,master_profile_id,merged_profile_id,merged_data)
    VALUES(journal_id,master_id,old_id,jsonb_build_object('state','prepared','operation','G9_login',
      'old_login_email',previous_email,'new_login_email',next_email,'master_before',m,'archived_before',o,
      'merged_profile_ids',jsonb_build_array(old_id),'merged_auth_user_ids','[]'::jsonb,'rollback_strategy','auth_api_then_exact_profile_journal'));
  END IF;
  RETURN jsonb_build_object('state','prepared','user_id',login_id,'previous_email',previous_email,'next_email',next_email,
    'auth_update_needed',lower(btrim(auth_email))<>next_email);
 END IF;
 IF journal IS NULL OR lower(btrim(auth_email)) IS DISTINCT FROM next_email
 THEN RAISE EXCEPTION 'Auth update and journal required before finish'; END IF;
 UPDATE profiles SET user_id=NULL,merged_to_profile_id=master_id,duplicate_flag='none' WHERE id=old_id;
 UPDATE profiles SET user_id=login_id WHERE id=master_id;
 IF (SELECT to_jsonb(p)-ARRAY['user_id','updated_at'] FROM profiles p WHERE id=master_id) IS DISTINCT FROM(m-ARRAY['user_id','updated_at'])
  OR (SELECT to_jsonb(p)-ARRAY['user_id','merged_to_profile_id','duplicate_flag','updated_at'] FROM profiles p WHERE id=old_id)
     IS DISTINCT FROM(o-ARRAY['user_id','merged_to_profile_id','duplicate_flag','updated_at'])
 THEN RAISE EXCEPTION 'Unexpected profile merge side effect'; END IF;
 UPDATE merge_history SET merged_data=journal||jsonb_build_object('state','complete','completed_at',now(),'login_email_changed',true) WHERE id=journal_id;
 INSERT INTO audit_logs(action,actor_type,actor_label,target_user_id,meta)
 VALUES('CONTACT_MERGED','system','Owner-approved archived login merge',login_id,
  jsonb_build_object('merge_history_id',journal_id,'master_profile_id',master_id,'merged_profile_ids',jsonb_build_array(old_id),'can_unmerge',false,'login_email_changed',true,'payments_transferred',0));
 RETURN jsonb_build_object('state','complete','changed',1);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_archived_login_merge_g9(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_archived_login_merge_g9(text) TO service_role;