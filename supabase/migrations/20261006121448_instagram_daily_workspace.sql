-- Additive daily workspace; preserve Vault, RBAC, free budget and original cron.
ALTER TABLE public.instagram_monitor_settings
 ADD COLUMN reels_per_run integer NOT NULL DEFAULT 10 CHECK (reels_per_run BETWEEN 1 AND 100),
 ADD COLUMN run_timeout_seconds integer NOT NULL DEFAULT 180 CHECK (run_timeout_seconds BETWEEN 60 AND 600),
 ADD COLUMN include_replies boolean NOT NULL DEFAULT false;
ALTER TABLE public.instagram_monitor_runs
 ADD COLUMN import_offset integer NOT NULL DEFAULT 0 CHECK (import_offset>=0),
 ADD COLUMN request_options jsonb NOT NULL DEFAULT '{}'::jsonb,
 ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE public.instagram_monitor_comments
 ADD COLUMN parent_comment_id text,
 ADD COLUMN likes_count integer NOT NULL DEFAULT 0 CHECK (likes_count>=0),
 ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.instagram_monitor_reels
 DROP CONSTRAINT instagram_monitor_reels_comments_coverage_check,
 ADD CONSTRAINT instagram_monitor_reels_comments_coverage_check CHECK (comments_coverage IN ('not_collected','partial','available')),
 ADD COLUMN comments_checked_at timestamptz,
 ADD COLUMN coverage_reason text;
CREATE INDEX instagram_monitor_comments_page ON public.instagram_monitor_comments(reel_id,id);
CREATE INDEX instagram_monitor_reels_page ON public.instagram_monitor_reels(profile_id,created_at DESC,id);

CREATE FUNCTION public.instagram_monitor_queue_profiles(_force boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p record; n integer:=0; s public.instagram_monitor_settings%ROWTYPE; total numeric; BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('instagram-monitor-queue'));
 SELECT * INTO s FROM public.instagram_monitor_settings WHERE id;
 IF NOT s.enabled OR NOT public.instagram_monitor_apify_ready() OR (NOT _force AND NOT s.auto_monitor) THEN RETURN 0; END IF;
 SELECT coalesce(sum(reserved_usd),0)+coalesce(sum(CASE WHEN budget_month=date_trunc('month',now())::date THEN cost_usd ELSE 0 END),0) INTO total FROM public.instagram_monitor_runs;
 IF total+s.max_run_usd>s.monthly_limit_usd THEN
  IF _force THEN RAISE EXCEPTION 'monthly_budget_exhausted'; END IF;
  RETURN 0;
 END IF;
 FOR p IN SELECT id FROM public.instagram_monitor_profiles x WHERE x.enabled
  AND NOT EXISTS(SELECT 1 FROM public.instagram_monitor_runs r WHERE r.profile_id=x.id AND r.kind='reels' AND r.status NOT IN ('succeeded','failed'))
  AND (_force OR NOT EXISTS(SELECT 1 FROM public.instagram_monitor_runs r WHERE r.profile_id=x.id AND r.kind='reels' AND r.created_at>now()-interval '24 hours'))
  ORDER BY x.last_checked_at NULLS FIRST,x.created_at,x.id LOOP
  PERFORM public.instagram_monitor_enqueue('reels',p.id,NULL); n:=n+1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.instagram_monitor_queue_profiles(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_monitor_queue_profiles(boolean) TO service_role;
