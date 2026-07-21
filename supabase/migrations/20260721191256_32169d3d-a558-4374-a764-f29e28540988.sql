-- Close default EXECUTE privileges applied by public-schema default ACL to functions.
revoke all on function public.referral_reconcile_orders(integer) from public, anon, authenticated;
grant execute on function public.referral_reconcile_orders(integer) to service_role;

revoke all on function public.referral_mature_due_commissions(integer) from public, anon;
grant execute on function public.referral_mature_due_commissions(integer) to authenticated, service_role;

revoke all on function public.referral_process_order(uuid) from public, anon, authenticated;
grant execute on function public.referral_process_order(uuid) to service_role;

revoke all on function public.referral_process_refund(uuid) from public, anon, authenticated;
grant execute on function public.referral_process_refund(uuid) to service_role;

revoke all on function public.referral_emit_event(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.referral_emit_event(text, uuid, jsonb) to service_role;

-- User-facing RPCs: keep authenticated, drop anon.
revoke all on function public.referral_ensure_current_partner() from public, anon;
grant execute on function public.referral_ensure_current_partner() to authenticated, service_role;

revoke all on function public.referral_attach_current_profile(text, timestamptz) from public, anon;
grant execute on function public.referral_attach_current_profile(text, timestamptz) to authenticated, service_role;

revoke all on function public.referral_admin_ensure_partner(uuid) from public, anon;
grant execute on function public.referral_admin_ensure_partner(uuid) to authenticated, service_role;

revoke all on function public.referral_admin_attach_profile(uuid, uuid, text) from public, anon;
grant execute on function public.referral_admin_attach_profile(uuid, uuid, text) to authenticated, service_role;

revoke all on function public.referral_get_my_dashboard() from public, anon;
grant execute on function public.referral_get_my_dashboard() to authenticated, service_role;

revoke all on function public.referral_create_payout_request(bigint) from public, anon;
grant execute on function public.referral_create_payout_request(bigint) to authenticated, service_role;

revoke all on function public.referral_admin_decide_payout(uuid, text, text, text) from public, anon;
grant execute on function public.referral_admin_decide_payout(uuid, text, text, text) to authenticated, service_role;

revoke all on function public.referral_is_admin(uuid) from public, anon;
grant execute on function public.referral_is_admin(uuid) to authenticated, service_role;
