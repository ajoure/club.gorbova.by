-- PATCH 1: Force REVOKE RPC access from PUBLIC/anon, keep only authenticated/service_role
-- This runs AFTER any CREATE OR REPLACE FUNCTION

REVOKE ALL ON FUNCTION public.get_order_expected_paid(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_order_expected_paid(uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.get_order_expected_paid(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_expected_paid(uuid) TO service_role;