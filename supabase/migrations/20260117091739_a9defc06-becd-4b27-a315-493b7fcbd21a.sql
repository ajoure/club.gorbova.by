-- Drop and recreate the trigger function without cancel_at_period_end column
CREATE OR REPLACE FUNCTION sync_payment_method_revocation()
RETURNS TRIGGER AS $$
BEGIN
  -- When status changes to 'revoked' or 'deleted'
  IF NEW.status IN ('revoked', 'deleted') AND OLD.status = 'active' THEN
    -- Clear payment_method_id in subscriptions
    UPDATE subscriptions_v2
    SET 
      payment_method_id = NULL,
      payment_token = NULL,
      auto_renew = false,
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'payment_method_revoked_at', now()::text,
        'revoked_payment_method_id', OLD.id::text
      )
    WHERE payment_method_id = OLD.id
      AND status IN ('active', 'trial', 'past_due');
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;