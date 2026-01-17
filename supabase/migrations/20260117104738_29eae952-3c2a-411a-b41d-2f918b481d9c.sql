-- Create audience_interests table for tracking what audience discusses
CREATE TABLE public.audience_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  frequency integer DEFAULT 1,
  last_discussed date NOT NULL,
  source_summary_id uuid REFERENCES tg_daily_summaries(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(topic)
);

-- Enable RLS
ALTER TABLE public.audience_interests ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (for edge functions)
CREATE POLICY "Service role can manage audience_interests" 
ON public.audience_interests 
FOR ALL 
USING (true);

-- Add resonance fields to news_content
ALTER TABLE public.news_content 
  ADD COLUMN IF NOT EXISTS is_resonant boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS resonance_topics text[] DEFAULT '{}';

-- Create index for faster resonance queries
CREATE INDEX IF NOT EXISTS idx_audience_interests_last_discussed 
ON public.audience_interests(last_discussed DESC);

CREATE INDEX IF NOT EXISTS idx_news_content_is_resonant 
ON public.news_content(is_resonant) WHERE is_resonant = true;

-- Add trigger to update updated_at
CREATE TRIGGER update_audience_interests_updated_at
BEFORE UPDATE ON public.audience_interests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();