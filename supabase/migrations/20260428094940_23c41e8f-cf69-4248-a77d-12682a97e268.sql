-- Stage 2: Idempotency guard for installment schedules
-- Prevents duplicate rows on webhook retries / double generation paths.
-- Pre-checked: 0 existing duplicates by (order_id, payment_number).

ALTER TABLE public.installment_payments
  ADD CONSTRAINT installment_payments_order_payment_number_unique
  UNIQUE (order_id, payment_number);