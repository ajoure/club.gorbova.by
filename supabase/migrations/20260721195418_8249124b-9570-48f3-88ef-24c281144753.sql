-- Migration-history marker only.
--
-- Lovable registered the referral_admin_get_summary RPC under this generated
-- version after the canonical migration
-- 20260721194242_referral_admin_summary_rpc.sql had already been merged.
-- Keeping the generated version as a marker preserves production migration
-- history without executing the same function definition twice on a fresh DB.

do $$
begin
  if to_regprocedure('public.referral_admin_get_summary()') is null then
    raise exception using
      message = 'referral_admin_get_summary must exist before migration-history marker',
      hint = 'Apply 20260721194242_referral_admin_summary_rpc.sql first';
  end if;
end
$$;
