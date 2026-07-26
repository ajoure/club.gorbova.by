-- Keep referral partner, attribution, and financial history intact when an
-- administrator's auth account is removed. These two nullable columns are
-- audit metadata only; they must not block auth.users deletion.
begin;

do $$
declare
  v_created_by_not_null boolean;
  v_updated_by_not_null boolean;
  v_created_by_definition text;
  v_updated_by_definition text;
begin
  select a.attnotnull, pg_get_constraintdef(c.oid)
    into v_created_by_not_null, v_created_by_definition
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  join unnest(c.conkey) as k(attnum) on true
  join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
  where n.nspname = 'public'
    and t.relname = 'referral_partners'
    and c.conname = 'referral_partners_created_by_fkey'
    and c.contype = 'f';

  select a.attnotnull, pg_get_constraintdef(c.oid)
    into v_updated_by_not_null, v_updated_by_definition
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  join unnest(c.conkey) as k(attnum) on true
  join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
  where n.nspname = 'public'
    and t.relname = 'referral_partners'
    and c.conname = 'referral_partners_updated_by_fkey'
    and c.contype = 'f';

  if v_created_by_definition is null or v_updated_by_definition is null then
    raise exception 'Expected referral_partners audit foreign keys are missing';
  end if;

  if v_created_by_not_null or v_updated_by_not_null then
    raise exception 'referral_partners audit columns must remain nullable before changing delete behavior';
  end if;

  if v_created_by_definition not ilike 'FOREIGN KEY (created_by) REFERENCES auth.users(id)%'
     or v_updated_by_definition not ilike 'FOREIGN KEY (updated_by) REFERENCES auth.users(id)%' then
    raise exception 'referral_partners audit foreign keys do not match the expected auth.users references';
  end if;
end
$$;

alter table public.referral_partners
  drop constraint referral_partners_created_by_fkey,
  add constraint referral_partners_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null,
  drop constraint referral_partners_updated_by_fkey,
  add constraint referral_partners_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete set null;

commit;
