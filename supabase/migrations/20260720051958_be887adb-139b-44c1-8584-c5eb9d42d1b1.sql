create or replace function public.crm_phase3b_rehearsal_replay()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_baseline jsonb;
  v_after_waves jsonb;
  v_after_pass2 jsonb;
  v_soft jsonb;
  v_activity_baseline bigint;
  v_activity_after_waves bigint;
  v_activity_after_pass2 bigint;
  v_seq_after_waves bigint;
  v_seq_after_pass2 bigint;
  v_payload jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'phase3b replay requires service_role identity' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'companies',        (select count(*) from public.companies),
    'map',              (select count(*) from public.client_legal_details_company_map),
    'contacts_billing', (select count(*) from public.company_contacts
                          where relationship_type = 'billing_contact' and is_billing_contact = true),
    'seq_company',      (select last_value from public.public_id_sequences where entity_type = 'company')
  ) into v_baseline;

  if (v_baseline->>'companies')::int  <> 0
     or (v_baseline->>'map')::int     <> 0
     or (v_baseline->>'contacts_billing')::int <> 0
     or (v_baseline->>'seq_company')::int      <> 0 then
    raise exception 'phase3b baseline not zero: %', v_baseline::text using errcode = 'P3B02';
  end if;

  select count(*) into v_activity_baseline from public.crm_activity_log;

  with elig as (
    select id, profile_id,
           regexp_replace(coalesce(case when client_type = 'legal_entity' then leg_unp else ent_unp end, ''), '\D', '', 'g') as unp,
           nullif(btrim(case when client_type = 'legal_entity'
                             then concat_ws(' ', leg_org_form, leg_name)
                             else ent_name end), '') as full_name,
           created_at
    from public.client_legal_details
    where purpose = 'billing' and client_type in ('legal_entity','entrepreneur')
  ), keep as (
    select id, unp, created_at,
           row_number() over (partition by unp order by created_at, id) as rn
    from elig
    where length(unp) > 0 and full_name is not null
  )
  select array_agg(id order by rn, unp, created_at) into v_ids from keep;

  if v_ids is null or array_length(v_ids, 1) <> 17 then
    raise exception 'phase3b eligible count mismatch: %', coalesce(array_length(v_ids, 1), 0)
      using errcode = 'P3B03';
  end if;

  foreach v_id in array v_ids[1:16] loop
    perform public.crm_company_backfill_billing_cld(v_id);
  end loop;

  perform public.crm_company_backfill_billing_cld(v_ids[17]);

  select jsonb_build_object(
    'companies',        (select count(*) from public.companies),
    'map',              (select count(*) from public.client_legal_details_company_map),
    'contacts_billing', (select count(*) from public.company_contacts
                          where relationship_type = 'billing_contact' and is_billing_contact = true)
  ) into v_after_waves;

  select last_value into v_seq_after_waves
    from public.public_id_sequences where entity_type = 'company';

  select jsonb_build_object(
    'unp', '193405000',
    'companies', (select count(*) from public.companies where unp_normalized = '193405000'),
    'billing_contacts', (
      select count(*) from public.company_contacts cc
        join public.companies c on c.id = cc.company_id
       where c.unp_normalized = '193405000'
         and cc.relationship_type = 'billing_contact'
         and cc.is_billing_contact = true
    )
  ) into v_soft;

  select count(*) into v_activity_after_waves from public.crm_activity_log;

  foreach v_id in array v_ids loop
    perform public.crm_company_backfill_billing_cld(v_id);
  end loop;

  select jsonb_build_object(
    'companies',        (select count(*) from public.companies),
    'map',              (select count(*) from public.client_legal_details_company_map),
    'contacts_billing', (select count(*) from public.company_contacts
                          where relationship_type = 'billing_contact' and is_billing_contact = true)
  ) into v_after_pass2;

  select last_value into v_seq_after_pass2
    from public.public_id_sequences where entity_type = 'company';

  select count(*) into v_activity_after_pass2 from public.crm_activity_log;

  v_payload := jsonb_build_object(
    'marker', 'PHASE3B_REHEARSAL_EXPECTED_ROLLBACK',
    'run_tag', gen_random_uuid()::text,
    'baseline', v_baseline,
    'after_waves', v_after_waves,
    'soft_flag_193405000', v_soft,
    'after_second_pass', v_after_pass2,
    'seq_company', jsonb_build_object(
      'baseline', (v_baseline->>'seq_company')::int,
      'after_waves', v_seq_after_waves,
      'after_second_pass', v_seq_after_pass2
    ),
    'crm_activity_log', jsonb_build_object(
      'baseline', v_activity_baseline,
      'after_waves', v_activity_after_waves,
      'after_second_pass', v_activity_after_pass2,
      'delta_waves', v_activity_after_waves - v_activity_baseline,
      'delta_pass2', v_activity_after_pass2 - v_activity_after_waves
    ),
    'idempotency_deltas', jsonb_build_object(
      'companies',        ((v_after_pass2->>'companies')::int        - (v_after_waves->>'companies')::int),
      'map',              ((v_after_pass2->>'map')::int              - (v_after_waves->>'map')::int),
      'contacts_billing', ((v_after_pass2->>'contacts_billing')::int - (v_after_waves->>'contacts_billing')::int),
      'seq_company',      (v_seq_after_pass2 - v_seq_after_waves)
    )
  );

  raise exception 'PHASE3B_REHEARSAL_EXPECTED_ROLLBACK %', v_payload::text using errcode = 'P3B01';
end;
$$;

revoke all on function public.crm_phase3b_rehearsal_replay() from public;
revoke all on function public.crm_phase3b_rehearsal_replay() from anon;
revoke all on function public.crm_phase3b_rehearsal_replay() from authenticated;
grant execute on function public.crm_phase3b_rehearsal_replay() to service_role;

do $guard$
declare
  v_svc  boolean;
  v_auth boolean;
  v_anon boolean;
begin
  select has_function_privilege('service_role',  'public.crm_phase3b_rehearsal_replay()', 'EXECUTE') into v_svc;
  select has_function_privilege('authenticated', 'public.crm_phase3b_rehearsal_replay()', 'EXECUTE') into v_auth;
  select has_function_privilege('anon',          'public.crm_phase3b_rehearsal_replay()', 'EXECUTE') into v_anon;
  if not v_svc or v_auth or v_anon then
    raise exception 'phase3b replay ACL guard failed: svc=% auth=% anon=%', v_svc, v_auth, v_anon;
  end if;
end
$guard$;