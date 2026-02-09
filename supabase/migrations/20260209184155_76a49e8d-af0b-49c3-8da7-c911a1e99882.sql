
-- PATCH P0.9.6: Create missing functions from failed first migration

-- A: Trigger function for superseded subscriptions
CREATE OR REPLACE FUNCTION public.fn_close_superseded_subscriptions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  closed_count int;
BEGIN
  IF NEW.status NOT IN ('active', 'trial') THEN
    RETURN NEW;
  END IF;

  UPDATE subscriptions_v2
  SET status = 'superseded',
      auto_renew = false,
      updated_at = now()
  WHERE user_id = NEW.user_id
    AND product_id = NEW.product_id
    AND id != NEW.id
    AND status IN ('active', 'trial', 'past_due')
    AND (
      (access_end_at IS NOT NULL AND NEW.access_end_at IS NULL)
      OR
      (access_end_at IS NOT NULL AND NEW.access_end_at IS NOT NULL AND access_end_at < NEW.access_end_at)
    );

  GET DIAGNOSTICS closed_count = ROW_COUNT;

  IF closed_count > 0 THEN
    INSERT INTO audit_logs (action, actor_type, actor_label, meta)
    VALUES (
      'subscription.auto_superseded',
      'system',
      'trg_close_superseded',
      jsonb_build_object(
        'new_subscription_id', NEW.id,
        'user_id', NEW.user_id,
        'product_id', NEW.product_id,
        'closed_count', closed_count
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_superseded_subscriptions ON subscriptions_v2;
CREATE TRIGGER trg_close_superseded_subscriptions
  AFTER INSERT OR UPDATE OF status ON subscriptions_v2
  FOR EACH ROW
  EXECUTE FUNCTION fn_close_superseded_subscriptions();

-- B: Cascade order cancellation function
CREATE OR REPLACE FUNCTION public.cascade_order_cancellation(
  p_order_id uuid,
  p_reason text DEFAULT 'order_canceled'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  ent_count int := 0;
  sub_count int := 0;
  grant_count int := 0;
BEGIN
  UPDATE entitlements SET status = 'revoked', updated_at = now()
  WHERE order_id = p_order_id AND status = 'active';
  GET DIAGNOSTICS ent_count = ROW_COUNT;

  UPDATE subscriptions_v2 SET status = 'canceled', auto_renew = false, updated_at = now()
  WHERE order_id = p_order_id AND status IN ('active', 'trial', 'past_due');
  GET DIAGNOSTICS sub_count = ROW_COUNT;

  UPDATE telegram_access_grants SET status = 'revoked', revoke_reason = p_reason, updated_at = now()
  WHERE source_id = p_order_id AND status = 'active';
  GET DIAGNOSTICS grant_count = ROW_COUNT;

  IF (ent_count + sub_count + grant_count) > 0 THEN
    INSERT INTO audit_logs (action, actor_type, actor_label, meta)
    VALUES ('order.cascade_cancel', 'system', 'cascade_order_cancellation',
      jsonb_build_object('order_id', p_order_id, 'reason', p_reason,
        'entitlements_revoked', ent_count, 'subscriptions_canceled', sub_count, 'grants_revoked', grant_count));
  END IF;

  RETURN jsonb_build_object('entitlements_revoked', ent_count, 'subscriptions_canceled', sub_count, 'grants_revoked', grant_count);
END;
$$;

-- C: Expire stale entitlements function
CREATE OR REPLACE FUNCTION public.expire_stale_entitlements(p_batch_limit int DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated_count int;
BEGIN
  WITH to_expire AS (
    SELECT id FROM entitlements
    WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < now()
    LIMIT p_batch_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE entitlements e SET status = 'expired', updated_at = now()
  FROM to_expire WHERE e.id = to_expire.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count > 0 THEN
    INSERT INTO audit_logs (action, actor_type, actor_label, meta)
    VALUES ('entitlements.expire_batch', 'system', 'expire_stale_entitlements',
      jsonb_build_object('updated_count', updated_count));
  END IF;

  RETURN jsonb_build_object('expired_count', updated_count);
END;
$$;
