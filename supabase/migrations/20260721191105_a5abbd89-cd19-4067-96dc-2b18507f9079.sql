-- Migration-history marker only.
--
-- Lovable applied the referrals v1 core migration in production under this
-- generated version even though the identical canonical SQL is already stored
-- in 20260721181043_referrals_v1_core.sql. Keeping this version as a no-op
-- preserves the production migration-history entry and prevents a fresh
-- database from executing the same CREATE TABLE / CREATE FUNCTION statements
-- twice.

do $$
begin
  if to_regclass('public.referral_program_settings') is null then
    raise exception using
      message = 'referrals_v1_core must run before migration-history marker',
      hint = 'Apply 20260721181043_referrals_v1_core.sql first';
  end if;
end
$$;
