-- PATCH-1B: Admin-only RPC for backfill by provider_token (NOT by last4+brand)
CREATE OR REPLACE FUNCTION public.backfill_payments_by_card_token(
  p_profile_id UUID,
  p_provider TEXT DEFAULT 'bepaid',
  p_provider_token TEXT DEFAULT NULL,
  p_dry_run BOOLEAN DEFAULT true,
  p_limit INTEGER DEFAULT 500
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count_before INTEGER;
  v_updated INTEGER := 0;
  v_skipped INTEGER := 0;
  v_token_hash TEXT;
BEGIN
  -- STOP-guard: limit max 2000
  IF p_limit > 2000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'p_limit exceeds maximum (2000)');
  END IF;
  
  -- Validate profile exists
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Profile not found');
  END IF;
  
  -- Require provider_token (we don't allow last4+brand backfill)
  IF p_provider_token IS NULL OR p_provider_token = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'provider_token is required (last4+brand backfill is disabled)');
  END IF;
  
  -- Hash token for audit (no PII)
  v_token_hash := encode(sha256(p_provider_token::bytea), 'hex');
  
  -- Count payments with this token where profile_id IS NULL
  SELECT COUNT(*) INTO v_count_before
  FROM payments_v2
  WHERE provider = p_provider
    AND (provider_response->>'token' = p_provider_token
         OR provider_response->'transaction'->'credit_card'->>'token' = p_provider_token)
    AND profile_id IS NULL;
  
  IF p_dry_run THEN
    RETURN jsonb_build_object('success', true, 'dry_run', true, 'would_update', v_count_before, 'profile_id', p_profile_id);
  END IF;
  
  -- Execute update (only where profile_id IS NULL - never overwrite)
  WITH updated_rows AS (
    UPDATE payments_v2 p
    SET profile_id = p_profile_id,
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'auto_linked_at', now()::text,
          'auto_linked_by', 'backfill_payments_by_card_token',
          'auto_linked_provider_token_hash', left(v_token_hash, 16))
    WHERE p.provider = p_provider
      AND (p.provider_response->>'token' = p_provider_token
           OR p.provider_response->'transaction'->'credit_card'->>'token' = p_provider_token)
      AND p.profile_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_updated FROM updated_rows;
  
  -- Count skipped (already have different profile_id)
  SELECT COUNT(*) INTO v_skipped
  FROM payments_v2
  WHERE provider = p_provider
    AND (provider_response->>'token' = p_provider_token
         OR provider_response->'transaction'->'credit_card'->>'token' = p_provider_token)
    AND profile_id IS NOT NULL AND profile_id != p_profile_id;
  
  -- Audit log (no PII - only hashed token and counts)
  INSERT INTO audit_logs (action, actor_type, actor_user_id, actor_label, meta)
  VALUES ('payment.card_token_backfill', 'system', NULL, 'backfill_payments_by_card_token',
    jsonb_build_object('profile_id', p_profile_id, 'provider', p_provider,
      'provider_token_hash', left(v_token_hash, 16), 'updated', v_updated, 'skipped_existing', v_skipped, 'dry_run', p_dry_run));
  
  RETURN jsonb_build_object('success', true, 'dry_run', false, 'updated', v_updated, 'skipped_existing', v_skipped, 'profile_id', p_profile_id);
END;
$$;

-- NOTE: NO GRANT EXECUTE TO authenticated - admin-only via service_role or Edge Function

-- PATCH-3A: Server-side pagination RPC for /admin/payments
CREATE OR REPLACE FUNCTION public.admin_get_payments_page_v1(
  p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_limit INTEGER DEFAULT 50, p_offset INTEGER DEFAULT 0,
  p_status TEXT DEFAULT NULL, p_search TEXT DEFAULT NULL, p_provider TEXT DEFAULT 'bepaid'
)
RETURNS TABLE (rows JSONB, total_count BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_rows JSONB; v_total BIGINT;
BEGIN
  IF p_limit > 200 THEN p_limit := 200; END IF;
  IF p_offset > 50000 THEN p_offset := 50000; END IF;
  
  SELECT COUNT(*) INTO v_total FROM payments_v2 p
  WHERE p.provider = p_provider AND p.paid_at >= p_from AND p.paid_at <= p_to
    AND (p_status IS NULL OR p.status = p_status)
    AND (p_search IS NULL OR p.provider_payment_id ILIKE '%' || p_search || '%' OR p.card_last4 ILIKE '%' || p_search || '%');
  
  SELECT COALESCE(jsonb_agg(row_to_json(sub)), '[]'::jsonb) INTO v_rows FROM (
    SELECT p.id, p.provider_payment_id as uid, p.amount, p.currency, p.status, p.transaction_type,
      p.paid_at, p.created_at, p.card_last4, p.card_brand, p.profile_id, p.order_id, p.origin, p.receipt_url, p.meta,
      pr.full_name as profile_name, pr.email as profile_email, o.order_number
    FROM payments_v2 p LEFT JOIN profiles pr ON pr.id = p.profile_id LEFT JOIN orders_v2 o ON o.id = p.order_id
    WHERE p.provider = p_provider AND p.paid_at >= p_from AND p.paid_at <= p_to
      AND (p_status IS NULL OR p.status = p_status)
      AND (p_search IS NULL OR p.provider_payment_id ILIKE '%' || p_search || '%' OR p.card_last4 ILIKE '%' || p_search || '%')
    ORDER BY p.paid_at DESC NULLS LAST LIMIT p_limit OFFSET p_offset
  ) sub;
  
  RETURN QUERY SELECT v_rows, v_total;
END;
$$;

-- PATCH-4A: Server-side stats RPC (independent of pagination)
CREATE OR REPLACE FUNCTION public.admin_get_payments_stats_v1(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_provider TEXT DEFAULT 'bepaid')
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_count', COUNT(*),
    'successful_count', COUNT(*) FILTER (WHERE status IN ('successful', 'succeeded') AND COALESCE(transaction_type,'') NOT IN ('refund', 'void') AND amount > 0),
    'successful_amount', COALESCE(SUM(amount) FILTER (WHERE status IN ('successful', 'succeeded') AND COALESCE(transaction_type,'') NOT IN ('refund', 'void') AND amount > 0), 0),
    'refunded_count', COUNT(*) FILTER (WHERE transaction_type = 'refund' OR status = 'refunded'),
    'refunded_amount', COALESCE(SUM(ABS(amount)) FILTER (WHERE transaction_type = 'refund' OR status = 'refunded'), 0),
    'cancelled_count', COUNT(*) FILTER (WHERE transaction_type = 'void' OR status IN ('cancelled', 'canceled', 'void')),
    'cancelled_amount', COALESCE(SUM(ABS(amount)) FILTER (WHERE transaction_type = 'void' OR status IN ('cancelled', 'canceled', 'void')), 0),
    'failed_count', COUNT(*) FILTER (WHERE status IN ('failed', 'declined', 'expired', 'error') AND COALESCE(transaction_type,'') NOT IN ('void')),
    'failed_amount', COALESCE(SUM(ABS(amount)) FILTER (WHERE status IN ('failed', 'declined', 'expired', 'error') AND COALESCE(transaction_type,'') NOT IN ('void')), 0),
    'processing_count', COUNT(*) FILTER (WHERE status IN ('pending', 'processing', 'incomplete')),
    'processing_amount', COALESCE(SUM(amount) FILTER (WHERE status IN ('pending', 'processing', 'incomplete')), 0),
    'commission_total', COALESCE(SUM((meta->>'commission_total')::numeric) FILTER (WHERE meta->>'commission_total' IS NOT NULL), 0)
  ) INTO result FROM payments_v2 WHERE provider = p_provider AND paid_at >= p_from AND paid_at <= p_to;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_payments_page_v1 TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_payments_stats_v1 TO authenticated;