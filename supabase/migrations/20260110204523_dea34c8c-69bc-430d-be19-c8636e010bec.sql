-- Create lesson_blocks table for block-based content editor
CREATE TABLE public.lesson_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES public.training_lessons(id) ON DELETE CASCADE,
  block_type TEXT NOT NULL CHECK (block_type IN ('heading', 'text', 'video', 'audio', 'image', 'file', 'button', 'embed', 'divider')),
  content JSONB NOT NULL DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for faster queries
CREATE INDEX idx_lesson_blocks_lesson_id ON public.lesson_blocks(lesson_id);
CREATE INDEX idx_lesson_blocks_sort_order ON public.lesson_blocks(lesson_id, sort_order);

-- Enable RLS
ALTER TABLE public.lesson_blocks ENABLE ROW LEVEL SECURITY;

-- Public read access (lessons are viewable if user has access to the module)
CREATE POLICY "Public read for lesson blocks" ON public.lesson_blocks
  FOR SELECT USING (true);

-- Admin full access using user_roles table with correct enum values
CREATE POLICY "Admin insert lesson blocks" ON public.lesson_blocks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur 
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'superadmin')
    )
  );

CREATE POLICY "Admin update lesson blocks" ON public.lesson_blocks
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur 
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'superadmin')
    )
  );

CREATE POLICY "Admin delete lesson blocks" ON public.lesson_blocks
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur 
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'superadmin')
    )
  );

-- Trigger for updated_at
CREATE TRIGGER update_lesson_blocks_updated_at
  BEFORE UPDATE ON public.lesson_blocks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();