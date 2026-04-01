
-- Product-scoped reentry pricing table
CREATE TABLE public.product_reentry_pricing (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products_v2(id),
  reentry_active BOOLEAN NOT NULL DEFAULT true,
  applies_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_subscription_id UUID REFERENCES public.subscriptions_v2(id),
  reason_code TEXT NOT NULL DEFAULT 'grace_period_expired',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, product_id)
);

ALTER TABLE public.product_reentry_pricing ENABLE ROW LEVEL SECURITY;

-- Service-only access (edge functions use service role key)
CREATE POLICY "Service role full access" ON public.product_reentry_pricing
  FOR ALL USING (true) WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX idx_product_reentry_pricing_user_product 
  ON public.product_reentry_pricing(user_id, product_id) 
  WHERE reentry_active = true;

-- Backfill from profiles.was_club_member for legit grace_period_expired cases
-- Map each user to their most recent expired subscription's product_id
INSERT INTO public.product_reentry_pricing (user_id, product_id, reentry_active, applies_from, source_subscription_id, reason_code)
SELECT DISTINCT ON (p.user_id, s.product_id)
  p.user_id,
  s.product_id,
  true,
  COALESCE(p.reentry_pricing_applies_from, p.club_exit_at, now()),
  s.id,
  'grace_period_expired'
FROM profiles p
JOIN subscriptions_v2 s ON s.user_id = p.user_id
WHERE p.was_club_member = true
  AND p.reentry_penalty_waived = false
  AND p.club_exit_reason = 'grace_period_expired'
  AND p.reentry_pricing_applies_from IS NOT NULL
  AND s.status IN ('expired','canceled','expired_reentry')
ORDER BY p.user_id, s.product_id, s.access_end_at DESC;
