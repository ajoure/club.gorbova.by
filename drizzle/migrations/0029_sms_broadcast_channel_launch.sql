CREATE OR REPLACE FUNCTION public.telegram_funnel_begin_launch(p_id uuid,p_funnel uuid,p_revision integer,p_bot uuid,p_filters jsonb,p_restart boolean DEFAULT false,p_scheduled_at timestamptz DEFAULT NULL)
RETURNS public.telegram_funnel_launches LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.telegram_funnels; l public.telegram_funnel_launches;
BEGIN
 IF NOT public.telegram_funnel_can_manage() THEN RAISE EXCEPTION 'communication_manage_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.telegram_funnels WHERE id=p_funnel FOR SHARE;
 IF NOT FOUND OR p_revision IS NULL OR f.status<>'active' OR f.revision<>p_revision THEN RAISE EXCEPTION 'funnel_not_launchable'; END IF;
 PERFORM public.telegram_funnel_validate_graph(f.start_block_id,f.blocks);
 IF public.sms_funnel_needs_telegram(f.start_block_id,f.blocks) AND NOT EXISTS(SELECT 1 FROM public.telegram_bots WHERE id=p_bot AND status='active') THEN RAISE EXCEPTION 'funnel_bot_unavailable'; END IF;
 PERFORM public.telegram_funnel_validate_segment(p_filters);
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=p_id;
 IF FOUND THEN
  IF l.funnel_id<>p_funnel OR l.bot_id IS DISTINCT FROM p_bot OR l.audience_filters<>p_filters OR l.restart_existing<>p_restart OR l.graph_snapshot->>'revision'<>p_revision::text THEN RAISE EXCEPTION 'funnel_launch_id_conflict'; END IF;
  RETURN l;
 END IF;
 INSERT INTO public.telegram_funnel_launches(id,funnel_id,bot_id,graph_snapshot,audience_filters,restart_existing,created_by,scheduled_for)
 VALUES(p_id,p_funnel,p_bot,jsonb_build_object('revision',f.revision,'start_block_id',f.start_block_id,'blocks',f.blocks),p_filters,p_restart,auth.uid(),coalesce(p_scheduled_at,now())) RETURNING * INTO l;
 -- Every launch freezes recipients atomically, before any transport or cron tick.
 PERFORM public.telegram_funnel_prepare_audience(l.id); SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=l.id;
 RETURN l;
END $$;
