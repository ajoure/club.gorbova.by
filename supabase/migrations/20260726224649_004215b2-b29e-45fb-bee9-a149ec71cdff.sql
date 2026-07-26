-- 20260727010000_lock_legacy_orders_client_inserts.sql
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  policy_name text;
BEGIN
  FOR policy_name IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'orders'
      AND cmd IN ('INSERT', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.orders', policy_name);
  END LOOP;
END $$;

REVOKE INSERT ON TABLE public.orders FROM anon, authenticated;