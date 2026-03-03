
CREATE OR REPLACE FUNCTION public.get_contact_tab_counts(p_search text DEFAULT NULL)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
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
    'with_deals', (select count(*) from paid_profiles),
    'banned',     (select count(*) from prof where status = 'banned')
  );
$$;
