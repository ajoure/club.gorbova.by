-- Fix installment_payments permissive insert policy
-- Installments should only be created by service role (Edge Functions handling payments)

DROP POLICY IF EXISTS "System can insert installments" ON public.installment_payments;
CREATE POLICY "Service role can insert installments"
  ON public.installment_payments
  FOR INSERT
  WITH CHECK (auth.jwt()->>'role' = 'service_role');