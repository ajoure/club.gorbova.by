-- Grant permissions to service role and authenticated users for RPC functions
GRANT EXECUTE ON FUNCTION public.find_wrongly_revoked_users() TO service_role;
GRANT EXECUTE ON FUNCTION public.find_wrongly_revoked_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_bought_not_joined_users() TO service_role;
GRANT EXECUTE ON FUNCTION public.find_bought_not_joined_users() TO authenticated;