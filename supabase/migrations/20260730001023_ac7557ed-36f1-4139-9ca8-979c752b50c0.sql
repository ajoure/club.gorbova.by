-- Stage Resolution 161 as unpublished content before managed batch import.
DO $migration$
DECLARE
  v_existing_document_count integer;
  v_document_id uuid;
  v_existing_checksum text;
  v_metadata jsonb := $metadata161${"source_regnum":"w21124359","source_snapshot_sha256":"ac7e28c93b6b3d1f029cec22593157d1624f9de9c7ffee1a811bd60e743b5f4b","source_extracted_at":"2026-07-29","consolidated_revision":"2017-04-10","source_rows":2248,"final_positions":1900,"footnotes":97,"internal_path":"/knowledge/laws/postanovlenie-minekonomiki-161-2011","resolution_161_import":{"expected_nodes":2349,"expected_batches":12,"applied_batches":[],"state":"staging"}}$metadata161$::jsonb;
BEGIN
  SELECT count(*)
  INTO v_existing_document_count
  FROM public.legal_documents
  WHERE external_id = 'w21124359';

  IF v_existing_document_count > 1 THEN
    RAISE EXCEPTION
      'Resolution 161 expected at most 1 legal_documents row, got %',
      v_existing_document_count;
  END IF;

  SELECT id, checksum
  INTO v_document_id, v_existing_checksum
  FROM public.legal_documents
  WHERE external_id = 'w21124359'
  LIMIT 1;

  IF v_existing_checksum IS NOT NULL
     AND v_existing_checksum <> 'ac7e28c93b6b3d1f029cec22593157d1624f9de9c7ffee1a811bd60e743b5f4b' THEN
    RAISE EXCEPTION
      'Resolution 161 already exists with another checksum; manual review required';
  END IF;

  IF v_document_id IS NULL THEN
    INSERT INTO public.legal_documents (
      external_id,
      slug,
      source,
      source_url,
      search_query,
      title,
      doc_type,
      doc_date,
      doc_number,
      category,
      status,
      organ,
      effective_at,
      revision_label,
      content_text,
      structure,
      checksum,
      metadata,
      is_published,
      last_synced_at
    )
    VALUES (
      'w21124359',
      'postanovlenie-minekonomiki-161-2011',
      'etalon',
      'https://etalonline.by/document/?regnum=w21124359',
      'постановление 161 нормативные сроки службы основных средств',
      $title161$Постановление Министерства экономики Республики Беларусь от 30 сентября 2011 г. №161 «Об установлении нормативных сроков службы основных средств и признании утратившими силу некоторых постановлений Министерства экономики Республики Беларусь»$title161$,
      'postanovlenie',
      DATE '2011-09-30',
      '161',
      'acts',
      'active',
      'Министерство экономики Республики Беларусь',
      DATE '2012-01-01',
      'Консолидированная редакция с изменениями по 10.04.2017',
      NULL,
      '[]'::jsonb,
      NULL,
      v_metadata,
      false,
      TIMESTAMPTZ '2026-07-29 00:00:00+00'
    )
    RETURNING id INTO v_document_id;
  ELSE
    IF v_existing_checksum = 'ac7e28c93b6b3d1f029cec22593157d1624f9de9c7ffee1a811bd60e743b5f4b'
       AND jsonb_array_length(COALESCE(
         (SELECT structure FROM public.legal_documents WHERE id = v_document_id),
         '[]'::jsonb
       )) = 2349 THEN
      RETURN;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.legal_documents
      WHERE id = v_document_id AND is_published
    ) THEN
      RAISE EXCEPTION 'Resolution 161 partial import cannot overwrite published content';
    END IF;
  END IF;
END
$migration$;