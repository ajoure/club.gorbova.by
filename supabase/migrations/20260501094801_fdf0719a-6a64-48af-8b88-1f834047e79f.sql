CREATE OR REPLACE FUNCTION public.has_month_purchase(_user_id uuid, _tariff_id uuid, _month text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders_v2
    WHERE user_id = _user_id
      AND status = 'paid'
      AND (meta->>'deal_month') = _month
      AND (_tariff_id IS NULL OR tariff_id = _tariff_id)
    LIMIT 1
  );
$function$;