
-- 1) Switch FK from RESTRICT to CASCADE so removing a package item also clears its session values
ALTER TABLE public.document_package_session_field_values
  DROP CONSTRAINT document_package_session_field_va_package_template_item_id_fkey,
  ADD  CONSTRAINT document_package_session_field_va_package_template_item_id_fkey
    FOREIGN KEY (package_template_item_id)
    REFERENCES public.document_package_template_items(id)
    ON DELETE CASCADE;

-- 2) Simplify trigger: cascade now handles session values, no need to skip protected rows
CREATE OR REPLACE FUNCTION public.package_items_unbind_on_template_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    DELETE FROM public.document_package_template_items
    WHERE template_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- 3) Backfill: now succeeds for previously protected items
DELETE FROM public.document_package_template_items i
WHERE i.template_id IN (
  SELECT id FROM public.document_templates WHERE deleted_at IS NOT NULL
);
