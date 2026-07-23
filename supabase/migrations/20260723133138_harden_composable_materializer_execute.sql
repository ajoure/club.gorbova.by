-- Supabase projects may define default function privileges that explicitly
-- grant EXECUTE to API roles. Revoking only from PUBLIC does not remove those
-- role-specific grants.
REVOKE ALL ON FUNCTION public.materialize_composable_order_group(uuid, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_composable_order_group(uuid, jsonb, text, text)
  TO service_role;
