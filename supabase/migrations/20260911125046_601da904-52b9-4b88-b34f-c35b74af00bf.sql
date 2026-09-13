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

  -- This owner-approved history has no known purchase date. The import month
  -- must not become a current-month purchase or unlock monthly content.
  IF NEW.reconcile_source = 'owner_confirmed_historical'
     AND current_meta->>'historical_batch_id' = 'hist-cb17-18-20260911-v1'
     AND current_meta->>'history_only' = 'true'
     AND current_meta->>'source_purchase_date_unknown' = 'true' THEN
    NEW.meta := current_meta - 'deal_month';
    RETURN NEW;
  END IF;

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