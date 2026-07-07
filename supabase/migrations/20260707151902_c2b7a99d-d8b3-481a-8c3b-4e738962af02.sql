-- 1. Add rule_kind column with default 'product' so existing rows backfill safely
ALTER TABLE public.live_event_access_rules
  ADD COLUMN IF NOT EXISTS rule_kind text NOT NULL DEFAULT 'product';

-- 2. Allow product_id to be NULL (only for any_authenticated)
ALTER TABLE public.live_event_access_rules
  ALTER COLUMN product_id DROP NOT NULL;

-- 3. Constrain allowed rule_kind values
ALTER TABLE public.live_event_access_rules
  DROP CONSTRAINT IF EXISTS live_event_access_rules_rule_kind_check;
ALTER TABLE public.live_event_access_rules
  ADD CONSTRAINT live_event_access_rules_rule_kind_check
    CHECK (rule_kind IN ('product', 'any_authenticated'));

-- 4. Structural invariant per kind:
--    product           => product_id NOT NULL
--    any_authenticated => product_id NULL AND tariff_id NULL
ALTER TABLE public.live_event_access_rules
  DROP CONSTRAINT IF EXISTS live_event_access_rules_kind_shape_check;
ALTER TABLE public.live_event_access_rules
  ADD CONSTRAINT live_event_access_rules_kind_shape_check
    CHECK (
      (rule_kind = 'product' AND product_id IS NOT NULL)
      OR (rule_kind = 'any_authenticated' AND product_id IS NULL AND tariff_id IS NULL)
    );

-- 5. Index for the new lookup path used by live-resolve
CREATE INDEX IF NOT EXISTS live_event_access_rules_event_kind_idx
  ON public.live_event_access_rules (live_event_id, rule_kind);
