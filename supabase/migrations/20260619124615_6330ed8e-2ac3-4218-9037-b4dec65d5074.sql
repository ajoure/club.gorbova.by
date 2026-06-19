
-- Auto-unbind package items when underlying document_templates is soft-deleted
CREATE OR REPLACE FUNCTION public.package_items_unbind_on_template_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    DELETE FROM public.document_package_template_items i
    WHERE i.template_id = NEW.id
      AND NOT EXISTS (
        SELECT 1 FROM public.document_package_session_field_values v
        WHERE v.package_template_item_id = i.id
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_package_items_unbind_on_template_soft_delete ON public.document_templates;
CREATE TRIGGER trg_package_items_unbind_on_template_soft_delete
AFTER UPDATE OF deleted_at ON public.document_templates
FOR EACH ROW
EXECUTE FUNCTION public.package_items_unbind_on_template_soft_delete();

-- One-time backfill: remove existing package items that reference already-soft-deleted templates
-- (skip those protected by historical session field values)
DELETE FROM public.document_package_template_items i
WHERE i.template_id IN (
  SELECT id FROM public.document_templates WHERE deleted_at IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1 FROM public.document_package_session_field_values v
  WHERE v.package_template_item_id = i.id
);
