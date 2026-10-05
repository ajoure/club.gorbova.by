-- Public-content pilot. No Direct/CRM tables or existing permissions are changed.
INSERT INTO public.admin_section(code,label,route_prefix,icon,sort_order,group_code,is_active)
VALUES ('instagram-monitor','Мониторинг Instagram','/admin/instagram-monitor','Video',31,'service',true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE public.instagram_monitor_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  auto_monitor boolean NOT NULL DEFAULT false,
  monthly_limit_usd numeric(10,4) NOT NULL DEFAULT 4 CHECK (monthly_limit_usd BETWEEN 0 AND 4),
  max_run_usd numeric(10,4) NOT NULL DEFAULT 0.25 CHECK (max_run_usd BETWEEN 0 AND 0.25)
);
INSERT INTO public.instagram_monitor_settings(id) VALUES (true);
-- Existing pilot cost recorded below after runs table creation, to keep one budget ledger.
CREATE TABLE public.instagram_monitor_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL CHECK (username ~ '^[a-z0-9_][a-z0-9_.]{0,29}$'),
  enabled boolean NOT NULL DEFAULT true,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.instagram_monitor_reels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.instagram_monitor_profiles(id),
  shortcode text UNIQUE NOT NULL,
  post_url text NOT NULL,
  caption text NOT NULL DEFAULT '',
  published_at timestamptz,
  likes_count integer NOT NULL DEFAULT 0 CHECK (likes_count >= 0),
  comments_count integer NOT NULL DEFAULT 0 CHECK (comments_count >= 0),
  collected_comments_count integer NOT NULL DEFAULT 0,
  comments_coverage text NOT NULL DEFAULT 'not_collected' CHECK (comments_coverage IN ('not_collected','partial')),
  transcript text,
  summary text,
  transcript_status text NOT NULL DEFAULT 'pending' CHECK (transcript_status IN ('pending','processing','done','failed')),
  storage_path text,
  duration_seconds numeric,
  source_run_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.instagram_monitor_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_id uuid NOT NULL REFERENCES public.instagram_monitor_reels(id),
  provider_comment_id text NOT NULL,
  username text NOT NULL DEFAULT '',
  text text NOT NULL,
  posted_at timestamptz,
  UNIQUE(reel_id,provider_comment_id)
);
CREATE TABLE public.instagram_monitor_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('reels','comments','media','transcribe')),
  profile_id uuid REFERENCES public.instagram_monitor_profiles(id),
  reel_id uuid REFERENCES public.instagram_monitor_reels(id),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','starting','waiting','processing','succeeded','failed','unknown')),
  provider_run_id text UNIQUE,
  budget_month date,
  reserved_usd numeric(10,4) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  cost_usd numeric(10,4) CHECK (cost_usd >= 0),
  error_code text,
  attempts integer NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  lease_owner uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.instagram_monitor_runs(kind,status,provider_run_id,budget_month,cost_usd) VALUES
 ('reels','succeeded','1kJneDGHIlu27zcU8','2026-10-01',0.006),
 ('reels','succeeded','PeZYge0dPiAr7P4YL','2026-10-01',0.184),
 ('comments','succeeded','Hg5ZxA1Yie1AmhpF8','2026-10-01',0.055);
CREATE INDEX instagram_monitor_queue ON public.instagram_monitor_runs(next_run_at,created_at)
WHERE status IN ('queued','waiting');
CREATE UNIQUE INDEX instagram_monitor_reel_active ON public.instagram_monitor_runs(kind,reel_id)
WHERE reel_id IS NOT NULL AND status NOT IN ('succeeded','failed');
CREATE UNIQUE INDEX instagram_monitor_profile_active ON public.instagram_monitor_runs(profile_id)
WHERE kind='reels' AND status NOT IN ('succeeded','failed');

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['settings','profiles','reels','comments','runs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY','instagram_monitor_'||t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated','instagram_monitor_'||t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated','instagram_monitor_'||t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role','instagram_monitor_'||t);
    EXECUTE format('CREATE POLICY instagram_monitor_read ON public.%I FOR SELECT TO authenticated USING (public.has_admin_section_access(auth.uid(),''instagram-monitor'',''view''))','instagram_monitor_'||t);
  END LOOP;
END $$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('instagram-monitor-media','instagram-monitor-media',false,31457280,ARRAY['video/mp4','audio/mp4','application/octet-stream'])
ON CONFLICT(id) DO NOTHING;
-- No client Storage policy: issue short-lived signed URLs only behind server RBAC.

CREATE FUNCTION public.instagram_monitor_enqueue(_kind text,_profile_id uuid DEFAULT NULL,_reel_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('instagram-monitor-queue'));
  IF _kind='reels' AND NOT (SELECT enabled FROM public.instagram_monitor_settings WHERE id) THEN RAISE EXCEPTION 'monitor_disabled'; END IF;
  IF _kind='reels' THEN
    IF NOT EXISTS(SELECT 1 FROM public.instagram_monitor_profiles WHERE id=_profile_id AND enabled) THEN RAISE EXCEPTION 'profile_disabled'; END IF;
    SELECT id INTO v_id FROM public.instagram_monitor_runs WHERE kind='reels' AND profile_id=_profile_id AND status NOT IN ('succeeded','failed') LIMIT 1;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.instagram_monitor_reels WHERE id=_reel_id) THEN RAISE EXCEPTION 'reel_missing'; END IF;
    SELECT id INTO v_id FROM public.instagram_monitor_runs WHERE kind=_kind AND reel_id=_reel_id AND status NOT IN ('succeeded','failed') LIMIT 1;
  END IF;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.instagram_monitor_runs(kind,profile_id,reel_id) VALUES(_kind,_profile_id,_reel_id) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- One worker claim at a time. A stale start never returns to the start queue.
CREATE FUNCTION public.instagram_monitor_claim(_owner uuid)
RETURNS SETOF public.instagram_monitor_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('instagram-monitor-queue'));
  UPDATE public.instagram_monitor_runs SET status='unknown',error_code='start_outcome_unknown',lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
    WHERE status='starting' AND lease_expires_at<now();
  UPDATE public.instagram_monitor_reels SET transcript_status='failed' WHERE id IN (SELECT reel_id FROM public.instagram_monitor_runs WHERE kind='transcribe' AND status='processing' AND lease_expires_at<now());
  UPDATE public.instagram_monitor_runs SET status=CASE WHEN kind='media' AND attempts<3 THEN 'queued' ELSE 'failed' END,
    error_code='worker_interrupted',lease_owner=NULL,lease_expires_at=NULL,updated_at=now(),next_run_at=now()+interval '5 minutes'
    WHERE status='processing' AND lease_expires_at<now();
  -- AI work is not automatically repeated after an interruption (separate paid credits).
  IF EXISTS(SELECT 1 FROM public.instagram_monitor_runs WHERE lease_expires_at>now()) THEN RETURN; END IF;
  SELECT id INTO v_id FROM public.instagram_monitor_runs
    WHERE status IN ('queued','waiting') AND next_run_at<=now()
      AND (lease_expires_at IS NULL OR lease_expires_at<now())
      AND (status='waiting' OR (SELECT enabled FROM public.instagram_monitor_settings WHERE id))
    ORDER BY CASE WHEN status='waiting' THEN 0 ELSE 1 END,created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN RETURN; END IF;
  RETURN QUERY UPDATE public.instagram_monitor_runs SET lease_owner=_owner,lease_expires_at=now()+interval '10 minutes',attempts=attempts+1,updated_at=now()
    WHERE id=v_id RETURNING *;
END $$;

CREATE FUNCTION public.instagram_monitor_reserve(_id uuid,_owner uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_month date:=date_trunc('month',now())::date; v_total numeric; v_limit numeric; v_run numeric; BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('instagram-monitor-budget'));
  IF NOT EXISTS(SELECT 1 FROM public.instagram_monitor_runs WHERE id=_id AND lease_owner=_owner AND lease_expires_at>now() AND status='queued' AND kind IN ('reels','comments')) THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.instagram_monitor_runs r WHERE r.id=_id AND r.kind='reels' AND NOT EXISTS(SELECT 1 FROM public.instagram_monitor_profiles p WHERE p.id=r.profile_id AND p.enabled)) THEN
    UPDATE public.instagram_monitor_runs SET status='failed',error_code='profile_disabled',lease_owner=NULL,lease_expires_at=NULL WHERE id=_id;
    RETURN false;
  END IF;
  IF EXISTS(SELECT 1 FROM public.instagram_monitor_runs WHERE id<>_id AND kind IN ('reels','comments') AND status IN ('starting','waiting','processing')) THEN RETURN false; END IF;
  SELECT monthly_limit_usd,max_run_usd INTO v_limit,v_run FROM public.instagram_monitor_settings WHERE id AND enabled;
  IF v_limit IS NULL THEN RETURN false; END IF;
  -- Unresolved reservations survive month rollover; late billing cannot reset the cap.
  SELECT coalesce(sum(reserved_usd),0)+coalesce(sum(CASE WHEN budget_month=v_month THEN cost_usd ELSE 0 END),0) INTO v_total FROM public.instagram_monitor_runs;
  IF v_total+v_run>v_limit THEN
    UPDATE public.instagram_monitor_runs SET status='failed',error_code='monthly_budget_exhausted',lease_owner=NULL,lease_expires_at=NULL WHERE id=_id;
    RETURN false;
  END IF;
  UPDATE public.instagram_monitor_runs SET reserved_usd=v_run,budget_month=v_month,status='starting',updated_at=now() WHERE id=_id;
  RETURN true;
END $$;

CREATE FUNCTION public.instagram_monitor_finish(_id uuid,_owner uuid,_status text,_error text DEFAULT NULL,_provider_id text DEFAULT NULL,_cost numeric DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer; BEGIN
  IF _status NOT IN ('queued','waiting','succeeded','failed','unknown') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  UPDATE public.instagram_monitor_runs SET status=_status,error_code=_error,
    provider_run_id=coalesce(_provider_id,provider_run_id),
    cost_usd=CASE WHEN _cost IS NOT NULL AND _cost>=0 THEN _cost ELSE cost_usd END,
    budget_month=CASE WHEN _cost IS NOT NULL AND _cost>=0 THEN date_trunc('month',now())::date ELSE budget_month END,
    reserved_usd=CASE WHEN _cost IS NOT NULL AND _cost>=0 THEN 0 ELSE reserved_usd END,
    lease_owner=NULL,lease_expires_at=NULL,next_run_at=now()+interval '1 minute',updated_at=now()
    WHERE id=_id AND lease_owner=_owner AND lease_expires_at>now();
  GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM vault.secrets WHERE name='instagram_monitor_cron_secret') THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32),'hex'),'instagram_monitor_cron_secret','Instagram monitor worker only');
  END IF;
END $$;
CREATE FUNCTION public.verify_instagram_monitor_cron_secret(_candidate text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,vault,pg_temp AS $$
SELECT coalesce(NULLIF(_candidate,'')=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='instagram_monitor_cron_secret' LIMIT 1),false);
$$;
CREATE FUNCTION public.invoke_instagram_monitor_worker()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,vault,net,pg_temp AS $$
DECLARE s text; BEGIN
 SELECT decrypted_secret INTO s FROM vault.decrypted_secrets WHERE name='instagram_monitor_cron_secret' LIMIT 1;
 IF s IS NULL THEN RAISE EXCEPTION 'missing_cron_secret'; END IF;
 RETURN net.http_post(url:='https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/instagram-monitor-worker',headers:=jsonb_build_object('Content-Type','application/json','x-instagram-monitor-secret',s),body:='{}'::jsonb,timeout_milliseconds:=55000);
END $$;
DO $$ DECLARE sig text; BEGIN
 FOREACH sig IN ARRAY ARRAY['instagram_monitor_enqueue(text,uuid,uuid)','instagram_monitor_claim(uuid)','instagram_monitor_reserve(uuid,uuid)','instagram_monitor_finish(uuid,uuid,text,text,text,numeric)','verify_instagram_monitor_cron_secret(text)','invoke_instagram_monitor_worker()'] LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION public.'||sig||' FROM PUBLIC,anon,authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||sig||' TO service_role';
 END LOOP;
END $$;
-- The tick is safe while the pilot is disabled; it only drains previously-started work.
SELECT cron.schedule('instagram-monitor-worker','* * * * *','SELECT public.invoke_instagram_monitor_worker();');
