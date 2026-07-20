do $g$
declare v_exists boolean;
begin
  select exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='crm_phase3b_rehearsal_replay'
  ) into v_exists;
  if not v_exists then
    raise notice 'phase3b replay already absent';
  end if;
end
$g$;

drop function if exists public.crm_phase3b_rehearsal_replay();

do $g$
declare v_still boolean;
declare v_writer_exists boolean;
declare v_writer_svc boolean;
begin
  select exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='crm_phase3b_rehearsal_replay'
  ) into v_still;
  if v_still then
    raise exception 'phase3b replay cleanup FAILED — function still exists';
  end if;

  select exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='crm_company_backfill_billing_cld'
  ) into v_writer_exists;
  if not v_writer_exists then
    raise exception 'permanent writer crm_company_backfill_billing_cld unexpectedly missing';
  end if;

  select has_function_privilege('service_role','public.crm_company_backfill_billing_cld(uuid)','EXECUTE') into v_writer_svc;
  if not v_writer_svc then
    raise exception 'permanent writer ACL regressed';
  end if;
end
$g$;