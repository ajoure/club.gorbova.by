
CREATE OR REPLACE FUNCTION public.sms_broadcast_summary(p_dispatch uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('dispatch_id',p_dispatch,'queued',count(*) FILTER(WHERE status='queued'),'sent',count(*) FILTER(WHERE status IN('sent','delivered')),'failed',count(*) FILTER(WHERE status='failed'),'unknown',count(*) FILTER(WHERE status IN('sending','unknown')),'skipped',count(*) FILTER(WHERE status='skipped'),'total',count(*),'sms_ids',coalesce((SELECT jsonb_agg(id) FROM(SELECT id FROM public.sms_messages WHERE dispatch_id=p_dispatch ORDER BY id LIMIT 20)s),'[]'::jsonb),'delivery_status','not_confirmed') FROM public.sms_messages WHERE dispatch_id=p_dispatch;
$$;
REVOKE ALL ON FUNCTION public.sms_broadcast_summary(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sms_broadcast_summary(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.sms_broadcast_audience_count(p_filters jsonb) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT count(*) FROM public.resolve_sms_broadcast_contacts(p_filters);
$$;
REVOKE ALL ON FUNCTION public.sms_broadcast_audience_count(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sms_broadcast_audience_count(jsonb) TO service_role;
