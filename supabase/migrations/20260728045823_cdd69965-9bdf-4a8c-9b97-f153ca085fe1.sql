
WITH new_tokens AS (
  SELECT to_jsonb(ARRAY[
    'package.ul.FLD-000345','package.ip.FLD-000017','package.ul.FLD-000009','package.ip.FLD-000016',
    'pf-000016','pf-000015','ln-000018|format=full','field:FLD-000069','pf-000032|format=long_ru',
    'tableRepeat:TR-000001','pf-000025','pf-000017','pf-000026','pf-000018','pf-000019','pf-000027',
    'pf-000030','pf-000023','pf-000028','pf-000020','pf-000024','pf-000029','pf-000021',
    'tableTotal:TT-000001','tableTotal:TT-000001|format=words','tableTotal:TT-000002','tableTotal:TT-000003',
    'ln-000018|format=signature_short'
  ]::text[]) AS j
)
INSERT INTO public.document_template_versions (
  template_id, version_number, storage_bucket, storage_path, file_name, file_size_bytes, file_sha256,
  tokens, detected_tokens, token_manifest, is_current, validation_status, validation_errors,
  markup_status, notes, validation_checked_at
)
SELECT
  'b5ad9e1f-266f-4fdf-ad51-7aeadbfbd0a0'::uuid,
  10,
  'documents',
  'templates/1785214634682-otchet-v10.docx',
  'otchet-v10.docx',
  39615,
  '06b5afe2f680fea4d5576071221610a4c7ce8f55c57367d17e1492b4b1a34a74',
  j, j, j,
  false, 'valid', '[]'::jsonb, 'marked',
  'v10: header date switched to pf-000032|format=long_ru ("27 июля 2026 г."); no other changes vs v9',
  now()
FROM new_tokens;

UPDATE public.document_template_versions SET is_current = false
  WHERE template_id = 'b5ad9e1f-266f-4fdf-ad51-7aeadbfbd0a0' AND version_number <> 10;

UPDATE public.document_template_versions SET is_current = true
  WHERE template_id = 'b5ad9e1f-266f-4fdf-ad51-7aeadbfbd0a0' AND version_number = 10;

UPDATE public.document_templates
  SET current_version_id = (SELECT id FROM public.document_template_versions
                            WHERE template_id = 'b5ad9e1f-266f-4fdf-ad51-7aeadbfbd0a0' AND version_number = 10),
      updated_at = now()
  WHERE id = 'b5ad9e1f-266f-4fdf-ad51-7aeadbfbd0a0';
