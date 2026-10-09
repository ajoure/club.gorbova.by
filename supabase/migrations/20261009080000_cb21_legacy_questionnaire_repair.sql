-- Installs a bounded managed repair, but does not change any production rows.
-- Old forms retain their origin; they must never be labelled questionnaire_first.
CREATE OR REPLACE FUNCTION public.repair_cb21_legacy_questionnaires(p_execute boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_page constant uuid := 'c8c5c19a-a10d-4f6b-8049-449f37230ed0';
  v_block constant uuid := '7f144dcc-1a71-4225-8399-efd4d91502cd';
  v_product constant uuid := '0c98e21a-5300-4cfb-ac82-51c2d6184650';
  v_tariff constant uuid := '1a7bf501-c654-46d3-8665-1febd7eb59eb';
  v_bot constant uuid := '1a560e98-574e-4fd9-82ab-4b7bbdc300b4';
  v_ids uuid[]; v_orders uuid[]; v_users uuid[]; v_content jsonb; v_mapping jsonb; v_keys text[];
  v_s public.site_form_submissions%ROWTYPE; v_p public.profiles%ROWTYPE; v_o public.orders_v2%ROWTYPE;
  v_email text; v_label text; v_count integer; v_histories integer := 0; v_changed_orders integer := 0; v_grants integer := 0;
BEGIN
  IF p_execute IS NULL THEN RAISE EXCEPTION 'legacy_repair_mode_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cb21_legacy_questionnaire_repair',0));
  SELECT b->'content' INTO v_content FROM site_pages p, jsonb_array_elements(p.blocks) b
    WHERE p.id=v_page AND p.status='published' AND b->>'id'=v_block::text AND b->>'type'='form';
  IF v_content IS NULL OR jsonb_typeof(v_content->'fields') IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_content->'fields')<>15 THEN RAISE EXCEPTION 'legacy_repair_schema_changed'; END IF;
  SELECT array_agg(f->>'label' ORDER BY f->>'label'),
    coalesce(jsonb_object_agg(f->>'label',f->>'mapping') FILTER(WHERE coalesce(f->>'mapping','none')<>'none'),'{}')
    INTO v_keys,v_mapping FROM jsonb_array_elements(v_content->'fields') f;
  IF cardinality(v_keys)<>15 OR (SELECT count(DISTINCT k) FROM unnest(v_keys) k)<>15
    OR (SELECT count(*) FROM jsonb_object_keys(v_mapping))<>5 THEN RAISE EXCEPTION 'legacy_repair_schema_changed'; END IF;
  SELECT key INTO v_label FROM jsonb_each_text(v_mapping) WHERE value='email';
  IF v_label IS NULL OR (SELECT count(*) FROM jsonb_each_text(v_mapping) WHERE value='email')<>1
    THEN RAISE EXCEPTION 'legacy_repair_email_mapping'; END IF;
  IF NOT EXISTS(SELECT 1 FROM products_v2 WHERE id=v_product AND is_active)
    OR NOT EXISTS(SELECT 1 FROM tariffs WHERE id=v_tariff AND product_id=v_product AND is_active)
    THEN RAISE EXCEPTION 'legacy_repair_product_changed'; END IF;
  -- Lock the exact historical cohort; later submissions are outside this repair.
  PERFORM 1 FROM site_form_submissions WHERE page_id=v_page AND source='site_form_auth'
    AND created_at>='2026-10-08 00:00:00+00' AND created_at<'2026-10-09 00:00:00+00' FOR UPDATE;
  SELECT array_agg(id ORDER BY id),array_agg(DISTINCT order_id),array_agg(DISTINCT profile_id)
    INTO v_ids,v_orders,v_users FROM site_form_submissions WHERE page_id=v_page AND source='site_form_auth'
    AND created_at>='2026-10-08 00:00:00+00' AND created_at<'2026-10-09 00:00:00+00';
  IF cardinality(v_ids) IS DISTINCT FROM 2 OR cardinality(v_orders) IS DISTINCT FROM 1
    OR cardinality(v_users) IS DISTINCT FROM 1 OR v_orders[1] IS NULL OR v_users[1] IS NULL
    THEN RAISE EXCEPTION 'legacy_repair_candidate_count_changed'; END IF;
  SELECT * INTO v_p FROM profiles WHERE id=v_users[1] FOR UPDATE;
  SELECT lower(btrim(email)) INTO v_email FROM auth.users WHERE id=v_p.user_id
    AND email_confirmed_at IS NOT NULL AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()) FOR SHARE;
  IF v_p.status IS DISTINCT FROM 'active' OR coalesce(v_p.is_archived,false)
    OR v_p.merged_to_profile_id IS NOT NULL OR v_email IS NULL THEN RAISE EXCEPTION 'legacy_repair_identity_changed'; END IF;
  SELECT * INTO v_o FROM orders_v2 WHERE id=v_orders[1] FOR UPDATE;
  IF NOT FOUND OR v_o.profile_id IS DISTINCT FROM v_p.id OR (v_o.user_id IS NOT NULL AND v_o.user_id<>v_p.user_id)
    OR v_o.status IS DISTINCT FROM 'draft' OR coalesce(v_o.is_deleted,false)
    OR coalesce(v_o.base_price,0)<>0 OR coalesce(v_o.final_price,0)<>0 OR coalesce(v_o.paid_amount,0)<>0
    OR (v_o.product_id IS NOT NULL AND v_o.product_id<>v_product) OR (v_o.tariff_id IS NOT NULL AND v_o.tariff_id<>v_tariff)
    OR EXISTS(SELECT 1 FROM payments_v2 WHERE order_id=v_o.id)
    THEN RAISE EXCEPTION 'legacy_repair_order_changed'; END IF;
  LOCK TABLE crm_pipeline_automation_rules IN SHARE MODE;
  IF EXISTS(SELECT 1 FROM crm_pipeline_automation_rules WHERE pipeline_id=v_o.pipeline_id
    AND stage_id=v_o.pipeline_stage_id AND status='active' AND trigger_type='deal_field_changed')
    THEN RAISE EXCEPTION 'legacy_repair_automation_changed'; END IF;
  FOR v_s IN SELECT * FROM site_form_submissions WHERE id=ANY(v_ids) ORDER BY id LOOP
    IF v_s.status IS DISTINCT FROM 'processed' OR v_s.metadata->>'auth_mode' IS DISTINCT FROM 'true'
      OR v_s.metadata ? 'questionnaire_first' OR v_s.metadata->>'user_id' IS DISTINCT FROM v_p.user_id::text
      OR v_s.field_mapping IS DISTINCT FROM v_mapping
      OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_s.form_data) k) IS DISTINCT FROM v_keys
      OR lower(btrim(v_s.form_data->>v_label)) IS DISTINCT FROM v_email
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_content->'fields') f
        WHERE jsonb_typeof(v_s.form_data->(f->>'label')) IS DISTINCT FROM 'string'
          OR (f->'required'='true'::jsonb AND btrim(v_s.form_data->>(f->>'label'))=''))
      OR (v_s.metadata ? 'block_id' AND v_s.metadata->>'block_id' IS DISTINCT FROM v_block::text)
      OR (v_s.metadata ? 'product_id' AND v_s.metadata->>'product_id' IS DISTINCT FROM v_product::text)
      OR (v_s.metadata ? 'tariff_id' AND v_s.metadata->>'tariff_id' IS DISTINCT FROM v_tariff::text)
      OR (v_s.metadata ? 'legacy_bonus_verified' AND v_s.metadata->>'legacy_bonus_verified' IS DISTINCT FROM 'cb21-2026-10-08-v1')
      THEN RAISE EXCEPTION 'legacy_repair_submission_changed'; END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM site_questionnaire_bonus_channels WHERE page_id=v_page AND block_id=v_block
    AND bot_id=v_bot AND channel_id=-1002091043395 AND is_enabled)
    OR EXISTS(SELECT 1 FROM telegram_clubs WHERE channel_id=-1002091043395 OR chat_id=-1002091043395)
    THEN RAISE EXCEPTION 'legacy_repair_bonus_route_unavailable'; END IF;
  SELECT count(*) INTO v_histories FROM site_form_submissions WHERE id=ANY(v_ids)
    AND metadata->>'legacy_bonus_verified' IS DISTINCT FROM 'cb21-2026-10-08-v1';
  v_changed_orders := CASE WHEN v_o.product_id IS DISTINCT FROM v_product OR v_o.tariff_id IS DISTINCT FROM v_tariff THEN 1 ELSE 0 END;
  v_grants := CASE WHEN EXISTS(SELECT 1 FROM site_questionnaire_bonus_channel_grants
    WHERE bot_id=v_bot AND channel_id=-1002091043395 AND user_id=v_p.user_id) THEN 0 ELSE 1 END;
  IF NOT p_execute THEN RETURN jsonb_build_object('dry_run',true,'histories',v_histories,'orders',v_changed_orders,'bonus_grants',v_grants); END IF;
  UPDATE site_form_submissions SET metadata=metadata || jsonb_build_object('block_id',v_block,'product_id',v_product,
    'tariff_id',v_tariff,'legacy_bonus_verified','cb21-2026-10-08-v1') WHERE id=ANY(v_ids)
    AND metadata->>'legacy_bonus_verified' IS DISTINCT FROM 'cb21-2026-10-08-v1';
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>v_histories THEN RAISE EXCEPTION 'legacy_repair_history_rowcount'; END IF;
  UPDATE orders_v2 SET product_id=v_product,tariff_id=v_tariff WHERE id=v_o.id
    AND (product_id IS DISTINCT FROM v_product OR tariff_id IS DISTINCT FROM v_tariff);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>v_changed_orders THEN RAISE EXCEPTION 'legacy_repair_order_rowcount'; END IF;
  -- Any unexpected trigger side effect must roll back the complete repair.
  IF (SELECT to_jsonb(o)-'product_id'-'tariff_id'-'updated_at' FROM orders_v2 o WHERE id=v_o.id)
    IS DISTINCT FROM (to_jsonb(v_o)-'product_id'-'tariff_id'-'updated_at') THEN
    RAISE EXCEPTION 'legacy_repair_order_side_effect';
  END IF;
  INSERT INTO site_questionnaire_bonus_channel_grants(bot_id,channel_id,user_id,submission_id)
    VALUES(v_bot,-1002091043395,v_p.user_id,v_ids[1]) ON CONFLICT(bot_id,channel_id,user_id) DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>v_grants THEN RAISE EXCEPTION 'legacy_repair_grant_rowcount'; END IF;
  IF v_histories+v_changed_orders+v_grants>0 THEN
    INSERT INTO audit_logs(action,actor_type,actor_label,entity_type,entity_id,meta)
      VALUES('site_questionnaire.legacy_repaired','system','managed-deployment','site_page',v_page::text,
        jsonb_build_object('histories',v_histories,'orders',v_changed_orders,'bonus_grants',v_grants,'purchases_changed',0,'origin_preserved',true));
  END IF;
  RETURN jsonb_build_object('dry_run',false,'histories',v_histories,'orders',v_changed_orders,'bonus_grants',v_grants);
END;
$$;
REVOKE ALL ON FUNCTION public.repair_cb21_legacy_questionnaires(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.repair_cb21_legacy_questionnaires(boolean) TO service_role;
