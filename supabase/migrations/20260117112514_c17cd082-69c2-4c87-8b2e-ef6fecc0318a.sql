-- 1. Marketing Insights Table for gratitude/complaints/questions tracking
CREATE TABLE public.marketing_insights (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  insight_type TEXT NOT NULL CHECK (insight_type IN ('gratitude', 'complaint', 'question', 'feature_request', 'objection')),
  content TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'telegram_chat' CHECK (source_type IN ('telegram_chat', 'email', 'website', 'manual')),
  source_message_id TEXT,
  source_chat_id TEXT,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  related_product_id UUID REFERENCES public.products_v2(id) ON DELETE SET NULL,
  related_news_id UUID REFERENCES public.news_content(id) ON DELETE SET NULL,
  sentiment_score NUMERIC(3,2) CHECK (sentiment_score >= -1 AND sentiment_score <= 1),
  keywords TEXT[],
  is_actionable BOOLEAN DEFAULT false,
  is_processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMP WITH TIME ZONE,
  extracted_by TEXT DEFAULT 'ai',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.marketing_insights ENABLE ROW LEVEL SECURITY;

-- Policy for admins (using correct enum values: admin, superadmin)
CREATE POLICY "Admins can manage marketing insights" 
ON public.marketing_insights 
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('superadmin', 'admin')
  )
);

-- Index for faster queries
CREATE INDEX idx_marketing_insights_type ON public.marketing_insights(insight_type);
CREATE INDEX idx_marketing_insights_profile ON public.marketing_insights(profile_id);
CREATE INDEX idx_marketing_insights_created ON public.marketing_insights(created_at DESC);

-- 2. Add loyalty_score to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS loyalty_score INTEGER DEFAULT 5 CHECK (loyalty_score >= 1 AND loyalty_score <= 10),
ADD COLUMN IF NOT EXISTS loyalty_updated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS loyalty_auto_update BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS sentiment_history JSONB DEFAULT '[]'::jsonb;

-- 3. Add AI persona fields to news_content for styling options
ALTER TABLE public.news_content
ADD COLUMN IF NOT EXISTS ai_persona TEXT DEFAULT 'official' CHECK (ai_persona IN ('official', 'club', 'sarcastic')),
ADD COLUMN IF NOT EXISTS audience_mood TEXT,
ADD COLUMN IF NOT EXISTS linked_insight_id UUID REFERENCES public.marketing_insights(id) ON DELETE SET NULL;

-- 4. Create index for resonant news
CREATE INDEX IF NOT EXISTS idx_news_content_resonant ON public.news_content(is_resonant) WHERE is_resonant = true;

-- 5. Trigger for updated_at on marketing_insights
CREATE OR REPLACE FUNCTION public.update_marketing_insights_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_marketing_insights_timestamp
BEFORE UPDATE ON public.marketing_insights
FOR EACH ROW
EXECUTE FUNCTION public.update_marketing_insights_updated_at();

-- 6. Enable realtime for marketing_insights
ALTER PUBLICATION supabase_realtime ADD TABLE public.marketing_insights;