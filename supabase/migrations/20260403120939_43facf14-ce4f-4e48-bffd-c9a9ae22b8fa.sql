-- Расширение live_events: invite_mode + direct_access_allowed
ALTER TABLE public.live_events
  ADD COLUMN IF NOT EXISTS invite_mode TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS direct_access_allowed BOOLEAN NOT NULL DEFAULT true;

-- Validate constraint: invite_mode must be one of the allowed values
ALTER TABLE public.live_events
  ADD CONSTRAINT chk_live_events_invite_mode
  CHECK (invite_mode IN ('none', 'optional_one_time', 'required_one_time'));

-- Validate constraint: required_one_time + direct_access_allowed=true is forbidden
ALTER TABLE public.live_events
  ADD CONSTRAINT chk_live_events_invite_direct_compat
  CHECK (NOT (invite_mode = 'required_one_time' AND direct_access_allowed = true));