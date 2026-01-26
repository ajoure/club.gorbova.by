-- RPC get_payment_duplicates (для nightly invariants)
CREATE OR REPLACE FUNCTION public.get_payment_duplicates()
RETURNS TABLE(
  provider TEXT,
  provider_payment_id TEXT,
  duplicate_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT provider, provider_payment_id, COUNT(*) as duplicate_count
  FROM payments_v2
  WHERE provider_payment_id IS NOT NULL
  GROUP BY provider, provider_payment_id
  HAVING COUNT(*) > 1
$$;

-- Grant to service_role only, revoke public
GRANT EXECUTE ON FUNCTION public.get_payment_duplicates() TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_payment_duplicates() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_payment_duplicates() FROM anon;