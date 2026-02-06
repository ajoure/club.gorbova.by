-- Fix SECURITY DEFINER VIEW warning
-- Drop and recreate view with SECURITY INVOKER (default, but explicit)
DROP VIEW IF EXISTS public.subscriptions_v2_safe;

CREATE VIEW public.subscriptions_v2_safe 
WITH (security_invoker = true)
AS
SELECT 
  id,
  user_id,
  profile_id,
  product_id,
  tariff_id,
  flow_id,
  order_id,
  status,
  access_start_at,
  access_end_at,
  is_trial,
  trial_end_at,
  trial_canceled_at,
  trial_canceled_by,
  keep_access_until_trial_end,
  next_charge_at,
  auto_renew,
  auto_renew_disabled_by,
  auto_renew_disabled_at,
  auto_renew_disabled_by_user_id,
  billing_type,
  grace_period_status,
  grace_period_started_at,
  grace_period_ends_at,
  payment_method_id,
  -- Note: payment_token is intentionally EXCLUDED for security
  charge_attempts,
  canceled_at,
  cancel_at,
  cancel_reason,
  created_at,
  updated_at,
  meta,
  -- Add a computed column to indicate if token exists (without revealing the token)
  public.subscription_has_payment_token(id) AS has_payment_token
FROM public.subscriptions_v2;

-- Grant SELECT on the safe view to authenticated users
GRANT SELECT ON public.subscriptions_v2_safe TO authenticated;

-- Re-add comment
COMMENT ON VIEW public.subscriptions_v2_safe IS 'Safe view of subscriptions excluding sensitive payment_token. Use this instead of subscriptions_v2 in frontend code.';