
-- 1) content_month columns
ALTER TABLE public.training_lessons
  ADD COLUMN IF NOT EXISTS content_month text;

ALTER TABLE public.training_modules
  ADD COLUMN IF NOT EXISTS content_month text;

-- Format check: YYYY-MM (NULL allowed)
ALTER TABLE public.training_lessons
  ADD CONSTRAINT training_lessons_content_month_format_chk
  CHECK (content_month IS NULL OR content_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

ALTER TABLE public.training_modules
  ADD CONSTRAINT training_modules_content_month_format_chk
  CHECK (content_month IS NULL OR content_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

CREATE INDEX IF NOT EXISTS idx_training_lessons_content_month
  ON public.training_lessons(content_month) WHERE content_month IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_training_modules_content_month
  ON public.training_modules(content_month) WHERE content_month IS NOT NULL;

-- 2) live_event_access_rules.conditions
ALTER TABLE public.live_event_access_rules
  ADD COLUMN IF NOT EXISTS conditions jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 3) Backfill training_lessons.content_month from DDMMYYYY slug (with real-date validation)
UPDATE public.training_lessons
SET content_month = substring(slug from 5 for 4) || '-' || substring(slug from 3 for 2)
WHERE content_month IS NULL
  AND slug ~ '^[0-3][0-9][0-1][0-9][0-9]{4}$'
  AND (
    -- validate real calendar date
    to_date(slug, 'DDMMYYYY') IS NOT NULL
  );

-- 4) Backfill live_events.metadata.content_month from scheduled_at (Europe/Minsk)
UPDATE public.live_events
SET metadata = COALESCE(metadata, '{}'::jsonb)
  || jsonb_build_object(
       'content_month',
       to_char((scheduled_at AT TIME ZONE 'Europe/Minsk'), 'YYYY-MM')
     )
WHERE (metadata->>'content_month') IS NULL
  AND scheduled_at IS NOT NULL;

-- 5) Backfill orders_v2.meta.deal_month for paid orders only, never overwrite
UPDATE public.orders_v2
SET meta = COALESCE(meta, '{}'::jsonb)
  || jsonb_build_object(
       'deal_month',
       to_char(
         ((COALESCE(deal_date::timestamptz, created_at)) AT TIME ZONE 'Europe/Minsk'),
         'YYYY-MM'
       )
     )
WHERE status = 'paid'
  AND (meta->>'deal_month') IS NULL;

-- 6) RPC for month-purchase check (used by resolvers and UI badges)
CREATE OR REPLACE FUNCTION public.has_month_purchase(
  _user_id uuid,
  _tariff_id uuid,
  _month text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders_v2
    WHERE user_id = _user_id
      AND tariff_id = _tariff_id
      AND status = 'paid'
      AND (meta->>'deal_month') = _month
    LIMIT 1
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_month_purchase(uuid, uuid, text) TO authenticated, service_role;
