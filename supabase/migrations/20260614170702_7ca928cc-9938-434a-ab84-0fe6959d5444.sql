
-- PATCH-PACKAGE-CUSTOM-FIELDS-V1: server-side auto-assign on new package item
CREATE OR REPLACE FUNCTION public.dpti_auto_assign_package_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.document_package_item_field_assignments
    (package_template_item_id, field_catalog_id, visibility_mode, is_active, sort_order)
  SELECT
    NEW.id,
    fc.id,
    'ask_client',
    TRUE,
    COALESCE(fc.sort_order, 100)
  FROM public.document_package_field_catalog fc
  WHERE fc.package_template_id = NEW.package_template_id
    AND fc.auto_assign_to_new_items = TRUE
    AND fc.is_active = TRUE
  ON CONFLICT (package_template_item_id, field_catalog_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dpti_auto_assign_fields ON public.document_package_template_items;
CREATE TRIGGER trg_dpti_auto_assign_fields
AFTER INSERT ON public.document_package_template_items
FOR EACH ROW EXECUTE FUNCTION public.dpti_auto_assign_package_fields();
