-- Atomically validate, publish and version the complete Resolution 161 import.
DO $migration$
DECLARE
  v_prompt_count integer;
  v_document_id uuid;
  v_content_text text;
  v_structure jsonb;
  v_chunk_count integer;
  v_metadata jsonb := $metadata161${"source_regnum":"w21124359","source_snapshot_sha256":"ac7e28c93b6b3d1f029cec22593157d1624f9de9c7ffee1a811bd60e743b5f4b","source_extracted_at":"2026-07-29","consolidated_revision":"2017-04-10","source_rows":2248,"final_positions":1900,"footnotes":97,"internal_path":"/knowledge/laws/postanovlenie-minekonomiki-161-2011","resolution_161_import":{"expected_nodes":2349,"expected_batches":12,"state":"complete"}}$metadata161$::jsonb;
BEGIN
  SELECT id, structure
  INTO v_document_id, v_structure
  FROM public.legal_documents
  WHERE external_id = 'w21124359'
  LIMIT 1;

  IF v_document_id IS NULL OR jsonb_array_length(v_structure) <> 2349 THEN
    RAISE EXCEPTION 'Resolution 161 finalization requires exactly 2349 nodes';
  END IF;

  IF (
    SELECT count(DISTINCT node->>'id') FROM jsonb_array_elements(v_structure) node
  ) <> 2349 OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_structure) node
    WHERE node->>'id' = 'code-70034'
  ) THEN
    RAISE EXCEPTION 'Resolution 161 node ids or code-70034 failed validation';
  END IF;

  SELECT string_agg(node.value->>'text', E'\n\n' ORDER BY node.ordinality)
  INTO v_content_text
  FROM jsonb_array_elements(v_structure) WITH ORDINALITY AS node(value, ordinality);

  UPDATE public.legal_documents
  SET
    source = 'etalon',
    source_url = 'https://etalonline.by/document/?regnum=w21124359',
    search_query = 'постановление 161 нормативные сроки службы основных средств',
    title = $title161$Постановление Министерства экономики Республики Беларусь от 30 сентября 2011 г. №161 «Об установлении нормативных сроков службы основных средств и признании утратившими силу некоторых постановлений Министерства экономики Республики Беларусь»$title161$,
    doc_type = 'postanovlenie',
    doc_date = DATE '2011-09-30',
    doc_number = '161',
    category = 'acts',
    status = 'active',
    organ = 'Министерство экономики Республики Беларусь',
    effective_at = DATE '2012-01-01',
    revision_label = 'Консолидированная редакция с изменениями по 10.04.2017',
    content_text = v_content_text,
    structure = v_structure,
    checksum = 'ac7e28c93b6b3d1f029cec22593157d1624f9de9c7ffee1a811bd60e743b5f4b',
    metadata = v_metadata,
    is_published = true,
    last_synced_at = TIMESTAMPTZ '2026-07-29 00:00:00+00'
  WHERE id = v_document_id;

  SELECT count(*)
  INTO v_chunk_count
  FROM public.legal_document_search_chunks
  WHERE document_id = v_document_id;
  IF v_chunk_count <> 2349 OR NOT EXISTS (
    SELECT 1 FROM public.legal_document_search_chunks
    WHERE document_id = v_document_id AND anchor = 'code-70034'
  ) THEN
    RAISE EXCEPTION
      'Resolution 161 search chunk read-back expected 2349 plus code-70034, got %',
      v_chunk_count;
  END IF;

  UPDATE public.ai_user_prompts
  SET
    description = 'Гибридный подбор: ИИ определяет тип и назначение объекта, а шифр и нормативный срок выбираются только из внутренней базы законодательства по постановлению Министерства экономики Республики Беларусь № 161.',
    prompt_text = 'SYSTEM: identify the object type and traits only; select codes, legal names and normative lives exclusively from the verified internal Resolution No. 161 catalog.',
    input_hint = 'Опишите объект: наименование, модель, основное назначение, исполнение и ключевые характеристики.',
    launcher_description = 'ИИ распознаёт объект, затем сервис подбирает шифр и нормативный срок только по внутренней базе постановления № 161.'
  WHERE code = 'asset_classifier';
  GET DIAGNOSTICS v_prompt_count = ROW_COUNT;
  IF v_prompt_count <> 1 THEN
    RAISE EXCEPTION 'asset_classifier prompt expected 1 row, got %', v_prompt_count;
  END IF;

  UPDATE public.legal_document_versions
  SET is_current = false
  WHERE document_id = v_document_id AND is_current;

  INSERT INTO public.legal_document_versions (
    document_id, revision_key, revision_label, effective_at, content_text,
    structure, checksum, source_url, is_current
  )
  VALUES (
    v_document_id,
    '2017-04-10-etalon-w21124359',
    'Консолидированная редакция с изменениями по 10.04.2017',
    DATE '2012-01-01',
    v_content_text,
    v_structure,
    'ac7e28c93b6b3d1f029cec22593157d1624f9de9c7ffee1a811bd60e743b5f4b',
    'https://etalonline.by/document/?regnum=w21124359',
    true
  )
  ON CONFLICT (document_id, revision_key) DO UPDATE
  SET
    revision_label = EXCLUDED.revision_label,
    effective_at = EXCLUDED.effective_at,
    content_text = EXCLUDED.content_text,
    structure = EXCLUDED.structure,
    checksum = EXCLUDED.checksum,
    source_url = EXCLUDED.source_url,
    is_current = true;
END
$migration$;
