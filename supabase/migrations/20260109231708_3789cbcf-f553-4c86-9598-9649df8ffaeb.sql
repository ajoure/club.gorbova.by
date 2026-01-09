-- Create training_modules table (sections/modules of knowledge base)
CREATE TABLE public.training_modules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES public.products_v2(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  cover_image TEXT,
  icon TEXT DEFAULT 'BookOpen',
  color_gradient TEXT DEFAULT 'from-pink-500 to-fuchsia-600',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create training_lessons table (lessons/materials within a module)
CREATE TABLE public.training_lessons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  module_id UUID NOT NULL REFERENCES public.training_modules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  content TEXT,
  content_type TEXT NOT NULL DEFAULT 'article' CHECK (content_type IN ('video', 'audio', 'article', 'document', 'mixed')),
  video_url TEXT,
  audio_url TEXT,
  thumbnail_url TEXT,
  sort_order INTEGER DEFAULT 0,
  duration_minutes INTEGER,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(module_id, slug)
);

-- Create lesson_attachments table (files attached to lessons)
CREATE TABLE public.lesson_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lesson_id UUID NOT NULL REFERENCES public.training_lessons(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create module_access table (links modules to tariffs for access control)
CREATE TABLE public.module_access (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  module_id UUID NOT NULL REFERENCES public.training_modules(id) ON DELETE CASCADE,
  tariff_id UUID NOT NULL REFERENCES public.tariffs(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(module_id, tariff_id)
);

-- Create lesson_progress table (tracks user progress)
CREATE TABLE public.lesson_progress (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  lesson_id UUID NOT NULL REFERENCES public.training_lessons(id) ON DELETE CASCADE,
  completed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, lesson_id)
);

-- Create indexes for performance
CREATE INDEX idx_training_modules_product_id ON public.training_modules(product_id);
CREATE INDEX idx_training_modules_slug ON public.training_modules(slug);
CREATE INDEX idx_training_lessons_module_id ON public.training_lessons(module_id);
CREATE INDEX idx_lesson_attachments_lesson_id ON public.lesson_attachments(lesson_id);
CREATE INDEX idx_module_access_module_id ON public.module_access(module_id);
CREATE INDEX idx_module_access_tariff_id ON public.module_access(tariff_id);
CREATE INDEX idx_lesson_progress_user_id ON public.lesson_progress(user_id);
CREATE INDEX idx_lesson_progress_lesson_id ON public.lesson_progress(lesson_id);

-- Enable RLS on all tables
ALTER TABLE public.training_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;

-- RLS Policies for training_modules (everyone can view active modules)
CREATE POLICY "Anyone can view active modules" 
  ON public.training_modules FOR SELECT 
  USING (is_active = true);

CREATE POLICY "Admins can manage modules" 
  ON public.training_modules FOR ALL 
  USING (public.has_permission(auth.uid(), 'content.manage'));

-- RLS Policies for training_lessons
-- Users can view lessons if they have active subscription with matching tariff
CREATE POLICY "Users can view lessons with valid subscription" 
  ON public.training_lessons FOR SELECT 
  USING (
    is_active = true AND (
      -- Check if user has active subscription with matching tariff
      EXISTS (
        SELECT 1 FROM public.subscriptions_v2 s
        JOIN public.module_access ma ON ma.tariff_id = s.tariff_id
        WHERE s.user_id = auth.uid()
          AND s.status = 'active'
          AND ma.module_id = training_lessons.module_id
      )
      -- Or is admin
      OR public.has_permission(auth.uid(), 'content.manage')
    )
  );

CREATE POLICY "Admins can manage lessons" 
  ON public.training_lessons FOR ALL 
  USING (public.has_permission(auth.uid(), 'content.manage'));

-- RLS Policies for lesson_attachments
CREATE POLICY "Users can view attachments with valid subscription" 
  ON public.lesson_attachments FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.training_lessons tl
      JOIN public.module_access ma ON ma.module_id = tl.module_id
      JOIN public.subscriptions_v2 s ON s.tariff_id = ma.tariff_id
      WHERE tl.id = lesson_attachments.lesson_id
        AND tl.is_active = true
        AND s.user_id = auth.uid()
        AND s.status = 'active'
    )
    OR public.has_permission(auth.uid(), 'content.manage')
  );

CREATE POLICY "Admins can manage attachments" 
  ON public.lesson_attachments FOR ALL 
  USING (public.has_permission(auth.uid(), 'content.manage'));

-- RLS Policies for module_access (admins only)
CREATE POLICY "Anyone can view module access" 
  ON public.module_access FOR SELECT 
  USING (true);

CREATE POLICY "Admins can manage module access" 
  ON public.module_access FOR ALL 
  USING (public.has_permission(auth.uid(), 'content.manage'));

-- RLS Policies for lesson_progress
CREATE POLICY "Users can view own progress" 
  ON public.lesson_progress FOR SELECT 
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own progress" 
  ON public.lesson_progress FOR INSERT 
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own progress" 
  ON public.lesson_progress FOR DELETE 
  USING (user_id = auth.uid());

CREATE POLICY "Admins can view all progress" 
  ON public.lesson_progress FOR SELECT 
  USING (public.has_permission(auth.uid(), 'content.manage'));

-- Create triggers for updated_at
CREATE TRIGGER update_training_modules_updated_at
  BEFORE UPDATE ON public.training_modules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_training_lessons_updated_at
  BEFORE UPDATE ON public.training_lessons
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for training content
INSERT INTO storage.buckets (id, name, public) 
VALUES ('training-content', 'training-content', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for training-content bucket
CREATE POLICY "Anyone can view training content"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'training-content');

CREATE POLICY "Admins can upload training content"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'training-content' 
    AND public.has_permission(auth.uid(), 'content.manage')
  );

CREATE POLICY "Admins can update training content"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'training-content' 
    AND public.has_permission(auth.uid(), 'content.manage')
  );

CREATE POLICY "Admins can delete training content"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'training-content' 
    AND public.has_permission(auth.uid(), 'content.manage')
  );