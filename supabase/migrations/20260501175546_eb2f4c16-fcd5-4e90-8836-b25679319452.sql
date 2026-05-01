-- Auto-fill orders_v2.meta.deal_month for paid orders (Europe/Minsk).
-- Idempotent: never overwrites existing deal_month.
CREATE OR REPLACE FUNCTION public.orders_v2_autofill_deal_month()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  src_ts timestamptz;
  computed_month text;
  current_meta jsonb;
BEGIN
  -- Only act on paid rows
  IF NEW.status::text <> 'paid' THEN
    RETURN NEW;
  END IF;

  current_meta := COALESCE(NEW.meta, '{}'::jsonb);

  -- Never overwrite existing deal_month
  IF current_meta ? 'deal_month'
     AND COALESCE(NULLIF(current_meta->>'deal_month',''), '') <> '' THEN
    RETURN NEW;
  END IF;

  -- Source timestamp: deal_date → fallback created_at → fallback now()
  src_ts := COALESCE(NEW.deal_date, NEW.created_at, now());

  computed_month := to_char(src_ts AT TIME ZONE 'Europe/Minsk', 'YYYY-MM');

  NEW.meta := current_meta || jsonb_build_object('deal_month', computed_month);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_v2_autofill_deal_month_trg ON public.orders_v2;
CREATE TRIGGER orders_v2_autofill_deal_month_trg
BEFORE INSERT OR UPDATE OF status, deal_date, meta ON public.orders_v2
FOR EACH ROW
EXECUTE FUNCTION public.orders_v2_autofill_deal_month();

COMMENT ON FUNCTION public.orders_v2_autofill_deal_month() IS
'Auto-fills orders_v2.meta.deal_month for paid orders in Europe/Minsk TZ. Never overwrites. Source: deal_date → created_at fallback. Installed 2026-05-01 as part of webinar access integrity fix.';