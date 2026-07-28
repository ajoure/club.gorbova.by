
UPDATE public.document_template_versions
SET storage_path = 'templates/1785215000000-otchet-v10-local.docx',
    file_sha256 = '044a31cc36e464eee39a19272e4f45ba710ec5907c16abaf869784f55a1eb32e',
    file_size_bytes = 41019,
    file_name = 'otchet-v10-local.docx',
    notes = COALESCE(notes,'') || E'\n[repack ' || now()::text || '] rebuilt locally from v9 source (sha a5dc6be1...); replaced header token {{pf-000032}} with {{pf-000032|format=long_ru}}; no metadata/token changes.'
WHERE id = '3aa13a52-7604-44f8-82bd-5ea8b595ee6d';
