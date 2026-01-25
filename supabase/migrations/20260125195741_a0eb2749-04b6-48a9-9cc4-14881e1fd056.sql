-- Add unique constraint on grace_notification_events for idempotency
ALTER TABLE public.grace_notification_events
ADD CONSTRAINT grace_notification_events_subscription_event_unique 
UNIQUE (subscription_id, event_type);