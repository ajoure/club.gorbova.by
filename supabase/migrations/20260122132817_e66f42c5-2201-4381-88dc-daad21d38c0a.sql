-- PATCH 10C: Таблица notification_outbox для DB-level idempotency
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  channel TEXT NOT NULL DEFAULT 'telegram',
  message_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  source TEXT DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  blocked_reason TEXT,
  meta JSONB,
  
  -- DB-level unique constraint for dedup
  CONSTRAINT notification_outbox_idempotency_unique UNIQUE (idempotency_key)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notification_outbox_user_created 
  ON public.notification_outbox(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_status 
  ON public.notification_outbox(status);

-- RLS (service-role access only)
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

-- Comments
COMMENT ON TABLE public.notification_outbox IS 'Idempotency protection for notifications - prevents duplicates at DB level';
COMMENT ON COLUMN public.notification_outbox.idempotency_key IS 'Hash of user_id + message_type + time_bucket to prevent duplicates';