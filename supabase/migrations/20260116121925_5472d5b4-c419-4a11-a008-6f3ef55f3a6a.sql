-- Clean up "ghost tokens" - subscriptions with payment_token but no payment_method_id
-- These tokens were saved directly from checkout, user cannot see/manage them

UPDATE subscriptions_v2
SET 
  payment_token = NULL,
  auto_renew = false,
  meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
    'ghost_token_cleared_at', now()::text,
    'ghost_token_reason', 'Token was saved without linked payment_method - user cannot manage card'
  )
WHERE payment_method_id IS NULL 
  AND payment_token IS NOT NULL
  AND status IN ('trial', 'active', 'past_due');

-- Log this cleanup
INSERT INTO audit_logs (actor_type, actor_label, action, meta)
VALUES (
  'system',
  'migration',
  'ghost_tokens_cleanup',
  jsonb_build_object('cleaned_at', now()::text)
);