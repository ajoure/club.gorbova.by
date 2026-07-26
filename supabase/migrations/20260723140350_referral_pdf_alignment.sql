-- PDF alignment: tiered commissions, Club first-payment rule, bonus wallet,
-- 40/60 payout guard, minimum payout, free-program links and notification hooks.

alter table public.referral_program_settings
  add column if not exists commission_scheme text not null default 'flat',
  add column if not exists tier_1_limit integer not null default 10,
  add column if not exists tier_1_commission_percent_bps integer not null default 1000,
  add column if not exists tier_2_limit integer not null default 20,
  add column if not exists tier_2_commission_percent_bps integer not null default 2000,
  add column if not exists tier_3_commission_percent_bps integer not null default 3000,
  add column if not exists club_first_payment_percent_bps integer not null default 3000,
  add column if not exists partner_bonus_enabled boolean not null default true,
  add column if not exists telegram_notifications_enabled boolean not null default true;

alter table public.referral_program_settings
  drop constraint if exists referral_program_settings_commission_scheme_check,
  drop constraint if exists referral_program_settings_tier_1_limit_check,
  drop constraint if exists referral_program_settings_tier_2_limit_check;
alter table public.referral_program_settings
  add constraint referral_program_settings_commission_scheme_check
    check (commission_scheme in ('flat', 'tiered', 'club_first_payment')),
  add constraint referral_program_settings_tier_1_limit_check check (tier_1_limit between 1 and 100000),
  add constraint referral_program_settings_tier_2_limit_check check (tier_2_limit between 1 and 100000);

alter table public.referral_program_settings
  alter column split_60_40_enabled set default true,
  alter column withdrawable_percent_bps set default 4000,
  alter column minimum_payout_minor set default 100000;
update public.referral_program_settings
set split_60_40_enabled = true,
    withdrawable_percent_bps = 4000,
    minimum_payout_minor = greatest(minimum_payout_minor, 100000),
    updated_at = now()
where singleton;

alter table public.products_v2
  add column if not exists referral_commission_scheme text,
  add column if not exists referral_tier_1_limit integer,
  add column if not exists referral_tier_1_commission_percent_bps integer,
  add column if not exists referral_tier_2_limit integer,
  add column if not exists referral_tier_2_commission_percent_bps integer,
  add column if not exists referral_tier_3_commission_percent_bps integer,
  add column if not exists referral_club_first_payment_percent_bps integer,
  add column if not exists referral_bonus_eligible boolean not null default true;
alter table public.products_v2
  drop constraint if exists products_v2_referral_commission_scheme_check;
alter table public.products_v2
  add constraint products_v2_referral_commission_scheme_check
    check (referral_commission_scheme is null or referral_commission_scheme in ('flat', 'tiered', 'club_first_payment'));

-- The product name differs between environments; this bounded, idempotent match
-- covers the known Club labels without touching unrelated products.
update public.products_v2
set referral_settings_mode = 'custom',
    referral_commission_percent_bps = 3000,
    referral_commission_scheme = 'club_first_payment',
    referral_club_first_payment_percent_bps = 3000,
    referral_bonus_eligible = false
where lower(coalesce(name, '')) like '%global club%'
   or lower(coalesce(name, '')) like '%gorbova club%'
   or lower(coalesce(name, '')) like '%буква закона%';

alter table public.referral_balance_transactions
  drop constraint if exists referral_balance_transactions_transaction_type_check;
alter table public.referral_balance_transactions
  add constraint referral_balance_transactions_transaction_type_check
  check (transaction_type in ('commission_pending', 'commission_available', 'refund_reversal',
    'payout_hold', 'payout_release', 'payout_paid', 'manual_adjustment',
    'bonus_reserve', 'bonus_release', 'bonus_spend'));
alter table public.referral_balance_entries
  drop constraint if exists referral_balance_entries_bucket_check;
alter table public.referral_balance_entries
  add constraint referral_balance_entries_bucket_check
  check (bucket in ('pending', 'internal_pending', 'available', 'internal', 'held', 'paid', 'internal_held', 'internal_spent'));

create table if not exists public.referral_bonus_reservations (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.referral_partners(id),
  amount_minor bigint not null check (amount_minor > 0),
  status text not null default 'reserved' check (status in ('reserved', 'consumed', 'released')),
  checkout_key text not null unique,
  applied_order_id uuid references public.orders_v2(id),
  product_id uuid references public.products_v2(id),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists referral_bonus_reservations_partner_idx
  on public.referral_bonus_reservations(partner_id, status, expires_at);

create table if not exists public.referral_program_links (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.referral_partners(id),
  title text not null,
  target_path text not null check (target_path like '/%' and target_path not like '%//%'),
  product_id uuid references public.products_v2(id),
  link_code text not null unique default ('REF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  program_kind text not null default 'free' check (program_kind = 'free'),
  status text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists referral_program_links_partner_idx on public.referral_program_links(partner_id, created_at desc);

alter table public.referral_bonus_reservations enable row level security;
alter table public.referral_program_links enable row level security;
create policy referral_bonus_owner_select on public.referral_bonus_reservations for select to authenticated using (
  public.referral_is_admin((select auth.uid())) or exists (
    select 1 from public.referral_partners rp join public.profiles p on p.id = rp.profile_id
    where rp.id = partner_id and p.user_id = (select auth.uid())
  )
);
create policy referral_program_links_owner_select on public.referral_program_links for select to authenticated using (
  public.referral_is_admin((select auth.uid())) or exists (
    select 1 from public.referral_partners rp join public.profiles p on p.id = rp.profile_id
    where rp.id = partner_id and p.user_id = (select auth.uid())
  )
);
grant select on public.referral_bonus_reservations, public.referral_program_links to authenticated;
grant all on public.referral_bonus_reservations, public.referral_program_links to service_role;

create or replace function public.referral_get_my_bonus_wallet(p_product_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_partner_id uuid; v_available bigint; v_eligible boolean;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  select rp.id into v_partner_id from public.referral_partners rp join public.profiles p on p.id = rp.profile_id
    where p.user_id = v_uid and rp.status = 'active' limit 1;
  select coalesce(s.partner_bonus_enabled, false) and coalesce(p.referral_bonus_eligible, true)
    and coalesce(p.referral_settings_mode, 'inherit') <> 'disabled'
    into v_eligible
    from public.referral_program_settings s left join public.products_v2 p on p.id = p_product_id where s.singleton;
  if v_partner_id is null then return jsonb_build_object('available_minor', 0, 'currency', 'BYN', 'eligible', false); end if;
  select greatest(coalesce(sum(e.amount_minor) filter (where e.bucket = 'internal'), 0)
    - coalesce((select sum(r.amount_minor) from public.referral_bonus_reservations r where r.partner_id = v_partner_id and r.status = 'reserved' and r.expires_at > now()), 0), 0)
    into v_available from public.referral_balance_entries e where e.partner_id = v_partner_id;
  return jsonb_build_object('available_minor', case when coalesce(v_eligible, false) then v_available else 0 end,
    'currency', 'BYN', 'eligible', coalesce(v_eligible, false));
end $$;
revoke all on function public.referral_get_my_bonus_wallet(uuid) from public;
grant execute on function public.referral_get_my_bonus_wallet(uuid) to authenticated;

create or replace function public.referral_reserve_partner_bonus(
  p_user_id uuid, p_requested_minor bigint, p_charge_amount_minor bigint,
  p_checkout_key text, p_product_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_partner_id uuid; v_available bigint; v_apply bigint; v_existing public.referral_bonus_reservations%rowtype; v_tx uuid;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_requested_minor <= 0 or p_charge_amount_minor <= 100 then return jsonb_build_object('applied_minor', 0); end if;
  if not exists (select 1 from public.referral_program_settings s where s.singleton and s.is_enabled and s.partner_bonus_enabled)
     or exists (select 1 from public.products_v2 p where p.id = p_product_id and (p.referral_bonus_eligible = false or p.referral_settings_mode = 'disabled')) then
    return jsonb_build_object('applied_minor', 0, 'eligible', false);
  end if;
  select * into v_existing from public.referral_bonus_reservations where checkout_key = p_checkout_key;
  if v_existing.id is not null then return jsonb_build_object('applied_minor', v_existing.amount_minor, 'reservation_id', v_existing.id); end if;
  select rp.id into v_partner_id from public.referral_partners rp join public.profiles p on p.id = rp.profile_id
    where p.user_id = p_user_id and rp.status = 'active' for update;
  if v_partner_id is null then return jsonb_build_object('applied_minor', 0); end if;
  update public.referral_bonus_reservations set status = 'released', updated_at = now()
    where partner_id = v_partner_id and status = 'reserved' and expires_at <= now();
  select greatest(coalesce(sum(amount_minor) filter (where bucket = 'internal'), 0)
    - coalesce((select sum(amount_minor) from public.referral_bonus_reservations where partner_id = v_partner_id and status = 'reserved'), 0), 0)
    into v_available from public.referral_balance_entries where partner_id = v_partner_id;
  v_apply := least(p_requested_minor, v_available, greatest(p_charge_amount_minor - 100, 0));
  if v_apply <= 0 then return jsonb_build_object('applied_minor', 0); end if;
  insert into public.referral_bonus_reservations(partner_id, amount_minor, checkout_key, product_id)
    values (v_partner_id, v_apply, p_checkout_key, p_product_id) returning * into v_existing;
  insert into public.referral_balance_transactions(partner_id, transaction_type, idempotency_key, source_type, source_id, description)
    values (v_partner_id, 'bonus_reserve', 'referral:bonus:reserve:' || v_existing.id, 'bonus_reservation', v_existing.id, 'Резерв внутреннего бонуса') returning id into v_tx;
  insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor)
    values (v_tx, v_partner_id, 'internal', -v_apply), (v_tx, v_partner_id, 'internal_held', v_apply);
  return jsonb_build_object('applied_minor', v_apply, 'reservation_id', v_existing.id);
end $$;
revoke all on function public.referral_reserve_partner_bonus(uuid, bigint, bigint, text, uuid) from public;
grant execute on function public.referral_reserve_partner_bonus(uuid, bigint, bigint, text, uuid) to service_role;

create or replace function public.referral_create_program_link(p_title text, p_target_path text, p_product_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_partner_id uuid; v_link public.referral_program_links%rowtype;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  if p_target_path is null or p_target_path not like '/%' or p_target_path like '%//%' or p_target_path like '%://%' then raise exception 'invalid_target_path'; end if;
  select rp.id into v_partner_id from public.referral_partners rp join public.profiles p on p.id = rp.profile_id
    where p.user_id = v_uid and rp.status = 'active' limit 1;
  if v_partner_id is null then raise exception 'active_partner_not_found'; end if;
  insert into public.referral_program_links(partner_id, title, target_path, product_id)
    values (v_partner_id, left(trim(coalesce(p_title, 'Бесплатная программа')), 120), p_target_path, p_product_id) returning * into v_link;
  return jsonb_build_object('id', v_link.id, 'title', v_link.title, 'target_path', v_link.target_path,
    'link_code', v_link.link_code, 'url', 'https://gorbova.by/r/' || v_link.link_code || '?target=' || replace(replace(v_link.target_path, '?', '%3F'), '&', '%26'));
end $$;
revoke all on function public.referral_create_program_link(text, text, uuid) from public;
grant execute on function public.referral_create_program_link(text, text, uuid) to authenticated;

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
    'payouts', (select jsonb_build_object('enabled', payout_requests_enabled, 'minimum_payout_minor', minimum_payout_minor) from public.referral_program_settings where singleton),
    'terms', (select jsonb_build_object('default_commission_percent_bps', commission_percent_bps, 'default_customer_discount_percent_bps', customer_discount_percent_bps,
      'commission_scheme', commission_scheme, 'tier_1_limit', tier_1_limit, 'tier_2_limit', tier_2_limit,
      'split_60_40_enabled', split_60_40_enabled, 'withdrawable_percent_bps', withdrawable_percent_bps, 'terms_url', terms_url) from public.referral_program_settings where singleton),
    'balances', (select jsonb_build_object('pending_minor', coalesce(sum(amount_minor) filter (where bucket = 'pending'), 0), 'internal_pending_minor', coalesce(sum(amount_minor) filter (where bucket = 'internal_pending'), 0), 'available_minor', coalesce(sum(amount_minor) filter (where bucket = 'available'), 0), 'internal_minor', coalesce(sum(amount_minor) filter (where bucket = 'internal'), 0), 'held_minor', coalesce(sum(amount_minor) filter (where bucket = 'held'), 0), 'paid_minor', coalesce(sum(amount_minor) filter (where bucket = 'paid'), 0), 'currency', 'BYN') from public.referral_balance_entries where partner_id = v_partner.id),
    'referrals', (select coalesce(jsonb_agg(jsonb_build_object('relationship_id', rr.id, 'profile_id', rr.referred_profile_id, 'display_name', coalesce(nullif(p.full_name, ''), p.email, 'Пользователь'), 'attached_at', rr.attached_at, 'sales_count', (select count(*) from public.referral_sale_attributions rsa where rsa.relationship_id = rr.id), 'commission_minor', (select coalesce(sum(rsa.commission_minor - rsa.reversed_minor), 0) from public.referral_sale_attributions rsa where rsa.relationship_id = rr.id)) order by rr.attached_at desc), '[]'::jsonb) from public.referral_relationships rr join public.profiles p on p.id = rr.referred_profile_id where rr.partner_id = v_partner.id and rr.status = 'active'),
    'sales', (select coalesce(jsonb_agg(jsonb_build_object('id', rsa.id, 'public_id', rsa.public_id, 'created_at', rsa.created_at, 'status', rsa.status, 'basis_minor', rsa.commission_basis_minor, 'commission_minor', rsa.commission_minor, 'reversed_minor', rsa.reversed_minor, 'product_name', coalesce(pr.name, 'Продукт')) order by rsa.created_at desc), '[]'::jsonb) from public.referral_sale_attributions rsa left join public.products_v2 pr on pr.id = rsa.product_id where rsa.partner_id = v_partner.id),
    'program_links', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'target_path', l.target_path, 'link_code', l.link_code, 'url', 'https://gorbova.by/r/' || l.link_code || '?target=' || replace(replace(l.target_path, '?', '%3F'), '&', '%26')) order by l.created_at desc), '[]'::jsonb) from public.referral_program_links l where l.partner_id = v_partner.id and l.status = 'active')
  );
end $$;
revoke all on function public.referral_get_my_dashboard() from public;
grant execute on function public.referral_get_my_dashboard() to authenticated;

-- Use an explicit trigger for partner bonus reservations so the ledger remains append-only.
create or replace function public.referral_apply_bonus_reservation_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_res public.referral_bonus_reservations%rowtype; v_tx uuid; v_key text;
begin
  v_key := nullif(new.meta->>'referral_partner_bonus_reservation_id', '');
  if v_key is null or new.status::text not in ('paid', 'failed', 'cancelled', 'refunded') then return new; end if;
  select * into v_res from public.referral_bonus_reservations where id = v_key::uuid for update;
  if v_res.id is null or v_res.status <> 'reserved' then return new; end if;
  if new.status::text = 'paid' then
    insert into public.referral_balance_transactions(partner_id, transaction_type, idempotency_key, source_type, source_id, description)
      values (v_res.partner_id, 'bonus_spend', 'referral:bonus:spend:' || v_res.id, 'order', new.id, 'Использован внутренний бонус') returning id into v_tx;
    insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor) values (v_tx, v_res.partner_id, 'internal_held', -v_res.amount_minor), (v_tx, v_res.partner_id, 'internal_spent', v_res.amount_minor);
    update public.referral_bonus_reservations set status = 'consumed', applied_order_id = new.id, updated_at = now() where id = v_res.id;
  else
    insert into public.referral_balance_transactions(partner_id, transaction_type, idempotency_key, source_type, source_id, description)
      values (v_res.partner_id, 'bonus_release', 'referral:bonus:release:' || v_res.id, 'order', new.id, 'Возврат внутреннего бонуса') returning id into v_tx;
    insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor) values (v_tx, v_res.partner_id, 'internal_held', -v_res.amount_minor), (v_tx, v_res.partner_id, 'internal', v_res.amount_minor);
    update public.referral_bonus_reservations set status = 'released', applied_order_id = new.id, updated_at = now() where id = v_res.id;
  end if;
  return new;
exception when invalid_text_representation then return new;
end $$;
revoke all on function public.referral_apply_bonus_reservation_trigger() from public;
drop trigger if exists referral_order_bonus_reservation_trigger on public.orders_v2;
create trigger referral_order_bonus_reservation_trigger after insert or update of status on public.orders_v2 for each row execute function public.referral_apply_bonus_reservation_trigger();

-- Re-declare the accrual function with the PDF's deterministic tier rules.
create or replace function public.referral_process_order(p_order_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders_v2%rowtype; v_settings public.referral_program_settings%rowtype;
  v_relationship public.referral_relationships%rowtype; v_partner public.referral_partners%rowtype;
  v_product public.products_v2%rowtype; v_payment_id uuid; v_paid_minor bigint; v_basis_minor bigint;
  v_commission_minor bigint; v_sale_id uuid; v_tx_id uuid; v_status text; v_available_at timestamptz;
  v_commission_bps integer; v_scheme text; v_rank bigint; v_existing boolean; v_cash_minor bigint; v_internal_minor bigint;
begin
  select * into v_settings from public.referral_program_settings where singleton;
  if not coalesce(v_settings.is_enabled, false) or not coalesce(v_settings.accrual_enabled, false) then return null; end if;
  select * into v_order from public.orders_v2 where id = p_order_id for update;
  if v_order.id is null or v_order.status::text <> 'paid' or coalesce(v_order.is_deleted, false) then return null; end if;
  if coalesce(v_order.currency, '') <> 'BYN' or coalesce(v_order.paid_amount, 0) <= 0 then return null; end if;
  if coalesce(v_order.meta->>'split_from_order_id', '') <> '' or coalesce(v_order.meta->>'is_test', 'false') = 'true' or coalesce(v_order.meta->>'sandbox', 'false') = 'true' then return null; end if;
  if exists (select 1 from public.referral_sale_attributions where order_id = p_order_id) then
    select id into v_sale_id from public.referral_sale_attributions where order_id = p_order_id; return v_sale_id;
  end if;
  if exists (select 1 from public.payments_v2 where order_id = p_order_id and status::text = 'succeeded' and coalesce(is_recurring, false)) then return null; end if;
  select (array_agg(id order by paid_at nulls last, created_at))[1], coalesce(sum(round(amount * 100)::bigint), 0)
    into v_payment_id, v_paid_minor from public.payments_v2 where order_id = p_order_id and status::text = 'succeeded' and not coalesce(is_recurring, false) and not coalesce(is_deleted, false);
  if v_paid_minor <= 0 then return null; end if;
  select * into v_relationship from public.referral_relationships where referred_profile_id = v_order.profile_id and status = 'active' order by attached_at, id limit 1;
  if v_relationship.id is null then return null; end if;
  select * into v_partner from public.referral_partners where id = v_relationship.partner_id and status = 'active';
  if v_partner.id is null or v_partner.profile_id = v_order.profile_id then return null; end if;
  select * into v_product from public.products_v2 where id = v_order.product_id;
  if v_product.id is null or v_product.referral_settings_mode = 'disabled' then return null; end if;

  v_scheme := coalesce(v_product.referral_commission_scheme, v_settings.commission_scheme, 'flat');
  if v_scheme = 'club_first_payment' then
    select exists (select 1 from public.referral_sale_attributions rsa where rsa.relationship_id = v_relationship.id and rsa.product_id = v_order.product_id) into v_existing;
    if v_existing then return null; end if;
    v_commission_bps := coalesce(v_product.referral_club_first_payment_percent_bps, v_product.referral_commission_percent_bps, v_settings.club_first_payment_percent_bps);
  elsif v_scheme = 'tiered' then
    select count(*) + 1 into v_rank from public.referral_relationships rr where rr.partner_id = v_relationship.partner_id and rr.status = 'active'
      and (rr.attached_at, rr.id) < (v_relationship.attached_at, v_relationship.id);
    v_commission_bps := case
      when v_rank <= coalesce(v_product.referral_tier_1_limit, v_settings.tier_1_limit) then coalesce(v_product.referral_tier_1_commission_percent_bps, v_settings.tier_1_commission_percent_bps)
      when v_rank <= coalesce(v_product.referral_tier_1_limit, v_settings.tier_1_limit) + coalesce(v_product.referral_tier_2_limit, v_settings.tier_2_limit) then coalesce(v_product.referral_tier_2_commission_percent_bps, v_settings.tier_2_commission_percent_bps)
      else coalesce(v_product.referral_tier_3_commission_percent_bps, v_settings.tier_3_commission_percent_bps) end;
  else
    v_commission_bps := case v_product.referral_settings_mode when 'custom' then coalesce(v_product.referral_commission_percent_bps, v_settings.commission_percent_bps) else v_settings.commission_percent_bps end;
  end if;
  v_commission_bps := greatest(0, least(10000, coalesce(v_commission_bps, 0)));
  v_basis_minor := least(round(v_order.paid_amount * 100)::bigint, v_paid_minor);
  v_commission_minor := round(v_basis_minor * v_commission_bps::numeric / 10000)::bigint;
  if v_basis_minor <= 0 or v_commission_minor <= 0 then return null; end if;
  v_status := case when v_settings.shadow_mode then 'shadow' else 'pending' end;
  v_available_at := now() + make_interval(days => v_settings.hold_days);
  insert into public.referral_sale_attributions(partner_id, relationship_id, order_id, payment_id, product_id, tariff_id, offer_id, status,
    commission_basis_minor, commission_basis_currency, commission_percent_bps, commission_minor, available_at, rule_snapshot, order_snapshot)
  values (v_partner.id, v_relationship.id, v_order.id, v_payment_id, v_order.product_id, v_order.tariff_id, v_order.offer_id, v_status,
    v_basis_minor, 'BYN', v_commission_bps, v_commission_minor, v_available_at,
    jsonb_build_object('commission_percent_bps', v_commission_bps, 'scheme', v_scheme, 'relationship_rank', v_rank,
      'hold_days', v_settings.hold_days, 'split_60_40_enabled', v_settings.split_60_40_enabled,
      'withdrawable_percent_bps', v_settings.withdrawable_percent_bps, 'version', 4),
    jsonb_build_object('order_id', v_order.id, 'paid_amount', v_order.paid_amount, 'currency', v_order.currency, 'product_id', v_order.product_id, 'tariff_id', v_order.tariff_id, 'offer_id', v_order.offer_id))
  returning id into v_sale_id;
  if not v_settings.shadow_mode then
    insert into public.referral_balance_transactions(partner_id, transaction_type, idempotency_key, source_type, source_id, description)
      values (v_partner.id, 'commission_pending', 'referral:commission:' || v_sale_id, 'sale_attribution', v_sale_id, trim(trailing '0' from trim(trailing '.' from (v_commission_bps::numeric / 100)::text)) || '% за покупку приглашённого') returning id into v_tx_id;
    v_cash_minor := case when v_settings.split_60_40_enabled then round(v_commission_minor * v_settings.withdrawable_percent_bps::numeric / 10000)::bigint else v_commission_minor end;
    v_internal_minor := v_commission_minor - v_cash_minor;
    if v_cash_minor > 0 then insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor) values (v_tx_id, v_partner.id, 'pending', v_cash_minor); end if;
    if v_internal_minor > 0 then insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor) values (v_tx_id, v_partner.id, 'internal_pending', v_internal_minor); end if;
  end if;
  perform public.referral_emit_event('referral.commission.' || v_status, v_sale_id, jsonb_build_object('partner_id', v_partner.id, 'order_id', v_order.id, 'commission_minor', v_commission_minor, 'currency', 'BYN'));
  return v_sale_id;
exception when unique_violation then select id into v_sale_id from public.referral_sale_attributions where order_id = p_order_id; return v_sale_id;
end $$;
revoke all on function public.referral_process_order(uuid) from public;
grant execute on function public.referral_process_order(uuid) to service_role;

create unique index if not exists pending_tg_referral_event_uidx
  on public.pending_telegram_notifications(user_id, notification_type, ((payload->>'idempotency_key')))
  where notification_type in ('referral_registration', 'referral_sale');
