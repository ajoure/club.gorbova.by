-- User lesson progress table for storing quiz responses and scores
CREATE TABLE user_lesson_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES training_lessons(id) ON DELETE CASCADE,
  block_id UUID REFERENCES lesson_blocks(id) ON DELETE SET NULL,
  
  -- User response data
  response JSONB DEFAULT '{}',
  
  -- Scoring
  is_correct BOOLEAN,
  score INTEGER DEFAULT 0,
  max_score INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  
  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  time_spent_seconds INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, lesson_id, block_id)
);

-- Enable RLS
ALTER TABLE user_lesson_progress ENABLE ROW LEVEL SECURITY;

-- Users can manage their own progress
CREATE POLICY "Users can view own progress" ON user_lesson_progress
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own progress" ON user_lesson_progress
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own progress" ON user_lesson_progress
  FOR UPDATE USING (auth.uid() = user_id);

-- Admins can view all progress
CREATE POLICY "Admins can view all progress" ON user_lesson_progress
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'superadmin'))
  );

-- Index for fast lookups
CREATE INDEX idx_user_lesson_progress_user_lesson ON user_lesson_progress(user_id, lesson_id);
CREATE INDEX idx_user_lesson_progress_block ON user_lesson_progress(block_id);

-- Trigger for updated_at
CREATE TRIGGER update_user_lesson_progress_updated_at
  BEFORE UPDATE ON user_lesson_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();