-- Referral customer discount wallet.
-- Recurring subscriptions keep their full provider plan price; the configured
-- invited-customer discount is credited here after a successful payment.

create table public.referral_customer_credit_entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  amount_minor bigint not null check (amount_minor <> 0),
  entry_type text not null check (entry_type in ('subscription_earn','purchase_reserve','refund_reversal','admin_adjustment')),
  status text not null default 'posted' check (status in ('posted','reserved','consumed','released')),
  source_payment_id uuid references public.payments_v2(id),
  reversal_of_entry_id uuid references public.referral_customer_credit_entries(id),
  source_order_id uuid references public.orders_v2(id),
  applied_order_id uuid references public.orders_v2(id),
  checkout_key text,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_customer_credit_source_payment_unique unique (source_payment_id),
  constraint referral_customer_credit_checkout_key_unique unique (checkout_key),
  constraint referral_customer_credit_reversal_unique unique (reversal_of_entry_id)
);

create index referral_customer_credit_profile_idx
  on public.referral_customer_credit_entries(profile_id, created_at desc);
create index referral_customer_credit_reserved_expiry_idx
  on public.referral_customer_credit_entries(expires_at)
  where status = 'reserved';

alter table public.referral_customer_credit_entries enable row level security;
create policy referral_customer_credit_owner_select
  on public.referral_customer_credit_entries for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = profile_id and p.user_id = (select auth.uid())
  ));
revoke all on public.referral_customer_credit_entries from anon, authenticated, public;
grant select on public.referral_customer_credit_entries to authenticated;
grant all on public.referral_customer_credit_entries to service_role;

create trigger referral_customer_credit_updated_at
before update on public.referral_customer_credit_entries
for each row execute function public.update_updated_at_column();

create or replace function public.referral_customer_credit_available(p_profile_id uuid)
returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(amount_minor) filter (
    where status in ('posted','reserved','consumed')
  ), 0)::bigint
  from public.referral_customer_credit_entries
  where profile_id = p_profile_id
$$;
revoke all on function public.referral_customer_credit_available(uuid) from public;
grant execute on function public.referral_customer_credit_available(uuid) to service_role;

create or replace function public.referral_get_my_customer_credit()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_profile_id uuid; v_available bigint;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select id into v_profile_id from public.profiles
    where user_id = auth.uid() and coalesce(is_archived, false) = false
    order by created_at limit 1;
  if v_profile_id is null then return jsonb_build_object('available_minor', 0, 'currency', 'BYN'); end if;
  update public.referral_customer_credit_entries
    set status = 'released'
    where profile_id = v_profile_id and status = 'reserved' and expires_at < now()
      and applied_order_id is null;
  v_available := public.referral_customer_credit_available(v_profile_id);
  return jsonb_build_object('available_minor', greatest(v_available, 0), 'currency', 'BYN');
end $$;
revoke all on function public.referral_get_my_customer_credit() from public;
grant execute on function public.referral_get_my_customer_credit() to authenticated;

create or replace function public.referral_reserve_customer_credit(
  p_user_id uuid,
  p_requested_minor bigint,
  p_charge_amount_minor bigint,
  p_checkout_key text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_profile_id uuid; v_available bigint; v_apply bigint; v_id uuid; v_existing public.referral_customer_credit_entries%rowtype;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'forbidden'; end if;
  if p_requested_minor <= 0 or p_charge_amount_minor <= 100 or nullif(trim(p_checkout_key), '') is null then
    return jsonb_build_object('applied_minor', 0, 'reservation_id', null);
  end if;
  select id into v_profile_id from public.profiles
    where user_id = p_user_id and coalesce(is_archived, false) = false
    order by created_at limit 1;
  if v_profile_id is null then return jsonb_build_object('applied_minor', 0, 'reservation_id', null); end if;
  perform pg_advisory_xact_lock(hashtextextended('referral-credit:' || v_profile_id::text, 0));
  select * into v_existing from public.referral_customer_credit_entries where checkout_key = p_checkout_key;
  if v_existing.id is not null then
    if v_existing.profile_id <> v_profile_id then raise exception 'checkout_key_conflict'; end if;
    if v_existing.status in ('reserved','consumed') then
      return jsonb_build_object('applied_minor', abs(v_existing.amount_minor), 'reservation_id', v_existing.id);
    end if;
    return jsonb_build_object('applied_minor', 0, 'reservation_id', null);
  end if;
  update public.referral_customer_credit_entries set status = 'released'
    where profile_id = v_profile_id and status = 'reserved' and expires_at < now() and applied_order_id is null;
  v_available := greatest(public.referral_customer_credit_available(v_profile_id), 0);
  -- Acquiring checkouts must retain at least 1 BYN. Zero-price fulfilment is a separate flow.
  v_apply := least(p_requested_minor, v_available, p_charge_amount_minor - 100);
  if v_apply <= 0 then return jsonb_build_object('applied_minor', 0, 'reservation_id', null); end if;
  insert into public.referral_customer_credit_entries(
    profile_id, amount_minor, entry_type, status, checkout_key, expires_at, metadata
  ) values (
    v_profile_id, -v_apply, 'purchase_reserve', 'reserved', trim(p_checkout_key), now() + interval '2 hours',
    jsonb_build_object('charge_amount_minor', p_charge_amount_minor)
  ) returning id into v_id;
  return jsonb_build_object('applied_minor', v_apply, 'reservation_id', v_id);
end $$;
revoke all on function public.referral_reserve_customer_credit(uuid,bigint,bigint,text) from public;
grant execute on function public.referral_reserve_customer_credit(uuid,bigint,bigint,text) to service_role;

create or replace function public.referral_customer_credit_order_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_reservation_id uuid;
begin
  begin v_reservation_id := nullif(new.meta->>'referral_customer_credit_reservation_id','')::uuid;
  exception when invalid_text_representation then v_reservation_id := null; end;
  if v_reservation_id is null then return new; end if;
  if new.status::text = 'paid' then
    update public.referral_customer_credit_entries
      set status = 'consumed', applied_order_id = new.id, expires_at = null
      where id = v_reservation_id and status in ('reserved','consumed');
  elsif new.status::text in ('failed','cancelled','canceled','refunded') then
    update public.referral_customer_credit_entries
      set status = 'released', applied_order_id = new.id, expires_at = null
      where id = v_reservation_id and status = 'reserved';
  else
    update public.referral_customer_credit_entries
      set applied_order_id = new.id
      where id = v_reservation_id and status = 'reserved' and applied_order_id is null;
  end if;
  return new;
end $$;
revoke all on function public.referral_customer_credit_order_trigger() from public;
create trigger referral_customer_credit_order_state
after insert or update of status on public.orders_v2
for each row execute function public.referral_customer_credit_order_trigger();

create or replace function public.referral_credit_subscription_payment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order public.orders_v2%rowtype; v_settings public.referral_program_settings%rowtype;
  v_profile_id uuid; v_discount_bps integer; v_earn bigint; v_mode text;
  v_original public.referral_customer_credit_entries%rowtype;
begin
  if new.status::text = 'refunded' then
    select * into v_original from public.referral_customer_credit_entries
      where source_payment_id = new.id and entry_type = 'subscription_earn';
    if v_original.id is not null then
      insert into public.referral_customer_credit_entries(
        profile_id, amount_minor, entry_type, status, source_order_id, reversal_of_entry_id, metadata
      ) values (
        v_original.profile_id, -abs(v_original.amount_minor), 'refund_reversal', 'posted',
        v_original.source_order_id, v_original.id, jsonb_build_object('refunded_payment_id', new.id)
      ) on conflict (reversal_of_entry_id) do nothing;
    end if;
    return new;
  end if;
  if new.status::text <> 'succeeded' or new.order_id is null or coalesce(new.amount,0) <= 0 then return new; end if;
  if exists (select 1 from public.referral_customer_credit_entries where source_payment_id = new.id) then return new; end if;
  select * into v_order from public.orders_v2 where id = new.order_id;
  if v_order.id is null or v_order.profile_id is null then return new; end if;
  -- Finite internal installments are purchases: their immediate discount remains active.
  if coalesce(v_order.meta->'installment'->>'as_finite_subscription','false') = 'true' then return new; end if;
  if coalesce(v_order.meta->>'payment_type','') <> 'subscription' and not coalesce(new.is_recurring,false) then return new; end if;
  if not exists (select 1 from public.referral_relationships where referred_profile_id = v_order.profile_id and status = 'active') then return new; end if;
  select * into v_settings from public.referral_program_settings where singleton;
  if not coalesce(v_settings.is_enabled,false) or not coalesce(v_settings.tracking_enabled,false) then return new; end if;
  select referral_settings_mode,
    case referral_settings_mode when 'disabled' then 0 when 'custom' then coalesce(referral_customer_discount_percent_bps,v_settings.customer_discount_percent_bps)
      else v_settings.customer_discount_percent_bps end
    into v_mode, v_discount_bps from public.products_v2 where id = v_order.product_id;
  v_discount_bps := coalesce(v_discount_bps,0);
  if v_discount_bps <= 0 then return new; end if;
  v_earn := round(new.amount * 100 * v_discount_bps::numeric / 10000)::bigint;
  if v_earn <= 0 then return new; end if;
  insert into public.referral_customer_credit_entries(
    profile_id, amount_minor, entry_type, status, source_payment_id, source_order_id, metadata
  ) values (
    v_order.profile_id, v_earn, 'subscription_earn', 'posted', new.id, v_order.id,
    jsonb_build_object('discount_percent_bps',v_discount_bps,'rule',v_mode,'payment_is_recurring',coalesce(new.is_recurring,false))
  ) on conflict (source_payment_id) do nothing;
  return new;
end $$;
revoke all on function public.referral_credit_subscription_payment() from public;
create trigger referral_credit_subscription_payment_trigger
after insert or update of status on public.payments_v2
for each row when (new.status::text in ('succeeded','refunded') and new.order_id is not null)
execute function public.referral_credit_subscription_payment();

-- Never reduce an open-ended provider subscription plan. The discount becomes wallet credit after payment.
create or replace function public.referral_apply_customer_discount()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_settings public.referral_program_settings%rowtype; v_mode text; v_discount_bps integer; v_base numeric; v_existing_bps integer;
begin
  if new.profile_id is null or new.product_id is null or new.status::text = 'paid' then return new; end if;
  if coalesce(new.meta->>'payment_type','') = 'subscription'
     and coalesce(new.meta->'installment'->>'as_finite_subscription','false') <> 'true' then return new; end if;
  select * into v_settings from public.referral_program_settings where singleton;
  if not coalesce(v_settings.is_enabled,false) or not coalesce(v_settings.tracking_enabled,false) then return new; end if;
  if not exists (select 1 from public.referral_relationships where referred_profile_id = new.profile_id and status = 'active') then return new; end if;
  select referral_settings_mode, case referral_settings_mode when 'disabled' then 0
    when 'custom' then coalesce(referral_customer_discount_percent_bps,v_settings.customer_discount_percent_bps)
    else v_settings.customer_discount_percent_bps end into v_mode,v_discount_bps
    from public.products_v2 where id = new.product_id;
  if coalesce(v_discount_bps,0) <= 0 then return new; end if;
  v_base := coalesce(new.base_price,new.final_price);
  if v_base is null or v_base <= 0 then return new; end if;
  v_existing_bps := case when new.final_price is null then 0 else greatest(0,least(10000,round((1-new.final_price/v_base)*10000)::integer)) end;
  if v_existing_bps >= v_discount_bps then return new; end if;
  new.base_price := v_base; new.discount_percent := v_discount_bps::numeric/100;
  new.final_price := round(v_base*(10000-v_discount_bps)::numeric/10000,2);
  new.meta := coalesce(new.meta,'{}'::jsonb) || jsonb_build_object('referral_discount_percent_bps',v_discount_bps,'referral_discount_applied',true,'referral_discount_rule',v_mode);
  return new;
end $$;
revoke all on function public.referral_apply_customer_discount() from public;