-- Keep the single-event month gate consistent with has_month_purchase_bulk:
-- historical orders may be linked through profiles.id instead of auth user_id.
-- The commercial source of truth remains a paid orders_v2 row for the exact
-- tariff and content month; rule-engine synthetic rows never qualify.
CREATE OR REPLACE FUNCTION public.has_month_purchase(
  _user_id uuid,
  _tariff_id uuid,
  _month text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders_v2 o
    WHERE o.status = 'paid'
      AND (o.meta->>'deal_month') = _month
      AND COALESCE(o.meta->>'source', '') <> 'rule_engine'
      AND (_tariff_id IS NULL OR o.tariff_id = _tariff_id)
      AND (
        o.user_id = _user_id
        OR EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = o.profile_id
            AND p.user_id = _user_id
        )
      )
    LIMIT 1
  );
$function$;

GRANT EXECUTE ON FUNCTION public.has_month_purchase(uuid, uuid, text)
  TO authenticated, service_role;