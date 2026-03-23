
-- ============================================
-- PATCH 9: Foundation для пакетов документов
-- ============================================

-- 1. Таблица пакетных шаблонов
CREATE TABLE public.document_package_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Таблица элементов пакета
CREATE TABLE public.document_package_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_template_id uuid NOT NULL REFERENCES public.document_package_templates(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.document_templates(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  title_override text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_package_template UNIQUE (package_template_id, template_id),
  CONSTRAINT chk_sort_order CHECK (sort_order >= 0)
);

-- Индекс для быстрого получения элементов пакета в порядке сортировки
CREATE INDEX idx_package_items_order ON public.document_package_template_items (package_template_id, sort_order);

-- 3. Add-only поля в ai_generated_documents для будущей совместимости
ALTER TABLE public.ai_generated_documents
  ADD COLUMN IF NOT EXISTS package_template_id uuid,
  ADD COLUMN IF NOT EXISTS package_item_id uuid;

-- 4. RLS для document_package_templates
ALTER TABLE public.document_package_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can select own packages"
  ON public.document_package_templates FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid() OR public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "Owner can insert own packages"
  ON public.document_package_templates FOR INSERT
  TO authenticated
  WITH CHECK (profile_id = auth.uid() OR public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "Owner can update own packages"
  ON public.document_package_templates FOR UPDATE
  TO authenticated
  USING (profile_id = auth.uid() OR public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "Owner can delete own packages"
  ON public.document_package_templates FOR DELETE
  TO authenticated
  USING (profile_id = auth.uid() OR public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

-- 5. RLS для document_package_template_items
ALTER TABLE public.document_package_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Access items through package ownership"
  ON public.document_package_template_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.document_package_templates p
      WHERE p.id = package_template_id
        AND (p.profile_id = auth.uid() OR public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
    )
  );

CREATE POLICY "Insert items through package ownership"
  ON public.document_package_template_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.document_package_templates p
      WHERE p.id = package_template_id
        AND (p.profile_id = auth.uid() OR public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
    )
  );

CREATE POLICY "Update items through package ownership"
  ON public.document_package_template_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.document_package_templates p
      WHERE p.id = package_template_id
        AND (p.profile_id = auth.uid() OR public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
    )
  );

CREATE POLICY "Delete items through package ownership"
  ON public.document_package_template_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.document_package_templates p
      WHERE p.id = package_template_id
        AND (p.profile_id = auth.uid() OR public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
    )
  );
