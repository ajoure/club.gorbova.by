-- Service-only proof of the existing primary support-bot binding.
CREATE OR REPLACE FUNCTION public.site_questionnaire_telegram_link_ready(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM profiles p JOIN telegram_bots b ON b.id=p.telegram_link_bot_id
    WHERE p.user_id=p_user_id AND p.status='active' AND NOT coalesce(p.is_archived,false)
      AND p.merged_to_profile_id IS NULL AND p.telegram_user_id IS NOT NULL
      AND p.telegram_link_status='active' AND b.is_primary AND b.status='active'
      AND EXISTS(SELECT 1 FROM telegram_access_audit a WHERE a.user_id=p.user_id
        AND a.telegram_user_id=p.telegram_user_id AND a.event_type IN ('telegram_link_confirmed','telegram_relink')
        AND a.meta->>'bot_id'=b.id::text AND a.created_at>=p.telegram_linked_at-interval '5 seconds'));
$$;
REVOKE ALL ON FUNCTION public.site_questionnaire_telegram_link_ready(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.site_questionnaire_telegram_link_ready(uuid) TO service_role;

-- Questionnaire-first submission is a service-only transaction. It never pays
-- an order or grants commercial access. All routing comes from a published page.
CREATE UNIQUE INDEX IF NOT EXISTS site_form_questionnaire_submission_key
ON public.site_form_submissions (page_id, (metadata->>'block_id'), (metadata->>'user_id'), (metadata->>'submission_key'))
WHERE metadata->>'questionnaire_first' = 'true';

CREATE OR REPLACE FUNCTION public.submit_site_questionnaire(
  p_page_id uuid, p_block_id uuid, p_user_id uuid, p_submission_key uuid,
  p_fields jsonb, p_source_code text, p_consent_version text,
  p_journey_id uuid DEFAULT NULL, p_journey_key_hash text DEFAULT NULL
) RETURNS jsonb
-- Managed production service_role cannot SELECT auth.users directly. This
-- narrowly scoped function runs as its migration owner, with only service_role
-- allowed to call it; verified identity and routing are rechecked below.
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_page public.site_pages%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_existing public.site_form_submissions%ROWTYPE;
  v_block jsonb; v_content jsonb; v_field jsonb; v_answer jsonb;
  v_data jsonb := '{}'; v_mapping jsonb := '{}'; v_values jsonb := '{}';
  v_meta jsonb; v_attribution jsonb := '{}';
  v_label text; v_value text; v_map text; v_email text; v_answer_email text;
  v_source_label text; v_source text; v_i integer; v_count integer;
  v_product uuid; v_tariff uuid; v_pipeline uuid; v_stage uuid; v_offer uuid;
  v_base numeric := 0; v_final numeric := 0; v_order uuid; v_number text;
  v_submission uuid; v_public_id text; v_event uuid; v_order_reused boolean := false;
BEGIN
  IF p_page_id IS NULL OR p_block_id IS NULL OR p_user_id IS NULL OR p_submission_key IS NULL
     OR p_consent_version IS DISTINCT FROM 'v2026-04-10' THEN
    RAISE EXCEPTION 'questionnaire_request_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT lower(btrim(email)) INTO v_email FROM auth.users
  WHERE id = p_user_id AND email_confirmed_at IS NOT NULL AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until <= now());
  IF v_email IS NULL THEN RAISE EXCEPTION 'questionnaire_identity_invalid' USING ERRCODE = '42501'; END IF;

  -- Serialize both submission retries and draft order reuse for this contact.
  PERFORM pg_advisory_xact_lock(hashtextextended('site_questionnaire:' || p_user_id::text, 0));
  SELECT * INTO v_profile FROM public.profiles WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_profile.status IS DISTINCT FROM 'active' OR coalesce(v_profile.is_archived, false)
     OR v_profile.merged_to_profile_id IS NOT NULL THEN
    RAISE EXCEPTION 'questionnaire_profile_unavailable' USING ERRCODE = '42501';
  END IF;
  IF NOT public.site_questionnaire_telegram_link_ready(p_user_id) THEN
    RAISE EXCEPTION 'questionnaire_telegram_link_required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_page FROM public.site_pages WHERE id = p_page_id AND status = 'published' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'questionnaire_page_unavailable' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO v_count FROM jsonb_array_elements(v_page.blocks) b
    WHERE b->>'id' = p_block_id::text AND b->>'type' = 'form';
  IF v_count <> 1 THEN RAISE EXCEPTION 'questionnaire_form_ambiguous' USING ERRCODE = '22023'; END IF;
  SELECT b INTO v_block FROM jsonb_array_elements(v_page.blocks) b WHERE b->>'id' = p_block_id::text AND b->>'type' = 'form';
  v_content := v_block->'content';
  IF v_content->'questionnaire_first' IS DISTINCT FROM 'true'::jsonb OR v_content->'auth_mode' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'questionnaire_mode_disabled' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'array' OR jsonb_typeof(v_content->'fields') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'questionnaire_fields_invalid' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(v_content->'fields');
  IF v_count < 1 OR v_count > 100 OR jsonb_array_length(p_fields) <> v_count THEN
    RAISE EXCEPTION 'questionnaire_fields_invalid' USING ERRCODE = '22023';
  END IF;
  FOR v_i IN 0..v_count-1 LOOP
    v_field := v_content->'fields'->v_i; v_answer := p_fields->v_i;
    v_label := v_field->>'label'; v_map := coalesce(v_field->>'mapping', 'none');
    IF coalesce(btrim(v_label), '') = '' OR v_data ? v_label
       OR coalesce(v_field->>'type', '') NOT IN ('text','email','phone','textarea')
       OR v_answer->>'label' IS DISTINCT FROM v_label
       OR v_answer->>'type' IS DISTINCT FROM v_field->>'type'
       OR coalesce(v_answer->>'mapping', 'none') IS DISTINCT FROM v_map
       OR jsonb_typeof(v_answer->'value') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'questionnaire_fields_invalid' USING ERRCODE = '22023';
    END IF;
    v_value := btrim(v_answer->>'value');
    IF (v_field->'required' = 'true'::jsonb AND v_value = '')
       OR length(v_value) > (CASE WHEN v_field->>'type' = 'textarea' THEN 10000 ELSE 1000 END) THEN
      RAISE EXCEPTION 'questionnaire_answer_invalid' USING ERRCODE = '22023';
    END IF;
    v_data := v_data || jsonb_build_object(v_label, v_value);
    IF v_map <> 'none' THEN
      IF v_values ? v_map THEN RAISE EXCEPTION 'questionnaire_mapping_ambiguous' USING ERRCODE = '22023'; END IF;
      v_mapping := v_mapping || jsonb_build_object(v_label, v_map);
      v_values := v_values || jsonb_build_object(v_map, v_value);
    END IF;
    IF v_field->>'type' = 'email' OR v_map = 'email' THEN
      IF v_answer_email IS NOT NULL THEN RAISE EXCEPTION 'questionnaire_email_ambiguous' USING ERRCODE = '22023'; END IF;
      v_answer_email := lower(v_value);
    END IF;
  END LOOP;
  IF v_answer_email IS DISTINCT FROM v_email THEN RAISE EXCEPTION 'questionnaire_email_mismatch' USING ERRCODE = '42501'; END IF;

  IF (p_journey_id IS NULL) IS DISTINCT FROM (p_journey_key_hash IS NULL) THEN
    RAISE EXCEPTION 'journey_binding_invalid' USING ERRCODE='42501'; END IF;
  IF p_journey_id IS NOT NULL THEN
    v_attribution := public.read_site_questionnaire_journey_attribution(p_journey_id,p_journey_key_hash,p_page_id,v_profile.id);
  END IF;
  SELECT * INTO v_existing FROM public.site_form_submissions WHERE page_id = p_page_id
    AND metadata->>'questionnaire_first' = 'true' AND metadata->>'block_id' = p_block_id::text
    AND metadata->>'user_id' = p_user_id::text AND metadata->>'submission_key' = p_submission_key::text;
  IF FOUND THEN
    IF v_existing.form_data IS DISTINCT FROM v_data OR v_existing.profile_id IS DISTINCT FROM v_profile.id
      OR v_existing.metadata->>'journey_id' IS DISTINCT FROM p_journey_id::text THEN
      RAISE EXCEPTION 'questionnaire_retry_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('success',true,'submission_id',v_existing.id,'public_id',v_existing.public_id,'order_id',v_existing.order_id,'replayed',true);
  END IF;
  SELECT label, source INTO v_source_label, v_source FROM (VALUES
    ('main_channel','Основной канал','telegram'), ('questionnaire_channel','Канал анкеты','telegram'),
    ('extra_channel','Дополнительный канал','telegram'), ('email','Почта','email'), ('bot','Бот','telegram'),
    ('stories','Сторис','instagram'), ('bio','Шапка профиля','instagram'), ('club','Клуб','club'),
    ('reels','Рилс','instagram'), ('direct','Директ','instagram')
  ) s(code,label,source) WHERE code = p_source_code;
  IF v_source_label IS NOT NULL THEN v_attribution := jsonb_build_object('source_code',p_source_code,'source_label',v_source_label,
    'utm_source',v_source,'utm_medium',p_source_code,'utm_campaign','cb21_preregistration') || v_attribution; END IF;

  -- Contact answers fill missing fields only; existing login/contact data and
  -- Telegram identity are never overwritten by questionnaire text.
  IF v_profile.full_name IS NULL OR v_profile.phone IS NULL THEN
    UPDATE public.profiles SET
    full_name = coalesce(full_name, nullif(v_values->>'full_name','')),
    phone = coalesce(phone, CASE WHEN regexp_replace(coalesce(v_values->>'phone',''), '[^0-9]', '', 'g') ~ '^[0-9]{9,15}$'
      THEN regexp_replace(v_values->>'phone', '[^0-9+]', '', 'g') ELSE NULL END)
    WHERE id = v_profile.id RETURNING * INTO v_profile;
  END IF;

  IF v_content->'product_binding_enabled' = 'true'::jsonb THEN
    v_product := nullif(v_content->>'product_id','')::uuid; v_tariff := nullif(v_content->>'tariff_id','')::uuid;
    IF v_product IS NULL OR NOT EXISTS (SELECT 1 FROM public.products_v2 WHERE id = v_product AND is_active) THEN
      RAISE EXCEPTION 'questionnaire_product_unavailable' USING ERRCODE = '22023';
    END IF;
    IF v_tariff IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tariffs WHERE id = v_tariff AND product_id = v_product AND is_active) THEN
      RAISE EXCEPTION 'questionnaire_tariff_unavailable' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_content->'deal_creation_enabled' = 'true'::jsonb THEN
    v_pipeline := nullif(v_content->>'pipeline_id','')::uuid; v_stage := nullif(v_content->>'pipeline_stage_id','')::uuid;
    IF v_pipeline IS NULL OR v_stage IS NULL OR NOT EXISTS (SELECT 1 FROM public.crm_pipelines WHERE id = v_pipeline)
      OR NOT EXISTS (SELECT 1 FROM public.crm_pipeline_stages WHERE id = v_stage AND pipeline_id = v_pipeline) THEN
      RAISE EXCEPTION 'questionnaire_pipeline_unavailable' USING ERRCODE = '22023';
    END IF;
    SELECT id, order_number INTO v_order, v_number FROM public.orders_v2 WHERE profile_id = v_profile.id
      AND reconcile_source = 'site_form' AND status IN ('draft','pending') AND NOT is_deleted
      AND product_id IS NOT DISTINCT FROM v_product AND tariff_id IS NOT DISTINCT FROM v_tariff
      AND pipeline_id IS NOT DISTINCT FROM v_pipeline AND pipeline_stage_id IS NOT DISTINCT FROM v_stage
      ORDER BY created_at, id LIMIT 1 FOR UPDATE;
    v_order_reused := FOUND;
    IF v_order IS NULL THEN
      IF v_tariff IS NOT NULL THEN
        SELECT id, coalesce(base_price,0), coalesce(final_price,0) INTO v_offer,v_base,v_final
        FROM public.tariff_offers WHERE tariff_id = v_tariff AND is_active AND is_primary ORDER BY id LIMIT 1;
      END IF;
      v_number := public.generate_order_number();
      INSERT INTO public.orders_v2 (order_number,profile_id,user_id,product_id,tariff_id,offer_id,base_price,final_price,currency,
        status,reconcile_source,pipeline_id,pipeline_stage_id,customer_email,customer_phone,meta)
      VALUES (v_number,v_profile.id,p_user_id,v_product,v_tariff,v_offer,coalesce(v_base,0),coalesce(v_final,0),'BYN',
        'draft','site_form',v_pipeline,v_stage,v_email,v_profile.phone,
        jsonb_build_object('page_id',p_page_id,'block_id',p_block_id,'source','site_form','questionnaire_first',true) || v_attribution)
      RETURNING id INTO v_order;
    END IF;
  END IF;
  v_meta := jsonb_build_object('auth_mode',true,'questionnaire_first',true,'page_id',p_page_id,'workspace_id',v_page.workspace_id,'block_id',p_block_id,'user_id',p_user_id,
    'submission_key',p_submission_key,'product_id',v_product,'tariff_id',v_tariff,'pipeline_id',v_pipeline,'pipeline_stage_id',v_stage) || v_attribution;
  INSERT INTO public.site_form_submissions (public_id,workspace_id,page_id,profile_id,order_id,form_data,field_mapping,status,source,metadata)
  VALUES ('',v_page.workspace_id,p_page_id,v_profile.id,v_order,v_data,v_mapping,'processed','site_form_auth',v_meta)
  RETURNING id,public_id INTO v_submission,v_public_id;
  IF p_journey_id IS NOT NULL THEN
    PERFORM public.bind_site_questionnaire_journey(p_journey_id,p_journey_key_hash,v_submission);
  END IF;
  INSERT INTO public.consent_logs (user_id,email,consent_type,policy_version,granted,source,meta)
  VALUES (p_user_id,v_email,'privacy_policy',p_consent_version,true,'site_questionnaire',jsonb_build_object('submission_id',v_submission,'page_id',p_page_id));
  INSERT INTO public.domain_events (event_type,source,entity_id,payload)
  VALUES ('site_questionnaire_submitted','site-builder',v_submission,v_meta || jsonb_build_object('submission_id',v_submission,'profile_id',v_profile.id,'order_id',v_order))
  RETURNING id INTO v_event;
  INSERT INTO public.domain_executions (event_id,step,status,attempt)
  VALUES (v_event,CASE WHEN v_order IS NULL THEN 'submission_saved' WHEN v_order_reused THEN 'reuse_order' ELSE 'create_order' END,'success',1);
  INSERT INTO public.audit_logs (action,actor_type,actor_user_id,actor_label,entity_type,entity_id,meta)
  VALUES ('site_questionnaire_submitted','user',p_user_id,'site-form-submit','site_form_submission',v_submission::text,
    v_meta || jsonb_build_object('profile_id',v_profile.id,'order_id',v_order,'order_reused',v_order_reused));
  RETURN jsonb_build_object('success',true,'submission_id',v_submission,'public_id',v_public_id,'order_id',v_order,'event_id',v_event,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_site_questionnaire(uuid,uuid,uuid,uuid,jsonb,text,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_site_questionnaire(uuid,uuid,uuid,uuid,jsonb,text,text,uuid,text) TO service_role;
