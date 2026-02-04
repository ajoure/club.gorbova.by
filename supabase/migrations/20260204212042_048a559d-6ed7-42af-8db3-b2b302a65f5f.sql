-- =====================================================
-- Training Quest Step 1: Kvest Mode Migration
-- =====================================================

-- 1. Create lesson_progress_state table
CREATE TABLE IF NOT EXISTS public.lesson_progress_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.training_lessons(id) ON DELETE CASCADE,
  state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, lesson_id)
);

-- RLS for lesson_progress_state
ALTER TABLE public.lesson_progress_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own progress state"
  ON public.lesson_progress_state FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_lesson_progress_state_user_lesson 
  ON public.lesson_progress_state(user_id, lesson_id);

COMMENT ON TABLE public.lesson_progress_state IS 
  'Хранит состояние прохождения квеста: роль, прогресс видео, ответы Point A/B и т.д.';

-- 2. Extend training_lessons table
-- Change published_at from date to timestamptz
ALTER TABLE public.training_lessons 
  ALTER COLUMN published_at TYPE timestamptz 
  USING CASE 
    WHEN published_at IS NOT NULL 
    THEN published_at::timestamp AT TIME ZONE 'Europe/Minsk'
    ELSE NULL 
  END;

-- Add new columns
ALTER TABLE public.training_lessons
  ADD COLUMN IF NOT EXISTS require_previous boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS completion_mode text DEFAULT 'manual';

-- Add check constraint for completion_mode
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'training_lessons_completion_mode_check'
  ) THEN
    ALTER TABLE public.training_lessons 
      ADD CONSTRAINT training_lessons_completion_mode_check 
      CHECK (completion_mode IN ('manual', 'view_all_blocks', 'watch_video', 'kvest'));
  END IF;
END $$;

COMMENT ON COLUMN public.training_lessons.require_previous IS 
  'Требует завершения предыдущего урока для открытия';
COMMENT ON COLUMN public.training_lessons.completion_mode IS 
  'manual = ручная отметка, kvest = последовательные шаги с gate rules';

-- 3. Extend training_modules table
ALTER TABLE public.training_modules
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

COMMENT ON COLUMN public.training_modules.published_at IS 
  'Дата/время открытия модуля для пользователей';

-- 4. Extend lesson_blocks block_type constraint
ALTER TABLE public.lesson_blocks 
  DROP CONSTRAINT IF EXISTS lesson_blocks_block_type_check;

ALTER TABLE public.lesson_blocks 
  ADD CONSTRAINT lesson_blocks_block_type_check 
  CHECK (block_type IN (
    'heading', 'text', 'accordion', 'tabs', 'spoiler', 'callout', 'quote',
    'video', 'audio', 'image', 'gallery', 'file',
    'button', 'embed', 'divider', 'timeline', 'steps',
    'quiz_single', 'quiz_multiple', 'quiz_true_false', 'quiz_fill_blank',
    'quiz_matching', 'quiz_sequence', 'quiz_hotspot', 'quiz_survey',
    'input_short', 'input_long', 'checklist', 'table_input', 'file_upload', 'rating',
    'container', 'columns', 'condition',
    'video_unskippable',
    'diagnostic_table',
    'sequential_form'
  ));

-- 5. Create trigger for updated_at on lesson_progress_state
CREATE OR REPLACE FUNCTION public.update_lesson_progress_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trigger_update_lesson_progress_state_updated_at ON public.lesson_progress_state;
CREATE TRIGGER trigger_update_lesson_progress_state_updated_at
  BEFORE UPDATE ON public.lesson_progress_state
  FOR EACH ROW
  EXECUTE FUNCTION public.update_lesson_progress_state_updated_at();