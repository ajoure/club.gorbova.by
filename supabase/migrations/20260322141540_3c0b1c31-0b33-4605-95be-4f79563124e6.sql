
-- ============================================================
-- PATCH 2: New tables + client_legal_details extension
-- ============================================================

-- 1. Extend client_legal_details
ALTER TABLE public.client_legal_details
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'billing',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE public.client_legal_details
  ADD CONSTRAINT chk_client_legal_details_purpose CHECK (purpose IN ('billing', 'document'));
ALTER TABLE public.client_legal_details
  ADD CONSTRAINT chk_client_legal_details_status CHECK (status IN ('active', 'archived'));

CREATE INDEX IF NOT EXISTS idx_cld_profile_purpose
  ON public.client_legal_details(profile_id, purpose);

-- 2. legal_details_persons
CREATE TABLE public.legal_details_persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  birth_date DATE,
  personal_number TEXT,
  passport_series TEXT,
  passport_number TEXT,
  passport_issued_by TEXT,
  passport_issued_date DATE,
  passport_valid_until DATE,
  phone TEXT,
  email TEXT,
  address_structured JSONB,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_persons_profile ON public.legal_details_persons(profile_id);
ALTER TABLE public.legal_details_persons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "persons_owner_select" ON public.legal_details_persons FOR SELECT TO authenticated
  USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));
CREATE POLICY "persons_owner_insert" ON public.legal_details_persons FOR INSERT TO authenticated
  WITH CHECK (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));
CREATE POLICY "persons_owner_update" ON public.legal_details_persons FOR UPDATE TO authenticated
  USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));
CREATE POLICY "persons_owner_delete" ON public.legal_details_persons FOR DELETE TO authenticated
  USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));
CREATE POLICY "persons_admin_all" ON public.legal_details_persons FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin', 'superadmin']::app_role[]));

-- 3. legal_details_roles_catalog
CREATE TABLE public.legal_details_roles_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_type TEXT NOT NULL CHECK (role_type IN ('founder', 'position', 'other')),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE public.legal_details_roles_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles_catalog_read" ON public.legal_details_roles_catalog FOR SELECT TO authenticated USING (true);
CREATE POLICY "roles_catalog_admin_manage" ON public.legal_details_roles_catalog FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin', 'superadmin']::app_role[]));

INSERT INTO public.legal_details_roles_catalog (role_type, code, label, sort_order) VALUES
  ('founder', 'founder', 'Учредитель', 1),
  ('position', 'position', 'Должностное лицо', 2),
  ('other', 'other', 'Другое', 3);

-- 4. legal_details_positions_catalog
CREATE TABLE public.legal_details_positions_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  country_scope TEXT DEFAULT 'BY',
  is_system BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0
);
ALTER TABLE public.legal_details_positions_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "positions_catalog_read" ON public.legal_details_positions_catalog FOR SELECT TO authenticated USING (true);
CREATE POLICY "positions_catalog_admin_manage" ON public.legal_details_positions_catalog FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin', 'superadmin']::app_role[]));

INSERT INTO public.legal_details_positions_catalog (code, label, sort_order) VALUES
  ('director', 'Директор', 1),
  ('chief_accountant', 'Главный бухгалтер', 2),
  ('deputy_director', 'Заместитель директора', 3),
  ('accountant', 'Бухгалтер', 4),
  ('secretary', 'Секретарь', 5);

-- 5. legal_details_entity_person_links
CREATE TABLE public.legal_details_entity_person_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  legal_details_id UUID NOT NULL REFERENCES public.client_legal_details(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES public.legal_details_persons(id) ON DELETE CASCADE,
  role_catalog_id UUID NOT NULL REFERENCES public.legal_details_roles_catalog(id),
  role_type TEXT NOT NULL CHECK (role_type IN ('founder', 'position', 'other')),
  position_catalog_id UUID REFERENCES public.legal_details_positions_catalog(id),
  custom_role_text TEXT,
  custom_position_text TEXT,
  share_percent NUMERIC(5,2),
  acts_on_basis TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  start_date DATE,
  end_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_share_percent_founder_only CHECK (share_percent IS NULL OR role_type = 'founder'),
  CONSTRAINT chk_position_catalog_position_only CHECK (position_catalog_id IS NULL OR role_type = 'position'),
  CONSTRAINT chk_custom_position_position_only CHECK (custom_position_text IS NULL OR role_type = 'position'),
  CONSTRAINT chk_custom_role_other_only CHECK (custom_role_text IS NULL OR role_type = 'other'),
  CONSTRAINT chk_position_exclusive CHECK (
    role_type != 'position'
    OR (position_catalog_id IS NOT NULL AND custom_position_text IS NULL)
    OR (position_catalog_id IS NULL AND custom_position_text IS NOT NULL)
  ),
  CONSTRAINT chk_other_has_text CHECK (role_type != 'other' OR custom_role_text IS NOT NULL)
);

CREATE INDEX idx_links_legal_details ON public.legal_details_entity_person_links(legal_details_id);
CREATE INDEX idx_links_person ON public.legal_details_entity_person_links(person_id);
CREATE INDEX idx_links_profile ON public.legal_details_entity_person_links(profile_id);

CREATE UNIQUE INDEX uq_link_founder
  ON public.legal_details_entity_person_links(legal_details_id, person_id, role_catalog_id)
  WHERE role_type = 'founder';
CREATE UNIQUE INDEX uq_link_position_catalog
  ON public.legal_details_entity_person_links(legal_details_id, person_id, role_catalog_id, position_catalog_id)
  WHERE role_type = 'position' AND position_catalog_id IS NOT NULL;
CREATE UNIQUE INDEX uq_link_position_custom
  ON public.legal_details_entity_person_links(legal_details_id, person_id, role_catalog_id, custom_position_text)
  WHERE role_type = 'position' AND position_catalog_id IS NULL AND custom_position_text IS NOT NULL;
CREATE UNIQUE INDEX uq_link_other
  ON public.legal_details_entity_person_links(legal_details_id, person_id, role_catalog_id, custom_role_text)
  WHERE role_type = 'other' AND custom_role_text IS NOT NULL;

ALTER TABLE public.legal_details_entity_person_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "links_owner_select" ON public.legal_details_entity_person_links FOR SELECT TO authenticated
  USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));
CREATE POLICY "links_owner_insert" ON public.legal_details_entity_person_links FOR INSERT TO authenticated
  WITH CHECK (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));
CREATE POLICY "links_owner_update" ON public.legal_details_entity_person_links FOR UPDATE TO authenticated
  USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));
CREATE POLICY "links_owner_delete" ON public.legal_details_entity_person_links FOR DELETE TO authenticated
  USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));
CREATE POLICY "links_admin_all" ON public.legal_details_entity_person_links FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin', 'superadmin']::app_role[]));

-- 6. ai_chat_messages
CREATE TABLE public.ai_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  attachments JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_chat_user ON public.ai_chat_messages(user_id);
CREATE INDEX idx_ai_chat_conversation ON public.ai_chat_messages(conversation_id, created_at);
ALTER TABLE public.ai_chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_chat_owner_select" ON public.ai_chat_messages FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "ai_chat_owner_insert" ON public.ai_chat_messages FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "ai_chat_admin_all" ON public.ai_chat_messages FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin', 'superadmin']::app_role[]));

-- Triggers
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_persons
  BEFORE UPDATE ON public.legal_details_persons
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER set_updated_at_links
  BEFORE UPDATE ON public.legal_details_entity_person_links
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
