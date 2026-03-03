
-- RPC 1: get_contact_tab_counts(p_search text) → json
create or replace function public.get_contact_tab_counts(p_search text default null)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with prof as (
    select p.*
    from public.profiles p
    where p_search is null
       or (
         coalesce(p.email,'') ilike '%'||p_search||'%'
         or coalesce(p.full_name,'') ilike '%'||p_search||'%'
         or coalesce(p.phone,'') ilike '%'||p_search||'%'
       )
  ),
  paid_profiles as (
    select distinct o.profile_id
    from public.orders_v2 o
    join prof p on p.id = o.profile_id
    where o.status = 'paid'
      and o.profile_id is not null
  )
  select json_build_object(
    'all',        (select count(*) from prof),
    'active',     (select count(*) from prof where user_id is not null and status != 'archived'),
    'no_account', (select count(*) from prof where user_id is null and status != 'archived'),
    'duplicates', (select count(*) from prof where duplicate_flag is not null and duplicate_flag is distinct from 'none'),
    'archived',   (select count(*) from prof where status = 'archived'),
    'with_deals', (select count(*) from paid_profiles)
  );
$$;

revoke all on function public.get_contact_tab_counts(text) from public;
grant execute on function public.get_contact_tab_counts(text) to service_role;
grant execute on function public.get_contact_tab_counts(text) to authenticated;

-- RPC 2: get_profiles_with_paid_orders(p_limit, p_offset, p_search)
create or replace function public.get_profiles_with_paid_orders(
  p_limit int,
  p_offset int,
  p_search text default null
)
returns table (
  profile_id uuid,
  user_id uuid,
  email text,
  full_name text,
  first_name text,
  last_name text,
  phone text,
  telegram_username text,
  telegram_user_id bigint,
  status text,
  is_archived boolean,
  created_at timestamptz,
  duplicate_flag text,
  avatar_url text,
  last_seen_at timestamptz,
  loyalty_score numeric,
  loyalty_ai_summary text,
  loyalty_status_reason text,
  loyalty_proofs jsonb,
  loyalty_analyzed_messages_count int,
  loyalty_updated_at timestamptz,
  communication_style jsonb,
  last_paid_at timestamptz,
  paid_orders_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with paid as (
    select
      o.profile_id,
      max(o.created_at) as last_paid_at,
      count(*)::int as paid_orders_count
    from public.orders_v2 o
    where o.status = 'paid'
      and o.profile_id is not null
    group by o.profile_id
  ),
  filtered as (
    select
      p.id as profile_id,
      p.user_id,
      p.email, p.full_name, p.first_name, p.last_name, p.phone,
      p.telegram_username, p.telegram_user_id,
      p.status, p.is_archived, p.created_at,
      p.duplicate_flag, p.avatar_url, p.last_seen_at,
      p.loyalty_score, p.loyalty_ai_summary, p.loyalty_status_reason,
      p.loyalty_proofs, p.loyalty_analyzed_messages_count, p.loyalty_updated_at,
      p.communication_style,
      paid.last_paid_at, paid.paid_orders_count
    from paid
    join public.profiles p on p.id = paid.profile_id
    where p_search is null
       or (
         coalesce(p.email,'') ilike '%'||p_search||'%'
         or coalesce(p.full_name,'') ilike '%'||p_search||'%'
         or coalesce(p.phone,'') ilike '%'||p_search||'%'
       )
  )
  select *
  from filtered
  order by last_paid_at desc, profile_id desc
  limit p_limit offset p_offset;
$$;

revoke all on function public.get_profiles_with_paid_orders(int,int,text) from public;
grant execute on function public.get_profiles_with_paid_orders(int,int,text) to service_role;
grant execute on function public.get_profiles_with_paid_orders(int,int,text) to authenticated;

-- RPC 3: get_profiles_with_paid_orders_count(p_search)
create or replace function public.get_profiles_with_paid_orders_count(p_search text default null)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::bigint
  from (
    select distinct o.profile_id
    from public.orders_v2 o
    join public.profiles p on p.id = o.profile_id
    where o.status = 'paid'
      and o.profile_id is not null
      and (
        p_search is null
        or coalesce(p.email,'') ilike '%'||p_search||'%'
        or coalesce(p.full_name,'') ilike '%'||p_search||'%'
        or coalesce(p.phone,'') ilike '%'||p_search||'%'
      )
  ) t;
$$;

revoke all on function public.get_profiles_with_paid_orders_count(text) from public;
grant execute on function public.get_profiles_with_paid_orders_count(text) to service_role;
grant execute on function public.get_profiles_with_paid_orders_count(text) to authenticated;
