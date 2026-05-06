
-- ============================================================================
-- Sprint 1: Canonical DOCX Generation Pipeline (ADD-ONLY)
-- ============================================================================

-- 1. document_template_versions
CREATE TABLE IF NOT EXISTS public.document_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.document_templates(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'documents-templates',
  storage_path TEXT NOT NULL,
  file_name TEXT,
  file_size_bytes BIGINT,
  file_sha256 TEXT,
  tokens JSONB NOT NULL DEFAULT '[]'::jsonb,
  unmapped_tokens JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  is_current BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_doc_tpl_versions_template ON public.document_template_versions(template_id);
CREATE INDEX IF NOT EXISTS idx_doc_tpl_versions_current ON public.document_template_versions(template_id) WHERE is_current = true;

ALTER TABLE public.document_template_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doc_tpl_versions_admin_all" ON public.document_template_versions
  FOR ALL USING (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin'))
  WITH CHECK (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin'));

-- 2. document_token_registry
CREATE TABLE IF NOT EXISTS public.document_token_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_key TEXT NOT NULL UNIQUE,
  ui_label TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'system',
  -- 'system' (resolver-managed) или 'custom_field' (через fields_registry)
  source_type TEXT NOT NULL DEFAULT 'system' CHECK (source_type IN ('system','custom_field')),
  field_id UUID REFERENCES public.fields_registry(id) ON DELETE SET NULL,
  resolver_key TEXT,
  data_type TEXT NOT NULL DEFAULT 'string',
  is_required BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  example_value TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_token_registry_category ON public.document_token_registry(category) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_token_registry_field ON public.document_token_registry(field_id) WHERE field_id IS NOT NULL;

ALTER TABLE public.document_token_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doc_token_registry_admin_all" ON public.document_token_registry
  FOR ALL USING (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin'))
  WITH CHECK (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin'));

CREATE POLICY "doc_token_registry_authenticated_read" ON public.document_token_registry
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- 3. document_generation_sessions (preview/draft)
CREATE TABLE IF NOT EXISTS public.document_generation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES public.document_templates(id) ON DELETE CASCADE,
  template_version_id UUID REFERENCES public.document_template_versions(id) ON DELETE SET NULL,
  context_type TEXT,
  context_id UUID,
  legal_details_id UUID,
  person_id UUID,
  signer_link_id UUID,
  resolved_tokens JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing_tokens JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_gen_sessions_template ON public.document_generation_sessions(template_id);
CREATE INDEX IF NOT EXISTS idx_doc_gen_sessions_creator ON public.document_generation_sessions(created_by);
CREATE INDEX IF NOT EXISTS idx_doc_gen_sessions_expires ON public.document_generation_sessions(expires_at);

ALTER TABLE public.document_generation_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doc_gen_sessions_admin_all" ON public.document_generation_sessions
  FOR ALL USING (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin'))
  WITH CHECK (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin'));

CREATE POLICY "doc_gen_sessions_owner_rw" ON public.document_generation_sessions
  FOR ALL USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

-- 4. document_templates: extend (nullable, no NOT NULL)
ALTER TABLE public.document_templates
  ADD COLUMN IF NOT EXISTS current_version_id UUID REFERENCES public.document_template_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_scope TEXT;

-- 5. ai_generated_documents: extend
ALTER TABLE public.ai_generated_documents
  ADD COLUMN IF NOT EXISTS context_type TEXT,
  ADD COLUMN IF NOT EXISTS context_id UUID,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS template_version_id UUID REFERENCES public.document_template_versions(id) ON DELETE SET NULL;

-- Partial unique index: idempotency only when key present and not error/deleted
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_gen_docs_idempotency
  ON public.ai_generated_documents(idempotency_key)
  WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_gen_docs_context ON public.ai_generated_documents(context_type, context_id) WHERE context_id IS NOT NULL;

-- 6. updated_at triggers
CREATE OR REPLACE FUNCTION public.tg_doc_canonical_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_doc_token_registry_updated_at ON public.document_token_registry;
CREATE TRIGGER trg_doc_token_registry_updated_at
  BEFORE UPDATE ON public.document_token_registry
  FOR EACH ROW EXECUTE FUNCTION public.tg_doc_canonical_set_updated_at();

DROP TRIGGER IF EXISTS trg_doc_gen_sessions_updated_at ON public.document_generation_sessions;
CREATE TRIGGER trg_doc_gen_sessions_updated_at
  BEFORE UPDATE ON public.document_generation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_doc_canonical_set_updated_at();

-- 7. Feature flag in app_settings
INSERT INTO public.app_settings(key, value)
VALUES ('documents_canonical_generation_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 8. Seed token registry — MVP for "Акт выполненных работ"
-- System (executor) tokens
INSERT INTO public.document_token_registry(token_key, ui_label, description, category, source_type, resolver_key, is_required, display_order)
VALUES
  ('executor.name',            'Исполнитель: название',          'Юр. название исполнителя из реквизитов компании',     'executor', 'system', 'executor.name', true, 10),
  ('executor.short_name',      'Исполнитель: краткое название',  'Краткое наименование исполнителя',                    'executor', 'system', 'executor.short_name', false, 11),
  ('executor.unp',             'Исполнитель: УНП',               'УНП исполнителя',                                     'executor', 'system', 'executor.unp', true, 12),
  ('executor.address',         'Исполнитель: адрес',             'Юридический адрес исполнителя',                       'executor', 'system', 'executor.address', false, 13),
  ('executor.bank',            'Исполнитель: банк',              'Название банка исполнителя',                          'executor', 'system', 'executor.bank', false, 14),
  ('executor.bank_code',       'Исполнитель: БИК',               'БИК банка исполнителя',                               'executor', 'system', 'executor.bank_code', false, 15),
  ('executor.account',         'Исполнитель: счёт',              'Расчётный счёт исполнителя',                          'executor', 'system', 'executor.account', false, 16),
  ('executor.director',        'Исполнитель: директор',          'ФИО руководителя исполнителя',                        'executor', 'system', 'executor.director', false, 17),
  ('executor.director_short',  'Исполнитель: директор (инициалы)','Иванов И.И.',                                        'executor', 'system', 'executor.director_short', false, 18),
  ('executor.acts_on_basis',   'Исполнитель: действует на основании', '', 'executor', 'system', 'executor.acts_on_basis', false, 19),
  ('customer.name',            'Заказчик: ФИО / название',       'ФИО физлица или название организации заказчика',      'customer', 'system', 'customer.name', true, 20),
  ('customer.short_name',      'Заказчик: краткое имя',          'Иванов И.И.',                                         'customer', 'system', 'customer.short_name', false, 21),
  ('customer.unp',             'Заказчик: УНП',                  'УНП заказчика (если ЮЛ/ИП)',                          'customer', 'system', 'customer.unp', false, 22),
  ('customer.address',         'Заказчик: адрес',                '',                                                    'customer', 'system', 'customer.address', false, 23),
  ('customer.phone',           'Заказчик: телефон',              '',                                                    'customer', 'system', 'customer.phone', false, 24),
  ('customer.email',           'Заказчик: email',                '',                                                    'customer', 'system', 'customer.email', false, 25),
  ('customer.bank',            'Заказчик: банк',                 '',                                                    'customer', 'system', 'customer.bank', false, 26),
  ('customer.account',         'Заказчик: счёт',                 '',                                                    'customer', 'system', 'customer.account', false, 27),
  ('customer.passport',        'Заказчик: паспорт',              'Серия и номер',                                       'customer', 'system', 'customer.passport', false, 28),
  ('deal.id',                  'Сделка: ID',                     'Идентификатор заказа/сделки',                         'deal',     'system', 'deal.id', false, 30),
  ('deal.product_name',        'Сделка: продукт',                'Название продукта',                                   'deal',     'system', 'deal.product_name', true, 31),
  ('deal.tariff_name',         'Сделка: тариф',                  'Название тарифа',                                     'deal',     'system', 'deal.tariff_name', false, 32),
  ('deal.amount',              'Сделка: сумма',                  'Сумма заказа',                                        'deal',     'system', 'deal.amount', true, 33),
  ('deal.amount_words',        'Сделка: сумма прописью',         'Сумма прописью на русском',                           'deal',     'system', 'deal.amount_words', false, 34),
  ('deal.currency',            'Сделка: валюта',                 'BYN / RUB / USD',                                     'deal',     'system', 'deal.currency', false, 35),
  ('deal.paid_at',             'Сделка: дата оплаты',            '',                                                    'deal',     'system', 'deal.paid_at', false, 36),
  ('deal.access_days',         'Сделка: срок доступа (дней)',    '',                                                    'deal',     'system', 'deal.access_days', false, 37),
  ('document.number',          'Документ: номер',                'Сгенерированный номер документа',                     'document', 'system', 'document.number', true, 40),
  ('document.date',            'Документ: дата (длинная)',       '6 мая 2026',                                          'document', 'system', 'document.date', true, 41),
  ('document.date_short',      'Документ: дата (короткая)',      '06.05.2026',                                          'document', 'system', 'document.date_short', false, 42),
  ('system.today',             'Система: сегодня',               'Текущая дата генерации',                              'system',   'system', 'system.today', false, 50),
  ('system.today_long',        'Система: сегодня (длинная)',     '',                                                    'system',   'system', 'system.today_long', false, 51)
ON CONFLICT (token_key) DO NOTHING;

-- Seed legal_details.* tokens linked to fields_registry (cf.legal_details.* mapping)
INSERT INTO public.document_token_registry(token_key, ui_label, description, category, source_type, field_id, resolver_key, display_order)
SELECT
  fr.key                                  AS token_key,
  fr.label                                AS ui_label,
  'Поле реквизитов (' || fr.key || ')'    AS description,
  'legal_details'                          AS category,
  'custom_field'                           AS source_type,
  fr.id                                    AS field_id,
  fr.key                                   AS resolver_key,
  100 + COALESCE(fr.display_order, 0)      AS display_order
FROM public.fields_registry fr
WHERE fr.entity_type = 'legal_details'
  AND fr.archived_at IS NULL
ON CONFLICT (token_key) DO NOTHING;
