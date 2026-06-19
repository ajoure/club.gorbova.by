
-- Stage A: PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1
-- Add generation_mode + repeat_role_catalog_id to document_package_template_items.

ALTER TABLE public.document_package_template_items
  ADD COLUMN IF NOT EXISTS generation_mode text NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS repeat_role_catalog_id uuid NULL
    REFERENCES public.document_package_role_catalog(id) ON DELETE RESTRICT;

ALTER TABLE public.document_package_template_items
  DROP CONSTRAINT IF EXISTS dpti_generation_mode_check;

ALTER TABLE public.document_package_template_items
  ADD CONSTRAINT dpti_generation_mode_check
    CHECK (generation_mode IN ('single','per_role_person'));

-- Trigger: cross-table consistency for generation_mode + repeat_role_catalog_id.
CREATE OR REPLACE FUNCTION public.dpti_assert_repeat_role_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_role_pkg uuid;
  v_role_active boolean;
BEGIN
  IF NEW.generation_mode = 'single' THEN
    IF NEW.repeat_role_catalog_id IS NOT NULL THEN
      RAISE EXCEPTION
        'dpti_repeat_role_must_be_null_in_single_mode: item=% mode=single repeat_role_catalog_id=%',
        NEW.id, NEW.repeat_role_catalog_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.generation_mode = 'per_role_person' THEN
    IF NEW.repeat_role_catalog_id IS NULL THEN
      RAISE EXCEPTION
        'dpti_repeat_role_required_in_per_role_person_mode: item=%',
        NEW.id
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT r.package_template_id, r.is_active
      INTO v_role_pkg, v_role_active
      FROM public.document_package_role_catalog r
      WHERE r.id = NEW.repeat_role_catalog_id;

    IF v_role_pkg IS NULL THEN
      RAISE EXCEPTION
        'dpti_repeat_role_not_found: role_catalog_id=%',
        NEW.repeat_role_catalog_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF v_role_pkg <> NEW.package_template_id THEN
      RAISE EXCEPTION
        'dpti_repeat_role_package_mismatch: item_pkg=% role_pkg=%',
        NEW.package_template_id, v_role_pkg
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_role_active IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION
        'dpti_repeat_role_inactive: role_catalog_id=%',
        NEW.repeat_role_catalog_id
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'dpti_unknown_generation_mode: %', NEW.generation_mode
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_dpti_assert_repeat_role_consistency
  ON public.document_package_template_items;

CREATE TRIGGER trg_dpti_assert_repeat_role_consistency
  BEFORE INSERT OR UPDATE OF generation_mode, repeat_role_catalog_id, package_template_id
  ON public.document_package_template_items
  FOR EACH ROW
  EXECUTE FUNCTION public.dpti_assert_repeat_role_consistency();

COMMENT ON COLUMN public.document_package_template_items.generation_mode IS
  'Sprint 3R/Stage A. ''single'' = один документ на item (default, legacy). ''per_role_person'' = по одному документу на каждого активного назначенца роли repeat_role_catalog_id (см. PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1).';

COMMENT ON COLUMN public.document_package_template_items.repeat_role_catalog_id IS
  'Sprint 3R/Stage A. Роль из document_package_role_catalog того же package_template_id, по активным назначениям которой раскрывается item при generation_mode=per_role_person. Обязателен при per_role_person, должен быть NULL при single (триггер dpti_assert_repeat_role_consistency).';
