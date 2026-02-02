-- =========================================================
-- CRITICAL FIX: Исправление backfill + pagination + stats
-- =========================================================

-- =========================================================
-- PATCH-1A FIX: card_profile_links.provider column
-- =========================================================
ALTER TABLE public.card_profile_links
  ADD COLUMN IF NOT EXISTS provider text;

UPDATE public.card_profile_links
SET provider = 'bepaid'
WHERE provider IS NULL;

ALTER TABLE public.card_profile_links
  ALTER COLUMN provider SET DEFAULT 'bepaid';

-- Drop old constraint if exists and recreate properly
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'card_profile_links_provider_token_uniq') THEN
    ALTER TABLE public.card_profile_links DROP CONSTRAINT card_profile_links_provider_token_uniq;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cpl_provider_token_uniq') THEN
    ALTER TABLE public.card_profile_links DROP CONSTRAINT cpl_provider_token_uniq;
  END IF;
END $$;

-- Create proper partial unique constraint (provider, provider_token) where token is not null
CREATE UNIQUE INDEX IF NOT EXISTS idx_cpl_provider_token_uniq
  ON public.card_profile_links (provider, provider_token)
  WHERE provider_token IS NOT NULL;

-- =========================================================
-- PATCH-1B FIX: backfill with CTE-based LIMIT (Postgres-correct)
-- STOP-guard: limit <= 2000, NO overwrite existing profile_id
-- NO GRANT to authenticated
-- =========================================================
CREATE OR REPLACE FUNCTION public.backfill_payments_by_card_token(
  p_profile_id uuid,
  p_provider text DEFAULT 'bepaid',
  p_provider_token text DEFAULT NULL,
  p_dry_run boolean DEFAULT true,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_token_hash text;
  v_would_update bigint := 0;
  v_updated bigint := 0;
  v_skipped bigint := 0;
BEGIN
  -- STOP-guard: validate limit
  IF p_limit IS NULL OR p_limit < 1 THEN p_limit := 1; END IF;
  IF p_limit > 2000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'p_limit exceeds maximum (2000)');
  END IF;

  -- Validate profile exists
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Profile not found');
  END IF;

  -- Validate token
  IF p_provider_token IS NULL OR btrim(p_provider_token) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'provider_token is required');
  END IF;

  -- Hash token for audit (no PII in logs)
  v_token_hash := encode(sha256(p_provider_token::bytea), 'hex');

  -- Count would-be updates (profile_id IS NULL only)
  SELECT COUNT(*) INTO v_would_update
  FROM public.payments_v2 p
  WHERE p.provider = p_provider
    AND p.profile_id IS NULL
    AND (
      p.provider_response->>'token' = p_provider_token
      OR p.provider_response->'transaction'->'credit_card'->>'token' = p_provider_token
      OR p.provider_response->'credit_card'->>'token' = p_provider_token
      OR p.provider_response->'card'->>'token' = p_provider_token
    );

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'success', true,
      'dry_run', true,
      'would_update', v_would_update,
      'provider', p_provider,
      'profile_id', p_profile_id,
      'provider_token_hash', left(v_token_hash, 16)
    );
  END IF;

  -- CRITICAL FIX: Use CTE with LIMIT for Postgres-correct UPDATE
  WITH target_ids AS (
    SELECT p.id
    FROM public.payments_v2 p
    WHERE p.provider = p_provider
      AND p.profile_id IS NULL
      AND (
        p.provider_response->>'token' = p_provider_token
        OR p.provider_response->'transaction'->'credit_card'->>'token' = p_provider_token
        OR p.provider_response->'credit_card'->>'token' = p_provider_token
        OR p.provider_response->'card'->>'token' = p_provider_token
      )
    ORDER BY p.paid_at DESC NULLS LAST
    LIMIT p_limit
  ),
  updated_rows AS (
    UPDATE public.payments_v2 p
    SET 
      profile_id = p_profile_id,
      meta = COALESCE(p.meta, '{}'::jsonb) || jsonb_build_object(
        'auto_linked_at', now(),
        'auto_linked_by', 'backfill_payments_by_card_token',
        'auto_linked_token_hash', left(v_token_hash, 16)
      )
    FROM target_ids t
    WHERE p.id = t.id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_updated FROM updated_rows;

  -- Count skipped (already has different profile_id)
  SELECT COUNT(*) INTO v_skipped
  FROM public.payments_v2 p
  WHERE p.provider = p_provider
    AND p.profile_id IS NOT NULL
    AND p.profile_id <> p_profile_id
    AND (
      p.provider_response->>'token' = p_provider_token
      OR p.provider_response->'transaction'->'credit_card'->>'token' = p_provider_token
      OR p.provider_response->'credit_card'->>'token' = p_provider_token
      OR p.provider_response->'card'->>'token' = p_provider_token
    );

  -- Audit log (no PII - only hash and counts)
  INSERT INTO public.audit_logs(action, actor_type, actor_user_id, actor_label, meta)
  VALUES (
    'payment.card_token_backfill',
    'system',
    NULL,
    'backfill_payments_by_card_token',
    jsonb_build_object(
      'provider', p_provider,
      'profile_id', p_profile_id,
      'token_hash', left(v_token_hash, 16),
      'updated', v_updated,
      'skipped_existing', v_skipped
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'dry_run', false,
    'updated', v_updated,
    'skipped_existing', v_skipped,
    'provider', p_provider,
    'profile_id', p_profile_id,
    'token_hash', left(v_token_hash, 16)
  );
END;
$$;

-- CRITICAL: NO GRANT to authenticated - admin-only via service_role

-- =========================================================
-- PATCH-3A FIX: admin_get_payments_page_v1 (NO PII in response)
-- Removed: profile_email, card_last4 search
-- Admin-only: NO GRANT to authenticated
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_get_payments_page_v1(
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_provider text DEFAULT 'bepaid'
)
RETURNS TABLE(rows jsonb, total_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows jsonb;
  v_total bigint;
BEGIN
  -- STOP-guards
  IF p_limit > 200 THEN p_limit := 200; END IF;
  IF p_limit < 1 THEN p_limit := 1; END IF;
  IF p_offset < 0 THEN p_offset := 0; END IF;
  IF p_offset > 50000 THEN p_offset := 50000; END IF;

  -- Count total (NO card_last4 in search - PII!)
  SELECT COUNT(*) INTO v_total
  FROM public.payments_v2 p
  LEFT JOIN public.profiles pr ON pr.id = p.profile_id
  LEFT JOIN public.orders_v2 o ON o.id = p.order_id
  WHERE p.provider = p_provider
    AND p.paid_at >= p_from AND p.paid_at <= p_to
    AND (p_status IS NULL OR p.status = p_status)
    AND (
      p_search IS NULL OR (
        p.provider_payment_id ILIKE '%'||p_search||'%'
        OR o.order_number ILIKE '%'||p_search||'%'
        OR pr.full_name ILIKE '%'||p_search||'%'
      )
    );

  -- Fetch rows (NO profile_email, NO card_last4 in response)
  SELECT COALESCE(jsonb_agg(row_to_json(sub) ORDER BY sub.paid_at DESC NULLS LAST), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT
      p.id,
      p.provider_payment_id AS uid,
      p.amount,
      p.currency,
      p.status,
      p.transaction_type,
      p.paid_at,
      p.created_at,
      p.card_brand,
      p.profile_id,
      p.order_id,
      p.origin,
      p.receipt_url,
      p.meta,
      pr.full_name AS profile_name,
      o.order_number
    FROM public.payments_v2 p
    LEFT JOIN public.profiles pr ON pr.id = p.profile_id
    LEFT JOIN public.orders_v2 o ON o.id = p.order_id
    WHERE p.provider = p_provider
      AND p.paid_at >= p_from AND p.paid_at <= p_to
      AND (p_status IS NULL OR p.status = p_status)
      AND (
        p_search IS NULL OR (
          p.provider_payment_id ILIKE '%'||p_search||'%'
          OR o.order_number ILIKE '%'||p_search||'%'
          OR pr.full_name ILIKE '%'||p_search||'%'
        )
      )
    ORDER BY p.paid_at DESC NULLS LAST
    LIMIT p_limit OFFSET p_offset
  ) sub;

  RETURN QUERY SELECT v_rows, v_total;
END;
$$;

-- CRITICAL: NO GRANT to authenticated - admin-only via service_role

-- =========================================================
-- PATCH-4A FIX: admin_get_payments_stats_v1 (NO PII)
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_get_payments_stats_v1(
  p_from timestamptz,
  p_to timestamptz,
  p_provider text DEFAULT 'bepaid'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_count', COUNT(*),
    'successful_count', COUNT(*) FILTER (WHERE status IN ('successful','succeeded') AND COALESCE(transaction_type,'') NOT IN ('refund','void') AND amount > 0),
    'successful_amount', COALESCE(SUM(amount) FILTER (WHERE status IN ('successful','succeeded') AND COALESCE(transaction_type,'') NOT IN ('refund','void') AND amount > 0), 0),
    'refunded_count', COUNT(*) FILTER (WHERE transaction_type='refund' OR status='refunded'),
    'refunded_amount', COALESCE(SUM(ABS(amount)) FILTER (WHERE transaction_type='refund' OR status='refunded'), 0),
    'cancelled_count', COUNT(*) FILTER (WHERE transaction_type='void' OR status IN ('cancelled','canceled','void')),
    'cancelled_amount', COALESCE(SUM(ABS(amount)) FILTER (WHERE transaction_type='void' OR status IN ('cancelled','canceled','void')), 0),
    'failed_count', COUNT(*) FILTER (WHERE status IN ('failed','declined','expired','error') AND COALESCE(transaction_type,'') <> 'void'),
    'failed_amount', COALESCE(SUM(ABS(amount)) FILTER (WHERE status IN ('failed','declined','expired','error') AND COALESCE(transaction_type,'') <> 'void'), 0),
    'processing_count', COUNT(*) FILTER (WHERE status IN ('pending','processing','incomplete')),
    'processing_amount', COALESCE(SUM(amount) FILTER (WHERE status IN ('pending','processing','incomplete')), 0),
    'commission_total', COALESCE(SUM((meta->>'commission_total')::numeric) FILTER (WHERE meta ? 'commission_total'), 0)
  )
  INTO result
  FROM public.payments_v2
  WHERE provider = p_provider
    AND paid_at >= p_from AND paid_at <= p_to;

  RETURN result;
END;
$$;

-- CRITICAL: NO GRANT to authenticated - admin-only via service_role

-- Revoke any existing authenticated grants (safety)
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.backfill_payments_by_card_token FROM authenticated;
  REVOKE EXECUTE ON FUNCTION public.admin_get_payments_page_v1 FROM authenticated;
  REVOKE EXECUTE ON FUNCTION public.admin_get_payments_stats_v1 FROM authenticated;
EXCEPTION WHEN OTHERS THEN
  -- Ignore if grants don't exist
  NULL;
END $$;