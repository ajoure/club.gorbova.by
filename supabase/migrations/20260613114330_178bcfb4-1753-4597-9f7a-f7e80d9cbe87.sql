
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    '_stripe_cleanup_2026_06_backup_access_grant_ledger',
    '_stripe_cleanup_2026_06_backup_entitlements',
    '_stripe_cleanup_2026_06_backup_orders',
    '_stripe_cleanup_2026_06_backup_payment_links',
    '_stripe_cleanup_2026_06_backup_payments',
    '_stripe_cleanup_2026_06_backup_provider_events',
    '_stripe_cleanup_2026_06_backup_provider_subs',
    '_stripe_cleanup_2026_06_backup_subscriptions'
  ])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS "deny_all_anon" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "deny_all_authenticated" ON public.%I', t);
    EXECUTE format('CREATE POLICY "deny_all_anon" ON public.%I AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false)', t);
    EXECUTE format('CREATE POLICY "deny_all_authenticated" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (false) WITH CHECK (false)', t);
  END LOOP;
END $$;
