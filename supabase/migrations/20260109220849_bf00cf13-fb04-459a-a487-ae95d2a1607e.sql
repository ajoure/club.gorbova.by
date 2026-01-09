-- =============================================
-- Спринт: Документы по покупке (шаблоны + автогенерация)
-- =============================================

-- 1. Таблица последовательностей нумерации документов
CREATE TABLE IF NOT EXISTS public.document_number_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT 'ДОК',
  year INTEGER NOT NULL,
  last_number INTEGER DEFAULT 0,
  format TEXT DEFAULT '{PREFIX}-{YY}-{000000}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(document_type, year)
);

-- RLS для document_number_sequences
ALTER TABLE public.document_number_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage document sequences"
  ON public.document_number_sequences
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'superadmin')
    )
  );

-- 2. Таблица правил генерации документов
CREATE TABLE IF NOT EXISTS public.document_generation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  
  -- Привязка (nullable = применяется ко всем)
  product_id UUID REFERENCES public.products_v2(id) ON DELETE CASCADE,
  tariff_id UUID REFERENCES public.tariffs(id) ON DELETE CASCADE,
  offer_id UUID REFERENCES public.tariff_offers(id) ON DELETE CASCADE,
  
  -- Триггер
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'payment_success',
    'trial_started',
    'installment_payment',
    'installment_first',
    'installment_last',
    'manual'
  )),
  
  -- Шаблон
  template_id UUID NOT NULL REFERENCES public.document_templates(id) ON DELETE CASCADE,
  
  -- Параметры заполнения (override для полей)
  field_overrides JSONB DEFAULT '{}',
  
  -- Отправка
  auto_send_email BOOLEAN DEFAULT true,
  auto_send_telegram BOOLEAN DEFAULT false,
  
  -- Условия применения
  payer_type_filter TEXT[],
  min_amount NUMERIC,
  max_amount NUMERIC,
  
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS для document_generation_rules
ALTER TABLE public.document_generation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage document rules"
  ON public.document_generation_rules
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'superadmin')
    )
  );

-- 3. Расширение таблицы tariffs (параметры документов)
ALTER TABLE public.tariffs 
  ADD COLUMN IF NOT EXISTS document_params JSONB DEFAULT '{}';

COMMENT ON COLUMN public.tariffs.document_params IS 'Параметры для генерации документов: service_title, unit, service_period_days, contract_number_prefix';

-- 4. Расширение таблицы generated_documents
ALTER TABLE public.generated_documents 
  ADD COLUMN IF NOT EXISTS rule_id UUID REFERENCES public.document_generation_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.document_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS installment_payment_id UUID REFERENCES public.installment_payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payer_type TEXT,
  ADD COLUMN IF NOT EXISTS payer_type_mismatch BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS mismatch_warning TEXT,
  ADD COLUMN IF NOT EXISTS generation_log JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS contract_number TEXT,
  ADD COLUMN IF NOT EXISTS contract_date DATE,
  ADD COLUMN IF NOT EXISTS service_period_from DATE,
  ADD COLUMN IF NOT EXISTS service_period_to DATE,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS contract_total_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'BYN',
  ADD COLUMN IF NOT EXISTS sent_to_telegram TEXT,
  ADD COLUMN IF NOT EXISTS trigger_type TEXT;

-- 5. Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_document_rules_product ON public.document_generation_rules(product_id);
CREATE INDEX IF NOT EXISTS idx_document_rules_tariff ON public.document_generation_rules(tariff_id);
CREATE INDEX IF NOT EXISTS idx_document_rules_trigger ON public.document_generation_rules(trigger_type);
CREATE INDEX IF NOT EXISTS idx_document_rules_template ON public.document_generation_rules(template_id);
CREATE INDEX IF NOT EXISTS idx_generated_documents_rule ON public.generated_documents(rule_id);
CREATE INDEX IF NOT EXISTS idx_generated_documents_template ON public.generated_documents(template_id);
CREATE INDEX IF NOT EXISTS idx_generated_documents_installment ON public.generated_documents(installment_payment_id);
CREATE INDEX IF NOT EXISTS idx_generated_documents_trigger ON public.generated_documents(trigger_type);

-- 6. Функция для получения следующего номера документа
CREATE OR REPLACE FUNCTION public.get_next_document_number(
  p_document_type TEXT,
  p_prefix TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INTEGER;
  v_next_number INTEGER;
  v_format TEXT;
  v_prefix TEXT;
  v_result TEXT;
BEGIN
  v_year := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  
  -- Вставляем или обновляем последовательность
  INSERT INTO document_number_sequences (document_type, prefix, year, last_number, format)
  VALUES (p_document_type, COALESCE(p_prefix, 'ДОК'), v_year, 1, '{PREFIX}-{YY}-{000000}')
  ON CONFLICT (document_type, year) 
  DO UPDATE SET 
    last_number = document_number_sequences.last_number + 1,
    updated_at = now()
  RETURNING last_number, format, prefix INTO v_next_number, v_format, v_prefix;
  
  -- Используем переданный префикс если указан
  IF p_prefix IS NOT NULL THEN
    v_prefix := p_prefix;
  END IF;
  
  -- Форматируем номер
  v_result := v_format;
  v_result := REPLACE(v_result, '{PREFIX}', v_prefix);
  v_result := REPLACE(v_result, '{YYYY}', v_year::TEXT);
  v_result := REPLACE(v_result, '{YY}', RIGHT(v_year::TEXT, 2));
  v_result := REPLACE(v_result, '{000000}', LPAD(v_next_number::TEXT, 6, '0'));
  v_result := REPLACE(v_result, '{00000}', LPAD(v_next_number::TEXT, 5, '0'));
  v_result := REPLACE(v_result, '{0000}', LPAD(v_next_number::TEXT, 4, '0'));
  
  RETURN v_result;
END;
$$;

-- 7. Добавляем начальные последовательности
INSERT INTO public.document_number_sequences (document_type, prefix, year, format)
VALUES 
  ('invoice_act', 'СА', EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER, '{PREFIX}-{YY}-{000000}'),
  ('act', 'АКТ', EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER, '{PREFIX}-{YY}-{000000}'),
  ('contract', 'ДОГ', EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER, '{PREFIX}-{YY}-{000000}')
ON CONFLICT (document_type, year) DO NOTHING;

-- 8. Триггер для updated_at
CREATE OR REPLACE FUNCTION public.update_document_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_document_generation_rules_updated_at ON public.document_generation_rules;
CREATE TRIGGER update_document_generation_rules_updated_at
  BEFORE UPDATE ON public.document_generation_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_document_rules_updated_at();

DROP TRIGGER IF EXISTS update_document_number_sequences_updated_at ON public.document_number_sequences;
CREATE TRIGGER update_document_number_sequences_updated_at
  BEFORE UPDATE ON public.document_number_sequences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_document_rules_updated_at();