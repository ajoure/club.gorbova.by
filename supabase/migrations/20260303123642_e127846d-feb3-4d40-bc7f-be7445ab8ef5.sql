
-- RPC: find_profiles_for_gc_import
-- plpgsql to avoid jsonb/text[] ambiguity
create or replace function public.find_profiles_for_gc_import(
  p_gc_ids text[],
  p_emails text[],
  p_phone_keys text[],
  p_tg_usernames text[]
)
returns table (
  id uuid,
  user_id uuid,
  status text,
  email text,
  phone text,
  external_id_gc text,
  telegram_username text,
  telegram_user_id bigint,
  full_name text,
  first_name text,
  last_name text,
  country text,
  city text,
  birth_date date,
  instagram_url text,
  gc_registered_at date
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select
      p.id,
      p.user_id,
      p.status,
      p.email,
      p.phone,
      p.external_id_gc,
      p.telegram_username,
      p.telegram_user_id,
      p.full_name,
      p.first_name,
      p.last_name,
      p.country,
      p.city,
      p.birth_date,
      p.instagram_url,
      p.gc_registered_at
    from public.profiles p
    where
      (array_length(p_gc_ids, 1) > 0 and p.external_id_gc = any(p_gc_ids))
      or
      (array_length(p_emails, 1) > 0 and lower(trim(p.email)) = any(p_emails))
      or
      (array_length(p_phone_keys, 1) > 0 and right(regexp_replace(coalesce(p.phone,''), '\D', '', 'g'), 9) = any(p_phone_keys))
      or
      (array_length(p_tg_usernames, 1) > 0 and lower(coalesce(p.telegram_username,'')) = any(p_tg_usernames));
end;
$$;

revoke all on function public.find_profiles_for_gc_import(text[], text[], text[], text[]) from public;
grant execute on function public.find_profiles_for_gc_import(text[], text[], text[], text[]) to service_role;
