
CREATE OR REPLACE FUNCTION public.sms_funnel_audience(p_segment jsonb,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.telegram_funnel_can_manage() THEN RAISE EXCEPTION 'communication_manage_required' USING ERRCODE='42501';END IF;
 PERFORM public.telegram_funnel_validate_segment(p_segment);
 IF p_offset IS NULL OR p_limit IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'funnel_page_invalid';END IF;
 WITH candidates AS MATERIALIZED(SELECT p.id profile_id,p.user_id,p.full_name,public.sms_normalize_phone(p.phone) phone FROM private.telegram_funnel_matching_profiles(p_segment)m JOIN public.profiles p ON p.id=m), matched AS MATERIALIZED(SELECT c.profile_id,c.user_id,c.full_name,(c.phone IS NOT NULL AND row_number()OVER(PARTITION BY c.phone ORDER BY(c.user_id IS NOT NULL)DESC,c.profile_id)=1) has_dialog FROM candidates c),
 paged AS(SELECT * FROM matched ORDER BY profile_id LIMIT p_limit OFFSET p_offset)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM matched),'available_count',(SELECT count(*) FROM matched WHERE has_dialog),'recipients',coalesce((SELECT jsonb_agg(to_jsonb(pg) ORDER BY profile_id) FROM paged pg),'[]')) INTO result;RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.sms_funnel_audience(jsonb,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sms_funnel_audience(jsonb,integer,integer) TO authenticated;
