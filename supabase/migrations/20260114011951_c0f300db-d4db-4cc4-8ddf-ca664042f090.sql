-- Уникальный индекс на provider_payment_id (это и есть bepaid_uid)
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_v2_unique_provider_payment_id
  ON public.payments_v2(provider_payment_id)
  WHERE provider_payment_id IS NOT NULL AND provider = 'bepaid';