-- Add fields for detailed loyalty analytics
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS loyalty_ai_summary TEXT,
ADD COLUMN IF NOT EXISTS loyalty_status_reason TEXT,
ADD COLUMN IF NOT EXISTS loyalty_proofs JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS loyalty_analyzed_messages_count INTEGER DEFAULT 0;

-- Index for fast lookup by telegram_user_id
CREATE INDEX IF NOT EXISTS idx_profiles_telegram_user_id 
ON public.profiles(telegram_user_id) WHERE telegram_user_id IS NOT NULL;

-- Comment on columns
COMMENT ON COLUMN public.profiles.loyalty_ai_summary IS 'AI-generated summary of client relationship';
COMMENT ON COLUMN public.profiles.loyalty_status_reason IS 'Explanation for the loyalty score';
COMMENT ON COLUMN public.profiles.loyalty_proofs IS 'Array of quote proofs with dates and sentiment';
COMMENT ON COLUMN public.profiles.loyalty_analyzed_messages_count IS 'Number of messages analyzed for this score';