-- Drop the old unique constraint that blocks correction inserts
ALTER TABLE public.live_event_notification_log
  DROP CONSTRAINT IF EXISTS live_event_notification_log_live_event_id_user_id_channel_n_key;

-- Recreate with dispatch_mode included so corrections can coexist with originals
CREATE UNIQUE INDEX live_event_notification_log_dedup_idx
  ON public.live_event_notification_log (live_event_id, user_id, channel, notify_offset_minutes, dispatch_mode);