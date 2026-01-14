-- 1. Add provider column to payment_reconcile_queue if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_reconcile_queue' 
    AND column_name = 'provider'
  ) THEN
    ALTER TABLE public.payment_reconcile_queue 
    ADD COLUMN provider TEXT DEFAULT 'bepaid';
  END IF;
END $$;

-- 2. Add provider column to bepaid_product_mappings if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bepaid_product_mappings' 
    AND column_name = 'provider'
  ) THEN
    ALTER TABLE public.bepaid_product_mappings 
    ADD COLUMN provider TEXT DEFAULT 'bepaid';
  END IF;
END $$;

-- 3. Add unique constraint on (provider, bepaid_uid) for deduplication
-- First check if index exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_payment_queue_provider_uid_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_payment_queue_provider_uid_unique 
    ON public.payment_reconcile_queue (provider, bepaid_uid) 
    WHERE bepaid_uid IS NOT NULL;
  END IF;
END $$;

-- 4. Add transaction_type enum-like check for future types
-- (payment, subscription, refund, void, chargeback)
COMMENT ON COLUMN public.payment_reconcile_queue.transaction_type IS 'Transaction type: payment, subscription, refund, void, chargeback';

-- 5. Add conflict flag column for matching conflicts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_reconcile_queue' 
    AND column_name = 'has_conflict'
  ) THEN
    ALTER TABLE public.payment_reconcile_queue 
    ADD COLUMN has_conflict BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- 6. Add is_external flag for transactions without tracking_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_reconcile_queue' 
    AND column_name = 'is_external'
  ) THEN
    ALTER TABLE public.payment_reconcile_queue 
    ADD COLUMN is_external BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- 7. Add matched_offer_id for offer matching
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_reconcile_queue' 
    AND column_name = 'matched_offer_id'
  ) THEN
    ALTER TABLE public.payment_reconcile_queue 
    ADD COLUMN matched_offer_id UUID REFERENCES public.tariff_offers(id);
  END IF;
END $$;

-- 8. Create indexes for efficient filtering
CREATE INDEX IF NOT EXISTS idx_payment_queue_provider ON public.payment_reconcile_queue (provider);
CREATE INDEX IF NOT EXISTS idx_payment_queue_status_normalized ON public.payment_reconcile_queue (status_normalized);
CREATE INDEX IF NOT EXISTS idx_payment_queue_has_conflict ON public.payment_reconcile_queue (has_conflict) WHERE has_conflict = TRUE;
CREATE INDEX IF NOT EXISTS idx_payment_queue_is_external ON public.payment_reconcile_queue (is_external) WHERE is_external = TRUE;
CREATE INDEX IF NOT EXISTS idx_payment_queue_paid_at ON public.payment_reconcile_queue (paid_at);

-- 9. Update existing records: mark external if no tracking_id or unrecognized
UPDATE public.payment_reconcile_queue 
SET is_external = TRUE 
WHERE (tracking_id IS NULL OR tracking_id = '') 
  AND is_external = FALSE;