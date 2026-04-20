-- =============================================================================
-- Sprint 2 PATCH 2.1: room lifecycle model (add-only)
-- =============================================================================

-- 1. Add new columns (add-only, do not touch legacy fields)
ALTER TABLE public.live_events
  ADD COLUMN IF NOT EXISTS room_state text NOT NULL DEFAULT 'closed',
  ADD COLUMN IF NOT EXISTS room_opened_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS live_started_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS webinar_completed_at timestamptz NULL;

-- 2. CHECK constraint on allowed values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'live_events_room_state_check'
  ) THEN
    ALTER TABLE public.live_events
      ADD CONSTRAINT live_events_room_state_check
      CHECK (room_state IN ('closed','opened','live','completed'));
  END IF;
END $$;

-- 3. Backfill from platform_status with explicit mapping + diagnostics
DO $$
DECLARE
  v_to_closed int;
  v_to_live int;
  v_to_completed int;
  v_unknown int;
  v_unknown_values jsonb;
BEGIN
  -- draft / scheduled / null → closed
  UPDATE public.live_events
     SET room_state = 'closed'
   WHERE room_state = 'closed' -- only newly-defaulted rows
     AND (platform_status IS NULL OR platform_status IN ('draft','scheduled'));
  GET DIAGNOSTICS v_to_closed = ROW_COUNT;

  -- live → live
  UPDATE public.live_events
     SET room_state = 'live',
         live_started_at = COALESCE(live_started_at, now())
   WHERE platform_status = 'live'
     AND room_state <> 'live';
  GET DIAGNOSTICS v_to_live = ROW_COUNT;

  -- ended / replay_available → completed
  UPDATE public.live_events
     SET room_state = 'completed',
         webinar_completed_at = COALESCE(webinar_completed_at, now())
   WHERE platform_status IN ('ended','replay_available')
     AND room_state <> 'completed';
  GET DIAGNOSTICS v_to_completed = ROW_COUNT;

  -- diagnostics: anything else stays 'closed' with explicit count
  SELECT COUNT(*), COALESCE(jsonb_agg(DISTINCT platform_status), '[]'::jsonb)
    INTO v_unknown, v_unknown_values
    FROM public.live_events
   WHERE platform_status IS NOT NULL
     AND platform_status NOT IN ('draft','scheduled','live','ended','replay_available');

  RAISE NOTICE '[room_lifecycle backfill] to_closed=%, to_live=%, to_completed=%, unknown_fallback_to_closed=%, unknown_values=%',
    v_to_closed, v_to_live, v_to_completed, v_unknown, v_unknown_values::text;

  -- Persist backfill audit into app_settings
  INSERT INTO public.app_settings (key, value)
  VALUES (
    'room_lifecycle_backfill_2026_04_20',
    jsonb_build_object(
      'executed_at', now(),
      'to_closed', v_to_closed,
      'to_live', v_to_live,
      'to_completed', v_to_completed,
      'unknown_fallback_to_closed', v_unknown,
      'unknown_values', v_unknown_values
    )
  )
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END $$;

-- =============================================================================
-- Sprint 2 PATCH 2.8: DB-level guard trigger for room_state transitions
-- =============================================================================

CREATE OR REPLACE FUNCTION public.guard_room_state_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  -- 1. Allow unchanged room_state updates (non-lifecycle saves)
  IF OLD.room_state IS NOT DISTINCT FROM NEW.room_state THEN
    RETURN NEW;
  END IF;

  -- 2. Allow privileged roles (service_role, postgres) — used by migrations + edge functions
  v_role := current_setting('role', true);
  IF v_role IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  -- Also bypass when running as superuser (migration context)
  IF current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- 3. Validate transition against state matrix
  IF OLD.room_state = 'closed' AND NEW.room_state = 'opened' THEN
    RETURN NEW;
  ELSIF OLD.room_state = 'opened' AND NEW.room_state = 'live' THEN
    RETURN NEW;
  ELSIF OLD.room_state = 'live' AND NEW.room_state = 'completed' THEN
    RETURN NEW;
  END IF;

  -- 4. Anything else is forbidden
  RAISE EXCEPTION 'Invalid room_state transition: % -> % (allowed: closed->opened, opened->live, live->completed)',
    OLD.room_state, NEW.room_state
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_room_state_transition ON public.live_events;
CREATE TRIGGER trg_guard_room_state_transition
  BEFORE UPDATE OF room_state ON public.live_events
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_room_state_transition();

-- 5. Index for lifecycle queries
CREATE INDEX IF NOT EXISTS idx_live_events_room_state ON public.live_events(room_state);

-- =============================================================================
-- Sprint 2 PATCH 2.6: active participants view
-- =============================================================================
CREATE OR REPLACE VIEW public.live_event_active_participants_v AS
SELECT
  live_event_id,
  COUNT(DISTINCT user_id)::int AS active_count
FROM public.live_active_sessions
WHERE revoked_at IS NULL
  AND expires_at > now()
  AND last_seen_at > now() - interval '2 minutes'
GROUP BY live_event_id;

COMMENT ON VIEW public.live_event_active_participants_v IS
  'Sprint 2 PATCH 2.6: active participants v1. Source = live_active_sessions with non-expired session AND fresh heartbeat (2 min window). expires_at is primary signal, last_seen_at is secondary diagnostic.';