-- Composable checkout schema/security contract.
-- Read-only catalog assertions; safe against an already migrated test database.
BEGIN;

DO $$
DECLARE
  v_table text;
  v_function text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'offer_addons',
    'order_groups',
    'order_group_items',
    'payment_allocations',
    'composable_refund_intents'
  ]
  LOOP
    ASSERT to_regclass('public.' || v_table) IS NOT NULL,
      format('missing table public.%s', v_table);
    ASSERT (
      SELECT c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_table
    ), format('RLS is disabled on public.%s', v_table);
  END LOOP;

  FOREACH v_function IN ARRAY ARRAY[
    'materialize_composable_order_group(uuid,jsonb,text,text)',
    'settle_composable_order_group(uuid,uuid)',
    'create_composable_refund_intent(uuid,uuid,numeric,text,text,integer,text,uuid)',
    'bind_composable_refund_provider_id(uuid,text)',
    'finalize_composable_refund_allocation(text)',
    'fail_composable_refund_intent(uuid,text)'
  ]
  LOOP
    ASSERT to_regprocedure('public.' || v_function) IS NOT NULL,
      format('missing function public.%s', v_function);
    ASSERT NOT has_function_privilege('anon', 'public.' || v_function, 'EXECUTE'),
      format('anon can execute public.%s', v_function);
    ASSERT NOT has_function_privilege('authenticated', 'public.' || v_function, 'EXECUTE'),
      format('authenticated can execute public.%s', v_function);
    ASSERT has_function_privilege('service_role', 'public.' || v_function, 'EXECUTE'),
      format('service_role cannot execute public.%s', v_function);
  END LOOP;

  ASSERT position(
    'checkout_fingerprint' IN pg_get_functiondef(
      'public.rr_get_or_create_pending_order(uuid,uuid,text,text,uuid,uuid,numeric,text,text,text,text,jsonb,jsonb,uuid,uuid,text)'::regprocedure
    )
  ) > 0, 'RR idempotency does not include checkout_fingerprint';

  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'order_groups'
      AND indexdef ILIKE '%idempotency_key%'
      AND indexdef ILIKE '%UNIQUE%'
  ), 'order_groups idempotency unique index is missing';

  RAISE NOTICE 'Composable checkout catalog/security contract passed';
END $$;

ROLLBACK;
