CREATE OR REPLACE FUNCTION public.telegram_funnel_begin_self_test(p_id uuid,p_funnel uuid,p_revision integer,p_bot uuid) RETURNS public.telegram_funnel_launches LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.telegram_funnels;l public.telegram_funnel_launches;p public.profiles;filters jsonb:='{"version":1,"root":{"id":"self","kind":"field","field":"status","operator":"eq","value":"active"}}';
BEGIN
 IF NOT public.telegram_funnel_can_manage() THEN RAISE EXCEPTION 'communication_manage_required' USING ERRCODE='42501';END IF;
 SELECT * INTO f FROM public.telegram_funnels WHERE id=p_funnel FOR SHARE;
 IF NOT FOUND OR p_revision IS NULL OR f.revision<>p_revision OR f.status NOT IN('draft','active') THEN RAISE EXCEPTION 'funnel_not_testable';END IF;
 PERFORM public.telegram_funnel_validate_graph(f.start_block_id,f.blocks);
 SELECT * INTO p FROM public.profiles WHERE user_id=auth.uid() AND is_archived IS NOT TRUE AND status IS DISTINCT FROM 'archived' AND merged_to_profile_id IS NULL;
 IF NOT FOUND OR (public.sms_funnel_needs_telegram(f.start_block_id,f.blocks) AND(p.telegram_user_id IS NULL OR NOT public.telegram_funnel_known_dialog(p.id,p_bot) OR NOT EXISTS(SELECT 1 FROM public.telegram_bots WHERE id=p_bot AND status='active'))) OR (NOT public.sms_funnel_needs_telegram(f.start_block_id,f.blocks) AND public.sms_normalize_phone(p.phone) IS NULL) THEN RAISE EXCEPTION 'funnel_self_dialog_required';END IF;
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=p_id;
 IF FOUND THEN IF l.created_by IS DISTINCT FROM auth.uid() OR l.test_profile_id IS DISTINCT FROM p.id OR l.funnel_id<>f.id OR l.bot_id IS DISTINCT FROM p_bot OR l.graph_snapshot->>'revision'<>p_revision::text THEN RAISE EXCEPTION 'funnel_launch_id_conflict';END IF;RETURN l;END IF;
 INSERT INTO public.telegram_funnel_launches(id,funnel_id,bot_id,graph_snapshot,audience_filters,created_by,test_profile_id)
 VALUES(p_id,f.id,p_bot,jsonb_build_object('revision',f.revision,'start_block_id',f.start_block_id,'blocks',f.blocks),filters,auth.uid(),p.id) RETURNING * INTO l;RETURN l;
END $$;
