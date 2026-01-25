-- PATCH-2: Restrict RPC access to authenticated and service_role only
-- Remove PUBLIC access for security

REVOKE EXECUTE ON FUNCTION public.get_order_expected_paid(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_expected_paid(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_expected_paid(uuid) TO service_role;