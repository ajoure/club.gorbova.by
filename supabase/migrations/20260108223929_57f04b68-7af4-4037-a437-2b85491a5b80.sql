-- =============================================
-- Таблица исполнителей (компаний/ИП, выставляющих документы)
-- =============================================
CREATE TABLE public.executors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  legal_form TEXT NOT NULL DEFAULT 'individual_entrepreneur',
  full_name TEXT NOT NULL,
  short_name TEXT,
  unp TEXT NOT NULL,
  legal_address TEXT NOT NULL,
  bank_account TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  bank_code TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  director_position TEXT DEFAULT 'Директор',
  director_full_name TEXT,
  director_short_name TEXT,
  acts_on_basis TEXT DEFAULT 'Устава',
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_executors_single_default ON public.executors (is_default) WHERE is_default = true;

-- =============================================
-- Таблица реквизитов клиентов
-- =============================================
CREATE TABLE public.client_legal_details (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_type TEXT NOT NULL DEFAULT 'individual',
  is_default BOOLEAN NOT NULL DEFAULT false,
  ind_full_name TEXT,
  ind_birth_date DATE,
  ind_passport_series TEXT,
  ind_passport_number TEXT,
  ind_passport_issued_by TEXT,
  ind_passport_issued_date DATE,
  ind_passport_valid_until DATE,
  ind_personal_number TEXT,
  ind_address_index TEXT,
  ind_address_region TEXT,
  ind_address_district TEXT,
  ind_address_city TEXT,
  ind_address_street TEXT,
  ind_address_house TEXT,
  ind_address_apartment TEXT,
  ent_name TEXT,
  ent_unp TEXT,
  ent_address TEXT,
  ent_acts_on_basis TEXT DEFAULT 'свидетельства о государственной регистрации',
  leg_org_form TEXT,
  leg_name TEXT,
  leg_unp TEXT,
  leg_address TEXT,
  leg_director_position TEXT,
  leg_director_name TEXT,
  leg_acts_on_basis TEXT DEFAULT 'Устава',
  bank_account TEXT,
  bank_name TEXT,
  bank_code TEXT,
  phone TEXT,
  email TEXT,
  validation_status TEXT DEFAULT 'pending',
  validation_errors JSONB,
  validated_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_legal_details_profile ON public.client_legal_details(profile_id);
CREATE UNIQUE INDEX idx_client_legal_details_default ON public.client_legal_details(profile_id, is_default) WHERE is_default = true;

-- =============================================
-- Таблица сгенерированных документов
-- =============================================
CREATE TABLE public.generated_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders_v2(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  executor_id UUID,
  client_details_id UUID,
  document_type TEXT NOT NULL DEFAULT 'invoice_act',
  document_number TEXT NOT NULL,
  document_date DATE NOT NULL DEFAULT CURRENT_DATE,
  executor_snapshot JSONB NOT NULL,
  client_snapshot JSONB NOT NULL,
  order_snapshot JSONB NOT NULL,
  file_path TEXT,
  file_url TEXT,
  file_size INTEGER,
  status TEXT NOT NULL DEFAULT 'generated',
  error_message TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  sent_to_email TEXT,
  download_count INTEGER DEFAULT 0,
  last_downloaded_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_generated_documents_order ON public.generated_documents(order_id);
CREATE INDEX idx_generated_documents_profile ON public.generated_documents(profile_id);
CREATE INDEX idx_generated_documents_status ON public.generated_documents(status);

-- Add foreign keys after table creation
ALTER TABLE public.generated_documents 
  ADD CONSTRAINT fk_generated_documents_executor FOREIGN KEY (executor_id) REFERENCES public.executors(id),
  ADD CONSTRAINT fk_generated_documents_client_details FOREIGN KEY (client_details_id) REFERENCES public.client_legal_details(id);

-- =============================================
-- RLS Policies
-- =============================================
ALTER TABLE public.executors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_legal_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;

-- Executors policies
CREATE POLICY "Authenticated users can view active executors"
  ON public.executors FOR SELECT
  USING (auth.role() = 'authenticated' AND is_active = true);

CREATE POLICY "Admins can manage executors"
  ON public.executors FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles_v2 ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.code IN ('super_admin', 'admin')
    )
  );

-- Client Legal Details policies
CREATE POLICY "Users can view own legal details"
  ON public.client_legal_details FOR SELECT
  USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own legal details"
  ON public.client_legal_details FOR INSERT
  WITH CHECK (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own legal details"
  ON public.client_legal_details FOR UPDATE
  USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own legal details"
  ON public.client_legal_details FOR DELETE
  USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Admins can manage all legal details"
  ON public.client_legal_details FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles_v2 ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.code IN ('super_admin', 'admin')
    )
  );

-- Generated Documents policies
CREATE POLICY "Users can view own documents"
  ON public.generated_documents FOR SELECT
  USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Admins can manage all documents"
  ON public.generated_documents FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles_v2 ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.code IN ('super_admin', 'admin')
    )
  );

-- =============================================
-- Storage bucket для документов
-- =============================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documents', 'documents', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Users can view own document files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "System can upload document files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'documents');

-- =============================================
-- Triggers
-- =============================================
CREATE TRIGGER update_executors_updated_at
  BEFORE UPDATE ON public.executors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_client_legal_details_updated_at
  BEFORE UPDATE ON public.client_legal_details
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_generated_documents_updated_at
  BEFORE UPDATE ON public.generated_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- Предзаполнение АЖУР инкам
-- =============================================
INSERT INTO public.executors (
  legal_form, full_name, short_name, unp, legal_address,
  bank_account, bank_name, bank_code, phone, email,
  director_position, director_full_name, director_short_name,
  acts_on_basis, is_default
) VALUES (
  'legal_entity',
  'Закрытое акционерное общество "АЖУР инкам"',
  'ЗАО "АЖУР инкам"',
  '193405000',
  '220035, г. Минск, ул. Панфилова, 2, офис 49Л',
  'BY47ALFA30122C35190010270000',
  'ЗАО "Альфа-Банк"',
  'ALFABY2X',
  '+375 17 3456789',
  'info@ajur.by',
  'Директор',
  'Иванов Иван Иванович',
  'Иванов И.И.',
  'Устава',
  true
);