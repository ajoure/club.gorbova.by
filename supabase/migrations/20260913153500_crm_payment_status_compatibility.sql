-- Runtime compatibility for the deployed checkout/refund predicates.
-- Additive only: no payment/order row or financial status is rewritten.
-- All existing states retain their meanings; partial refunds were already
-- recognized by readers. The value becomes usable after migration commit.
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'partially_refunded';

-- Restore exactly the trigger temporarily removed during incident containment.
DO $$
BEGIN
  IF to_regprocedure('public.crm_restore_archived_purchase_on_money()') IS NULL THEN
    RAISE EXCEPTION 'crm_money_restore_dependency_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.payments_v2'::regclass
    AND tgname='crm_restore_archived_payment_money' AND NOT tgisinternal) THEN
    CREATE TRIGGER crm_restore_archived_payment_money
      AFTER INSERT OR UPDATE OF status,amount,refunded_amount ON public.payments_v2
      FOR EACH ROW EXECUTE FUNCTION public.crm_restore_archived_purchase_on_money();
  END IF;
END;
$$;
