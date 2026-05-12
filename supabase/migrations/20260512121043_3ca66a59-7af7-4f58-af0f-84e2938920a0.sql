-- Main smoke template
WITH t AS (
  INSERT INTO public.document_templates
    (name, code, description, document_type, template_path, template_status, template_scope, is_active, category, idempotency_scope)
  VALUES
    ('SMOKE TEST — плейсхолдеры документов',
     'smoke_test_placeholders_v1',
     'Internal smoke template для проверки канонического рендерера плейсхолдеров. Не для клиентов.',
     'service_act',
     'smoke/smoke-test-placeholders-v1.docx',
     'draft', 'internal', false, 'smoke', 'order')
  RETURNING id
),
v AS (
  INSERT INTO public.document_template_versions
    (template_id, version_number, storage_bucket, storage_path, file_name, file_size_bytes, file_sha256, is_current, validation_status, notes)
  SELECT t.id, 1, 'documents-templates', 'smoke/smoke-test-placeholders-v1.docx',
         'smoke_main.docx', 8968,
         'ccb3eb51d7d9021fb71d076318fc9c09d757922758b2469f959f3d24adcc33f2',
         true, 'pending', 'smoke v1 — only supported tokens'
  FROM t RETURNING id, template_id
)
UPDATE public.document_templates dt SET current_version_id = v.id
FROM v WHERE dt.id = v.template_id;

-- Negative smoke template (one unknown token)
WITH tn AS (
  INSERT INTO public.document_templates
    (name, code, description, document_type, template_path, template_status, template_scope, is_active, category, idempotency_scope)
  VALUES
    ('SMOKE TEST — плейсхолдеры документов (NEGATIVE)',
     'smoke_test_placeholders_negative_v1',
     'Internal smoke template — содержит один неизвестный токен payment.provider_transaction_id, чтобы проверить missing_tokens / unresolved_count. Не для клиентов.',
     'service_act',
     'smoke/smoke-test-placeholders-negative-v1.docx',
     'draft', 'internal', false, 'smoke', 'order')
  RETURNING id
),
vn AS (
  INSERT INTO public.document_template_versions
    (template_id, version_number, storage_bucket, storage_path, file_name, file_size_bytes, file_sha256, is_current, validation_status, notes)
  SELECT tn.id, 1, 'documents-templates', 'smoke/smoke-test-placeholders-negative-v1.docx',
         'smoke_negative.docx', 9073,
         '45fd07008f5fdad315ed465703fbde55418cec165ce4dc7650e6f08bd4ec58bd',
         true, 'pending', 'negative smoke — intentional unknown token'
  FROM tn RETURNING id, template_id
)
UPDATE public.document_templates dt SET current_version_id = vn.id
FROM vn WHERE dt.id = vn.template_id;

-- Temporarily enable canonical generation for smoke run
UPDATE public.app_settings SET value = 'true'::jsonb, updated_at = now()
WHERE key = 'documents_canonical_generation_enabled';