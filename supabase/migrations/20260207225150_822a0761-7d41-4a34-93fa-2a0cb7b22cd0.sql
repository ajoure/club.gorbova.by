-- PATCH-B: Create RPC for safe dedup of bePaid subscriptions
-- Supports dry-run and execute modes
-- Does NOT delete records — marks past_due without order_id as canceled/terminated

CREATE OR REPLACE FUNCTION public.admin_dedup_bepaid_subscriptions(
  p_mode text DEFAULT 'dry-run'  -- 'dry-run' or 'execute'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duplicates jsonb := '[]'::jsonb;
  v_processed int := 0;
  v_audit_log_id uuid;
  v_dup record;
  v_sub record;
BEGIN
  -- Find all user+product combinations with multiple subscriptions
  -- where at least one is past_due with NULL order_id
  FOR v_dup IN
    WITH candidates AS (
      SELECT 
        s.user_id,
        s.product_id,
        COUNT(*) as sub_count,
        COUNT(*) FILTER (WHERE s.status = 'past_due' AND s.order_id IS NULL) as past_due_orphan_count,
        COUNT(*) FILTER (WHERE s.status IN ('active', 'trial')) as active_count
      FROM subscriptions_v2 s
      WHERE s.canceled_at IS NULL
        AND s.status IN ('active', 'trial', 'past_due')
      GROUP BY s.user_id, s.product_id
      HAVING COUNT(*) > 1
         AND COUNT(*) FILTER (WHERE s.status = 'past_due' AND s.order_id IS NULL) > 0
    )
    SELECT 
      c.user_id,
      c.product_id,
      c.sub_count,
      c.past_due_orphan_count,
      c.active_count,
      p.email as user_email,
      pr.name as product_name
    FROM candidates c
    LEFT JOIN profiles p ON p.user_id = c.user_id
    LEFT JOIN products_v2 pr ON pr.id = c.product_id
    ORDER BY c.user_id
  LOOP
    -- Get subscriptions for this user+product
    FOR v_sub IN
      SELECT 
        s.id,
        s.status,
        s.order_id,
        s.access_end_at,
        s.created_at
      FROM subscriptions_v2 s
      WHERE s.user_id = v_dup.user_id
        AND s.product_id = v_dup.product_id
        AND s.canceled_at IS NULL
        AND s.status IN ('active', 'trial', 'past_due')
      ORDER BY s.access_end_at DESC
    LOOP
      -- Identify past_due orphans (no order_id)
      IF v_sub.status = 'past_due' AND v_sub.order_id IS NULL THEN
        v_duplicates := v_duplicates || jsonb_build_object(
          'subscription_id', v_sub.id,
          'user_id', v_dup.user_id,
          'user_email', v_dup.user_email,
          'product_id', v_dup.product_id,
          'product_name', v_dup.product_name,
          'status', v_sub.status,
          'order_id', v_sub.order_id,
          'access_end_at', v_sub.access_end_at,
          'action', 'mark_canceled'
        );

        -- Execute mode: mark as canceled
        IF p_mode = 'execute' THEN
          UPDATE subscriptions_v2
          SET 
            status = 'canceled',
            canceled_at = now(),
            cancel_reason = 'Dedup: past_due without order_id',
            meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
              'dedup_reason', 'past_due_without_order_id',
              'dedup_at', now()::text
            ),
            updated_at = now()
          WHERE id = v_sub.id;
          
          v_processed := v_processed + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- Create audit log entry for execute mode
  IF p_mode = 'execute' AND v_processed > 0 THEN
    INSERT INTO audit_logs (
      actor_type,
      actor_user_id,
      actor_label,
      action,
      meta
    ) VALUES (
      'system',
      NULL,
      'admin_dedup_bepaid_subscriptions',
      'bepaid.subscriptions.dedup_executed',
      jsonb_build_object(
        'processed_count', v_processed,
        'sample_ids', (SELECT jsonb_agg(d->>'subscription_id') FROM jsonb_array_elements(v_duplicates) d LIMIT 10)
      )
    )
    RETURNING id INTO v_audit_log_id;
  END IF;

  RETURN jsonb_build_object(
    'status', CASE WHEN p_mode = 'execute' THEN 'executed' ELSE 'dry-run' END,
    'found_count', jsonb_array_length(v_duplicates),
    'processed_count', v_processed,
    'duplicates', v_duplicates,
    'audit_log_id', v_audit_log_id
  );
END;
$$;

-- Grant execute only to service_role (no direct authenticated access)
REVOKE ALL ON FUNCTION public.admin_dedup_bepaid_subscriptions(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_dedup_bepaid_subscriptions(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dedup_bepaid_subscriptions(text) TO service_role;

COMMENT ON FUNCTION public.admin_dedup_bepaid_subscriptions IS 'PATCH-B: Safe dedup of duplicate subscriptions. Marks past_due orphans as canceled instead of deleting. Requires service_role.';