-- =============================================
-- MIGRATION: Telegram Access Queue + Auto-grant trigger
-- =============================================

-- 1. Create telegram_access_queue table for reliable delivery
CREATE TABLE IF NOT EXISTS public.telegram_access_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  club_id UUID NOT NULL REFERENCES telegram_clubs(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions_v2(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.telegram_access_queue ENABLE ROW LEVEL SECURITY;

-- RLS: Only service role can access (no direct user access)
CREATE POLICY "Service role full access to telegram_access_queue"
  ON public.telegram_access_queue
  FOR ALL
  USING (auth.role() = 'service_role');

-- Index for efficient queue processing
CREATE INDEX IF NOT EXISTS idx_telegram_access_queue_pending 
  ON public.telegram_access_queue(status, created_at) 
  WHERE status = 'pending';

-- Unique constraint to prevent duplicate queue entries
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_access_queue_unique
  ON public.telegram_access_queue(user_id, club_id, subscription_id, action)
  WHERE status IN ('pending', 'processing');

-- 2. Create trigger function for auto-granting Telegram access
CREATE OR REPLACE FUNCTION public.trg_subscription_grant_telegram()
RETURNS TRIGGER AS $$
DECLARE
  club_mapping RECORD;
  profile_telegram RECORD;
BEGIN
  -- Only for active or trial subscriptions
  IF NEW.status NOT IN ('active', 'trial') THEN
    RETURN NEW;
  END IF;
  
  -- Skip if this is just an update and status didn't change to active/trial
  IF TG_OP = 'UPDATE' AND OLD.status IN ('active', 'trial') THEN
    RETURN NEW;
  END IF;
  
  -- Find active product-club mappings for this product
  FOR club_mapping IN 
    SELECT pcm.club_id 
    FROM product_club_mappings pcm
    WHERE pcm.product_id = NEW.product_id AND pcm.is_active = true
  LOOP
    -- Check if user has Telegram linked
    SELECT telegram_user_id, telegram_link_status 
    INTO profile_telegram
    FROM profiles 
    WHERE user_id = NEW.user_id;
    
    -- Only queue if Telegram is linked
    IF profile_telegram.telegram_user_id IS NOT NULL 
       AND profile_telegram.telegram_link_status = 'linked' THEN
      -- Add to queue (ignore conflict if already pending)
      INSERT INTO telegram_access_queue (user_id, club_id, subscription_id, action, status)
      VALUES (NEW.user_id, club_mapping.club_id, NEW.id, 'grant', 'pending')
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3. Create trigger on subscriptions_v2
DROP TRIGGER IF EXISTS subscription_grant_telegram ON subscriptions_v2;
CREATE TRIGGER subscription_grant_telegram
  AFTER INSERT OR UPDATE ON subscriptions_v2
  FOR EACH ROW
  WHEN (NEW.status IN ('active', 'trial'))
  EXECUTE FUNCTION public.trg_subscription_grant_telegram();

-- 4. Enable Realtime for orders_v2 and subscriptions_v2
ALTER PUBLICATION supabase_realtime ADD TABLE orders_v2;
ALTER PUBLICATION supabase_realtime ADD TABLE subscriptions_v2;

-- 5. Comment for documentation
COMMENT ON TABLE public.telegram_access_queue IS 
  'Queue for reliable Telegram club access grant/revoke operations. Processed by telegram-process-access-queue edge function.';

COMMENT ON FUNCTION public.trg_subscription_grant_telegram() IS 
  'Trigger function that queues Telegram access grants when subscription becomes active/trial';