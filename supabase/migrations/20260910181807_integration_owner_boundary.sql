-- Configuration stays owner-only even if a legacy permissive policy grants
-- entitlements.manage. Read-only operational projections below expose only
-- fields needed by existing staff workflows, never credentials or raw config.
BEGIN;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'integration_instances', 'integration_credentials', 'payment_settings',
    'email_accounts', 'telegram_bots', 'integration_field_mappings',
    'integration_sync_settings', 'acquiring_connections', 'integrations'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'Missing integration configuration table: %', t;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS integration_owner_boundary ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY integration_owner_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.has_role_v2((select auth.uid()), ''super_admin'')) WITH CHECK (public.has_role_v2((select auth.uid()), ''super_admin''))', t);
    EXECUTE format('DROP POLICY IF EXISTS integration_owner_access ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY integration_owner_access ON public.%I FOR ALL TO authenticated USING (public.has_role_v2((select auth.uid()), ''super_admin'')) WITH CHECK (public.has_role_v2((select auth.uid()), ''super_admin''))', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', t);
  END LOOP;
END;
$$;

-- Club membership operations remain independent of editing the connection.
ALTER TABLE public.telegram_clubs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_clubs FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.telegram_clubs FROM authenticated;
DROP POLICY IF EXISTS integration_owner_insert ON public.telegram_clubs;
CREATE POLICY integration_owner_insert ON public.telegram_clubs AS RESTRICTIVE
FOR INSERT TO authenticated WITH CHECK (public.has_role_v2((select auth.uid()), 'super_admin'));
DROP POLICY IF EXISTS integration_owner_update ON public.telegram_clubs;
CREATE POLICY integration_owner_update ON public.telegram_clubs AS RESTRICTIVE
FOR UPDATE TO authenticated USING (public.has_role_v2((select auth.uid()), 'super_admin'))
WITH CHECK (public.has_role_v2((select auth.uid()), 'super_admin'));
DROP POLICY IF EXISTS integration_owner_delete ON public.telegram_clubs;
CREATE POLICY integration_owner_delete ON public.telegram_clubs AS RESTRICTIVE
FOR DELETE TO authenticated USING (public.has_role_v2((select auth.uid()), 'super_admin'));

-- Deliberate, authenticated projection APIs. No caller-supplied identity,
-- dynamic table/column selection, raw JSON config, credentials or error logs.
CREATE OR REPLACE FUNCTION public.list_operational_telegram_bots()
RETURNS TABLE(id uuid, bot_name text, bot_username text, bot_id bigint,
  status text, is_primary boolean, last_check_at timestamptz,
  error_message text, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT b.id, b.bot_name, b.bot_username, b.bot_id, b.status, b.is_primary,
    b.last_check_at, NULL::text, b.created_at, b.updated_at
  FROM public.telegram_bots b
  WHERE (select auth.uid()) IS NOT NULL AND (
    public.has_admin_section_access((select auth.uid()), 'communication', 'view') OR
    public.has_admin_section_access((select auth.uid()), 'contacts', 'view') OR
    public.has_admin_section_access((select auth.uid()), 'club-members', 'view') OR
    public.has_admin_section_access((select auth.uid()), 'training', 'view') OR
    public.has_admin_section_access((select auth.uid()), 'products', 'view') OR
    public.has_permission((select auth.uid()), 'entitlements.manage')
  );
$$;

CREATE OR REPLACE FUNCTION public.list_operational_email_accounts()
RETURNS TABLE(id uuid, email text, display_name text, provider text,
  is_default boolean, is_active boolean, imap_enabled boolean, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT e.id, e.email, e.display_name, e.provider, e.is_default,
    e.is_active, e.imap_enabled, e.created_at
  FROM public.email_accounts e
  WHERE (select auth.uid()) IS NOT NULL AND (
    public.has_admin_section_access((select auth.uid()), 'communication', 'view') OR
    public.has_admin_section_access((select auth.uid()), 'contacts', 'view') OR
    public.has_admin_section_access((select auth.uid()), 'companies', 'view') OR
    public.has_permission((select auth.uid()), 'entitlements.manage')
  );
$$;

CREATE OR REPLACE FUNCTION public.list_operational_integrations()
RETURNS TABLE(id uuid, alias text, category text, provider text, status text,
  is_default boolean, config jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT i.id, i.alias, i.category, i.provider, i.status, i.is_default,
    CASE WHEN i.provider = 'bepaid' THEN jsonb_build_object(
      'shop_id', i.config->>'shop_id', 'test_mode', i.config->>'test_mode' IN ('true', '1'),
      'fee_rules', jsonb_build_object(
        'erip_percent', CASE WHEN jsonb_typeof(i.config#>'{fee_rules,erip_percent}') = 'number' THEN i.config#>'{fee_rules,erip_percent}' ELSE NULL END,
        'card_by_percent', CASE WHEN jsonb_typeof(i.config#>'{fee_rules,card_by_percent}') = 'number' THEN i.config#>'{fee_rules,card_by_percent}' ELSE NULL END,
        'card_foreign_percent', CASE WHEN jsonb_typeof(i.config#>'{fee_rules,card_foreign_percent}') = 'number' THEN i.config#>'{fee_rules,card_foreign_percent}' ELSE NULL END,
        'card_micro_percent', CASE WHEN jsonb_typeof(i.config#>'{fee_rules,card_micro_percent}') = 'number' THEN i.config#>'{fee_rules,card_micro_percent}' ELSE NULL END,
        'micro_amount_byn', CASE WHEN jsonb_typeof(i.config#>'{fee_rules,micro_amount_byn}') = 'number' THEN i.config#>'{fee_rules,micro_amount_byn}' ELSE NULL END,
        'fixed_per_txn', CASE WHEN jsonb_typeof(i.config#>'{fee_rules,fixed_per_txn}') = 'number' THEN i.config#>'{fee_rules,fixed_per_txn}' ELSE NULL END))
    WHEN i.category = 'email' THEN jsonb_build_object(
      'email', i.config->>'email', 'from_email', i.config->>'from_email')
    ELSE '{}'::jsonb END
  FROM public.integration_instances i
  WHERE (select auth.uid()) IS NOT NULL AND (
    (i.provider = 'bepaid' AND (
      public.has_admin_section_access((select auth.uid()), 'payments', 'view') OR
      public.has_admin_section_access((select auth.uid()), 'deals', 'view') OR
      public.has_admin_section_access((select auth.uid()), 'products', 'view'))) OR
    (i.category = 'email' AND (
      public.has_admin_section_access((select auth.uid()), 'communication', 'view') OR
      public.has_admin_section_access((select auth.uid()), 'contacts', 'view') OR
      public.has_admin_section_access((select auth.uid()), 'companies', 'view'))) OR
    (i.provider = 'kinescope' AND
      public.has_admin_section_access((select auth.uid()), 'live-events', 'view'))
  );
$$;

CREATE OR REPLACE FUNCTION public.list_operational_acquiring_connections()
RETURNS TABLE(account_code text, account_name text, provider text, test_mode boolean,
  is_default boolean, status text, capabilities_snapshot jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.account_code, a.account_name, a.provider, a.test_mode, a.is_default,
    a.status, jsonb_build_object('supported_currencies', (
      SELECT coalesce(jsonb_agg(c.value), '[]'::jsonb)
      FROM jsonb_array_elements(CASE
        WHEN jsonb_typeof(a.capabilities_snapshot->'supported_currencies') = 'array'
        THEN a.capabilities_snapshot->'supported_currencies' ELSE '[]'::jsonb END) c
      WHERE jsonb_typeof(c.value) = 'string' AND c.value#>>'{}' ~ '^[A-Za-z]{3}$'))
  FROM public.acquiring_connections a
  WHERE (select auth.uid()) IS NOT NULL AND (
    public.has_admin_section_access((select auth.uid()), 'payments', 'view') OR
    public.has_admin_section_access((select auth.uid()), 'deals', 'view') OR
    public.has_admin_section_access((select auth.uid()), 'products', 'view'));
$$;

REVOKE ALL ON FUNCTION public.list_operational_telegram_bots() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_operational_email_accounts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_operational_integrations() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_operational_acquiring_connections() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_operational_telegram_bots(),
  public.list_operational_email_accounts(), public.list_operational_integrations(),
  public.list_operational_acquiring_connections() TO authenticated, service_role;

COMMIT;
