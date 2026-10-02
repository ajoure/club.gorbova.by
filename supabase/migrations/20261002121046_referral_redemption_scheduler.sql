-- Dedicated secret, no service key in cron.job. Created DISABLED; enable only
-- after exact-SHA deployment, maturation manifest and bounded read-back.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM vault.secrets WHERE name='referral_redemption_cron_secret') THEN
  PERFORM vault.create_secret(encode(gen_random_bytes(32),'hex'),'referral_redemption_cron_secret','Authenticates referral maturity/access outbox scheduler only');
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.verify_referral_redemption_cron_secret(p_candidate text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,vault,pg_temp AS $$
 SELECT coalesce(nullif(p_candidate,'')=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='referral_redemption_cron_secret' LIMIT 1),false)
$$;
REVOKE ALL ON FUNCTION public.verify_referral_redemption_cron_secret(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verify_referral_redemption_cron_secret(text) TO service_role;
CREATE OR REPLACE FUNCTION public.invoke_referral_redemption_worker()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,vault,net,pg_temp AS $$
DECLARE v_secret text; v_request bigint;
BEGIN
 SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='referral_redemption_cron_secret' LIMIT 1;
 IF nullif(v_secret,'') IS NULL THEN RAISE EXCEPTION 'referral_scheduler_secret_missing'; END IF;
 SELECT net.http_post(url:='https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/referral-redemption-worker',headers:=jsonb_build_object('Content-Type','application/json','x-referral-cron-secret',v_secret),body:='{"dry_run":false,"run_maturation":true,"limit":20}'::jsonb) INTO v_request;
 RETURN v_request;
END $$;
REVOKE ALL ON FUNCTION public.invoke_referral_redemption_worker() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_referral_redemption_worker() TO service_role;
DO $$ DECLARE v_job bigint; BEGIN
 SELECT jobid INTO v_job FROM cron.job WHERE jobname='referral-redemption-every-minute' LIMIT 1;
 IF v_job IS NULL THEN
  SELECT cron.schedule('referral-redemption-every-minute','* * * * *','SELECT public.invoke_referral_redemption_worker();') INTO v_job;
  PERFORM cron.alter_job(job_id:=v_job,active:=false);
 END IF;
END $$;
