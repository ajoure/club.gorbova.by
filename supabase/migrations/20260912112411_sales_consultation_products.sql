-- Uses existing campaign knowledge and product settings; no product ID or price
-- is embedded in runtime or this migration. The owner selects consultation scope.
CREATE OR REPLACE FUNCTION public.sales_configure_knowledge_products(p_campaign uuid,p_actor uuid,p_ids jsonb,p_expected jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.sales_campaigns; c public.sales_conversations; item text;
BEGIN
 IF NOT public.has_role_v2(p_actor,'super_admin') OR NOT public.has_admin_section_access(p_actor,'communication','manage') THEN RAISE EXCEPTION 'owner_required'; END IF;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=p_campaign FOR UPDATE;
 SELECT * INTO c FROM public.sales_conversations WHERE campaign_id=p.id FOR UPDATE;
 IF p.id IS NULL OR coalesce(p.knowledge->'consultation_product_ids','[]') IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'knowledge_configuration_changed'; END IF;
 IF p.mode<>'off' OR NOT coalesce(c.human_hold,false) OR EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id=c.id AND status IN ('sending','unknown')) THEN RAISE EXCEPTION 'disable_and_pause_required'; END IF;
 IF jsonb_typeof(p_ids) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_consultation_products'; END IF;
 IF jsonb_array_length(p_ids)>20 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(p_ids))<>jsonb_array_length(p_ids) THEN RAISE EXCEPTION 'invalid_consultation_products'; END IF;
 FOR item IN SELECT jsonb_array_elements_text(p_ids) LOOP
  IF item IS NULL OR item !~* '^[0-9a-f-]{36}$' OR NOT EXISTS(SELECT 1 FROM public.products_v2 WHERE id=item::uuid AND is_active AND status='active') THEN RAISE EXCEPTION 'consultation_product_unavailable'; END IF;
 END LOOP;
 UPDATE public.sales_campaigns SET knowledge=jsonb_set(knowledge,'{consultation_product_ids}',p_ids) WHERE id=p.id;
 UPDATE public.sales_conversations SET revision=revision+1 WHERE id=c.id;
 UPDATE public.sales_jobs SET status='cancelled',reason='knowledge_configuration_changed' WHERE conversation_id=c.id AND status IN ('queued','claimed');
 INSERT INTO public.sales_events(conversation_id,event,actor_id,details) VALUES(c.id,'knowledge_products_configured',p_actor,jsonb_build_object('before',p_expected,'after',p_ids));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.sales_configure_knowledge_products(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_configure_knowledge_products(uuid,uuid,jsonb,jsonb) TO service_role;
