ALTER TABLE public.document_package_external_forms
  ADD COLUMN IF NOT EXISTS repeat_group_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.document_package_external_forms
  ADD CONSTRAINT dpe_forms_repeat_group_settings_object_chk
  CHECK (jsonb_typeof(repeat_group_settings) = 'object');

COMMENT ON COLUMN public.document_package_external_forms.repeat_group_settings IS
  'UI-managed labels, help text and optional MNS UNP lookup mapping for every repeat_group_key.';