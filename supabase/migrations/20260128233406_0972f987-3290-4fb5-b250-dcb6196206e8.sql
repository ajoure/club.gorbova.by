-- 1. Create kb_questions table for storing Q&A with timecodes
CREATE TABLE public.kb_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES public.training_lessons(id) ON DELETE CASCADE,
  episode_number INT NOT NULL,
  question_number INT,
  title TEXT NOT NULL,
  full_question TEXT,
  tags TEXT[],
  kinescope_url TEXT,
  timecode_seconds INT,
  answer_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, question_number)
);

-- 2. Add published_at column to training_lessons for displaying original broadcast date
ALTER TABLE public.training_lessons ADD COLUMN IF NOT EXISTS published_at DATE;

-- 3. Create indexes for performance
CREATE INDEX idx_kb_questions_lesson_id ON public.kb_questions(lesson_id);
CREATE INDEX idx_kb_questions_episode ON public.kb_questions(episode_number);
CREATE INDEX idx_kb_questions_tags ON public.kb_questions USING GIN(tags);
CREATE INDEX idx_kb_questions_answer_date ON public.kb_questions(answer_date DESC);

-- 4. Create FTS index for Russian text search on title and full_question
CREATE INDEX idx_kb_questions_fts ON public.kb_questions USING GIN(
  to_tsvector('russian', coalesce(title, '') || ' ' || coalesce(full_question, ''))
);

-- 5. Enable RLS
ALTER TABLE public.kb_questions ENABLE ROW LEVEL SECURITY;

-- 6. RLS policies
-- SELECT: authenticated users can read all questions
CREATE POLICY "kb_questions_select_authenticated" ON public.kb_questions
  FOR SELECT TO authenticated USING (true);

-- ALL (INSERT/UPDATE/DELETE): only admin/superadmin (using correct enum values)
CREATE POLICY "kb_questions_admin_all" ON public.kb_questions
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'admin'::app_role) OR
    public.has_role(auth.uid(), 'superadmin'::app_role)
  );

-- 7. Create trigger for updating updated_at
CREATE TRIGGER update_kb_questions_updated_at
  BEFORE UPDATE ON public.kb_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 8. Add realtime for live updates in UI
ALTER PUBLICATION supabase_realtime ADD TABLE public.kb_questions;