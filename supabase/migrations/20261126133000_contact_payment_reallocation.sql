-- Correct a mistaken, fully paid single-item Club purchase to an existing BBB
-- period. The bank receipt and allocation identities/amounts never change.
-- This is not a refund, a new payment, or a provider cancellation endpoint.
create table public.payment_reallocations (
  request_id uuid primary key,
  payment_id uuid not null unique references public.payments_v2(id),
  profile_id uuid not null references public.profiles(id),
  actor_id uuid not null,
  reason text not null check (length(trim(reason)) between 10 and 1000),
  before_hash text not null,
  before_state jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.payment_reallocations enable row level security;
revoke all on public.payment_reallocations from public, anon, authenticated;
grant select on public.payment_reallocations to service_role;

-- Private graph builder. All inputs are re-resolved server-side. Full row
-- digests stay inside the server; the returned summary contains no card data,
-- checkout tokens, provider payloads, or signed URLs.
create or replace function public.payment_reallocation_graph(p_profile_id uuid, p_payment_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  pay public.payments_v2%rowtype; deal public.orders_v2%rowtype;
  source_sub public.subscriptions_v2%rowtype; target_sub public.subscriptions_v2%rowtype;
  old_ent public.entitlements%rowtype; new_ent public.entitlements%rowtype;
  alloc public.payment_allocations%rowtype; item public.order_group_items%rowtype;
  grp public.order_groups%rowtype; offer public.tariff_offers%rowtype;
  grant_row public.telegram_access_grants%rowtype;
  prior_order uuid; source_end timestamptz; target_end timestamptz;
  old_club uuid; new_club uuid; fingerprint jsonb; summary jsonb;
  bonus jsonb; uid uuid; source_product constant uuid := '11c9f1b8-0355-4753-bd74-40b42aa53616';
  target_product constant uuid := '85046734-2282-4ded-b0d3-8c66c8f5bc2b';
begin
  select user_id into strict uid from public.profiles where id=p_profile_id and not coalesce(is_archived,false);
  select * into strict pay from public.payments_v2 where id=p_payment_id;
  select * into strict deal from public.orders_v2 where id=pay.order_id;
  if uid is null or pay.profile_id is distinct from p_profile_id or pay.user_id is distinct from uid
    or deal.profile_id is distinct from p_profile_id or deal.user_id is distinct from uid
    or deal.product_id<>source_product or deal.status::text<>'paid' or coalesce(deal.is_deleted,false)
    or pay.status::text<>'succeeded' or coalesce(pay.is_deleted,false)
    or pay.currency<>'BYN' or deal.currency<>'BYN' or pay.amount<>250
    or deal.final_price<>250 or deal.paid_amount<>250 or coalesce(pay.refunded_amount,0)<>0
    or pay.paid_at is null or pay.paid_at<now()-interval '7 days' then raise exception 'reallocation_receipt_not_eligible'; end if;
  if (select count(*) from public.payments_v2 where order_id=deal.id and not coalesce(is_deleted,false))<>1
    or exists(select 1 from public.payment_refund_requests where payment_id=pay.id)
    or exists(select 1 from public.referral_sale_attributions where order_id=deal.id)
    or exists(select 1 from public.referral_customer_credit_entries where source_order_id=deal.id or source_payment_id=pay.id)
    then raise exception 'reallocation_financial_dependencies'; end if;
  if exists(select 1 from public.crm_pipeline_automation_rules where pipeline_id=deal.pipeline_id and stage_id=deal.pipeline_stage_id
    and status='active' and trigger_type='deal_field_changed' and trigger_field in('product_id','tariff_id'))
    then raise exception 'reallocation_automation_review_required'; end if;
  select * into strict alloc from public.payment_allocations where payment_id=pay.id;
  select * into strict item from public.order_group_items where id=alloc.order_group_item_id;
  select * into strict grp from public.order_groups where id=alloc.order_group_id;
  if alloc.amount<>250 or alloc.refunded_amount<>0 or item.role<>'primary' or item.order_id<>deal.id
    or item.product_id<>source_product or item.final_amount<>250 or item.quantity<>1
    or item.tariff_id is distinct from deal.tariff_id or item.offer_id is distinct from deal.offer_id
    or grp.profile_id is distinct from p_profile_id or grp.user_id is distinct from uid or grp.primary_order_id<>deal.id
    or grp.status<>'paid' or grp.total_amount<>250 or grp.currency<>'BYN'
    or (select count(*) from public.order_group_items where order_group_id=grp.id)<>1
    or (select count(*) from public.payment_allocations where order_group_id=grp.id)<>1
    then raise exception 'reallocation_single_item_required'; end if;
  select * into strict source_sub from public.subscriptions_v2 where user_id=uid and product_id=source_product and status::text='active';
  select * into strict target_sub from public.subscriptions_v2 where user_id=uid and product_id=target_product and status::text in('active','expired');
  if source_sub.auto_renew is distinct from false or source_sub.access_end_at is null or target_sub.access_end_at is null or pay.paid_at is null or target_sub.access_end_at<pay.paid_at
    or target_sub.access_end_at>pay.paid_at+interval '2 days'
    or target_sub.access_end_at+interval '30 days'<=now()
    or jsonb_array_length(coalesce(source_sub.meta->'extended_by_orders','[]'::jsonb))<2
    or source_sub.meta->'extended_by_orders'->>-1<>deal.id::text
    then raise exception 'reallocation_period_not_eligible'; end if;
  -- A real misdirected receipt may be corrected after the old period expired.
  -- This credits only its already-paid next window, never a new free period.
  -- An expired target requires billing to have been explicitly stopped first.
  if target_sub.status::text='expired' and (target_sub.auto_renew is distinct from false
    or not exists(select 1 from public.provider_subscriptions p where p.subscription_v2_id=target_sub.id and p.state='canceled')
    or exists(select 1 from public.provider_subscriptions p where p.subscription_v2_id=target_sub.id and p.state in('active','trial','pending')))
    then raise exception 'reallocation_expired_target_billing_not_stopped'; end if;
  if exists(select 1 from public.provider_subscriptions p join public.subscriptions_v2 s on s.id=p.subscription_v2_id
      where p.user_id=uid and s.product_id=source_product and p.state in('active','trial'))
    then raise exception 'reallocation_source_recurring_active'; end if;
  -- A pending Club mandate is not an active debit, but is still part of
  -- the locked graph. Refuse if any provider schedule/receipt exists for it.
  if exists(select 1 from public.provider_subscriptions p join public.subscriptions_v2 s on s.id=p.subscription_v2_id
      where p.user_id=uid and s.product_id=source_product and p.state='pending'
        and (p.last_charge_at is not null or p.next_charge_at is not null or s.status::text<>'past_due'
          or exists(select 1 from public.payments_v2 x where x.order_id=p.order_id)))
    then raise exception 'reallocation_pending_provider_not_proven_idle'; end if;
  prior_order:=(source_sub.meta->'extended_by_orders'->>-2)::uuid;
  if not exists(select 1 from public.orders_v2 o join public.payments_v2 p on p.order_id=o.id
    where o.id=prior_order and o.user_id=uid and o.product_id=source_product and o.status::text='paid'
      and p.status::text='succeeded' and p.amount=250 and coalesce(p.refunded_amount,0)=0 and not coalesce(p.is_deleted,false))
    then raise exception 'reallocation_legitimate_club_payment_required'; end if;
  -- Match the Club calendar-month rule (no DST in the UTC-normalized window).
  source_end:=source_sub.access_end_at-interval '1 month';
  target_end:=target_sub.access_end_at+interval '30 days';
  select * into strict offer from public.tariff_offers where tariff_id=target_sub.tariff_id
    and is_active and offer_type='pay_now' and payment_method='full_payment' and amount=250;
  if not exists(select 1 from public.tariffs where id=target_sub.tariff_id and product_id=target_product and is_active)
    then raise exception 'reallocation_target_tariff_invalid'; end if;
  select * into strict old_ent from public.entitlements where user_id=uid and product_id=source_product and status='active';
  select * into strict new_ent from public.entitlements where user_id=uid and product_id=target_product and status in('active','expired');
  if old_ent.order_id<>deal.id or old_ent.expires_at<>source_sub.access_end_at or new_ent.expires_at<>target_sub.access_end_at
    or exists(select 1 from public.entitlement_sources where user_id=uid and product_id in(source_product,target_product))
    then raise exception 'reallocation_access_graph_not_supported'; end if;
  -- Secondary rights must have an exact immutable before-window in the
  -- successful grant ledger. Never derive their previous state from a month.
  select jsonb_agg(jsonb_build_object('entitlement_id',e.id,'ledger_id',l.id,
    'previous_expires_at',l.result->>'previous_expires_at','new_expires_at',l.result->>'new_expires_at') order by e.id)
    into bonus from public.entitlements e join public.access_grant_ledger l
      on l.user_id=e.user_id and l.result->>'target_product_id'=e.product_id::text
      and l.source_order_id=deal.id and l.reason_code='rule_engine_bonus' and l.status='extended'
    where e.user_id=uid and e.product_id not in(source_product,target_product)
      and e.meta->>'source_order_id'=deal.id::text and e.status='active'
      and e.expires_at=(l.result->>'new_expires_at')::timestamptz
      and l.result->>'previous_expires_at' is not null
      and (l.result->>'previous_expires_at')::timestamptz<e.expires_at
      and not exists(select 1 from public.access_grant_ledger later where later.user_id=uid
        and later.result->>'target_product_id'=e.product_id::text and later.created_at>l.created_at
        and later.status in('granted','extended','reactivated'))
      and not exists(select 1 from public.entitlement_sources es where es.user_id=uid and es.product_id=e.product_id);
  if coalesce(jsonb_array_length(bonus),0)<>10
    or (select count(*) from public.entitlements where user_id=uid and product_id not in(source_product,target_product)
      and meta->>'source_order_id'=deal.id::text)<>10
    or (select count(distinct x->>'entitlement_id') from jsonb_array_elements(bonus) x)<>10
    then raise exception 'reallocation_bonus_before_state_unproven'; end if;
  select telegram_club_id into strict old_club from public.products_v2 where id=source_product;
  select telegram_club_id into strict new_club from public.products_v2 where id=target_product;
  select * into strict grant_row from public.telegram_access_grants where user_id=uid and club_id=old_club
    and source='grant-access-for-order' and source_id=deal.id and status='active';
  if grant_row.end_at<>source_sub.access_end_at
    or (select max(end_at) from public.telegram_access_grants where user_id=uid and club_id=old_club and status='active' and id<>grant_row.id)<>source_end
    or (select count(*) from public.telegram_access where user_id=uid and club_id in(old_club,new_club))<>2
    or exists(select 1 from public.telegram_access_grants where user_id=uid and club_id=new_club and status='active' and end_at>target_sub.access_end_at)
    then raise exception 'reallocation_telegram_graph_not_supported'; end if;
  summary:=jsonb_build_object('payment_id',pay.id,'payment_hash',md5(to_jsonb(pay)::text),'provider_hash',(select md5(coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb)::text) from public.provider_subscriptions p where user_id=uid),'order_id',deal.id,'group_id',grp.id,'item_id',item.id,
    'allocation_id',alloc.id,'profile_id',p_profile_id,'user_id',uid,'amount_minor',25000,'currency','BYN',
    'source_product_id',source_product,'source_tariff_id',deal.tariff_id,'source_offer_id',deal.offer_id,
    'source_purchase_window',jsonb_build_object('access_days',deal.purchase_snapshot->'access_days',
      'planned_access_start_at',deal.purchase_snapshot->'planned_access_start_at','planned_access_end_at',deal.purchase_snapshot->'planned_access_end_at'),
    'target_product_id',target_product,'target_tariff_id',target_sub.tariff_id,'target_offer_id',offer.id,
    'source_subscription_id',source_sub.id,'target_subscription_id',target_sub.id,'prior_order_id',prior_order,
    'source_entitlement_id',old_ent.id,'target_entitlement_id',new_ent.id,
    'source_club_id',old_club,'target_club_id',new_club,'grant_id',grant_row.id,
    'source_old_end',source_sub.access_end_at,'source_new_end',source_end,'target_old_end',target_sub.access_end_at,'target_new_end',target_end,
    'provider_cancellation_included',false,'bank_receipts_created',0,'bank_receipts_changed',0,
    'bonus_restorations',bonus,'expected_counts',jsonb_build_object('orders',1,'groups',1,'items',1,'subscriptions',2,'entitlements',12,'telegram_grants',1,'telegram_access',2,'reallocations',1));
  fingerprint:=jsonb_build_array(to_jsonb(pay),to_jsonb(deal),to_jsonb(grp),to_jsonb(item),to_jsonb(alloc),
    (select jsonb_agg(to_jsonb(s) order by id) from public.subscriptions_v2 s where user_id=uid),
    (select jsonb_agg(to_jsonb(o) order by id) from public.orders_v2 o where user_id=uid),
    (select jsonb_agg(to_jsonb(p) order by id) from public.payments_v2 p where user_id=uid),
    to_jsonb(source_sub),to_jsonb(target_sub),to_jsonb(old_ent),to_jsonb(new_ent),to_jsonb(grant_row),to_jsonb(offer),
    (select jsonb_agg(to_jsonb(e) order by id) from public.entitlements e where user_id=uid),
    (select jsonb_agg(to_jsonb(l) order by id) from public.access_grant_ledger l where user_id=uid),
    (select jsonb_agg(to_jsonb(es) order by id) from public.entitlement_sources es where user_id=uid),
    (select jsonb_agg(to_jsonb(t) order by id) from public.tariffs t where id=target_sub.tariff_id),
    (select jsonb_agg(to_jsonb(a) order by id) from public.telegram_access a where user_id=uid and club_id in(old_club,new_club)),
    (select jsonb_agg(to_jsonb(a) order by id) from public.provider_subscriptions a where user_id=uid),
    (select jsonb_agg(to_jsonb(a) order by id) from public.telegram_access_grants a where user_id=uid and club_id in(old_club,new_club)));
  return summary||jsonb_build_object('before_hash',md5(fingerprint::text));
exception when no_data_found or too_many_rows then raise exception 'reallocation_graph_ambiguous';
end $$;
revoke all on function public.payment_reallocation_graph(uuid,uuid) from public,anon,authenticated;

create or replace function public.admin_preview_payment_reallocation(p_profile_id uuid,p_payment_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if auth.uid() is null or not(coalesce(public.has_role_v2(auth.uid(),'admin'),false) or coalesce(public.has_role_v2(auth.uid(),'super_admin'),false))
    then raise exception 'reallocation_admin_required' using errcode='42501'; end if;
  return public.payment_reallocation_graph(p_profile_id,p_payment_id);
end $$;
revoke all on function public.admin_preview_payment_reallocation(uuid,uuid) from public,anon;
grant execute on function public.admin_preview_payment_reallocation(uuid,uuid) to authenticated;

create or replace function public.admin_commit_payment_reallocation(p_request_id uuid,p_profile_id uuid,p_payment_id uuid,p_before_hash text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare g jsonb; prior public.payment_reallocations%rowtype; result jsonb; quote jsonb; snapshot jsonb;
  b jsonb; affected integer; uid uuid; oid uuid; source_sub uuid; target_sub uuid; source_club uuid; target_club uuid;
begin
  if auth.uid() is null or not(coalesce(public.has_role_v2(auth.uid(),'admin'),false) or coalesce(public.has_role_v2(auth.uid(),'super_admin'),false))
    then raise exception 'reallocation_admin_required' using errcode='42501'; end if;
  if p_request_id is null or length(trim(coalesce(p_reason,''))) not between 10 and 1000 then raise exception 'reallocation_reason_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payment-reallocation:'||p_payment_id::text,0));
  select * into prior from public.payment_reallocations where request_id=p_request_id or payment_id=p_payment_id;
  if found then
    if prior.request_id<>p_request_id or prior.payment_id<>p_payment_id or prior.profile_id<>p_profile_id or prior.reason<>p_reason or prior.before_hash<>p_before_hash
      then raise exception 'reallocation_already_applied'; end if;
    return prior.result||jsonb_build_object('replayed',true);
  end if;
  select user_id into strict uid from public.profiles where id=p_profile_id for update;
  perform 1 from public.payments_v2 where id=p_payment_id for update;
  select order_id into strict oid from public.payments_v2 where id=p_payment_id;
  perform 1 from public.orders_v2 where user_id=uid order by id for update;
  perform 1 from public.payments_v2 where user_id=uid order by id for update;
  perform 1 from public.subscriptions_v2 where user_id=uid order by id for update;
  perform 1 from public.provider_subscriptions where user_id=uid order by id for update;
  perform 1 from public.entitlements where user_id=uid order by id for update;
  perform 1 from public.telegram_access_grants where user_id=uid order by id for update;
  perform 1 from public.telegram_access where user_id=uid order by id for update;
  perform 1 from public.payment_allocations where payment_id=p_payment_id order by id for update;
  perform 1 from public.order_groups where primary_order_id=oid for update;
  perform 1 from public.order_group_items where order_id=oid for update;
  perform 1 from public.entitlement_sources where user_id=uid order by id for update;
  perform 1 from public.access_grant_ledger where user_id=uid order by id for update;
  g:=public.payment_reallocation_graph(p_profile_id,p_payment_id);
  if g->>'before_hash' is distinct from p_before_hash then raise exception 'reallocation_preview_changed'; end if;
  source_sub:=(g->>'source_subscription_id')::uuid; target_sub:=(g->>'target_subscription_id')::uuid;
  source_club:=(g->>'source_club_id')::uuid; target_club:=(g->>'target_club_id')::uuid;
  select jsonb_build_object('product_id',p.id,'product_name',to_jsonb(p)->'name','product_code',to_jsonb(p)->'code','product_public_id',to_jsonb(p)->'public_id',
    'tariff_id',t.id,'tariff_name',to_jsonb(t)->'name','tariff_code',to_jsonb(t)->'code','tariff_public_id',to_jsonb(t)->'public_id',
    'offer_id',g->>'target_offer_id','price',250,'currency','BYN','access_days',30,'is_trial',false,'trial_days',null,
    'reconcile_source','payment_reallocation','snapshot_created_at',now(),
    'planned_access_start_at',g->>'target_old_end','planned_access_end_at',g->>'target_new_end') into strict snapshot
    from public.products_v2 p join public.tariffs t on t.product_id=p.id and t.id=(g->>'target_tariff_id')::uuid where p.id=(g->>'target_product_id')::uuid;
  quote:=jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',g->>'target_product_id',
    'tariff_id',g->>'target_tariff_id','offer_id',g->>'target_offer_id','role','primary','quantity',1,
    'list_amount',250,'discount_amount',0,'final_amount',250)),'currency','BYN','subtotal',250,'total',250,'adjustment_amount',0);
  update public.orders_v2 set product_id=(g->>'target_product_id')::uuid,tariff_id=(g->>'target_tariff_id')::uuid,
    offer_id=(g->>'target_offer_id')::uuid,purchase_snapshot=snapshot,
    meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('composable_checkout',quote,'product_name',snapshot->>'product_name','tariff_name',snapshot->>'tariff_name','payment_reallocation_request_id',p_request_id,
      'payment_reallocation_period',jsonb_build_object('starts_at',g->>'target_old_end','expires_at',g->>'target_new_end')) where id=oid;
  update public.order_group_items set product_id=(g->>'target_product_id')::uuid,tariff_id=(g->>'target_tariff_id')::uuid,
    offer_id=(g->>'target_offer_id')::uuid,item_snapshot=snapshot where id=(g->>'item_id')::uuid;
  update public.order_groups set quote_snapshot=quote,meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('payment_reallocation_request_id',p_request_id) where id=(g->>'group_id')::uuid;
  update public.subscriptions_v2 set access_end_at=(g->>'source_new_end')::timestamptz,next_charge_at=(g->>'source_new_end')::timestamptz,
    meta=jsonb_set(coalesce(meta,'{}'::jsonb),'{extended_by_orders}',(meta->'extended_by_orders')-oid::text)||jsonb_build_object('payment_reallocation_request_id',p_request_id) where id=source_sub;
  update public.subscriptions_v2 set access_end_at=(g->>'target_new_end')::timestamptz,status='active',
    meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('extended_by_orders',coalesce(meta->'extended_by_orders','[]'::jsonb)||jsonb_build_array(oid::text),'payment_reallocation_request_id',p_request_id) where id=target_sub;
  update public.entitlements set expires_at=(g->>'source_new_end')::timestamptz,order_id=(g->>'prior_order_id')::uuid,meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('payment_reallocation_request_id',p_request_id) where id=(g->>'source_entitlement_id')::uuid;
  update public.entitlements set expires_at=(g->>'target_new_end')::timestamptz,status='active',order_id=oid,meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('payment_reallocation_request_id',p_request_id) where id=(g->>'target_entitlement_id')::uuid;
  for b in select value from jsonb_array_elements(g->'bonus_restorations') loop
    update public.entitlements set expires_at=(b->>'previous_expires_at')::timestamptz,
      meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('payment_reallocation_request_id',p_request_id,
        'payment_reallocation_reversed_ledger_id',b->>'ledger_id')
      where id=(b->>'entitlement_id')::uuid and expires_at=(b->>'new_expires_at')::timestamptz;
    get diagnostics affected=row_count;
    if affected<>1 then raise exception 'reallocation_bonus_restore_conflict'; end if;
  end loop;
  update public.telegram_access_grants set club_id=target_club,start_at=(g->>'target_old_end')::timestamptz,end_at=(g->>'target_new_end')::timestamptz,
    meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('payment_reallocation_request_id',p_request_id) where id=(g->>'grant_id')::uuid;
  update public.telegram_access set active_until=(g->>'source_new_end')::timestamptz where user_id=uid and club_id=source_club;
  update public.telegram_access set active_until=(g->>'target_new_end')::timestamptz where user_id=uid and club_id=target_club;
  if (select md5(coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb)::text) from public.provider_subscriptions p where user_id=uid) is distinct from g->>'provider_hash'
    or (select md5(to_jsonb(p)::text) from public.payments_v2 p where id=p_payment_id) is distinct from g->>'payment_hash'
    or not exists(select 1 from public.payment_allocations where id=(g->>'allocation_id')::uuid and payment_id=p_payment_id and amount=250 and refunded_amount=0)
    or not exists(select 1 from public.orders_v2 where id=oid and status::text='paid' and paid_amount=250 and final_price=250 and product_id=(g->>'target_product_id')::uuid)
    or not exists(select 1 from public.subscriptions_v2 where id=source_sub and access_end_at=(g->>'source_new_end')::timestamptz and not auto_renew)
    or not exists(select 1 from public.subscriptions_v2 where id=target_sub and access_end_at=(g->>'target_new_end')::timestamptz)
    or not exists(select 1 from public.order_group_items where id=(g->>'item_id')::uuid and product_id=(g->>'target_product_id')::uuid and final_amount=250)
    or not exists(select 1 from public.entitlements where id=(g->>'source_entitlement_id')::uuid and order_id=(g->>'prior_order_id')::uuid and expires_at=(g->>'source_new_end')::timestamptz)
    or not exists(select 1 from public.entitlements where id=(g->>'target_entitlement_id')::uuid and order_id=oid and expires_at=(g->>'target_new_end')::timestamptz)
    or not exists(select 1 from public.telegram_access_grants where id=(g->>'grant_id')::uuid and club_id=target_club and source_id=oid and end_at=(g->>'target_new_end')::timestamptz)
    or not exists(select 1 from public.telegram_access where user_id=uid and club_id=source_club and active_until=(g->>'source_new_end')::timestamptz)
    or not exists(select 1 from public.telegram_access where user_id=uid and club_id=target_club and active_until=(g->>'target_new_end')::timestamptz)
    then raise exception 'reallocation_postcondition_failed'; end if;
  result:=g||jsonb_build_object('request_id',p_request_id,'applied',true,'replayed',false);
  insert into public.payment_reallocations(request_id,payment_id,profile_id,actor_id,reason,before_hash,before_state,result)
    values(p_request_id,p_payment_id,p_profile_id,auth.uid(),p_reason,p_before_hash,g,result);
  insert into public.audit_logs(action,actor_type,actor_user_id,target_user_id,entity_type,entity_id,meta)
    values('payment.product_reallocated','admin',auth.uid(),uid,'payment_reallocation',p_request_id::text,
      jsonb_build_object('reason',p_reason,'before',g,'after',result,'receipt_preserved',true,'provider_cancellation_included',false));
  return result;
end $$;
revoke all on function public.admin_commit_payment_reallocation(uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.admin_commit_payment_reallocation(uuid,uuid,uuid,text,text) to authenticated;

create or replace function public.admin_get_payment_reallocation(p_profile_id uuid,p_payment_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or not(coalesce(public.has_role_v2(auth.uid(),'admin'),false) or coalesce(public.has_role_v2(auth.uid(),'super_admin'),false))
    then raise exception 'reallocation_admin_required' using errcode='42501'; end if;
  select r.result into result from public.payment_reallocations r where r.profile_id=p_profile_id and r.payment_id=p_payment_id;
  return result;
end $$;
revoke all on function public.admin_get_payment_reallocation(uuid,uuid) from public,anon;
grant execute on function public.admin_get_payment_reallocation(uuid,uuid) to authenticated;

-- Fence every access projection at the database boundary. An Edge invocation
-- may have read the old order before the correction committed; its old payload
-- must not resurrect the reversed purchase after the early replay check.
create or replace function public.guard_payment_reallocation_projection()
returns trigger language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare j jsonb:=to_jsonb(new); oldj jsonb; r record; g jsonb; k text; protected boolean; product uuid;
begin
  if TG_OP='UPDATE' then oldj:=to_jsonb(old); end if;
  -- VOLATILE performs a fresh READ COMMITTED lookup after PostgreSQL has
  -- acquired the target row lock. Do not acquire a profile lock here: an
  -- UPDATE already owns its row and reversing the correction's lock order
  -- would create an avoidable profile/entitlement deadlock.
  for r in select * from public.payment_reallocations where before_state->>'user_id'=j->>'user_id'
    or (TG_TABLE_NAME='orders_v2' and before_state->>'order_id'=j->>'id') loop
    g:=r.before_state; protected:=false;
    if TG_TABLE_NAME='orders_v2' and j->>'id'=g->>'order_id' then
      if j->'meta'->>'payment_reallocation_request_id' is distinct from r.request_id::text
        or j->>'product_id' is distinct from g->>'target_product_id'
        or j->>'tariff_id' is distinct from g->>'target_tariff_id'
        or j->>'offer_id' is distinct from g->>'target_offer_id'
        then raise exception 'reallocation_stale_order_write'; end if;
    elsif TG_TABLE_NAME='subscriptions_v2' then
      if j->>'product_id'=g->>'source_product_id' and (j->'meta'->'extended_by_orders') ? (g->>'order_id')
        then raise exception 'reallocation_stale_source_subscription'; end if;
      protected:=j->>'id' in(g->>'source_subscription_id',g->>'target_subscription_id');
      if protected and TG_OP='UPDATE' then
        if j->'meta'->>'payment_reallocation_request_id' is distinct from r.request_id::text
          then raise exception 'reallocation_stale_subscription_meta'; end if;
        if j->>'access_end_at' is distinct from oldj->>'access_end_at'
          or j->>'next_charge_at' is distinct from oldj->>'next_charge_at' then
          k:=j->'meta'->'extended_by_orders'->>-1;
          if k is null or k=g->>'order_id' or k is not distinct from oldj->'meta'->'extended_by_orders'->>-1
            or not exists(select 1 from public.orders_v2 o where o.id::text=k and o.user_id=(j->>'user_id')::uuid
              and o.product_id=(j->>'product_id')::uuid and o.status::text='paid')
            then raise exception 'reallocation_stale_subscription_window'; end if;
        end if;
      end if;
    elsif TG_TABLE_NAME='entitlements' then
      protected:=j->>'id' in(g->>'source_entitlement_id',g->>'target_entitlement_id')
        or (TG_OP='INSERT' and j->>'product_id' in(g->>'source_product_id',g->>'target_product_id'))
        or exists(select 1 from jsonb_array_elements(g->'bonus_restorations') b join public.entitlements e
          on e.id=(b->>'entitlement_id')::uuid where b->>'entitlement_id'=j->>'id'
            or (TG_OP='INSERT' and e.product_id=(j->>'product_id')::uuid));
      if protected then
        if j->'meta'->>'payment_reallocation_request_id' is distinct from r.request_id::text
          then raise exception 'reallocation_stale_entitlement_meta'; end if;
        if TG_OP='UPDATE' and (j->>'expires_at' is distinct from oldj->>'expires_at' or j->>'status' is distinct from oldj->>'status' or j->>'order_id' is distinct from oldj->>'order_id')
          and not(j->>'status'='expired' and j->>'expires_at' is not distinct from oldj->>'expires_at'
            and j->>'order_id' is not distinct from oldj->>'order_id' and (j->>'expires_at')::timestamptz<=now()) then
          k:=case when j->>'id' in(g->>'source_entitlement_id',g->>'target_entitlement_id') then j->>'order_id'
            else j->'meta'->>'source_order_id' end;
          if k is null or k=g->>'order_id' or k=coalesce(oldj->'meta'->>'source_order_id',oldj->>'order_id')
            or not exists(select 1 from public.orders_v2 o where o.id::text=k and o.user_id=(j->>'user_id')::uuid
              and o.status::text='paid' and (o.product_id=(j->>'product_id')::uuid or
                (j->>'id' not in(g->>'source_entitlement_id',g->>'target_entitlement_id') and o.product_id=(g->>'source_product_id')::uuid)))
            then raise exception 'reallocation_stale_entitlement_window'; end if;
        end if;
      end if;
    elsif TG_TABLE_NAME='telegram_access_grants' and j->>'source_id'=g->>'order_id' then
      if j->>'club_id' is distinct from g->>'target_club_id'
        or (j->>'end_at')::timestamptz is distinct from (g->>'target_new_end')::timestamptz
        or (j->>'start_at')::timestamptz is distinct from (g->>'target_old_end')::timestamptz
        then raise exception 'reallocation_stale_telegram_grant'; end if;
    elsif TG_TABLE_NAME='telegram_access' and j->>'club_id' in(g->>'source_club_id',g->>'target_club_id') then
      product:=case when j->>'club_id'=g->>'source_club_id' then (g->>'source_product_id')::uuid else (g->>'target_product_id')::uuid end;
      if (j->>'active_until')::timestamptz is distinct from
        (select max(access_end_at) from public.subscriptions_v2 where user_id=(j->>'user_id')::uuid and product_id=product and status::text='active')
        then raise exception 'reallocation_stale_telegram_projection'; end if;
    elsif TG_TABLE_NAME='entitlement_sources' and (j->>'order_id'=g->>'order_id'
      or j->'meta'->>'source_order_id'=g->>'order_id') then
      raise exception 'reallocation_stale_entitlement_source';
    elsif TG_TABLE_NAME='access_grant_ledger' and j->>'source_order_id'=g->>'order_id' and j->>'status' in('granted','extended','reactivated') then
      raise exception 'reallocation_stale_grant_ledger';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.guard_payment_reallocation_projection() from public,anon,authenticated;
create trigger zz_payment_reallocation_guard before insert or update on public.orders_v2 for each row execute function public.guard_payment_reallocation_projection();
create trigger zz_payment_reallocation_guard before insert or update on public.subscriptions_v2 for each row execute function public.guard_payment_reallocation_projection();
create trigger zz_payment_reallocation_guard before insert or update on public.entitlements for each row execute function public.guard_payment_reallocation_projection();
create trigger zz_payment_reallocation_guard before insert or update on public.telegram_access_grants for each row execute function public.guard_payment_reallocation_projection();
create trigger zz_payment_reallocation_guard before insert or update on public.telegram_access for each row execute function public.guard_payment_reallocation_projection();
create trigger zz_payment_reallocation_guard before insert or update on public.access_grant_ledger for each row execute function public.guard_payment_reallocation_projection();

create trigger zz_payment_reallocation_guard before insert or update on public.entitlement_sources for each row execute function public.guard_payment_reallocation_projection();
