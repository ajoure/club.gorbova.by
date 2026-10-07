-- Calendar scheduling reuses the existing minute worker and private queue lock.
ALTER TABLE public.instagram_monitor_settings
 ADD COLUMN schedule_time text NOT NULL DEFAULT '09:00' CHECK(schedule_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 ADD COLUMN timezone text NOT NULL DEFAULT 'Europe/Minsk' CHECK(timezone IN ('Europe/Minsk','Europe/Warsaw','UTC')),
 ADD COLUMN period text NOT NULL DEFAULT 'previous_day' CHECK(period IN ('previous_day','recent')),
 ADD COLUMN last_schedule_date date;
ALTER TABLE public.instagram_monitor_runs ADD COLUMN imported_reels integer NOT NULL DEFAULT 0 CHECK(imported_reels>=0);
-- Do not initiate a second daily batch during rollout; existing queued work survives.
UPDATE public.instagram_monitor_settings SET last_schedule_date=(clock_timestamp() AT TIME ZONE timezone)::date;
CREATE OR REPLACE FUNCTION public.instagram_monitor_queue_profiles(_force boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p record; n integer:=0; s public.instagram_monitor_settings%ROWTYPE; total numeric; local_now timestamp; run_id uuid; opts jsonb:='{}'::jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('instagram-monitor-queue'));
 SELECT * INTO s FROM public.instagram_monitor_settings WHERE id;
 IF NOT s.enabled OR NOT public.instagram_monitor_apify_ready() OR (NOT _force AND NOT s.auto_monitor) THEN RETURN 0; END IF;
 local_now:=clock_timestamp() AT TIME ZONE s.timezone;
 IF NOT _force AND (local_now::time<s.schedule_time::time OR s.last_schedule_date>=local_now::date) THEN RETURN 0; END IF;
 SELECT coalesce(sum(reserved_usd),0)+coalesce(sum(CASE WHEN budget_month=date_trunc('month',now())::date THEN cost_usd ELSE 0 END),0) INTO total FROM public.instagram_monitor_runs;
 IF total+s.max_run_usd>s.monthly_limit_usd THEN
  IF _force THEN RAISE EXCEPTION 'monthly_budget_exhausted'; END IF;
  RETURN 0;
 END IF;
 IF NOT _force AND s.period='previous_day' THEN
  opts:=jsonb_build_object('period','previous_day','window_start',((local_now::date-1)::timestamp AT TIME ZONE s.timezone),'window_end',(local_now::date::timestamp AT TIME ZONE s.timezone));
 END IF;
 FOR p IN SELECT id FROM public.instagram_monitor_profiles x WHERE x.enabled
  AND NOT EXISTS(SELECT 1 FROM public.instagram_monitor_runs r WHERE r.profile_id=x.id AND r.kind='reels' AND r.status NOT IN ('succeeded','failed'))
  ORDER BY x.last_checked_at NULLS FIRST,x.created_at,x.id LOOP
  run_id:=public.instagram_monitor_enqueue('reels',p.id,NULL);
  UPDATE public.instagram_monitor_runs SET request_options=opts WHERE id=run_id;
  n:=n+1;
 END LOOP;
 IF NOT _force THEN UPDATE public.instagram_monitor_settings SET last_schedule_date=local_now::date WHERE id; END IF;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.instagram_monitor_queue_profiles(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_monitor_queue_profiles(boolean) TO service_role;
CREATE FUNCTION public.instagram_monitor_profile_status()
RETURNS TABLE(profile_id uuid,latest_status text,latest_error text,imported_reels integer,reels_total bigint)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p.id,r.status,r.error_code,r.imported_reels,(SELECT count(*) FROM public.instagram_monitor_reels v WHERE v.profile_id=p.id)
 FROM public.instagram_monitor_profiles p LEFT JOIN LATERAL
 (SELECT status,error_code,imported_reels FROM public.instagram_monitor_runs WHERE profile_id=p.id AND kind='reels' ORDER BY created_at DESC,id DESC LIMIT 1) r ON true;
$$;
REVOKE ALL ON FUNCTION public.instagram_monitor_profile_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_monitor_profile_status() TO service_role;
