
-- ============================================================================
-- Phase 1.1 — Atomic reorder RPC for tariff offers
-- ============================================================================
-- SECURITY INVOKER: existing RLS + trigger-based checks apply to the caller.
-- The function only writes sort_order. All other columns are untouched, so
-- meta/slot_role/is_active/etc. cannot be corrupted through this endpoint.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_tariff_offers(
  p_tariff_id   uuid,
  p_ordered_ids uuid[]
)
RETURNS SETOF public.tariff_offers
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_input_count      int := COALESCE(cardinality(p_ordered_ids), 0);
  v_distinct_count   int;
  v_expected_count   int;
  v_matching_count   int;
BEGIN
  IF p_tariff_id IS NULL THEN
    RAISE EXCEPTION 'reorder_tariff_offers: p_tariff_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Lock all offers of the tariff in a deterministic order to avoid deadlocks.
  PERFORM 1
  FROM public.tariff_offers
  WHERE tariff_id = p_tariff_id
  ORDER BY id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_expected_count
  FROM public.tariff_offers
  WHERE tariff_id = p_tariff_id;

  -- Empty tariff: only accept an empty array, then no-op.
  IF v_expected_count = 0 THEN
    IF v_input_count <> 0 THEN
      RAISE EXCEPTION 'reorder_tariff_offers: tariff % has no offers, but % ids were passed',
        p_tariff_id, v_input_count
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    RETURN;
  END IF;

  IF v_input_count <> v_expected_count THEN
    RAISE EXCEPTION 'reorder_tariff_offers: expected % ids for tariff %, got %',
      v_expected_count, p_tariff_id, v_input_count
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Reject duplicated ids in the input array.
  SELECT COUNT(DISTINCT x) INTO v_distinct_count
  FROM unnest(p_ordered_ids) AS x;

  IF v_distinct_count <> v_input_count THEN
    RAISE EXCEPTION 'reorder_tariff_offers: duplicated ids in p_ordered_ids for tariff %',
      p_tariff_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Every passed id must belong to this tariff.
  SELECT COUNT(*) INTO v_matching_count
  FROM public.tariff_offers o
  WHERE o.tariff_id = p_tariff_id
    AND o.id = ANY(p_ordered_ids);

  IF v_matching_count <> v_expected_count THEN
    RAISE EXCEPTION 'reorder_tariff_offers: some ids do not belong to tariff % (matched % of %)',
      p_tariff_id, v_matching_count, v_expected_count
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Atomic reorder: sort_order = 0..N-1 in the order provided.
  UPDATE public.tariff_offers AS o
  SET sort_order = (u.ord - 1)::int
  FROM unnest(p_ordered_ids) WITH ORDINALITY AS u(oid, ord)
  WHERE o.id = u.oid
    AND o.tariff_id = p_tariff_id;

  RETURN QUERY
    SELECT *
    FROM public.tariff_offers
    WHERE tariff_id = p_tariff_id
    ORDER BY sort_order ASC, id ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.reorder_tariff_offers(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_tariff_offers(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_tariff_offers(uuid, uuid[]) TO service_role;

COMMENT ON FUNCTION public.reorder_tariff_offers(uuid, uuid[]) IS
  'Atomically renumbers meta.sort_order for all offers of p_tariff_id to 0..N-1 in the given order. SECURITY INVOKER; caller must have UPDATE access via RLS.';

-- ============================================================================
-- Phase 1.2 — Migrate legacy slot_role values to canonical button_N
-- ============================================================================
-- Idempotent: only rows whose current slot_role matches a legacy key are touched.
-- meta remains a proper JSON object; other keys are preserved.
-- ----------------------------------------------------------------------------
UPDATE public.tariff_offers AS o
SET meta = jsonb_set(
  COALESCE(o.meta, '{}'::jsonb),
  '{slot_role}',
  to_jsonb(m.new_role),
  true
)
FROM (VALUES
  ('payment_card',     'button_1'),
  ('payment_invoice',  'button_2'),
  ('installment_2',    'button_3'),
  ('installment_3',    'button_4'),
  ('installment_bank', 'button_5')
) AS m(old_role, new_role)
WHERE o.meta ->> 'slot_role' = m.old_role;

-- ============================================================================
-- Phase 1.3 — Post-migration assertions
-- ============================================================================
DO $$
DECLARE
  v_legacy    int;
  v_dup_count int;
BEGIN
  SELECT COUNT(*) INTO v_legacy
  FROM public.tariff_offers
  WHERE meta ->> 'slot_role' IN (
    'payment_card','payment_invoice','installment_2','installment_3','installment_bank',
    'installment_variant_1','installment_variant_2','bank_installment_variant_1','other'
  );

  IF v_legacy <> 0 THEN
    RAISE EXCEPTION 'slot_role migration assertion failed: % legacy values remain', v_legacy;
  END IF;

  SELECT COALESCE(SUM(dup - 1), 0) INTO v_dup_count
  FROM (
    SELECT tariff_id, meta->>'slot_role' AS role, COUNT(*) AS dup
    FROM public.tariff_offers
    WHERE NULLIF(meta->>'slot_role', '') IS NOT NULL
    GROUP BY tariff_id, meta->>'slot_role'
    HAVING COUNT(*) > 1
  ) x;

  IF v_dup_count <> 0 THEN
    RAISE EXCEPTION 'slot_role migration assertion failed: % duplicate slot_role rows per tariff', v_dup_count;
  END IF;
END $$;
