-- PATCH-1: bePaid Provider-Managed Subscriptions - Database Schema
-- Adds billing_type, provider_subscriptions, orphans tables, orders idempotency

-- 1.1. Add billing_type column to subscriptions_v2
ALTER TABLE subscriptions_v2 
ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'mit';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'subscriptions_v2_billing_type_check'
  ) THEN
    ALTER TABLE subscriptions_v2 
    ADD CONSTRAINT subscriptions_v2_billing_type_check 
    CHECK (billing_type IN ('mit', 'provider_managed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subscriptions_v2_billing_type 
ON subscriptions_v2(billing_type);

COMMENT ON COLUMN subscriptions_v2.billing_type IS 
  'mit = мы сами инициируем списания; provider_managed = bePaid управляет биллингом';

-- 1.2. Ensure set_updated_at() exists
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 1.3. Create provider_subscriptions table
CREATE TABLE IF NOT EXISTS public.provider_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  provider TEXT NOT NULL DEFAULT 'bepaid',
  provider_subscription_id TEXT NOT NULL,

  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subscription_v2_id UUID REFERENCES subscriptions_v2(id) ON DELETE SET NULL,
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,

  state TEXT NOT NULL DEFAULT 'pending',

  next_charge_at TIMESTAMPTZ,
  last_charge_at TIMESTAMPTZ,
  amount_cents INTEGER,
  currency TEXT DEFAULT 'BYN',
  interval_days INTEGER DEFAULT 30,

  card_brand TEXT,
  card_last4 TEXT,
  card_token TEXT,

  raw_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'provider_subscriptions_unique_provider_id'
  ) THEN
    ALTER TABLE provider_subscriptions 
    ADD CONSTRAINT provider_subscriptions_unique_provider_id 
    UNIQUE (provider, provider_subscription_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_provider_subscriptions_subscription_v2_id 
ON provider_subscriptions(subscription_v2_id);
CREATE INDEX IF NOT EXISTS idx_provider_subscriptions_user_id 
ON provider_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_provider_subscriptions_state 
ON provider_subscriptions(state);
CREATE INDEX IF NOT EXISTS idx_provider_subscriptions_next_charge_at 
ON provider_subscriptions(next_charge_at);

ALTER TABLE provider_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access provider_subscriptions" ON provider_subscriptions
FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins can read provider_subscriptions" ON provider_subscriptions
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users see own provider_subscriptions" ON provider_subscriptions
FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS set_provider_subscriptions_updated_at ON provider_subscriptions;
CREATE TRIGGER set_provider_subscriptions_updated_at
  BEFORE UPDATE ON provider_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 1.4. Create provider_webhook_orphans table
CREATE TABLE IF NOT EXISTS public.provider_webhook_orphans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'bepaid',
  provider_subscription_id TEXT,
  provider_payment_id TEXT,
  reason TEXT NOT NULL,
  raw_data JSONB NOT NULL,
  processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orphans_created_at 
ON provider_webhook_orphans(created_at);

CREATE INDEX IF NOT EXISTS idx_orphans_processed 
ON provider_webhook_orphans(processed) WHERE NOT processed;

ALTER TABLE provider_webhook_orphans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access provider_webhook_orphans" ON provider_webhook_orphans
FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins can read provider_webhook_orphans" ON provider_webhook_orphans
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS set_provider_webhook_orphans_updated_at ON provider_webhook_orphans;
CREATE TRIGGER set_provider_webhook_orphans_updated_at
  BEFORE UPDATE ON provider_webhook_orphans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 1.5. Add idempotency columns to orders_v2 for provider payments
ALTER TABLE orders_v2 
ADD COLUMN IF NOT EXISTS provider TEXT,
ADD COLUMN IF NOT EXISTS provider_payment_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_v2_provider_payment_unique
ON orders_v2(provider, provider_payment_id)
WHERE provider IS NOT NULL AND provider_payment_id IS NOT NULL;