-- Create table for dynamic user menu sections
CREATE TABLE public.user_menu_sections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  icon TEXT DEFAULT 'Folder',
  url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  parent_key TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_menu_sections ENABLE ROW LEVEL SECURITY;

-- Public read access (menu is visible to all authenticated users)
CREATE POLICY "Authenticated users can view menu sections"
ON public.user_menu_sections
FOR SELECT
TO authenticated
USING (true);

-- Only admins can manage menu sections (using correct app_role enum values)
CREATE POLICY "Admins can manage menu sections"
ON public.user_menu_sections
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role IN ('superadmin', 'admin')
  )
);

-- Insert default sections based on current AppSidebar structure
INSERT INTO public.user_menu_sections (key, label, icon, url, sort_order, parent_key) VALUES
  ('dashboard', 'Пульс', 'Activity', '/dashboard', 0, NULL),
  ('knowledge', 'База знаний', 'BookOpen', '/knowledge', 1, NULL),
  ('knowledge-questions', 'Вопросы', 'HelpCircle', '/knowledge/questions', 0, 'knowledge'),
  ('knowledge-videos', 'Видеоответы', 'Video', '/knowledge/videos', 1, 'knowledge'),
  ('knowledge-laws', 'Законодательство', 'Scale', '/knowledge/laws', 2, 'knowledge'),
  ('money', 'Деньги', 'Wallet', '/money', 2, NULL),
  ('self-development', 'Саморазвитие', 'Sparkles', '/self-development', 3, NULL),
  ('ai', 'Нейросеть', 'Cpu', '/ai', 4, NULL),
  ('products', 'Обучение', 'GraduationCap', '/products', 5, NULL),
  ('products-library', 'Моя библиотека', 'Library', '/products/library', 0, 'products'),
  ('products-all', 'Все продукты', 'Package', '/products/all', 1, 'products'),
  ('business', 'Бизнес', 'Briefcase', '/business', 6, NULL),
  ('accountant', 'Бухгалтер', 'Calculator', '/accountant', 7, NULL),
  ('audits', 'Проверки', 'ClipboardCheck', '/audits', 8, NULL);

-- Add menu placement columns to training_modules
ALTER TABLE public.training_modules 
ADD COLUMN IF NOT EXISTS menu_section_key TEXT DEFAULT 'products',
ADD COLUMN IF NOT EXISTS display_layout TEXT DEFAULT 'grid';

-- Add foreign key constraint
ALTER TABLE public.training_modules
ADD CONSTRAINT fk_training_modules_menu_section
FOREIGN KEY (menu_section_key) REFERENCES public.user_menu_sections(key)
ON DELETE SET NULL ON UPDATE CASCADE;

-- Add comments
COMMENT ON TABLE public.user_menu_sections IS 'Dynamic user navigation menu sections with hierarchical structure';
COMMENT ON COLUMN public.user_menu_sections.parent_key IS 'Parent section key for subsections (null = top-level)';
COMMENT ON COLUMN public.training_modules.menu_section_key IS 'Where this module appears in user navigation';
COMMENT ON COLUMN public.training_modules.display_layout IS 'Layout style: grid, list, cards-horizontal, fullscreen';

-- Create trigger for updated_at
CREATE TRIGGER update_user_menu_sections_updated_at
BEFORE UPDATE ON public.user_menu_sections
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();