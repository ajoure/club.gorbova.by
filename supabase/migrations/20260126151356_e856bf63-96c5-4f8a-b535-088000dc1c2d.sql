-- PATCH-6: Delete phantom tariff_price 110 BYN + audit

-- Step 1: Record audit log for cleanup action
INSERT INTO audit_logs (actor_type, actor_user_id, actor_label, action, meta)
VALUES (
  'system', 
  NULL, 
  'patch-6-cleanup',
  'tariff_price.deleted',
  jsonb_build_object(
    'tariff_price_id', '0633f728-8bfe-448c-88e0-580ff1676e99',
    'price', 110,
    'tariff_id', '31f75673-a7ae-420a-b5ab-5906e34cbf84',
    'reason', 'phantom_price_cleanup_sprint',
    'was_is_active', false,
    'deleted_at', now()::text
  )
);

-- Step 2: Delete the phantom 110 BYN tariff_price entry
DELETE FROM tariff_prices 
WHERE id = '0633f728-8bfe-448c-88e0-580ff1676e99';

-- PATCH-8: Add timezone column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Europe/Minsk';
COMMENT ON COLUMN profiles.timezone IS 'IANA timezone string for UI display preferences';

-- PATCH-7: Unique constraint on payments_v2 for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_v2_provider_uid 
ON payments_v2(provider, provider_payment_id) 
WHERE provider_payment_id IS NOT NULL;

-- PATCH-7: Create statement_lines staging table for safe imports
CREATE TABLE IF NOT EXISTS statement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'bepaid',
  stable_key TEXT NOT NULL,
  raw_data JSONB,
  parsed_amount NUMERIC(12,2),
  parsed_currency TEXT DEFAULT 'BYN',
  parsed_status TEXT,
  parsed_paid_at TIMESTAMPTZ,
  transaction_type TEXT,
  card_last4 TEXT,
  customer_email TEXT,
  source TEXT NOT NULL DEFAULT 'csv_import',
  source_timezone TEXT DEFAULT 'Europe/Minsk',
  processed_at TIMESTAMPTZ,
  payment_id UUID REFERENCES payments_v2(id),
  order_id UUID REFERENCES orders_v2(id),
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(provider, stable_key)
);

-- Enable RLS on statement_lines
ALTER TABLE statement_lines ENABLE ROW LEVEL SECURITY;

-- RLS policy: Only admins can access statement_lines
CREATE POLICY "Admins can manage statement_lines"
ON statement_lines
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_roles_v2 ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
    AND r.code IN ('super_admin', 'admin')
  )
);

-- PATCH-2: Create trial_blocks table
CREATE TABLE IF NOT EXISTS trial_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products_v2(id),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  removed_by UUID REFERENCES auth.users(id),
  meta JSONB DEFAULT '{}'::jsonb
);

-- Unique constraint: one active block per user (per product if specified)
CREATE UNIQUE INDEX IF NOT EXISTS idx_trial_blocks_user_active 
ON trial_blocks(user_id, COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid)) 
WHERE removed_at IS NULL;

-- Enable RLS on trial_blocks
ALTER TABLE trial_blocks ENABLE ROW LEVEL SECURITY;

-- RLS policy: Only admins can manage trial_blocks
CREATE POLICY "Admins can manage trial_blocks"
ON trial_blocks
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_roles_v2 ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
    AND r.code IN ('super_admin', 'admin')
  )
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_trial_blocks_user_lookup 
ON trial_blocks(user_id, product_id) 
WHERE removed_at IS NULL;