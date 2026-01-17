-- Create table for audience insights from chat analysis
CREATE TABLE IF NOT EXISTS audience_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id TEXT,
  insight_type TEXT NOT NULL CHECK (insight_type IN ('topic', 'question', 'problem', 'pain_point', 'objection', 'interest')),
  title TEXT NOT NULL,
  description TEXT,
  examples TEXT[],
  frequency INTEGER DEFAULT 1,
  sentiment TEXT CHECK (sentiment IN ('positive', 'negative', 'neutral', 'mixed')),
  relevance_score NUMERIC(3,2) DEFAULT 0.5,
  source_message_count INTEGER DEFAULT 0,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add index for efficient queries
CREATE INDEX IF NOT EXISTS idx_audience_insights_type ON audience_insights(insight_type);
CREATE INDEX IF NOT EXISTS idx_audience_insights_channel ON audience_insights(channel_id);
CREATE INDEX IF NOT EXISTS idx_audience_insights_relevance ON audience_insights(relevance_score DESC);

-- Enable RLS
ALTER TABLE audience_insights ENABLE ROW LEVEL SECURITY;

-- Allow admins to read/write (using user_roles table with correct enum)
CREATE POLICY "Admins can manage audience insights" ON audience_insights
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.role = 'admin'
    )
  );

-- Create trigger for updated_at
CREATE TRIGGER update_audience_insights_updated_at
  BEFORE UPDATE ON audience_insights
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();