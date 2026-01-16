-- Fix FK on payment_reconcile_queue so orders can be deleted
ALTER TABLE public.payment_reconcile_queue
  DROP CONSTRAINT IF EXISTS payment_reconcile_queue_matched_order_id_fkey;

ALTER TABLE public.payment_reconcile_queue
  ADD CONSTRAINT payment_reconcile_queue_matched_order_id_fkey
  FOREIGN KEY (matched_order_id)
  REFERENCES public.orders_v2(id)
  ON DELETE SET NULL;