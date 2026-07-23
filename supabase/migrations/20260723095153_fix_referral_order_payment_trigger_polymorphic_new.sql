-- The trigger is shared by orders_v2 and payments_v2. A CASE expression still
-- makes PostgreSQL resolve both NEW.id and NEW.order_id while planning, so an
-- orders_v2 INSERT fails because that record has no order_id field.
CREATE OR REPLACE FUNCTION public.referral_order_payment_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'orders_v2' THEN
    PERFORM public.referral_process_order(NEW.id);
  ELSE
    PERFORM public.referral_process_order(NEW.order_id);
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.referral_order_payment_trigger() FROM PUBLIC;
