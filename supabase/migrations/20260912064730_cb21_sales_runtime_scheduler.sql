-- Dedicated secret; never a service-role key in cron.job or browser code.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM vault.secrets WHERE name='sales_runtime_cron_secret') THEN
  PERFORM vault.create_secret(encode(gen_random_bytes(32),'hex'),'sales_runtime_cron_secret','Authenticates only the CB21 sales worker.');
 END IF;
END $$;
CREATE FUNCTION public.verify_sales_runtime_cron_secret(p_candidate text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(nullif(p_candidate,'')=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='sales_runtime_cron_secret' LIMIT 1),false);
$$;
REVOKE ALL ON FUNCTION public.verify_sales_runtime_cron_secret(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verify_sales_runtime_cron_secret(text) TO service_role;
CREATE FUNCTION public.invoke_sales_runtime_worker() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE secret text; request_id bigint;
BEGIN
 -- No HTTP/model calls while the pilot is disabled or nobody is waiting.
 IF NOT EXISTS(SELECT 1 FROM public.sales_campaigns WHERE mode='owner_test') THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sales_jobs WHERE (status='queued' AND due_at<=now()) OR
   (status IN ('claimed','sending') AND claimed_at<now()-interval '3 minutes'))
   AND NOT EXISTS(SELECT 1 FROM public.sales_events e WHERE e.event IN ('handoff','opt_out')
    AND EXISTS(SELECT 1 FROM public.contact_center_message_assignments a WHERE a.id::text=e.details->>'assignment_id' AND a.resolved_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM public.notification_outbox o WHERE o.idempotency_key='sales_assignment:'||(e.details->>'assignment_id')))
 THEN RETURN NULL; END IF;
 SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='sales_runtime_cron_secret' LIMIT 1;
 IF secret IS NULL THEN RAISE EXCEPTION 'sales_scheduler_secret_missing'; END IF;
 SELECT net.http_post(url:='https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/sales-runtime-worker',
 headers:=jsonb_build_object('Content-Type','application/json','x-sales-runtime-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=55000) INTO request_id;
 RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION public.invoke_sales_runtime_worker() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_sales_runtime_worker() TO service_role;
-- pg_cron >=1.5 supports interval schedules. Execution adds at most one 10s tick.
SELECT cron.schedule('cb21-sales-runtime','10 seconds','SELECT public.invoke_sales_runtime_worker();');
