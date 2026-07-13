
CREATE OR REPLACE FUNCTION public.payments_v2_reject_tombstoned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.provider_payment_id IS NOT NULL
     AND NEW.provider IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.payment_tombstones t
       WHERE t.provider    = NEW.provider
         AND t.external_id = NEW.provider_payment_id
     )
  THEN
    RAISE EXCEPTION
      'payments_v2 insert blocked: payment (%s, %s) is tombstoned', NEW.provider, NEW.provider_payment_id
      USING ERRCODE = 'P0001',
            HINT = 'A prior admin delete created a tombstone. Webhook/reconcile/manual writers MUST skip this payment.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_v2_reject_tombstoned_trg ON public.payments_v2;
CREATE TRIGGER payments_v2_reject_tombstoned_trg
  BEFORE INSERT ON public.payments_v2
  FOR EACH ROW
  EXECUTE FUNCTION public.payments_v2_reject_tombstoned();

COMMENT ON FUNCTION public.payments_v2_reject_tombstoned() IS
  'PATCH-PAYMENTS-MANAGEMENT-V2 Stage 4. BEFORE INSERT guard on payments_v2. Fails any insert whose (provider, provider_payment_id) matches an existing payment_tombstones row.';
