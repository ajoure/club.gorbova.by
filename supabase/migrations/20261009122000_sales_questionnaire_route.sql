-- Configure the existing sales runtime; no new menu, recipient or message.
CREATE FUNCTION public.sales_configure_questionnaire_campaign(
 p_template uuid,p_actor uuid,p_page uuid,p_block uuid,p_phrase text,
 p_expected_route jsonb,p_expected_knowledge_version text
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE template public.sales_campaigns; customer public.sales_campaigns; route jsonb;
BEGIN
 IF NOT coalesce(public.has_role_v2(p_actor,'super_admin'),false)
  OR NOT coalesce(public.has_admin_section_access(p_actor,'communication','manage'),false) THEN RAISE EXCEPTION 'owner_required'; END IF;
 SELECT * INTO template FROM public.sales_campaigns WHERE id=p_template FOR UPDATE;
 IF NOT FOUND OR template.knowledge_version IS DISTINCT FROM p_expected_knowledge_version THEN RAISE EXCEPTION 'configuration_changed'; END IF;
 IF p_phrase IS NULL OR length(btrim(p_phrase)) NOT BETWEEN 8 AND 240 OR p_phrase~'[[:cntrl:]]' THEN RAISE EXCEPTION 'invalid_trigger_phrase'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.site_pages page WHERE page.id=p_page AND page.status='published'
   AND (SELECT count(*) FROM jsonb_array_elements(page.blocks) block WHERE block->>'id'=p_block::text AND block->>'type'='form')=1
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(page.blocks) block WHERE block->>'id'=p_block::text AND block->>'type'='form'
     AND block->'content'->'auth_mode'='true'::jsonb)) THEN RAISE EXCEPTION 'questionnaire_source_invalid'; END IF;
 SELECT * INTO customer FROM public.sales_campaigns WHERE bot_id=template.bot_id
   AND business_account_id=template.business_account_id AND test_user_id IS NULL FOR UPDATE;
 IF customer.id IS NULL THEN
   IF p_expected_route IS NOT NULL THEN RAISE EXCEPTION 'configuration_changed'; END IF;
   INSERT INTO public.sales_campaigns(code,bot_id,business_account_id,test_user_id,assignee_user_id,product_id,
     trigger_phrase,policy_version,knowledge_version,knowledge,ai_config,delay_min_seconds,delay_max_seconds,
     followup_min_seconds,followup_max_seconds,source_page_id,source_block_id)
   VALUES('questionnaire-'||template.id::text,template.bot_id,template.business_account_id,null,template.assignee_user_id,
     template.product_id,btrim(p_phrase),template.policy_version,template.knowledge_version,
     template.knowledge||jsonb_build_object('release_mode','questionnaire_customer','client_release_approved',false),
     template.ai_config,template.delay_min_seconds,template.delay_max_seconds,template.followup_min_seconds,
     template.followup_max_seconds,p_page,p_block) RETURNING * INTO customer;
   RETURN customer.id;
 END IF;
 route:=jsonb_build_object('id',customer.id,'page_id',customer.source_page_id,'block_id',customer.source_block_id,'trigger_phrase',customer.trigger_phrase);
 IF p_expected_route IS NULL AND customer.source_page_id=p_page AND customer.source_block_id=p_block
   AND customer.trigger_phrase=btrim(p_phrase) THEN RETURN customer.id; END IF;
 IF route IS DISTINCT FROM p_expected_route THEN RAISE EXCEPTION 'configuration_changed'; END IF;
 PERFORM id FROM public.sales_conversations WHERE campaign_id=customer.id ORDER BY id FOR UPDATE;
 IF customer.mode<>'off' OR EXISTS(SELECT 1 FROM public.sales_conversations WHERE campaign_id=customer.id AND NOT human_hold)
   OR EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id IN (SELECT id FROM public.sales_conversations WHERE campaign_id=customer.id)
     AND status IN ('sending','unknown')) THEN RAISE EXCEPTION 'disable_and_pause_required'; END IF;
 IF customer.source_page_id=p_page AND customer.source_block_id=p_block AND customer.trigger_phrase=btrim(p_phrase) THEN RETURN customer.id; END IF;
 UPDATE public.sales_campaigns SET source_page_id=p_page,source_block_id=p_block,trigger_phrase=btrim(p_phrase),enabled_at=null,
   knowledge=knowledge||jsonb_build_object('client_release_approved',false) WHERE id=customer.id;
 UPDATE public.sales_conversations SET revision=revision+1,started=false,state=CASE WHEN state IN ('STOPPED','DELIVERY_UNKNOWN') THEN state ELSE 'HUMAN_HOLD' END,
   reason='questionnaire_route_changed',updated_at=now() WHERE campaign_id=customer.id;
 UPDATE public.sales_jobs SET status='cancelled',reason='questionnaire_route_changed' WHERE conversation_id IN
   (SELECT id FROM public.sales_conversations WHERE campaign_id=customer.id) AND status IN ('queued','claimed');
 INSERT INTO public.sales_events(conversation_id,event,actor_id,details) SELECT id,'questionnaire_route_changed',p_actor,
   jsonb_build_object('before',route,'page_id',p_page,'block_id',p_block) FROM public.sales_conversations WHERE campaign_id=customer.id;
 RETURN customer.id;
END $$;
REVOKE ALL ON FUNCTION public.sales_configure_questionnaire_campaign(uuid,uuid,uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_configure_questionnaire_campaign(uuid,uuid,uuid,uuid,text,jsonb,text) TO service_role;

CREATE FUNCTION public.sales_campaign_configuration_ready(p_campaign uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.sales_campaigns p WHERE p.id=p_campaign AND p.mode='off'
   AND NOT EXISTS(SELECT 1 FROM public.sales_conversations c WHERE c.campaign_id=p.id
     AND (NOT c.human_hold OR (p.test_user_id IS NOT NULL AND c.state<>'HUMAN_HOLD')))
   AND NOT EXISTS(SELECT 1 FROM public.sales_jobs j JOIN public.sales_conversations c ON c.id=j.conversation_id
     WHERE c.campaign_id=p.id AND j.status IN ('sending','unknown')));
$$;
REVOKE ALL ON FUNCTION public.sales_campaign_configuration_ready(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_campaign_configuration_ready(uuid) TO service_role;
