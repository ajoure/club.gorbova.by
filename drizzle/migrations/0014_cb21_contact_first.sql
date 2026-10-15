-- Contact-first is opt-in on the existing form. No history backfill or learning grants.
-- Apply through Lovable Cloud from the reviewed merged GitHub artifact only.
DO $guard$
BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.submit_site_questionnaire(uuid,uuid,uuid,uuid,jsonb,text,text,uuid,text)'::regprocedure)) <> '8c5d623cb3c84fd7741ad3e893f6e593'
   OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.record_site_questionnaire_confirmation(uuid,uuid,uuid)'::regprocedure)) <> 'f4b08f05b42aaeecdcfd78bdbf1b6a10' THEN
   RAISE EXCEPTION 'questionnaire_contact_dependency_drift'; END IF;
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.site_questionnaire_funnel_stats(uuid,timestamptz,timestamptz)'::regprocedure)) NOT IN ('f3bf6885696fe748b39677a770b8f8ca','886c7d612b6e9a82a205adf5fa2f8125') THEN
   RAISE EXCEPTION 'questionnaire_contact_stats_drift'; END IF;
 IF to_regprocedure('public.save_site_questionnaire_contact(uuid,uuid,uuid,uuid,jsonb,text,uuid,text)') IS NOT NULL
   AND md5((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.save_site_questionnaire_contact(uuid,uuid,uuid,uuid,jsonb,text,uuid,text)'))) <> '61d3b07fce40e818440af270d404fd7f' THEN
   RAISE EXCEPTION 'questionnaire_contact_rpc_drift'; END IF;
END;
$guard$;
ALTER TABLE public.site_questionnaire_confirmations
 ADD COLUMN IF NOT EXISTS contact_saved_at timestamptz,
 ADD COLUMN IF NOT EXISTS contact_submission_key uuid,
 ADD COLUMN IF NOT EXISTS contact_journey_id uuid REFERENCES public.site_questionnaire_journeys(id);
CREATE INDEX IF NOT EXISTS site_questionnaire_confirmations_contact_journey ON public.site_questionnaire_confirmations(contact_journey_id,contact_saved_at)
 WHERE contact_saved_at IS NOT NULL;
CREATE OR REPLACE FUNCTION public.save_site_questionnaire_contact(
 p_page_id uuid,p_block_id uuid,p_user_id uuid,p_submission_key uuid,p_fields jsonb,p_consent_version text,
 p_journey_id uuid DEFAULT NULL,p_journey_key_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 v_profile public.profiles%ROWTYPE; v_content jsonb; v_fields jsonb; v_field jsonb; v_answer jsonb;
 v_email text; v_answer_email text; v_label text; v_value text; v_map text;
 v_values jsonb := '{}'; v_labels jsonb := '{}'; v_count integer; v_i integer; v_replayed boolean;
BEGIN
 IF p_page_id IS NULL OR p_block_id IS NULL OR p_user_id IS NULL OR p_submission_key IS NULL
   OR p_consent_version IS DISTINCT FROM 'v2026-04-10' THEN
   RAISE EXCEPTION 'questionnaire_request_invalid' USING ERRCODE='22023'; END IF;
 SELECT lower(btrim(email)) INTO v_email FROM auth.users WHERE id=p_user_id AND email_confirmed_at IS NOT NULL
   AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now());
 IF v_email IS NULL THEN RAISE EXCEPTION 'questionnaire_identity_invalid' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('site_questionnaire:'||p_user_id::text,0));
 SELECT * INTO v_profile FROM profiles WHERE user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR v_profile.status IS DISTINCT FROM 'active' OR coalesce(v_profile.is_archived,false)
   OR v_profile.merged_to_profile_id IS NOT NULL
   OR (nullif(btrim(v_profile.email),'') IS NOT NULL AND lower(btrim(v_profile.email))<>v_email) THEN
   RAISE EXCEPTION 'questionnaire_profile_unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM site_pages WHERE id=p_page_id AND status='published' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'questionnaire_page_unavailable' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO v_count FROM site_pages p CROSS JOIN LATERAL jsonb_array_elements(p.blocks) b
   WHERE p.id=p_page_id AND b->>'id'=p_block_id::text AND b->>'type'='form';
 IF v_count<>1 THEN RAISE EXCEPTION 'questionnaire_form_ambiguous' USING ERRCODE='22023'; END IF;
 SELECT b->'content' INTO v_content FROM site_pages p CROSS JOIN LATERAL jsonb_array_elements(p.blocks) b
   WHERE p.id=p_page_id AND b->>'id'=p_block_id::text AND b->>'type'='form';
 IF v_content->'auth_mode' IS DISTINCT FROM 'true'::jsonb OR v_content->'questionnaire_first' IS DISTINCT FROM 'true'::jsonb
   OR v_content->'contact_first' IS DISTINCT FROM 'true'::jsonb THEN
   RAISE EXCEPTION 'questionnaire_contact_mode_disabled' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(v_content->'fields') IS DISTINCT FROM 'array' OR jsonb_typeof(p_fields) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'questionnaire_fields_invalid' USING ERRCODE='22023'; END IF;
 SELECT jsonb_agg(f ORDER BY ord) INTO v_fields FROM jsonb_array_elements(v_content->'fields') WITH ORDINALITY AS x(f,ord)
   WHERE f->>'type' IN ('email','phone') OR f->>'mapping' IN ('full_name','first_name','last_name','email','phone','instagram','instagram_url');
 v_count:=coalesce(jsonb_array_length(v_fields),0);
 IF v_count<1 OR v_count>100 OR jsonb_array_length(p_fields)<>v_count THEN
   RAISE EXCEPTION 'questionnaire_fields_invalid' USING ERRCODE='22023'; END IF;
 FOR v_i IN 0..v_count-1 LOOP
   v_field:=v_fields->v_i; v_answer:=p_fields->v_i; v_label:=v_field->>'label'; v_map:=coalesce(v_field->>'mapping','none');
   IF coalesce(btrim(v_label),'')='' OR v_labels ? v_label OR coalesce(v_field->>'type','') NOT IN ('text','email','phone','textarea')
     OR v_answer->>'label' IS DISTINCT FROM v_label OR v_answer->>'type' IS DISTINCT FROM v_field->>'type'
     OR coalesce(v_answer->>'mapping','none') IS DISTINCT FROM v_map OR jsonb_typeof(v_answer->'value') IS DISTINCT FROM 'string' THEN
     RAISE EXCEPTION 'questionnaire_fields_invalid' USING ERRCODE='22023'; END IF;
   v_value:=btrim(v_answer->>'value'); v_labels:=v_labels||jsonb_build_object(v_label,true);
   IF (v_field->'required'='true'::jsonb AND v_value='') OR length(v_value)>1000 THEN
     RAISE EXCEPTION 'questionnaire_answer_invalid' USING ERRCODE='22023'; END IF;
   IF v_field->>'type'='phone' OR v_map='phone' THEN
     IF v_value<>'' AND (v_value !~ '^[+0-9[:space:]().-]+$' OR regexp_replace(v_value,'[^0-9+]','','g') !~ '^\+[0-9]{8,15}$') THEN
       RAISE EXCEPTION 'phone_invalid' USING ERRCODE='22023'; END IF;
     v_map:='phone';
   END IF;
   IF v_field->>'type'='email' OR v_map='email' THEN
     IF v_answer_email IS NOT NULL THEN RAISE EXCEPTION 'questionnaire_email_ambiguous' USING ERRCODE='22023'; END IF;
     v_answer_email:=lower(v_value); v_map:='email';
   END IF;
   IF v_map<>'none' THEN
     IF v_values ? v_map THEN RAISE EXCEPTION 'questionnaire_mapping_ambiguous' USING ERRCODE='22023'; END IF;
     v_values:=v_values||jsonb_build_object(v_map,v_value);
   END IF;
 END LOOP;
 IF v_answer_email IS DISTINCT FROM v_email THEN RAISE EXCEPTION 'questionnaire_email_mismatch' USING ERRCODE='42501'; END IF;
 IF (p_journey_id IS NULL) IS DISTINCT FROM (p_journey_key_hash IS NULL) THEN
   RAISE EXCEPTION 'journey_binding_invalid' USING ERRCODE='42501'; END IF;
 IF p_journey_id IS NOT NULL THEN
   PERFORM read_site_questionnaire_journey_attribution(p_journey_id,p_journey_key_hash,p_page_id,v_profile.id);
   PERFORM record_site_questionnaire_account_outcome(p_journey_id,p_journey_key_hash,p_user_id);
 END IF;
 -- Reuse the existing confirmation/reminder contract, preserving its first timestamp.
 PERFORM record_site_questionnaire_confirmation(p_page_id,p_block_id,p_user_id);
 SELECT contact_saved_at IS NOT NULL INTO v_replayed FROM site_questionnaire_confirmations
   WHERE page_id=p_page_id AND block_id=p_block_id AND user_id=p_user_id FOR UPDATE;
 IF v_replayed THEN RETURN jsonb_build_object('success',true,'contact_saved',true,'replayed',true); END IF;
 -- Only missing fields may be filled. Email ownership and Telegram identity are never replaced by form text.
 UPDATE profiles SET
   full_name=coalesce(nullif(btrim(full_name),''),nullif(v_values->>'full_name','')),
   first_name=coalesce(nullif(btrim(first_name),''),nullif(v_values->>'first_name','')),
   last_name=coalesce(nullif(btrim(last_name),''),nullif(v_values->>'last_name','')),
   phone=coalesce(nullif(btrim(phone),''),nullif(regexp_replace(v_values->>'phone','[^0-9+]','','g'),'')),
   instagram_url=coalesce(nullif(btrim(instagram_url),''),nullif(v_values->>'instagram_url',''),nullif(v_values->>'instagram','')),
   email=coalesce(nullif(btrim(email),''),v_email)
 WHERE id=v_profile.id;
 UPDATE site_questionnaire_confirmations SET contact_saved_at=now(),contact_submission_key=p_submission_key,contact_journey_id=p_journey_id
   WHERE page_id=p_page_id AND block_id=p_block_id AND user_id=p_user_id;
 INSERT INTO consent_logs(user_id,email,consent_type,policy_version,granted,source,meta)
   VALUES(p_user_id,v_email,'privacy_policy',p_consent_version,true,'site_questionnaire_contact',jsonb_build_object('page_id',p_page_id,'block_id',p_block_id));
 INSERT INTO audit_logs(action,actor_type,actor_user_id,actor_label,entity_type,entity_id,meta)
   VALUES('site_questionnaire_contact_saved','user',p_user_id,'site-form-submit','profile',v_profile.id::text,
     jsonb_build_object('page_id',p_page_id,'block_id',p_block_id,'submission_key',p_submission_key,'journey_id',p_journey_id));
 RETURN jsonb_build_object('success',true,'contact_saved',true,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.save_site_questionnaire_contact(uuid,uuid,uuid,uuid,jsonb,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_site_questionnaire_contact(uuid,uuid,uuid,uuid,jsonb,text,uuid,text) TO service_role;
-- Existing stats return contract and permission checks stay intact; contacts include early saves.
CREATE OR REPLACE FUNCTION public.site_questionnaire_funnel_stats(p_page_id uuid,p_from timestamptz,p_to timestamptz)
RETURNS TABLE(attribution jsonb,visits bigint,visitors bigint,questionnaires bigint,contacts bigint,new_accounts bigint,existing_accounts bigint,unclassified_accounts bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_resource_access(auth.uid(),'forms-hub','site','view') THEN
    RAISE EXCEPTION 'questionnaire_stats_forbidden' USING ERRCODE='42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to<=p_from OR p_to-p_from>interval '366 days' THEN
    RAISE EXCEPTION 'questionnaire_stats_range_invalid' USING ERRCODE='22023'; END IF;
  RETURN QUERY WITH selected AS (
    SELECT j.* FROM site_questionnaire_journeys j WHERE j.page_id=p_page_id
  ), per_journey AS (
    SELECT j.id,j.attribution,j.profile_id,j.account_outcome,j.outcome_at,
      (SELECT count(*) FROM site_questionnaire_visits v WHERE v.journey_id=j.id AND v.seen_at>=p_from AND v.seen_at<p_to) visit_count,
      (SELECT count(*) FROM site_form_submissions s WHERE s.page_id=p_page_id AND s.status='processed'
        AND s.metadata->>'journey_id'=j.id::text AND s.created_at>=p_from AND s.created_at<p_to) form_count,
      EXISTS(SELECT 1 FROM site_questionnaire_confirmations c WHERE c.page_id=p_page_id AND c.contact_journey_id=j.id
        AND c.contact_saved_at>=p_from AND c.contact_saved_at<p_to) contact_saved
    FROM selected j
  ) SELECT j.attribution,sum(j.visit_count)::bigint,count(*) FILTER(WHERE j.visit_count>0)::bigint,sum(j.form_count)::bigint,
    count(DISTINCT j.profile_id) FILTER(WHERE j.form_count>0 OR j.contact_saved)::bigint,
    count(DISTINCT j.profile_id) FILTER(WHERE j.account_outcome='new_account' AND j.outcome_at>=p_from AND j.outcome_at<p_to)::bigint,
    count(DISTINCT j.profile_id) FILTER(WHERE j.account_outcome='existing_account' AND j.outcome_at>=p_from AND j.outcome_at<p_to)::bigint,
    count(DISTINCT j.profile_id) FILTER(WHERE j.account_outcome IS NULL AND j.form_count>0)::bigint
    FROM per_journey j GROUP BY j.attribution HAVING sum(j.visit_count)+sum(j.form_count)+count(*) FILTER(WHERE j.contact_saved)+count(*) FILTER(WHERE j.outcome_at>=p_from AND j.outcome_at<p_to)>0 ORDER BY sum(j.visit_count) DESC;
END;
$$;
