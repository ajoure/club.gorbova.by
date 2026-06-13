
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    '_backup_entitlement_delete_byn_2026_05_shulyak',
    '_backup_entitlement_tariff_id_backfill_2026_05',
    '_microcorrection_rollback_2026_05_03_backup',
    '_orders_cohort_b_cleanup_2026_05_backup',
    '_orders_orphan_cleanup_2026_05_backup'
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
