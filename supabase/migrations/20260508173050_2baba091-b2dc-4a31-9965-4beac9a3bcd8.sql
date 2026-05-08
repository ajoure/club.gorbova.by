
ALTER TABLE public.document_template_versions
  DROP CONSTRAINT IF EXISTS document_template_versions_validation_status_check;

ALTER TABLE public.document_template_versions
  ADD CONSTRAINT document_template_versions_validation_status_check
  CHECK (
    validation_status IS NULL OR validation_status = ANY (ARRAY[
      'pending',
      'valid',
      'valid_with_warnings',
      'invalid',
      'invalid_unknown_required',
      'unchecked'
    ])
  );

ALTER TABLE public.document_template_versions
  ADD COLUMN IF NOT EXISTS markup_status text NOT NULL DEFAULT 'unmarked';

ALTER TABLE public.document_template_versions
  DROP CONSTRAINT IF EXISTS document_template_versions_markup_status_check;

ALTER TABLE public.document_template_versions
  ADD CONSTRAINT document_template_versions_markup_status_check
  CHECK (markup_status = ANY (ARRAY['unmarked', 'in_progress', 'marked']));
