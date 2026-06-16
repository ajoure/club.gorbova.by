-- PATCH-PACKAGE-CUSTOM-FIELDS V2: убираем авто-создание assignment-строк.
-- Привязка pf-полей к документу пакета теперь определяется токенами в DOCX,
-- а не записями в document_package_item_field_assignments.

DROP TRIGGER IF EXISTS trg_dpti_auto_assign_fields
  ON public.document_package_template_items;

DROP FUNCTION IF EXISTS public.dpti_auto_assign_package_fields();