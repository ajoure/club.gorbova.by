-- Referrals 1.0: add-only core. Feature flags are OFF by default.
-- Money is stored in minor units (1 BYN = 100 kapeykas).

create table public.referral_program_settings (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  is_enabled boolean not null default false,
  tracking_enabled boolean not null default false,
  accrual_enabled boolean not null default false,
  partner_portal_enabled boolean not null default false,
  payout_requests_enabled boolean not null default false,
  shadow_mode boolean not null default true,
  base_currency text not null default 'BYN' check (base_currency = 'BYN'),
  commission_percent_bps integer not null default 1000
    check (commission_percent_bps between 0 and 10000),
  hold_days integer not null default 14 check (hold_days between 0 and 365),
  minimum_payout_minor bigint not null default 0 check (minimum_payout_minor >= 0),
  terms_version text,
  terms_url text,
  enabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.referral_program_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create table public.referral_partners (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('RFP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  profile_id uuid not null unique references public.profiles(id),
  partner_code text not null,
  status text not null default 'active'
    check (status in ('pending_review', 'active', 'paused', 'blocked', 'closed')),
  joined_at timestamptz not null default now(),
  terms_version text,
  terms_accepted_at timestamptz,
  status_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb
);

create unique index referral_partners_code_lower_uidx
  on public.referral_partners (lower(partner_code));

create table public.referral_relationships (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('RFR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  partner_id uuid not null references public.referral_partners(id),
  referred_profile_id uuid not null references public.profiles(id),
  source text not null default 'registration'
    check (source in ('registration', 'partner_link', 'admin_manual')),
  status text not null default 'active'
    check (status in ('active', 'revoked', 'disputed', 'fraud_hold')),
  attached_at timestamptz not null default now(),
  revoked_at timestamptz,
  manual_reason text,
  manual_actor_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint referral_relationship_not_self check (partner_id is not null)
);

create unique index referral_relationship_one_active_referrer_uidx
  on public.referral_relationships (referred_profile_id)
  where status = 'active';
create index referral_relationship_partner_idx
  on public.referral_relationships (partner_id, attached_at desc);

create table public.referral_sale_attributions (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('RFS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  partner_id uuid not null references public.referral_partners(id),
  relationship_id uuid not null references public.referral_relationships(id),
  order_id uuid not null unique references public.orders_v2(id),
  payment_id uuid references public.payments_v2(id),
  product_id uuid references public.products_v2(id),
  tariff_id uuid references public.tariffs(id),
  offer_id uuid,
  status text not null default 'pending'
    check (status in ('shadow', 'pending', 'available', 'partially_reversed', 'reversed', 'declined', 'fraud_hold')),
  commission_basis_minor bigint not null check (commission_basis_minor > 0),
  commission_basis_currency text not null check (commission_basis_currency = 'BYN'),
  commission_percent_bps integer not null check (commission_percent_bps between 0 and 10000),
  commission_minor bigint not null check (commission_minor >= 0),
  reversed_minor bigint not null default 0 check (reversed_minor >= 0),
  available_at timestamptz not null,
  rule_snapshot jsonb not null,
  order_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index referral_sale_partner_idx
  on public.referral_sale_attributions (partner_id, created_at desc);

create table public.referral_balance_transactions (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('RFT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  partner_id uuid not null references public.referral_partners(id),
  transaction_type text not null
    check (transaction_type in ('commission_pending', 'commission_available', 'refund_reversal', 'payout_hold', 'payout_release', 'payout_paid', 'manual_adjustment')),
  idempotency_key text not null unique,
  source_type text not null,
  source_id uuid,
  currency text not null default 'BYN' check (currency = 'BYN'),
  description text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb
);

create index referral_balance_transaction_partner_idx
  on public.referral_balance_transactions (partner_id, created_at desc);

create table public.referral_balance_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.referral_balance_transactions(id),
  partner_id uuid not null references public.referral_partners(id),
  bucket text not null check (bucket in ('pending', 'available', 'held', 'paid')),
  amount_minor bigint not null check (amount_minor <> 0),
  created_at timestamptz not null default now()
);

create index referral_balance_entry_partner_idx
  on public.referral_balance_entries (partner_id, bucket, created_at desc);

create table public.referral_payout_requests (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('RFPAY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  partner_id uuid not null references public.referral_partners(id),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'BYN' check (currency = 'BYN'),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'paid', 'rejected', 'cancelled')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  paid_at timestamptz,
  decision_reason text,
  decided_by uuid references auth.users(id),
  payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index referral_payout_partner_idx
  on public.referral_payout_requests (partner_id, requested_at desc);

create or replace function public.referral_settings_before_update()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  if new.is_enabled and not old.is_enabled then new.enabled_at := coalesce(new.enabled_at, now()); end if;
  return new;
end $$;
create trigger referral_settings_updated_at before update on public.referral_program_settings
for each row execute function public.referral_settings_before_update();
create trigger referral_partners_updated_at before update on public.referral_partners
for each row execute function public.update_updated_at_column();
create trigger referral_sales_updated_at before update on public.referral_sale_attributions
for each row execute function public.update_updated_at_column();
create trigger referral_payouts_updated_at before update on public.referral_payout_requests
for each row execute function public.update_updated_at_column();

create or replace function public.referral_guard_relationship_self_reference()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.referral_partners where id = new.partner_id and profile_id = new.referred_profile_id) then
    raise exception 'self_referral';
  end if;
  return new;
end $$;
create trigger referral_relationship_self_guard
before insert or update of partner_id, referred_profile_id on public.referral_relationships
for each row execute function public.referral_guard_relationship_self_reference();

create or replace function public.referral_forbid_ledger_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'referral_ledger_is_append_only';
end $$;
create trigger referral_transactions_append_only
before update or delete on public.referral_balance_transactions
for each row execute function public.referral_forbid_ledger_mutation();
create trigger referral_entries_append_only
before update or delete on public.referral_balance_entries
for each row execute function public.referral_forbid_ledger_mutation();

revoke all on function public.referral_guard_relationship_self_reference() from public;
revoke all on function public.referral_forbid_ledger_mutation() from public;
revoke all on function public.referral_settings_before_update() from public;

alter table public.referral_program_settings enable row level security;
alter table public.referral_partners enable row level security;
alter table public.referral_relationships enable row level security;
alter table public.referral_sale_attributions enable row level security;
alter table public.referral_balance_transactions enable row level security;
alter table public.referral_balance_entries enable row level security;
alter table public.referral_payout_requests enable row level security;

create or replace function public.referral_is_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.has_role_v2(p_user_id, 'admin'), false)
      or coalesce(public.has_role_v2(p_user_id, 'super_admin'), false)
$$;

revoke all on function public.referral_is_admin(uuid) from public;
grant execute on function public.referral_is_admin(uuid) to authenticated, service_role;

create policy referral_settings_admin_select on public.referral_program_settings
  for select to authenticated using (public.referral_is_admin((select auth.uid())));
create policy referral_settings_admin_update on public.referral_program_settings
  for update to authenticated
  using (public.referral_is_admin((select auth.uid())))
  with check (public.referral_is_admin((select auth.uid())));

create policy referral_partners_owner_or_admin_select on public.referral_partners
  for select to authenticated using (
    public.referral_is_admin((select auth.uid()))
    or exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = (select auth.uid()))
  );
create policy referral_relationship_owner_or_admin_select on public.referral_relationships
  for select to authenticated using (
    public.referral_is_admin((select auth.uid()))
    or exists (
      select 1 from public.referral_partners rp
      join public.profiles p on p.id = rp.profile_id
      where rp.id = partner_id and p.user_id = (select auth.uid())
    )
  );
create policy referral_sales_owner_or_admin_select on public.referral_sale_attributions
  for select to authenticated using (
    public.referral_is_admin((select auth.uid()))
    or exists (
      select 1 from public.referral_partners rp
      join public.profiles p on p.id = rp.profile_id
      where rp.id = partner_id and p.user_id = (select auth.uid())
    )
  );
create policy referral_transactions_owner_or_admin_select on public.referral_balance_transactions
  for select to authenticated using (
    public.referral_is_admin((select auth.uid()))
    or exists (
      select 1 from public.referral_partners rp
      join public.profiles p on p.id = rp.profile_id
      where rp.id = partner_id and p.user_id = (select auth.uid())
    )
  );
create policy referral_entries_owner_or_admin_select on public.referral_balance_entries
  for select to authenticated using (
    public.referral_is_admin((select auth.uid()))
    or exists (
      select 1 from public.referral_partners rp
      join public.profiles p on p.id = rp.profile_id
      where rp.id = partner_id and p.user_id = (select auth.uid())
    )
  );
create policy referral_payout_owner_or_admin_select on public.referral_payout_requests
  for select to authenticated using (
    public.referral_is_admin((select auth.uid()))
    or exists (
      select 1 from public.referral_partners rp
      join public.profiles p on p.id = rp.profile_id
      where rp.id = partner_id and p.user_id = (select auth.uid())
    )
  );

grant select on public.referral_program_settings, public.referral_partners,
  public.referral_relationships, public.referral_sale_attributions,
  public.referral_balance_transactions, public.referral_balance_entries,
  public.referral_payout_requests to authenticated;
grant update on public.referral_program_settings to authenticated;
grant all on public.referral_program_settings, public.referral_partners,
  public.referral_relationships, public.referral_sale_attributions,
  public.referral_balance_transactions, public.referral_balance_entries,
  public.referral_payout_requests to service_role;

create or replace function public.referral_emit_event(
  p_event_type text, p_entity_id uuid, p_payload jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  insert into public.domain_events(event_type, source, entity_id, payload)
  values (p_event_type, 'referrals', p_entity_id, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  insert into public.domain_executions(event_id, step, status, attempt)
  values (v_id, 'referrals.persisted', 'success', 1);
  return v_id;
end $$;
revoke all on function public.referral_emit_event(text, uuid, jsonb) from public;
grant execute on function public.referral_emit_event(text, uuid, jsonb) to service_role;

create or replace function public.referral_ensure_current_partner()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_profile public.profiles%rowtype;
  v_partner public.referral_partners%rowtype; v_settings public.referral_program_settings%rowtype;
  v_code text;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  select * into v_settings from public.referral_program_settings where singleton;
  if not coalesce(v_settings.is_enabled, false) or not coalesce(v_settings.partner_portal_enabled, false) then
    return jsonb_build_object('enabled', false);
  end if;
  select * into v_profile from public.profiles where user_id = v_uid and coalesce(is_archived, false) = false order by created_at limit 1;
  if v_profile.id is null then raise exception 'profile_not_found'; end if;
  select * into v_partner from public.referral_partners where profile_id = v_profile.id;
  if v_partner.id is null then
    v_code := 'REF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    insert into public.referral_partners(profile_id, partner_code, status, created_by)
    values (v_profile.id, v_code, 'active', v_uid) returning * into v_partner;
    perform public.referral_emit_event('referral.partner.created', v_partner.id, jsonb_build_object('profile_id', v_profile.id));
  end if;
  return jsonb_build_object('enabled', true, 'partner_id', v_partner.id, 'public_id', v_partner.public_id,
    'partner_code', v_partner.partner_code, 'status', v_partner.status);
end $$;
revoke all on function public.referral_ensure_current_partner() from public;
grant execute on function public.referral_ensure_current_partner() to authenticated;

create or replace function public.referral_admin_ensure_partner(p_profile_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_code text;
begin
  if not public.referral_is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and coalesce(is_archived, false) = false) then
    raise exception 'profile_not_found';
  end if;
  select id into v_id from public.referral_partners where profile_id = p_profile_id;
  if v_id is not null then return v_id; end if;
  v_code := 'REF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.referral_partners(profile_id, partner_code, status, created_by)
  values (p_profile_id, v_code, 'active', auth.uid()) returning id into v_id;
  insert into public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
  values (auth.uid(), 'user', 'referral_partner_created', 'referral_partner', v_id,
    jsonb_build_object('profile_id', p_profile_id));
  perform public.referral_emit_event('referral.partner.created', v_id, jsonb_build_object('profile_id', p_profile_id));
  return v_id;
end $$;
revoke all on function public.referral_admin_ensure_partner(uuid) from public;
grant execute on function public.referral_admin_ensure_partner(uuid) to authenticated;

create or replace function public.referral_attach_current_profile(p_partner_code text, p_captured_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_profile_id uuid; v_partner public.referral_partners%rowtype;
  v_relationship public.referral_relationships%rowtype; v_settings public.referral_program_settings%rowtype;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  select * into v_settings from public.referral_program_settings where singleton;
  if not coalesce(v_settings.is_enabled, false) or not coalesce(v_settings.tracking_enabled, false) then
    return jsonb_build_object('attached', false, 'reason', 'tracking_disabled');
  end if;
  if p_captured_at is null or p_captured_at > now() + interval '5 minutes' or p_captured_at < now() - interval '60 days' then
    return jsonb_build_object('attached', false, 'reason', 'invalid_or_expired_capture');
  end if;
  select id into v_profile_id from public.profiles
    where user_id = v_uid and coalesce(is_archived, false) = false and created_at >= p_captured_at - interval '10 minutes'
    order by created_at limit 1;
  if v_profile_id is null and exists (select 1 from public.profiles where user_id = v_uid and coalesce(is_archived, false) = false) then
    return jsonb_build_object('attached', false, 'reason', 'existing_profile_requires_admin');
  end if;
  if v_profile_id is null then raise exception 'profile_not_found'; end if;
  select * into v_partner from public.referral_partners where lower(partner_code) = lower(trim(p_partner_code)) and status = 'active';
  if v_partner.id is null then return jsonb_build_object('attached', false, 'reason', 'invalid_partner'); end if;
  if v_partner.profile_id = v_profile_id then return jsonb_build_object('attached', false, 'reason', 'self_referral'); end if;
  select * into v_relationship from public.referral_relationships where referred_profile_id = v_profile_id and status = 'active';
  if v_relationship.id is not null then
    return jsonb_build_object('attached', v_relationship.partner_id = v_partner.id, 'reason', 'already_attributed');
  end if;
  insert into public.referral_relationships(partner_id, referred_profile_id, source)
  values (v_partner.id, v_profile_id, 'partner_link') returning * into v_relationship;
  perform public.referral_emit_event('referral.relationship.created', v_relationship.id,
    jsonb_build_object('partner_id', v_partner.id, 'referred_profile_id', v_profile_id));
  return jsonb_build_object('attached', true, 'relationship_id', v_relationship.id);
end $$;
revoke all on function public.referral_attach_current_profile(text, timestamptz) from public;
grant execute on function public.referral_attach_current_profile(text, timestamptz) to authenticated;

create or replace function public.referral_admin_attach_profile(
  p_partner_profile_id uuid, p_referred_profile_id uuid, p_reason text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_partner_id uuid; v_id uuid;
begin
  if not public.referral_is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'reason_required'; end if;
  if p_partner_profile_id = p_referred_profile_id then raise exception 'self_referral'; end if;
  select id into v_partner_id from public.referral_partners where profile_id = p_partner_profile_id and status = 'active';
  if v_partner_id is null then raise exception 'active_partner_not_found'; end if;
  if exists (select 1 from public.referral_relationships where referred_profile_id = p_referred_profile_id and status = 'active') then
    raise exception 'profile_already_attributed';
  end if;
  insert into public.referral_relationships(partner_id, referred_profile_id, source, manual_reason, manual_actor_user_id)
  values (v_partner_id, p_referred_profile_id, 'admin_manual', trim(p_reason), auth.uid()) returning id into v_id;
  insert into public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
  values (auth.uid(), 'user', 'referral_relationship_manual_attach', 'referral_relationship', v_id,
    jsonb_build_object('reason', trim(p_reason), 'partner_profile_id', p_partner_profile_id, 'referred_profile_id', p_referred_profile_id));
  perform public.referral_emit_event('referral.relationship.created', v_id, jsonb_build_object('source', 'admin_manual'));
  return v_id;
end $$;
revoke all on function public.referral_admin_attach_profile(uuid, uuid, text) from public;
grant execute on function public.referral_admin_attach_profile(uuid, uuid, text) to authenticated;

create or replace function public.referral_process_order(p_order_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders_v2%rowtype; v_settings public.referral_program_settings%rowtype;
  v_relationship public.referral_relationships%rowtype; v_partner public.referral_partners%rowtype;
  v_payment_id uuid; v_paid_minor bigint; v_basis_minor bigint; v_commission_minor bigint;
  v_sale_id uuid; v_tx_id uuid; v_status text; v_available_at timestamptz;
begin
  select * into v_settings from public.referral_program_settings where singleton;
  if not coalesce(v_settings.is_enabled, false) or not coalesce(v_settings.accrual_enabled, false) then return null; end if;
  select * into v_order from public.orders_v2 where id = p_order_id for update;
  if v_order.id is null or v_order.status::text <> 'paid' or coalesce(v_order.is_deleted, false) then return null; end if;
  if coalesce(v_order.currency, '') <> 'BYN' or coalesce(v_order.paid_amount, 0) <= 0 then return null; end if;
  if coalesce(v_order.meta->>'split_from_order_id', '') <> '' then return null; end if;
  if coalesce(v_order.meta->>'is_test', 'false') = 'true' or coalesce(v_order.meta->>'sandbox', 'false') = 'true' then return null; end if;
  if exists (select 1 from public.referral_sale_attributions where order_id = p_order_id) then
    select id into v_sale_id from public.referral_sale_attributions where order_id = p_order_id; return v_sale_id;
  end if;
  if exists (select 1 from public.payments_v2 where order_id = p_order_id and status::text = 'succeeded' and coalesce(is_recurring, false)) then return null; end if;
  select (array_agg(id order by paid_at nulls last, created_at))[1], coalesce(sum(round(amount * 100)::bigint), 0)
    into v_payment_id, v_paid_minor
    from public.payments_v2
    where order_id = p_order_id and status::text = 'succeeded' and not coalesce(is_recurring, false) and not coalesce(is_deleted, false);
  if v_paid_minor <= 0 then return null; end if;
  select * into v_relationship from public.referral_relationships
    where referred_profile_id = v_order.profile_id and status = 'active' order by attached_at limit 1;
  if v_relationship.id is null then return null; end if;
  select * into v_partner from public.referral_partners where id = v_relationship.partner_id and status = 'active';
  if v_partner.id is null or v_partner.profile_id = v_order.profile_id then return null; end if;
  v_basis_minor := least(round(v_order.paid_amount * 100)::bigint, v_paid_minor);
  if v_basis_minor <= 0 then return null; end if;
  v_commission_minor := round(v_basis_minor * v_settings.commission_percent_bps::numeric / 10000)::bigint;
  if v_commission_minor <= 0 then return null; end if;
  v_status := case when v_settings.shadow_mode then 'shadow' else 'pending' end;
  v_available_at := now() + make_interval(days => v_settings.hold_days);
  insert into public.referral_sale_attributions(
    partner_id, relationship_id, order_id, payment_id, product_id, tariff_id, offer_id, status,
    commission_basis_minor, commission_basis_currency, commission_percent_bps, commission_minor,
    available_at, rule_snapshot, order_snapshot
  ) values (
    v_partner.id, v_relationship.id, v_order.id, v_payment_id, v_order.product_id, v_order.tariff_id, v_order.offer_id,
    v_status, v_basis_minor, 'BYN', v_settings.commission_percent_bps, v_commission_minor, v_available_at,
    jsonb_build_object('commission_percent_bps', v_settings.commission_percent_bps, 'hold_days', v_settings.hold_days, 'version', 1),
    jsonb_build_object('order_id', v_order.id, 'paid_amount', v_order.paid_amount, 'currency', v_order.currency,
      'product_id', v_order.product_id, 'tariff_id', v_order.tariff_id, 'offer_id', v_order.offer_id)
  ) returning id into v_sale_id;
  if not v_settings.shadow_mode then
    insert into public.referral_balance_transactions(partner_id, transaction_type, idempotency_key, source_type, source_id, description)
    values (v_partner.id, 'commission_pending', 'referral:commission:' || v_sale_id, 'sale_attribution', v_sale_id, '10% за покупку приглашённого')
    returning id into v_tx_id;
    insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor)
    values (v_tx_id, v_partner.id, 'pending', v_commission_minor);
  end if;
  perform public.referral_emit_event('referral.commission.' || v_status, v_sale_id,
    jsonb_build_object('partner_id', v_partner.id, 'order_id', v_order.id, 'commission_minor', v_commission_minor, 'currency', 'BYN'));
  insert into public.audit_logs(actor_type, actor_label, action, entity_type, entity_id, meta)
  values ('system', 'referrals', 'referral_commission_' || v_status, 'referral_sale_attribution', v_sale_id,
    jsonb_build_object('partner_id', v_partner.id, 'order_id', v_order.id, 'commission_minor', v_commission_minor, 'currency', 'BYN'));
  return v_sale_id;
exception when unique_violation then
  select id into v_sale_id from public.referral_sale_attributions where order_id = p_order_id; return v_sale_id;
end $$;
revoke all on function public.referral_process_order(uuid) from public;
grant execute on function public.referral_process_order(uuid) to service_role;

create or replace function public.referral_order_payment_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.referral_process_order(case when tg_table_name = 'orders_v2' then new.id else new.order_id end);
  return new;
end $$;
revoke all on function public.referral_order_payment_trigger() from public;

create trigger referral_order_paid_trigger
after insert or update of status, paid_amount on public.orders_v2
for each row when (new.status::text = 'paid') execute function public.referral_order_payment_trigger();

create trigger referral_payment_succeeded_trigger
after insert or update of status, paid_at on public.payments_v2
for each row when (new.status::text = 'succeeded' and new.order_id is not null)
execute function public.referral_order_payment_trigger();

create or replace function public.referral_process_orders_for_relationship()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order_id uuid; v_enabled_at timestamptz;
begin
  select enabled_at into v_enabled_at from public.referral_program_settings where singleton;
  if v_enabled_at is null then return new; end if;
  for v_order_id in
    select o.id from public.orders_v2 o
    where o.profile_id = new.referred_profile_id
      and o.status::text = 'paid'
      and o.created_at >= v_enabled_at
      and not exists (select 1 from public.referral_sale_attributions rsa where rsa.order_id = o.id)
    order by o.created_at
    limit 100
  loop
    perform public.referral_process_order(v_order_id);
  end loop;
  return new;
end $$;
revoke all on function public.referral_process_orders_for_relationship() from public;
create trigger referral_relationship_process_recent_orders
after insert on public.referral_relationships
for each row when (new.status = 'active') execute function public.referral_process_orders_for_relationship();

create or replace function public.referral_reconcile_orders(p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order_id uuid; v_enabled_at timestamptz; v_scanned integer := 0; v_created integer := 0; v_result uuid;
begin
  if not (public.referral_is_admin(auth.uid()) or coalesce(auth.jwt()->>'role', '') = 'service_role') then raise exception 'forbidden'; end if;
  select enabled_at into v_enabled_at from public.referral_program_settings where singleton;
  if v_enabled_at is null then return jsonb_build_object('scanned', 0, 'created', 0, 'reason', 'program_never_enabled'); end if;
  for v_order_id in
    select o.id from public.orders_v2 o
    join public.referral_relationships rr on rr.referred_profile_id = o.profile_id and rr.status = 'active'
    where o.status::text = 'paid' and o.created_at >= v_enabled_at
      and not exists (select 1 from public.referral_sale_attributions rsa where rsa.order_id = o.id)
    order by o.created_at
    limit least(greatest(p_limit, 1), 2000)
  loop
    v_scanned := v_scanned + 1;
    v_result := public.referral_process_order(v_order_id);
    if v_result is not null then v_created := v_created + 1; end if;
  end loop;
  return jsonb_build_object('scanned', v_scanned, 'created', v_created);
end $$;
revoke all on function public.referral_reconcile_orders(integer) from public;
grant execute on function public.referral_reconcile_orders(integer) to service_role;

create or replace function public.referral_mature_due_commissions(p_limit integer default 500)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sale public.referral_sale_attributions%rowtype; v_tx uuid; v_count integer := 0; v_remaining bigint;
begin
  if not (public.referral_is_admin(auth.uid()) or coalesce(auth.jwt()->>'role', '') = 'service_role') then raise exception 'forbidden'; end if;
  for v_sale in select * from public.referral_sale_attributions
    where status in ('pending', 'partially_reversed') and available_at <= now() order by available_at for update skip locked limit least(greatest(p_limit, 1), 2000)
  loop
    v_tx := null;
    v_remaining := v_sale.commission_minor - v_sale.reversed_minor;
    if v_remaining > 0 then
      insert into public.referral_balance_transactions(partner_id, transaction_type, idempotency_key, source_type, source_id, description)
      values (v_sale.partner_id, 'commission_available', 'referral:mature:' || v_sale.id, 'sale_attribution', v_sale.id, 'Комиссия доступна к выплате')
      on conflict (idempotency_key) do nothing returning id into v_tx;
      if v_tx is not null then
        insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor)
        values (v_tx, v_sale.partner_id, 'pending', -v_remaining), (v_tx, v_sale.partner_id, 'available', v_remaining);
      end if;
    end if;
    update public.referral_sale_attributions set status = case when v_remaining > 0 then 'available' else 'reversed' end, updated_at = now() where id = v_sale.id;
    if v_remaining > 0 then
      perform public.referral_emit_event('referral.commission.available', v_sale.id,
        jsonb_build_object('partner_id', v_sale.partner_id, 'available_minor', v_remaining, 'currency', 'BYN'));
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function public.referral_mature_due_commissions(integer) from public;
grant execute on function public.referral_mature_due_commissions(integer) to authenticated, service_role;

create or replace function public.referral_process_refund(p_order_id uuid)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sale public.referral_sale_attributions%rowtype; v_refunded_minor bigint; v_target bigint; v_delta bigint;
  v_tx uuid; v_bucket text;
begin
  select * into v_sale from public.referral_sale_attributions where order_id = p_order_id for update;
  if v_sale.id is null or v_sale.status in ('shadow', 'declined') then return 0; end if;
  select greatest(
      coalesce(sum(round(greatest(coalesce(refunded_amount, 0), 0) * 100)::bigint)
        filter (where amount >= 0), 0),
      coalesce(sum(round(abs(amount) * 100)::bigint)
        filter (where amount < 0 and (coalesce(transaction_type, '') ilike '%refund%' or status::text = 'refunded')), 0)
    ) into v_refunded_minor
    from public.payments_v2 where order_id = p_order_id and not coalesce(is_deleted, false);
  v_target := least(v_sale.commission_minor,
    floor(v_sale.commission_minor::numeric * least(v_refunded_minor, v_sale.commission_basis_minor) / v_sale.commission_basis_minor)::bigint);
  v_delta := greatest(v_target - v_sale.reversed_minor, 0);
  if v_delta = 0 then return 0; end if;
  select case when coalesce(sum(amount_minor) filter (where bucket = 'pending'), 0) > 0 then 'pending' else 'available' end
    into v_bucket from public.referral_balance_entries where partner_id = v_sale.partner_id;
  insert into public.referral_balance_transactions(partner_id, transaction_type, idempotency_key, source_type, source_id, description, metadata)
  values (v_sale.partner_id, 'refund_reversal', 'referral:refund:' || v_sale.id || ':' || v_target,
    'sale_attribution', v_sale.id, 'Корректировка комиссии после возврата', jsonb_build_object('refunded_minor', v_refunded_minor))
  returning id into v_tx;
  insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor)
  values (v_tx, v_sale.partner_id, v_bucket, -v_delta);
  update public.referral_sale_attributions set reversed_minor = v_target,
    status = case when v_target >= commission_minor then 'reversed' else 'partially_reversed' end,
    updated_at = now() where id = v_sale.id;
  perform public.referral_emit_event('referral.commission.reversed', v_sale.id,
    jsonb_build_object('reversal_minor', v_delta, 'cumulative_reversed_minor', v_target));
  insert into public.audit_logs(actor_type, actor_label, action, entity_type, entity_id, meta)
  values ('system', 'referrals', 'referral_commission_reversed', 'referral_sale_attribution', v_sale.id,
    jsonb_build_object('reversal_minor', v_delta, 'cumulative_reversed_minor', v_target, 'order_id', p_order_id));
  return v_delta;
end $$;
revoke all on function public.referral_process_refund(uuid) from public;
grant execute on function public.referral_process_refund(uuid) to service_role;

create or replace function public.referral_refund_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.order_id is not null then perform public.referral_process_refund(new.order_id); end if;
  return new;
end $$;
revoke all on function public.referral_refund_trigger() from public;

create trigger referral_payment_refund_trigger
after update of refunded_amount, refunds, status on public.payments_v2
for each row when (
  new.order_id is not null and (
    coalesce(new.refunded_amount, 0) > coalesce(old.refunded_amount, 0)
    or (new.status::text = 'refunded' and old.status::text <> 'refunded')
  )
) execute function public.referral_refund_trigger();

create trigger referral_payment_refund_insert_trigger
after insert on public.payments_v2
for each row when (
  new.order_id is not null and (
    coalesce(new.refunded_amount, 0) > 0
    or new.amount < 0
    or new.status::text = 'refunded'
  )
) execute function public.referral_refund_trigger();

create or replace function public.referral_get_my_dashboard()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_partner public.referral_partners%rowtype; v_profile_id uuid;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  select id into v_profile_id from public.profiles where user_id = v_uid and coalesce(is_archived, false) = false order by created_at limit 1;
  select * into v_partner from public.referral_partners where profile_id = v_profile_id;
  if v_partner.id is null then return jsonb_build_object('partner', null); end if;
  return jsonb_build_object(
    'partner', jsonb_build_object('id', v_partner.id, 'public_id', v_partner.public_id, 'partner_code', v_partner.partner_code, 'status', v_partner.status),
    'payouts', (select jsonb_build_object(
      'enabled', payout_requests_enabled,
      'minimum_payout_minor', minimum_payout_minor
    ) from public.referral_program_settings where singleton),
    'balances', (select jsonb_build_object(
      'pending_minor', coalesce(sum(amount_minor) filter (where bucket = 'pending'), 0),
      'available_minor', coalesce(sum(amount_minor) filter (where bucket = 'available'), 0),
      'held_minor', coalesce(sum(amount_minor) filter (where bucket = 'held'), 0),
      'paid_minor', coalesce(sum(amount_minor) filter (where bucket = 'paid'), 0),
      'currency', 'BYN') from public.referral_balance_entries where partner_id = v_partner.id),
    'referrals', (select coalesce(jsonb_agg(jsonb_build_object(
      'relationship_id', rr.id, 'profile_id', rr.referred_profile_id,
      'display_name', coalesce(nullif(p.full_name, ''), 'Пользователь'), 'attached_at', rr.attached_at,
      'sales_count', (select count(*) from public.referral_sale_attributions rsa where rsa.relationship_id = rr.id),
      'commission_minor', (select coalesce(sum(rsa.commission_minor - rsa.reversed_minor), 0) from public.referral_sale_attributions rsa where rsa.relationship_id = rr.id)
    ) order by rr.attached_at desc), '[]'::jsonb)
      from public.referral_relationships rr join public.profiles p on p.id = rr.referred_profile_id
      where rr.partner_id = v_partner.id and rr.status = 'active'),
    'sales', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', rsa.id, 'public_id', rsa.public_id, 'created_at', rsa.created_at, 'status', rsa.status,
      'basis_minor', rsa.commission_basis_minor, 'commission_minor', rsa.commission_minor,
      'reversed_minor', rsa.reversed_minor, 'product_name', coalesce(pr.name, 'Продукт')
    ) order by rsa.created_at desc), '[]'::jsonb)
      from public.referral_sale_attributions rsa left join public.products_v2 pr on pr.id = rsa.product_id
      where rsa.partner_id = v_partner.id)
  );
end $$;
revoke all on function public.referral_get_my_dashboard() from public;
grant execute on function public.referral_get_my_dashboard() to authenticated;

create or replace function public.referral_create_payout_request(p_amount_minor bigint)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_partner_id uuid; v_available bigint; v_min bigint; v_request uuid; v_tx uuid;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  select rp.id into v_partner_id from public.referral_partners rp join public.profiles p on p.id = rp.profile_id
    where p.user_id = v_uid and rp.status = 'active';
  if v_partner_id is null then raise exception 'active_partner_not_found'; end if;
  select minimum_payout_minor into v_min from public.referral_program_settings where singleton and payout_requests_enabled;
  if v_min is null then raise exception 'payout_requests_disabled'; end if;
  if p_amount_minor <= 0 or p_amount_minor < v_min then raise exception 'amount_below_minimum'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_partner_id::text, 0));
  select coalesce(sum(amount_minor), 0) into v_available from public.referral_balance_entries
    where partner_id = v_partner_id and bucket = 'available';
  if v_available < p_amount_minor then raise exception 'insufficient_balance'; end if;
  insert into public.referral_payout_requests(partner_id, amount_minor) values (v_partner_id, p_amount_minor) returning id into v_request;
  insert into public.referral_balance_transactions(partner_id, transaction_type, idempotency_key, source_type, source_id, description)
  values (v_partner_id, 'payout_hold', 'referral:payout:hold:' || v_request, 'payout_request', v_request, 'Резерв под заявку на выплату') returning id into v_tx;
  insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor)
  values (v_tx, v_partner_id, 'available', -p_amount_minor), (v_tx, v_partner_id, 'held', p_amount_minor);
  perform public.referral_emit_event('referral.payout.requested', v_request, jsonb_build_object('amount_minor', p_amount_minor, 'currency', 'BYN'));
  return v_request;
end $$;
revoke all on function public.referral_create_payout_request(bigint) from public;
grant execute on function public.referral_create_payout_request(bigint) to authenticated;

create or replace function public.referral_admin_decide_payout(
  p_request_id uuid, p_decision text, p_reason text default null, p_payment_reference text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_req public.referral_payout_requests%rowtype; v_tx uuid; v_type text;
begin
  if not public.referral_is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if p_decision not in ('paid', 'rejected') then raise exception 'invalid_decision'; end if;
  select * into v_req from public.referral_payout_requests where id = p_request_id for update;
  if v_req.id is null then raise exception 'request_not_found'; end if;
  if v_req.status not in ('pending', 'approved') then raise exception 'request_already_decided'; end if;
  if p_decision = 'paid' and nullif(trim(coalesce(p_payment_reference, '')), '') is null then raise exception 'payment_reference_required'; end if;
  v_type := case when p_decision = 'paid' then 'payout_paid' else 'payout_release' end;
  insert into public.referral_balance_transactions(partner_id, transaction_type, idempotency_key, source_type, source_id, description)
  values (v_req.partner_id, v_type, 'referral:payout:' || p_decision || ':' || v_req.id, 'payout_request', v_req.id,
    case when p_decision = 'paid' then 'Выплата подтверждена администратором' else 'Резерв выплаты возвращён' end) returning id into v_tx;
  if p_decision = 'paid' then
    insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor)
    values (v_tx, v_req.partner_id, 'held', -v_req.amount_minor), (v_tx, v_req.partner_id, 'paid', v_req.amount_minor);
  else
    insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor)
    values (v_tx, v_req.partner_id, 'held', -v_req.amount_minor), (v_tx, v_req.partner_id, 'available', v_req.amount_minor);
  end if;
  update public.referral_payout_requests set status = p_decision, decision_reason = nullif(trim(p_reason), ''),
    payment_reference = nullif(trim(p_payment_reference), ''), decided_at = now(),
    paid_at = case when p_decision = 'paid' then now() else null end, decided_by = auth.uid(), updated_at = now()
    where id = v_req.id;
  insert into public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
  values (auth.uid(), 'user', 'referral_payout_' || p_decision, 'referral_payout_request', v_req.id,
    jsonb_build_object('amount_minor', v_req.amount_minor, 'reason', p_reason, 'payment_reference', p_payment_reference));
  perform public.referral_emit_event('referral.payout.' || p_decision, v_req.id, jsonb_build_object('amount_minor', v_req.amount_minor));
end $$;
revoke all on function public.referral_admin_decide_payout(uuid, text, text, text) from public;
grant execute on function public.referral_admin_decide_payout(uuid, text, text, text) to authenticated;

-- Seed the RBAC catalog directly; the frontend registry remains the canonical sync payload.
insert into public.admin_section(code, label, route_prefix, group_code, sort_order, is_active)
values ('referrals', 'Реферальная программа', '/admin/referrals', 'crm', 60, true)
on conflict (code) do update set label = excluded.label, route_prefix = excluded.route_prefix, is_active = true;

-- No production test partners, relationships, sales or ledger entries are seeded.
