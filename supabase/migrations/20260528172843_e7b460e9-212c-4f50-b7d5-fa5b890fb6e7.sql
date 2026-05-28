-- =====================================================================
-- Sprint 3F Phase 2: role-catalog guards, audit triggers, bind RPCs
-- =====================================================================

-- ---------------------------------------------------------------
-- 1. Guard trigger on document_package_role_catalog
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_package_role_catalog_mutations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system = true THEN
      RAISE EXCEPTION 'Системную роль пакета (% / %) нельзя удалять. Используйте архивацию (is_active=false).',
        OLD.public_id, OLD.role_key
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- public_id is immutable for everyone
    IF NEW.public_id IS DISTINCT FROM OLD.public_id THEN
      RAISE EXCEPTION 'public_id роли пакета (% → %) нельзя менять — это стабильный идентификатор для DOCX токенов.',
        OLD.public_id, NEW.public_id
        USING ERRCODE = '42501';
    END IF;
    IF NEW.package_template_id IS DISTINCT FROM OLD.package_template_id THEN
      RAISE EXCEPTION 'package_template_id роли (%) менять запрещено — роль привязана к конкретному пакету.',
        OLD.public_id
        USING ERRCODE = '42501';
    END IF;

    IF OLD.is_system = true THEN
      IF NEW.role_key IS DISTINCT FROM OLD.role_key THEN
        RAISE EXCEPTION 'role_key системной роли (%) нельзя менять — нарушит существующих участников.',
          OLD.public_id
          USING ERRCODE = '42501';
      END IF;
      IF NEW.is_system IS DISTINCT FROM OLD.is_system THEN
        RAISE EXCEPTION 'Признак is_system системной роли (%) менять запрещено.',
          OLD.public_id
          USING ERRCODE = '42501';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_package_role_catalog_mutations
  ON public.document_package_role_catalog;
CREATE TRIGGER trg_guard_package_role_catalog_mutations
  BEFORE UPDATE OR DELETE ON public.document_package_role_catalog
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_package_role_catalog_mutations();

-- ---------------------------------------------------------------
-- 2. Audit trigger on document_package_role_catalog
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_package_role_catalog_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_action text;
  v_target_id uuid;
  v_meta jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'package_role_created';
    v_target_id := NEW.id;
    v_meta := jsonb_build_object(
      'public_id', NEW.public_id,
      'role_key', NEW.role_key,
      'label', NEW.label,
      'package_template_id', NEW.package_template_id,
      'is_system', NEW.is_system,
      'is_active', NEW.is_active
    );
  ELSIF TG_OP = 'UPDATE' THEN
    -- archive event takes priority
    IF OLD.is_active = true AND NEW.is_active = false THEN
      v_action := 'package_role_archived';
    ELSIF OLD.is_active = false AND NEW.is_active = true THEN
      v_action := 'package_role_restored';
    ELSE
      v_action := 'package_role_updated';
    END IF;
    v_target_id := NEW.id;
    v_meta := jsonb_build_object(
      'public_id', NEW.public_id,
      'role_key', NEW.role_key,
      'package_template_id', NEW.package_template_id,
      'is_system', NEW.is_system,
      'changes', jsonb_build_object(
        'label',           jsonb_build_array(OLD.label, NEW.label),
        'description',     jsonb_build_array(OLD.description, NEW.description),
        'is_active',       jsonb_build_array(OLD.is_active, NEW.is_active),
        'required',        jsonb_build_array(OLD.required, NEW.required),
        'min_count',       jsonb_build_array(OLD.min_count, NEW.min_count),
        'max_count',       jsonb_build_array(OLD.max_count, NEW.max_count),
        'sort_order',      jsonb_build_array(OLD.sort_order, NEW.sort_order),
        'output_template', jsonb_build_array(OLD.output_template, NEW.output_template)
      )
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'package_role_deleted';
    v_target_id := OLD.id;
    v_meta := jsonb_build_object(
      'public_id', OLD.public_id,
      'role_key', OLD.role_key,
      'package_template_id', OLD.package_template_id
    );
  END IF;

  INSERT INTO public.audit_logs (actor_user_id, actor_type, action, meta, created_at)
  VALUES (
    v_actor,
    CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END,
    v_action,
    v_meta || jsonb_build_object('row_id', v_target_id),
    now()
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_package_role_catalog
  ON public.document_package_role_catalog;
CREATE TRIGGER trg_audit_package_role_catalog
  AFTER INSERT OR UPDATE OR DELETE ON public.document_package_role_catalog
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_package_role_catalog_change();

-- ---------------------------------------------------------------
-- 3. Audit trigger on document_package_template_items
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_package_template_items_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (actor_user_id, actor_type, action, meta, created_at)
    VALUES (
      v_actor,
      CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END,
      'package_template_item_linked',
      jsonb_build_object(
        'row_id', NEW.id,
        'package_template_id', NEW.package_template_id,
        'template_id', NEW.template_id,
        'sort_order', NEW.sort_order
      ),
      now()
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (actor_user_id, actor_type, action, meta, created_at)
    VALUES (
      v_actor,
      CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END,
      'package_template_item_unlinked',
      jsonb_build_object(
        'row_id', OLD.id,
        'package_template_id', OLD.package_template_id,
        'template_id', OLD.template_id
      ),
      now()
    );
    RETURN OLD;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_package_template_items
  ON public.document_package_template_items;
CREATE TRIGGER trg_audit_package_template_items
  AFTER INSERT OR DELETE ON public.document_package_template_items
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_package_template_items_change();

-- ---------------------------------------------------------------
-- 4. Admin-only RPC: bind template to package
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.package_template_bind_template(
  _template_id uuid,
  _package_template_id uuid,
  _sort_order integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_item_id uuid;
  v_max_sort integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Не авторизован' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role_v2(v_actor, 'super_admin') OR public.has_role_v2(v_actor, 'admin')) THEN
    RAISE EXCEPTION 'Привязка шаблонов к пакетам доступна только администраторам.' USING ERRCODE = '42501';
  END IF;

  -- Validate template exists and not deleted
  IF NOT EXISTS (SELECT 1 FROM public.document_templates WHERE id = _template_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Шаблон не найден или удалён.' USING ERRCODE = 'P0002';
  END IF;
  -- Validate package exists
  IF NOT EXISTS (SELECT 1 FROM public.document_package_templates WHERE id = _package_template_id) THEN
    RAISE EXCEPTION 'Пакет не найден.' USING ERRCODE = 'P0002';
  END IF;

  -- Compute sort_order if not provided
  IF _sort_order IS NULL THEN
    SELECT COALESCE(MAX(sort_order), -1) + 1
      INTO v_max_sort
      FROM public.document_package_template_items
     WHERE package_template_id = _package_template_id;
  ELSE
    v_max_sort := _sort_order;
  END IF;

  -- Upsert link
  INSERT INTO public.document_package_template_items (
    package_template_id, template_id, sort_order, is_required
  )
  VALUES (_package_template_id, _template_id, v_max_sort, true)
  ON CONFLICT (package_template_id, template_id)
    DO UPDATE SET sort_order = EXCLUDED.sort_order
  RETURNING id INTO v_item_id;

  -- Update denormalized template_scope hint
  UPDATE public.document_templates
     SET template_scope = 'package', updated_at = now()
   WHERE id = _template_id AND template_scope IS DISTINCT FROM 'package';

  RETURN v_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.package_template_bind_template(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.package_template_bind_template(uuid, uuid, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------
-- 5. Admin-only RPC: unbind template from package(s)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.package_template_unbind_template(
  _template_id uuid,
  _package_template_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_removed integer := 0;
  v_remaining integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Не авторизован' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role_v2(v_actor, 'super_admin') OR public.has_role_v2(v_actor, 'admin')) THEN
    RAISE EXCEPTION 'Отвязка шаблонов от пакетов доступна только администраторам.' USING ERRCODE = '42501';
  END IF;

  IF _package_template_id IS NULL THEN
    DELETE FROM public.document_package_template_items
     WHERE template_id = _template_id;
    GET DIAGNOSTICS v_removed = ROW_COUNT;
  ELSE
    DELETE FROM public.document_package_template_items
     WHERE template_id = _template_id
       AND package_template_id = _package_template_id;
    GET DIAGNOSTICS v_removed = ROW_COUNT;
  END IF;

  SELECT count(*) INTO v_remaining
    FROM public.document_package_template_items
   WHERE template_id = _template_id;

  IF v_remaining = 0 THEN
    UPDATE public.document_templates
       SET template_scope = 'billing', updated_at = now()
     WHERE id = _template_id AND template_scope = 'package';
  END IF;

  RETURN v_removed;
END;
$$;

REVOKE ALL ON FUNCTION public.package_template_unbind_template(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.package_template_unbind_template(uuid, uuid) TO authenticated, service_role;
