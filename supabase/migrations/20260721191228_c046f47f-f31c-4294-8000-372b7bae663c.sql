-- Fix follow-up: revoke default write privileges leaked via public-schema default ACL.
-- RLS was already blocking writes at runtime; this closes has_table_privilege reporting
-- and enforces defense-in-depth: end users only touch these tables via SECURITY DEFINER RPCs.

revoke insert, update, delete, truncate on
  public.referral_partners,
  public.referral_relationships,
  public.referral_sale_attributions,
  public.referral_balance_transactions,
  public.referral_balance_entries,
  public.referral_payout_requests
from anon, authenticated, public;

revoke insert, delete, truncate on public.referral_program_settings from anon, authenticated, public;
-- UPDATE stays for authenticated because the super_admin RLS policy still gates it.

revoke select, insert, update, delete on
  public.referral_partners,
  public.referral_relationships,
  public.referral_sale_attributions,
  public.referral_balance_transactions,
  public.referral_balance_entries,
  public.referral_payout_requests,
  public.referral_program_settings
from anon;

-- Reconfirm the intended surface.
grant select on
  public.referral_program_settings,
  public.referral_partners,
  public.referral_relationships,
  public.referral_sale_attributions,
  public.referral_balance_transactions,
  public.referral_balance_entries,
  public.referral_payout_requests
to authenticated;
grant update on public.referral_program_settings to authenticated;

grant all on
  public.referral_program_settings,
  public.referral_partners,
  public.referral_relationships,
  public.referral_sale_attributions,
  public.referral_balance_transactions,
  public.referral_balance_entries,
  public.referral_payout_requests
to service_role;
