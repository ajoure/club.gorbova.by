-- Separate registration mode, reusing the reviewed contact/OTP/form/notification contracts.
-- No changes to existing questionnaire functions, auth, purchases or access rules.
DO $guard$
BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.save_site_questionnaire_contact(uuid,uuid,uuid,uuid,jsonb,text,uuid,text)'::regprocedure)) <> '61d3b07fce40e818440af270d404fd7f'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.submit_site_questionnaire(uuid,uuid,uuid,uuid,jsonb,text,text,uuid,text)'::regprocedure)) <> '8c5d623cb3c84fd7741ad3e893f6e593' THEN
  RAISE EXCEPTION 'webinar_registration_dependency_drift';
 END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION public.submit_site_webinar_registration(
 p_page_id uuid,p_block_id uuid,p_user_id uuid,p_submission_key uuid,p_fields jsonb,
 p_source_code text,p_consent_version text,p_journey_id uuid DEFAULT NULL,p_journey_key_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_content jsonb; v_existing site_form_submissions%ROWTYPE; v_result jsonb; v_profile uuid; v_event uuid; v_meta jsonb;
BEGIN
 -- The canonical contact function verifies email ownership, active profile,
 -- current published CMS schema, consent and journey ownership under its lock.
 PERFORM save_site_questionnaire_contact(p_page_id,p_block_id,p_user_id,p_submission_key,p_fields,p_consent_version,p_journey_id,p_journey_key_hash);
 SELECT b->'content' INTO STRICT v_content FROM site_pages p CROSS JOIN LATERAL jsonb_array_elements(p.blocks) b
  WHERE p.id=p_page_id AND p.status='published' AND b->>'id'=p_block_id::text AND b->>'type'='form';
 IF v_content->'webinar_registration' IS DISTINCT FROM 'true'::jsonb
  OR v_content->'deal_creation_enabled'='true'::jsonb
  OR v_content->'product_binding_enabled' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_array_length(v_content->'fields')<>4
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_content->'fields') f WHERE f->>'mapping' NOT IN ('first_name','last_name','email','phone') OR f->>'mapping' IS NULL)
  OR (SELECT count(DISTINCT f->>'mapping') FROM jsonb_array_elements(v_content->'fields') f)<>4 THEN
  RAISE EXCEPTION 'webinar_registration_configuration_invalid' USING ERRCODE='22023'; END IF;
 IF NOT site_questionnaire_telegram_link_ready(p_user_id) THEN
  RAISE EXCEPTION 'webinar_telegram_link_required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM products_v2 WHERE id=(v_content->>'product_id')::uuid AND is_active) THEN
  RAISE EXCEPTION 'webinar_product_unavailable' USING ERRCODE='22023'; END IF;
 v_event:=nullif(v_content->>'live_event_id','')::uuid;
 IF v_event IS NOT NULL AND NOT EXISTS(SELECT 1 FROM live_events WHERE id=v_event AND product_id=(v_content->>'product_id')::uuid) THEN
  RAISE EXCEPTION 'webinar_event_binding_invalid' USING ERRCODE='22023'; END IF;
 SELECT id INTO STRICT v_profile FROM profiles WHERE user_id=p_user_id;
 -- Revisit/reload is still one registration and one notification per person/form.
 SELECT * INTO v_existing FROM site_form_submissions WHERE page_id=p_page_id AND profile_id=v_profile AND status='processed'
  AND metadata->>'block_id'=p_block_id::text AND metadata->>'user_id'=p_user_id::text AND metadata->>'webinar_registration'='true'
  ORDER BY created_at,id LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('success',true,'submission_id',v_existing.id,'public_id',v_existing.public_id,'registered',true,'replayed',true); END IF;
 -- Canonical first name + surname. Never replace established CRM values.
 UPDATE profiles SET full_name=nullif(btrim(concat_ws(' ',nullif(btrim(first_name),''),nullif(btrim(last_name),''))),'')
  WHERE id=v_profile AND nullif(btrim(full_name),'') IS NULL;
 -- Preserve real journey UTM. Without a journey, do not inherit the CB21 campaign fallback.
 v_result:=submit_site_questionnaire(p_page_id,p_block_id,p_user_id,p_submission_key,p_fields,NULL,p_consent_version,p_journey_id,p_journey_key_hash);
 v_meta:=jsonb_build_object('webinar_registration',true,'live_event_id',v_event);
 SELECT metadata||v_meta INTO STRICT v_meta FROM site_form_submissions WHERE id=(v_result->>'submission_id')::uuid;
 v_meta:=v_meta||jsonb_build_object('source_code',coalesce(nullif(v_meta->>'source_code',''),nullif(p_source_code,''),'direct'),
  'source_label',coalesce(nullif(v_meta->>'source_label',''),'Регистрация на вебинар'),
  'utm_source',coalesce(nullif(v_meta->>'utm_source',''),nullif(p_source_code,''),'direct'),
  'utm_medium',coalesce(nullif(v_meta->>'utm_medium',''),'webinar'),
  'utm_campaign',coalesce(nullif(v_meta->>'utm_campaign',''),'webinar_registration'));
 UPDATE site_form_submissions SET metadata=metadata||v_meta WHERE id=(v_result->>'submission_id')::uuid;
 -- The canonical event and audit are enriched in this transaction before consumers can see them.
 UPDATE domain_events SET payload=payload||v_meta WHERE event_type='site_questionnaire_submitted' AND source='site-builder' AND entity_id=(v_result->>'submission_id')::uuid;
 UPDATE audit_logs SET meta=meta||v_meta WHERE action='site_questionnaire_submitted' AND entity_type='site_form_submission' AND entity_id=v_result->>'submission_id';
 RETURN v_result||jsonb_build_object('registered',true);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_site_webinar_registration(uuid,uuid,uuid,uuid,jsonb,text,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_site_webinar_registration(uuid,uuid,uuid,uuid,jsonb,text,text,uuid,text) TO service_role;
