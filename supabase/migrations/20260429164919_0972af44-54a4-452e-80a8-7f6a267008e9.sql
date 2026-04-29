-- PATCH-PAYMENTS-REVISION: явная связь provider_subscriptions ↔ orders_v2
ALTER TABLE public.provider_subscriptions
ADD COLUMN IF NOT EXISTS order_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'provider_subscriptions_order_id_fkey'
  ) THEN
    ALTER TABLE public.provider_subscriptions
    ADD CONSTRAINT provider_subscriptions_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders_v2(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_provider_subscriptions_order_id
ON public.provider_subscriptions(order_id)
WHERE order_id IS NOT NULL;

-- Safe backfill: только валидные UUID, чей order реально существует в orders_v2
UPDATE public.provider_subscriptions ps
SET order_id = (ps.meta->>'order_id')::uuid
WHERE ps.order_id IS NULL
  AND ps.meta->>'order_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1 FROM public.orders_v2 o
    WHERE o.id = (ps.meta->>'order_id')::uuid
  );