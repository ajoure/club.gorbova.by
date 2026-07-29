-- A fresh idempotency key must not create another succeeded manual payment for
-- an order that is already fully paid. Existing-key replays remain allowed so
-- ON CONFLICT can return the original payment and repair downstream work.

CREATE OR REPLACE FUNCTION public.guard_manual_admin_payment_fully_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_idempotency_key text;
  v_status text;
  v_paid_amount numeric;
  v_final_price numeric;
BEGIN
  IF NEW.origin IS DISTINCT FROM 'manual_admin'
     OR NEW.order_id IS NULL
     OR NEW.status IS DISTINCT FROM 'succeeded'
     OR coalesce(NEW.is_deleted, false) THEN
    RETURN NEW;
  END IF;

  v_idempotency_key := nullif(NEW.meta->>'idempotency_key', '');

  -- Preserve the canonical same-key replay path. The existing partial unique
  -- index will turn this attempted insert into DO NOTHING.
  IF v_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.payments_v2 p
     WHERE p.origin = 'manual_admin'
       AND coalesce(p.is_deleted, false) = false
       AND p.meta->>'idempotency_key' = v_idempotency_key
  ) THEN
    RETURN NEW;
  END IF;

  SELECT o.status::text, coalesce(o.paid_amount, 0), coalesce(o.final_price, 0)
    INTO v_status, v_paid_amount, v_final_price
    FROM public.orders_v2 o
   WHERE o.id = NEW.order_id
   FOR UPDATE;

  IF FOUND AND (
    v_status = 'paid'
    OR (v_final_price > 0 AND v_paid_amount >= v_final_price)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'order_already_fully_paid';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manual_admin_payment_fully_paid
  ON public.payments_v2;
CREATE TRIGGER trg_manual_admin_payment_fully_paid
BEFORE INSERT ON public.payments_v2
FOR EACH ROW
EXECUTE FUNCTION public.guard_manual_admin_payment_fully_paid();

REVOKE ALL ON FUNCTION public.guard_manual_admin_payment_fully_paid() FROM PUBLIC;

COMMENT ON FUNCTION public.guard_manual_admin_payment_fully_paid() IS
'Prevents a new-key succeeded manual payment from overpaying an already fully paid order while preserving same-key idempotent replay.';
