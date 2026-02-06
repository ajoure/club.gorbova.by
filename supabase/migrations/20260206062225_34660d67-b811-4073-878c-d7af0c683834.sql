-- ============================================
-- SECURITY FIX: Isolate payment tokens from frontend access
-- Move payment_token to a separate service_role-only table
-- ============================================

-- Step 1: Create the isolated credentials table
CREATE TABLE IF NOT EXISTS public.subscription_payment_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.subscriptions_v2(id) ON DELETE CASCADE,
  payment_token text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(subscription_id)
);

-- Step 2: Enable RLS and restrict to service_role only
ALTER TABLE public.subscription_payment_credentials ENABLE ROW LEVEL SECURITY;

-- No policies for authenticated users - service_role bypasses RLS
-- This means ONLY backend functions can access payment tokens

-- Step 3: Migrate existing tokens (only non-null tokens)
INSERT INTO public.subscription_payment_credentials (subscription_id, payment_token)
SELECT id, payment_token 
FROM public.subscriptions_v2 
WHERE payment_token IS NOT NULL
ON CONFLICT (subscription_id) DO NOTHING;

-- Step 4: Create helper function for backend to check if token exists (without exposing it)
-- This allows frontend to check "has token" status via RPC without seeing the actual token
CREATE OR REPLACE FUNCTION public.subscription_has_payment_token(p_subscription_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM subscription_payment_credentials 
    WHERE subscription_id = p_subscription_id
  )
$$;

-- Grant execute to authenticated users (they can check if token exists, but can't see the token itself)
GRANT EXECUTE ON FUNCTION public.subscription_has_payment_token(uuid) TO authenticated;

-- Step 5: Create view for subscriptions without payment_token for frontend use
-- This view excludes the payment_token column entirely but includes all other columns
CREATE OR REPLACE VIEW public.subscriptions_v2_safe AS
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
  EXISTS (
    SELECT 1 FROM subscription_payment_credentials spc 
    WHERE spc.subscription_id = subscriptions_v2.id
  ) AS has_payment_token
FROM public.subscriptions_v2;

-- Grant SELECT on the safe view to authenticated users
GRANT SELECT ON public.subscriptions_v2_safe TO authenticated;

-- Step 6: Add comment for documentation
COMMENT ON TABLE public.subscription_payment_credentials IS 'Isolated storage for payment tokens. Access restricted to service_role only. Frontend must use subscriptions_v2_safe view.';
COMMENT ON VIEW public.subscriptions_v2_safe IS 'Safe view of subscriptions excluding sensitive payment_token. Use this instead of subscriptions_v2 in frontend code.';
COMMENT ON FUNCTION public.subscription_has_payment_token IS 'Check if subscription has a payment token without exposing the token value.';