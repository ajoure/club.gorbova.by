
-- 1. SECURITY DEFINER view fix: enable security_invoker on payment_links_enriched_v
ALTER VIEW public.payment_links_enriched_v SET (security_invoker = true);

-- 2. RLS enabled with no policy — add restrictive deny-all (service_role only) policies on backup / internal tables
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity=true
      AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid)
  LOOP
    EXECUTE format(
      'CREATE POLICY "service_role full access" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      r.relname
    );
    EXECUTE format(
      'CREATE POLICY "deny all clients" ON public.%I FOR ALL TO authenticated, anon USING (false) WITH CHECK (false)',
      r.relname
    );
  END LOOP;
END$$;

-- 3. Public bucket allows listing — drop the broad public SELECT policy on owner-photos.
-- Public access via getPublicUrl continues to work; only `.list()` is blocked.
DROP POLICY IF EXISTS "Public view owner photos" ON storage.objects;

-- 4. realtime.messages had RLS with zero policies → anyone could subscribe to any topic.
-- Add a minimum restriction: only authenticated users may read/write realtime messages.
DROP POLICY IF EXISTS "authenticated can receive realtime messages" ON realtime.messages;
DROP POLICY IF EXISTS "authenticated can send realtime messages" ON realtime.messages;

CREATE POLICY "authenticated can receive realtime messages"
  ON realtime.messages FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated can send realtime messages"
  ON realtime.messages FOR INSERT
  TO authenticated
  WITH CHECK (true);
