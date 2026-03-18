
-- Таблица папок для страниц конструктора
CREATE TABLE public.site_page_folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.site_page_folders(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL DEFAULT '__default__',
  sort_order INT NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Добавить folder_id к site_pages
ALTER TABLE public.site_pages ADD COLUMN folder_id UUID REFERENCES public.site_page_folders(id) ON DELETE SET NULL;

-- RLS
ALTER TABLE public.site_page_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage folders"
  ON public.site_page_folders
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
