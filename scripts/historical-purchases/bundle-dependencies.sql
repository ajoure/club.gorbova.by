-- Expression shared by native preflight, the renderer and local contract tests.
-- A conservative fingerprint of live helpers, write-table triggers and CRM rules.
md5(jsonb_build_object(
  'functions',(SELECT COALESCE(jsonb_agg(pg_get_functiondef(p.oid) ORDER BY n.nspname,p.proname,p.oid),'[]'::jsonb)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind IN('f','p')),
  'triggers',(SELECT COALESCE(jsonb_agg(jsonb_build_array(c.relname,t.tgname,t.tgenabled,
      pg_get_triggerdef(t.oid),pg_get_functiondef(t.tgfoid)) ORDER BY c.relname,t.tgname),'[]'::jsonb)
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN('orders_v2','entitlements','access_grant_ledger','audit_logs')
      AND NOT t.tgisinternal AND t.tgenabled<>'D'),
  'crm_rules',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) FROM crm_pipeline_automation_rules r)
)::text)
