-- Security hotfix: legacy public.orders is written only by trusted Edge Functions
-- using service_role.  The current product checkout uses orders_v2; browser roles
-- must never be able to attribute a legacy order to an arbitrary user_id.

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Remove every direct INSERT policy, including policies created by older releases
-- under a different name. service_role bypasses RLS, so server-side payments keep
-- working while anonymous and authenticated browser clients cannot create rows.
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
