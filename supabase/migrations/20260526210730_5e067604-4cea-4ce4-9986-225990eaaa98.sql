
-- Sprint 1: Persisted Package Session для пакетов документов («Идеология» как первый пакет)
-- Add-only; не трогаем fields_registry / document_token_registry / orders_v2 / billing resolver.

-- ============================================================
-- 1. Расширение document_package_templates под system-level seed
-- ============================================================
ALTER TABLE public.document_package_templates
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ALTER COLUMN profile_id DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.document_package_templates
    ADD CONSTRAINT document_package_templates_profile_or_system_chk
    CHECK ((is_system = true AND profile_id IS NULL) OR (is_system = false AND profile_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS document_package_templates_system_code_uidx
  ON public.document_package_templates (code) WHERE is_system = true AND code IS NOT NULL;

-- ============================================================
-- 2. document_package_role_catalog
-- ============================================================
CREATE TABLE IF NOT EXISTS public.document_package_role_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_template_id uuid NOT NULL REFERENCES public.document_package_templates(id) ON DELETE CASCADE,
  role_key text NOT NULL,
  label text NOT NULL,
  description text,
  allowed_entity_types text[] NOT NULL,
  required boolean NOT NULL DEFAULT false,
  min_count integer,
  max_count integer,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT document_package_role_catalog_unique UNIQUE (package_template_id, role_key)
);

GRANT SELECT ON public.document_package_role_catalog TO authenticated;
GRANT ALL ON public.document_package_role_catalog TO service_role;

ALTER TABLE public.document_package_role_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "role_catalog_select_authenticated"
  ON public.document_package_role_catalog FOR SELECT TO authenticated USING (is_active = true);

CREATE POLICY "role_catalog_admin_all"
  ON public.document_package_role_catalog FOR ALL TO authenticated
  USING (public.has_role_v2(auth.uid(), 'super_admin') OR public.has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'super_admin') OR public.has_role_v2(auth.uid(), 'admin'));

-- ============================================================
-- 3. document_package_sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.document_package_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_id uuid,
  package_template_id uuid NOT NULL REFERENCES public.document_package_templates(id) ON DELETE RESTRICT,
  order_id uuid,
  entitlement_id uuid,
  product_id uuid,
  tariff_id uuid,
  selected_legal_entity_id uuid REFERENCES public.client_legal_details(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','locked','archived')),
  legal_entity_locked_at timestamptz,
  legal_entity_locked_by_event text,
  unlocked_at timestamptz,
  unlocked_by uuid,
  unlock_reason text,
  first_generation_batch_id uuid,
  first_generated_document_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);

CREATE INDEX IF NOT EXISTS document_package_sessions_profile_idx ON public.document_package_sessions(profile_id);
CREATE INDEX IF NOT EXISTS document_package_sessions_template_idx ON public.document_package_sessions(package_template_id);
CREATE INDEX IF NOT EXISTS document_package_sessions_entitlement_idx ON public.document_package_sessions(entitlement_id) WHERE entitlement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS document_package_sessions_order_idx ON public.document_package_sessions(order_id) WHERE order_id IS NOT NULL;

-- Uniqueness (priority 1): per entitlement
CREATE UNIQUE INDEX IF NOT EXISTS document_package_sessions_entitlement_uidx
  ON public.document_package_sessions(profile_id, package_template_id, entitlement_id)
  WHERE entitlement_id IS NOT NULL AND status <> 'archived';

-- Uniqueness (priority 2): per order
CREATE UNIQUE INDEX IF NOT EXISTS document_package_sessions_order_uidx
  ON public.document_package_sessions(profile_id, package_template_id, order_id)
  WHERE order_id IS NOT NULL AND entitlement_id IS NULL AND status <> 'archived';

-- Uniqueness (temporary fallback): per profile+template, ТОЛЬКО когда нет access-binding (technical debt)
CREATE UNIQUE INDEX IF NOT EXISTS document_package_sessions_profile_template_uidx
  ON public.document_package_sessions(profile_id, package_template_id)
  WHERE status <> 'archived' AND entitlement_id IS NULL AND order_id IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_package_sessions TO authenticated;
GRANT ALL ON public.document_package_sessions TO service_role;

ALTER TABLE public.document_package_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions_select_own"
  ON public.document_package_sessions FOR SELECT TO authenticated
  USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "sessions_insert_own"
  ON public.document_package_sessions FOR INSERT TO authenticated
  WITH CHECK (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "sessions_update_own_unlocked"
  ON public.document_package_sessions FOR UPDATE TO authenticated
  USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()))
  WITH CHECK (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "sessions_delete_own_draft"
  ON public.document_package_sessions FOR DELETE TO authenticated
  USING (
    profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND status = 'draft'
  );

CREATE POLICY "sessions_admin_all"
  ON public.document_package_sessions FOR ALL TO authenticated
  USING (public.has_role_v2(auth.uid(), 'super_admin') OR public.has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'super_admin') OR public.has_role_v2(auth.uid(), 'admin'));

-- Trigger: запрет UPDATE selected_legal_entity_id, если legal_entity_locked_at IS NOT NULL (только не-админам)
CREATE OR REPLACE FUNCTION public.document_package_sessions_lock_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.legal_entity_locked_at IS NOT NULL
     AND NEW.selected_legal_entity_id IS DISTINCT FROM OLD.selected_legal_entity_id
     AND NOT (public.has_role_v2(auth.uid(), 'super_admin') OR public.has_role_v2(auth.uid(), 'admin'))
  THEN
    RAISE EXCEPTION 'package_session_locked: legal entity locked at %, change forbidden', OLD.legal_entity_locked_at
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS document_package_sessions_lock_guard_trg ON public.document_package_sessions;
CREATE TRIGGER document_package_sessions_lock_guard_trg
  BEFORE UPDATE ON public.document_package_sessions
  FOR EACH ROW EXECUTE FUNCTION public.document_package_sessions_lock_guard();

-- ============================================================
-- 4. document_package_session_participants
-- ============================================================
CREATE TABLE IF NOT EXISTS public.document_package_session_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_session_id uuid NOT NULL REFERENCES public.document_package_sessions(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('legal_entity','entrepreneur','person')),
  legal_entity_id uuid REFERENCES public.client_legal_details(id) ON DELETE CASCADE,
  person_id uuid REFERENCES public.legal_details_persons(id) ON DELETE CASCADE,
  role_key text NOT NULL,
  role_catalog_id uuid REFERENCES public.document_package_role_catalog(id) ON DELETE SET NULL,
  is_required boolean NOT NULL DEFAULT false,
  is_primary boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT participants_entity_id_chk CHECK (
    (entity_type = 'person' AND person_id IS NOT NULL AND legal_entity_id IS NULL)
    OR (entity_type IN ('legal_entity','entrepreneur') AND legal_entity_id IS NOT NULL AND person_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS participants_session_person_role_uidx
  ON public.document_package_session_participants(package_session_id, role_key, person_id)
  WHERE person_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS participants_session_legal_role_uidx
  ON public.document_package_session_participants(package_session_id, role_key, legal_entity_id)
  WHERE legal_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS participants_session_idx ON public.document_package_session_participants(package_session_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_package_session_participants TO authenticated;
GRANT ALL ON public.document_package_session_participants TO service_role;

ALTER TABLE public.document_package_session_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "participants_select_own"
  ON public.document_package_session_participants FOR SELECT TO authenticated
  USING (
    package_session_id IN (
      SELECT id FROM public.document_package_sessions
      WHERE profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "participants_insert_own"
  ON public.document_package_session_participants FOR INSERT TO authenticated
  WITH CHECK (
    package_session_id IN (
      SELECT id FROM public.document_package_sessions
      WHERE profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    )
    AND (
      person_id IS NULL OR person_id IN (
        SELECT p.id FROM public.legal_details_persons p
        WHERE p.profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      )
    )
    AND (
      legal_entity_id IS NULL OR legal_entity_id IN (
        SELECT l.id FROM public.client_legal_details l
        WHERE l.profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      )
    )
  );

CREATE POLICY "participants_update_own"
  ON public.document_package_session_participants FOR UPDATE TO authenticated
  USING (
    package_session_id IN (
      SELECT id FROM public.document_package_sessions
      WHERE profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "participants_delete_own"
  ON public.document_package_session_participants FOR DELETE TO authenticated
  USING (
    package_session_id IN (
      SELECT id FROM public.document_package_sessions
      WHERE profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "participants_admin_all"
  ON public.document_package_session_participants FOR ALL TO authenticated
  USING (public.has_role_v2(auth.uid(), 'super_admin') OR public.has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'super_admin') OR public.has_role_v2(auth.uid(), 'admin'));

-- ============================================================
-- 5. Admin unlock RPC (audit-logged)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_unlock_package_session(
  p_session_id uuid,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_old_legal_entity uuid;
BEGIN
  IF NOT (public.has_role_v2(v_caller, 'super_admin') OR public.has_role_v2(v_caller, 'admin')) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'reason required (min 5 chars)';
  END IF;

  SELECT selected_legal_entity_id INTO v_old_legal_entity
  FROM public.document_package_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found'; END IF;

  UPDATE public.document_package_sessions
  SET legal_entity_locked_at = NULL,
      legal_entity_locked_by_event = NULL,
      unlocked_at = now(),
      unlocked_by = v_caller,
      unlock_reason = p_reason,
      status = CASE WHEN status = 'locked' THEN 'ready' ELSE status END,
      updated_at = now(),
      updated_by = v_caller
  WHERE id = p_session_id;

  INSERT INTO public.audit_logs (action, entity_type, entity_id, actor_id, payload)
  VALUES (
    'document_package.legal_entity_unlocked',
    'document_package_session',
    p_session_id,
    v_caller,
    jsonb_build_object('reason', p_reason, 'old_legal_entity_id', v_old_legal_entity)
  );

  RETURN p_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_unlock_package_session(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_unlock_package_session(uuid, text) TO authenticated;

-- ============================================================
-- 6. Seed «Идеология» (idempotent)
-- ============================================================
DO $$
DECLARE v_pkg_id uuid;
BEGIN
  SELECT id INTO v_pkg_id FROM public.document_package_templates
  WHERE is_system = true AND code = 'ideology' LIMIT 1;

  IF v_pkg_id IS NULL THEN
    INSERT INTO public.document_package_templates (id, profile_id, name, description, is_active, is_system, code)
    VALUES (gen_random_uuid(), NULL, 'Идеология',
      'Системный пакет идеологической работы в организации: приказ, положение, годовой план.',
      true, true, 'ideology')
    RETURNING id INTO v_pkg_id;
  END IF;

  -- Roles
  INSERT INTO public.document_package_role_catalog
    (package_template_id, role_key, label, description, allowed_entity_types, required, min_count, max_count, sort_order)
  VALUES
    (v_pkg_id, 'package_company', 'Организация пакета', 'Юрлицо/ИП, для которого формируется пакет.', ARRAY['legal_entity','entrepreneur'], true, 1, 1, 10),
    (v_pkg_id, 'company_head', 'Руководитель организации', 'Утверждает приказ, положение, годовой план.', ARRAY['person'], true, 1, 1, 20),
    (v_pkg_id, 'ideology_responsible', 'Ответственный за идеологическую работу', 'Координатор; разрабатывает план, ведёт документацию.', ARRAY['person'], true, 1, 1, 30),
    (v_pkg_id, 'document_signer', 'Подписант документов', 'Если отличается от руководителя.', ARRAY['person'], false, 0, 1, 40),
    (v_pkg_id, 'document_preparer', 'Составитель документов', 'Готовит проекты документов.', ARRAY['person'], false, 0, 1, 50),
    (v_pkg_id, 'control_person', 'Контролирующее лицо', 'Контроль исполнения приказа.', ARRAY['person'], false, 0, 1, 60),
    (v_pkg_id, 'ideology_active_member', 'Член идеологического актива', 'Состав актива организации.', ARRAY['person'], false, 0, NULL, 70),
    (v_pkg_id, 'ideology_participant', 'Участник мероприятий', 'Участники мероприятий годового плана.', ARRAY['person'], false, 0, NULL, 80),
    (v_pkg_id, 'notified_person', 'Ознакомленное лицо', 'Лица, ознакомленные с приказом/положением.', ARRAY['person'], false, 0, NULL, 90),
    (v_pkg_id, 'report_participant', 'Участник отчёта', 'Участник мероприятия для отчёта.', ARRAY['person'], false, 0, NULL, 100),
    (v_pkg_id, 'external_specialist', 'Внешний специалист/организация', 'Привлекается по договору (UI deferred до Sprint 2).', ARRAY['legal_entity','entrepreneur','person'], false, 0, NULL, 110)
  ON CONFLICT (package_template_id, role_key) DO NOTHING;
END $$;
