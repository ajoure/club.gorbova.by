-- Table to store rejected webhooks and unprocessed payments for retry
CREATE TABLE public.payment_reconcile_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bepaid_uid TEXT,
  tracking_id TEXT,
  amount NUMERIC,
  currency TEXT DEFAULT 'BYN',
  customer_email TEXT,
  raw_payload JSONB,
  source TEXT DEFAULT 'webhook', -- 'webhook', 'api_fetch', 'manual'
  status TEXT DEFAULT 'pending', -- pending, processing, completed, failed, skipped
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 5,
  last_error TEXT,
  processed_order_id UUID REFERENCES public.orders_v2(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.payment_reconcile_queue ENABLE ROW LEVEL SECURITY;

-- Only admins can access this table
CREATE POLICY "Admins can manage payment reconcile queue"
ON public.payment_reconcile_queue
FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Index for efficient queries
CREATE INDEX idx_payment_reconcile_queue_status ON public.payment_reconcile_queue(status);
CREATE INDEX idx_payment_reconcile_queue_bepaid_uid ON public.payment_reconcile_queue(bepaid_uid);
CREATE INDEX idx_payment_reconcile_queue_next_retry ON public.payment_reconcile_queue(next_retry_at) WHERE status = 'pending';

-- Trigger for updated_at
CREATE TRIGGER update_payment_reconcile_queue_updated_at
  BEFORE UPDATE ON public.payment_reconcile_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add comment
COMMENT ON TABLE public.payment_reconcile_queue IS 'Queue for rejected webhooks and unprocessed payments for automatic reconciliation';