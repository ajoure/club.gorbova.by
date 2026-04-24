
-- ============================================================
-- 1. ALTER broadcast_templates (add-only)
-- ============================================================

ALTER TABLE public.broadcast_templates
  ADD COLUMN IF NOT EXISTS audience_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS channels text[] NOT NULL DEFAULT ARRAY['telegram']::text[],
  ADD COLUMN IF NOT EXISTS media_storage_path text,
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS media_file_name text,
  ADD COLUMN IF NOT EXISTS send_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS recurrence_rule jsonb,
  ADD COLUMN IF NOT EXISTS next_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS total_runs integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_only_when_no_telegram boolean NOT NULL DEFAULT false;

-- Backfill channels[] from legacy channel column for existing rows
UPDATE public.broadcast_templates
SET channels = ARRAY[channel]::text[]
WHERE channels IS NULL OR cardinality(channels) = 0;

-- Recreate status CHECK to include 'recurring' (preserves draft/scheduled/sent/archived)
ALTER TABLE public.broadcast_templates
  DROP CONSTRAINT IF EXISTS broadcast_templates_status_check;

ALTER TABLE public.broadcast_templates
  ADD CONSTRAINT broadcast_templates_status_check
  CHECK (status = ANY (ARRAY['draft','scheduled','sent','archived','recurring']::text[]));

-- send_mode CHECK
ALTER TABLE public.broadcast_templates
  DROP CONSTRAINT IF EXISTS broadcast_templates_send_mode_check;

ALTER TABLE public.broadcast_templates
  ADD CONSTRAINT broadcast_templates_send_mode_check
  CHECK (send_mode = ANY (ARRAY['manual','scheduled','recurring']::text[]));

-- media_type CHECK (nullable)
ALTER TABLE public.broadcast_templates
  DROP CONSTRAINT IF EXISTS broadcast_templates_media_type_check;

ALTER TABLE public.broadcast_templates
  ADD CONSTRAINT broadcast_templates_media_type_check
  CHECK (media_type IS NULL OR media_type = ANY (ARRAY['photo','video','audio','video_note']::text[]));

-- channels CHECK (non-empty, only known values)
ALTER TABLE public.broadcast_templates
  DROP CONSTRAINT IF EXISTS broadcast_templates_channels_check;

ALTER TABLE public.broadcast_templates
  ADD CONSTRAINT broadcast_templates_channels_check
  CHECK (
    cardinality(channels) > 0
    AND channels <@ ARRAY['telegram','email']::text[]
  );

-- Partial index for the dispatcher cron sweep
CREATE INDEX IF NOT EXISTS idx_broadcast_templates_next_run
  ON public.broadcast_templates(next_run_at)
  WHERE status IN ('scheduled','recurring') AND next_run_at IS NOT NULL;

-- ============================================================
-- 2. broadcast_runs (per-execution log)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.broadcast_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.broadcast_templates(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  channel text NOT NULL CHECK (channel IN ('telegram','email')),
  audience_count integer,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  dry_run boolean NOT NULL DEFAULT false,
  audience_snapshot jsonb,
  dispatch_mode text NOT NULL DEFAULT 'production'
    CHECK (dispatch_mode IN ('production','proof')),
  error text,
  triggered_by text NOT NULL
    CHECK (triggered_by IN ('manual','scheduled','recurring','dry_run')),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broadcast_runs_template_started
  ON public.broadcast_runs(template_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_broadcast_runs_dispatch_started
  ON public.broadcast_runs(dispatch_mode, started_at DESC);

ALTER TABLE public.broadcast_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view broadcast_runs"
  ON public.broadcast_runs FOR SELECT
  TO authenticated
  USING (has_permission(auth.uid(), 'entitlements.manage'));

CREATE POLICY "Service role full access to broadcast_runs"
  ON public.broadcast_runs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 3. broadcast_dispatcher_config (singleton kill-switch)
--    Separate from live_notification_config so pausing one
--    domain doesn't affect the other.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.broadcast_dispatcher_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  production_approved boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

INSERT INTO public.broadcast_dispatcher_config (id, enabled, production_approved)
VALUES (1, false, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.broadcast_dispatcher_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read broadcast_dispatcher_config"
  ON public.broadcast_dispatcher_config FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Admins can update broadcast_dispatcher_config"
  ON public.broadcast_dispatcher_config FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Service role read broadcast_dispatcher_config"
  ON public.broadcast_dispatcher_config FOR SELECT
  USING (auth.role() = 'service_role');

-- ============================================================
-- 4. compute_next_broadcast_run(rule, from_ts) → timestamptz
-- ============================================================

CREATE OR REPLACE FUNCTION public.compute_next_broadcast_run(
  rule jsonb,
  from_ts timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_freq text;
  v_interval int;
  v_tz text;
  v_time text;
  v_hour int;
  v_minute int;
  v_by_weekday int[];
  v_ends_at timestamptz;
  v_local_from timestamp;
  v_candidate_local timestamp;
  v_candidate timestamptz;
  v_dow int;
  v_i int;
  v_found boolean;
BEGIN
  IF rule IS NULL THEN
    RETURN NULL;
  END IF;

  v_freq    := COALESCE(rule->>'frequency', 'daily');
  v_interval := COALESCE((rule->>'interval')::int, 1);
  v_tz      := COALESCE(rule->>'timezone', 'Europe/Minsk');
  v_time    := COALESCE(rule->>'time_of_day', '09:00');
  v_hour    := split_part(v_time, ':', 1)::int;
  v_minute  := split_part(v_time, ':', 2)::int;

  IF rule ? 'by_weekday' AND jsonb_typeof(rule->'by_weekday') = 'array' THEN
    SELECT array_agg((value)::text::int)
    INTO v_by_weekday
    FROM jsonb_array_elements(rule->'by_weekday');
  END IF;

  IF rule ? 'ends_at' AND nullif(rule->>'ends_at','') IS NOT NULL THEN
    v_ends_at := (rule->>'ends_at')::timestamptz;
  END IF;

  -- Convert from_ts into local wall-clock for the rule's timezone
  v_local_from := from_ts AT TIME ZONE v_tz;

  IF v_freq = 'daily' THEN
    -- Today at HH:MM in v_tz; if already past, advance by interval days
    v_candidate_local := date_trunc('day', v_local_from)
                       + make_interval(hours => v_hour, mins => v_minute);
    WHILE v_candidate_local <= v_local_from LOOP
      v_candidate_local := v_candidate_local + make_interval(days => v_interval);
    END LOOP;

  ELSIF v_freq = 'weekly' THEN
    -- Search up to 7 * interval days for first matching weekday after from_ts
    v_found := false;
    v_candidate_local := date_trunc('day', v_local_from)
                       + make_interval(hours => v_hour, mins => v_minute);
    FOR v_i IN 0..(7 * GREATEST(v_interval,1) + 7) LOOP
      v_dow := EXTRACT(ISODOW FROM v_candidate_local)::int; -- 1..7 (Mon..Sun)
      IF (v_by_weekday IS NULL OR v_dow = ANY(v_by_weekday))
         AND v_candidate_local > v_local_from THEN
        v_found := true;
        EXIT;
      END IF;
      v_candidate_local := v_candidate_local + interval '1 day';
    END LOOP;
    IF NOT v_found THEN
      RETURN NULL;
    END IF;

  ELSIF v_freq = 'monthly' THEN
    v_candidate_local := date_trunc('month', v_local_from)
                       + make_interval(
                           days  => EXTRACT(DAY FROM v_local_from)::int - 1,
                           hours => v_hour,
                           mins  => v_minute);
    WHILE v_candidate_local <= v_local_from LOOP
      v_candidate_local := v_candidate_local + make_interval(months => v_interval);
    END LOOP;

  ELSE
    RETURN NULL;
  END IF;

  -- Convert local wall-clock back to UTC timestamptz
  v_candidate := v_candidate_local AT TIME ZONE v_tz;

  IF v_ends_at IS NOT NULL AND v_candidate > v_ends_at THEN
    RETURN NULL;
  END IF;

  RETURN v_candidate;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_next_broadcast_run(jsonb, timestamptz)
  TO authenticated, service_role;

-- ============================================================
-- 5. Trigger: keep channel column in sync with channels[0]
--    (legacy compatibility for old code paths)
-- ============================================================

CREATE OR REPLACE FUNCTION public.broadcast_templates_sync_channel()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.channels IS NOT NULL AND cardinality(NEW.channels) > 0 THEN
    NEW.channel := NEW.channels[1];
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_broadcast_templates_sync_channel ON public.broadcast_templates;

CREATE TRIGGER trg_broadcast_templates_sync_channel
  BEFORE INSERT OR UPDATE OF channels ON public.broadcast_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_templates_sync_channel();
