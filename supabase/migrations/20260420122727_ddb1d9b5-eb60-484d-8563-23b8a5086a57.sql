-- Surgical hardening: prevent live_events.platform_status downgrade
-- from 'live' back to 'scheduled'/'draft' when Kinescope provider is actively on-air.
-- This protects against form-save / stale state writes that race against lifecycle.

CREATE OR REPLACE FUNCTION public.guard_live_events_status_downgrade()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider_status text;
BEGIN
  -- Only act on platform_status downgrades
  IF NEW.platform_status IS NOT DISTINCT FROM OLD.platform_status THEN
    RETURN NEW;
  END IF;

  -- Only block downgrades from 'live'
  IF OLD.platform_status <> 'live' THEN
    RETURN NEW;
  END IF;

  -- Only block downgrades to scheduled/draft (allowing live -> ended/replay_available)
  IF NEW.platform_status NOT IN ('scheduled', 'draft') THEN
    RETURN NEW;
  END IF;

  -- Check provider stream status from metadata
  v_provider_status := COALESCE(
    NEW.metadata->'provider'->'current'->>'stream_status',
    OLD.metadata->'provider'->'current'->>'stream_status'
  );

  IF v_provider_status IN ('on-air', 'live', 'active') THEN
    -- Block downgrade: keep OLD platform_status and OLD status
    NEW.platform_status := OLD.platform_status;
    NEW.status := OLD.status;

    -- Audit the blocked attempt for traceability
    INSERT INTO public.audit_logs (action, actor_type, actor_user_id, meta)
    VALUES (
      'live_status_downgrade_blocked',
      'system',
      NULL,
      jsonb_build_object(
        'live_event_id', NEW.id,
        'slug', NEW.slug,
        'attempted_platform_status', NEW.platform_status,
        'kept_platform_status', OLD.platform_status,
        'provider_stream_status', v_provider_status
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_live_events_status_downgrade ON public.live_events;
CREATE TRIGGER trg_guard_live_events_status_downgrade
  BEFORE UPDATE ON public.live_events
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_live_events_status_downgrade();