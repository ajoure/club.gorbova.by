-- Presentation and lookup rules of a repeatable public-form block are package
-- configuration, not application code.  An administrator chooses the fields
-- from the package catalog in the UI; the opaque public link exposes only
-- those choices for its own active form.
ALTER TABLE public.document_package_external_forms
  ADD COLUMN IF NOT EXISTS repeat_group_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.document_package_external_forms
  ADD CONSTRAINT dpe_forms_repeat_group_settings_object_chk
  CHECK (jsonb_typeof(repeat_group_settings) = 'object');

COMMENT ON COLUMN public.document_package_external_forms.repeat_group_settings IS
  'UI-managed labels, help text and optional MNS UNP lookup mapping for every repeat_group_key.';
