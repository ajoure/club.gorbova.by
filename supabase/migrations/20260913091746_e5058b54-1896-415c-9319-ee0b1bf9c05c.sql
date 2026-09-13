-- Existing submissions remain untouched. New attempts are claimed atomically.
ALTER TABLE public.document_package_external_submissions
  ADD COLUMN request_id uuid,
  ADD COLUMN request_fingerprint text;
CREATE UNIQUE INDEX document_external_submission_request_unique
  ON public.document_package_external_submissions (external_link_id, request_id)
  WHERE request_id IS NOT NULL;
ALTER TABLE public.document_package_external_submissions
  ADD CONSTRAINT document_external_submission_fingerprint_check
  CHECK (request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$');