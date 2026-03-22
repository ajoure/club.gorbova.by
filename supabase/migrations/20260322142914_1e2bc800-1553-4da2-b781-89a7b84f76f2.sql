-- PATCH 2.x: Validation trigger for role_type ↔ role_catalog_id consistency
-- Prevents desync where link.role_type differs from catalog.role_type

CREATE OR REPLACE FUNCTION public.validate_link_role_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_catalog_role_type TEXT;
BEGIN
  SELECT role_type INTO v_catalog_role_type
  FROM public.legal_details_roles_catalog
  WHERE id = NEW.role_catalog_id;

  IF v_catalog_role_type IS NULL THEN
    RAISE EXCEPTION 'role_catalog_id % not found in legal_details_roles_catalog', NEW.role_catalog_id;
  END IF;

  IF NEW.role_type <> v_catalog_role_type THEN
    RAISE EXCEPTION 'role_type mismatch: link.role_type=% but catalog.role_type=%',
      NEW.role_type, v_catalog_role_type;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_link_role_type
  BEFORE INSERT OR UPDATE ON public.legal_details_entity_person_links
  FOR EACH ROW EXECUTE FUNCTION public.validate_link_role_type();