-- Compatibility fields used by the reminder/audit readers.
-- These are descriptive mirrors; provider_subscriptions remains the source of
-- truth for provider state and billing dates.
ALTER TABLE public.subscriptions_v2
  ADD COLUMN IF NOT EXISTS payment_type text,
  ADD COLUMN IF NOT EXISTS provider text;

-- Backfill the non-ambiguous classification from the canonical billing model.
UPDATE public.subscriptions_v2
SET payment_type = CASE
  WHEN billing_type = 'provider_managed'
    OR (meta #>> '{recurring,is_recurring}') IN ('true', '1')
    THEN 'subscription'
  ELSE 'one_time'
END
WHERE payment_type IS NULL;

-- Mirror the linked provider only when an unambiguous provider-subscription
-- row exists. Unlinked legacy rows intentionally remain NULL.
UPDATE public.subscriptions_v2 AS s
SET provider = ps.provider
FROM public.provider_subscriptions AS ps
WHERE ps.subscription_v2_id = s.id
  AND s.provider IS NULL;

COMMENT ON COLUMN public.subscriptions_v2.payment_type IS
  'Compatibility classification: subscription or one_time; derived from billing_type/recurring metadata.';

COMMENT ON COLUMN public.subscriptions_v2.provider IS
  'Optional provider mirror for linked provider_subscriptions; provider_subscriptions is authoritative.';
