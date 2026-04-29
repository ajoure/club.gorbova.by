-- Problem:
-- trg_subscription_grant_telegram is a SECURITY DEFINER trigger function and does
-- not need to be callable directly by public API roles.
--
-- Diagnose:
-- information_schema.routine_privileges showed PUBLIC EXECUTE on the function.
--
-- Dry-run:
-- SELECT grantee, privilege_type FROM information_schema.routine_privileges
-- WHERE specific_schema='public' AND routine_name='trg_subscription_grant_telegram';
--
-- Execute:
-- Revoke direct EXECUTE from public-facing roles while preserving trigger execution.
--
-- STOP-guard:
-- No table data is modified. The trigger remains attached to subscriptions_v2.
--
-- DoD:
-- PUBLIC/anon/authenticated cannot directly execute the function.
--
-- SYSTEM ACTOR proof:
-- Change is database-level permission hardening for a system trigger function.

REVOKE EXECUTE ON FUNCTION public.trg_subscription_grant_telegram() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_subscription_grant_telegram() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_subscription_grant_telegram() FROM authenticated;