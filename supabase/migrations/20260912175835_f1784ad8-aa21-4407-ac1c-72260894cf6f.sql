-- Optional reviewed short replies. No data edits, activation or quality promotion.
CREATE OR REPLACE FUNCTION public.sales_check_knowledge_facts(p_campaign uuid,p_facts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.sales_campaigns; f jsonb; output jsonb:='[]'; errors jsonb:='[]';
 seen text[]:='{}'; ident text; scope text; source_uuid uuid; target_id uuid;
 t record; b record; target record; reason text; normalized jsonb;
BEGIN
 SELECT * INTO p FROM public.sales_campaigns WHERE id=p_campaign;
 IF NOT FOUND THEN RAISE EXCEPTION 'campaign_missing'; END IF;
 IF p_facts IS NULL OR jsonb_typeof(p_facts)<>'array' OR jsonb_array_length(p_facts)>100
   OR octet_length(p_facts::text)>250000 THEN RAISE EXCEPTION 'invalid_facts_array'; END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p_facts) LOOP
  reason:=NULL; ident:=f->>'id'; scope:=coalesce(f->>'scope','curriculum');
  IF jsonb_typeof(f)<>'object' OR ident IS NULL OR ident !~ '^[A-Za-z0-9_-]{1,100}$'
    OR ident=ANY(seen) THEN reason:='invalid_or_duplicate_id';
  ELSIF scope NOT IN ('curriculum','background') THEN reason:='invalid_scope';
  ELSIF jsonb_typeof(f->'text') IS DISTINCT FROM 'string' OR length(btrim(f->>'text')) NOT BETWEEN 1 AND 600
    OR (f->>'text') ~* '(https?://|www\.|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|[<>]|[+][0-9][0-9 ()-]{8,}|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.)'
    OR (f->>'text') ~ '[[:cntrl:]]' THEN reason:='invalid_summary_text';
  ELSIF f ? 'reply_text' AND (scope='background'
    OR jsonb_typeof(f->'reply_text') IS DISTINCT FROM 'string'
    OR length(btrim(f->>'reply_text')) NOT BETWEEN 1 AND 200
    OR (f->>'reply_text') ~* '(https?://|www\.|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|[<>?？؟]|[+][0-9][0-9 ()-]{8,}|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.)'
    OR (f->>'reply_text') ~ '[[:cntrl:]]') THEN reason:='invalid_short_reply';
  ELSIF coalesce(length(f->>'title'),0)>120 OR coalesce(f->>'title','') ~ '[<>[:cntrl:]]' THEN reason:='invalid_title';
  ELSIF coalesce(f->>'source_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR coalesce(f->>'source_revision','') !~ '^[a-f0-9]{64}$'
    OR coalesce(f->>'source_sha256','') !~ '^[a-f0-9]{64}$' THEN reason:='invalid_source_reference'; END IF;
  IF reason IS NULL THEN
   source_uuid:=(f->>'source_id')::uuid;
   SELECT s.enabled,s.source_revision,s.provider,s.video_id,
     ct.content_sha256,ct.source_revision transcript_revision,ct.quality_status
    INTO t FROM public.course_transcription_sources s
    JOIN public.course_transcripts ct ON ct.source_id=s.id WHERE s.id=source_uuid;
   IF NOT FOUND OR NOT t.enabled OR t.provider<>'kinescope' OR t.quality_status='rejected'
     OR t.source_revision IS DISTINCT FROM f->>'source_revision'
     OR t.transcript_revision IS DISTINCT FROM t.source_revision
     OR t.content_sha256 IS DISTINCT FROM f->>'source_sha256' THEN reason:='source_unavailable_or_stale';
   ELSIF EXISTS(SELECT 1 FROM public.course_caption_gap_audits a WHERE a.source_id=source_uuid
     AND a.source_revision=t.source_revision AND a.status IN ('pending','review_required')) THEN reason:='source_gap_unresolved'; END IF;
  END IF;
  IF reason IS NULL THEN
   -- A source binding must still describe the same existing video block.
   SELECT cb.block_id,cb.lesson_id,lb.updated_at,lb.content,lb.block_type
    INTO b FROM public.course_transcription_bindings cb
    JOIN public.lesson_blocks lb ON lb.id=cb.block_id AND lb.lesson_id=cb.lesson_id
    JOIN public.training_lessons l ON l.id=cb.lesson_id
    JOIN public.training_modules m ON m.id=l.module_id AND m.product_id=cb.product_id
    WHERE cb.source_id=source_uuid AND cb.block_updated_at=lb.updated_at AND lb.block_type='video'
    ORDER BY cb.block_id LIMIT 1;
   IF NOT FOUND THEN reason:='source_binding_stale'; END IF;
  END IF;
  IF reason IS NULL AND scope='curriculum' THEN
   IF coalesce(f->>'binding_block_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR coalesce(f->>'module_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN reason:='target_reference_required';
   ELSE
    target_id:=(f->>'binding_block_id')::uuid;
    SELECT lb.id,lb.lesson_id,lb.updated_at,lb.content,m.id module_id,m.is_active
     INTO target FROM public.lesson_blocks lb
     JOIN public.training_lessons l ON l.id=lb.lesson_id
     JOIN public.training_modules m ON m.id=l.module_id
     WHERE lb.id=target_id AND lb.block_type='video' AND m.id=(f->>'module_id')::uuid
      AND m.product_id=p.product_id AND m.parent_module_id=(p.knowledge->>'root_module_id')::uuid;
    IF NOT FOUND THEN reason:='target_outside_curriculum';
    ELSIF coalesce(b.content->>'url','')='' OR (target.content->>'url') IS DISTINCT FROM (b.content->>'url')
      OR coalesce(target.content->>'provider','') IS DISTINCT FROM coalesce(b.content->>'provider','')
      THEN reason:='target_video_not_verified'; END IF;
   END IF;
  END IF;
  IF reason IS NOT NULL THEN
   errors:=errors||jsonb_build_array(jsonb_build_object('fact_id',CASE WHEN length(ident)<=100 THEN ident END,'reason',reason));
   CONTINUE;
  END IF;
  seen:=array_append(seen,ident);
  normalized:=jsonb_build_object('id',ident,'title',coalesce(nullif(btrim(f->>'title'),''),ident),
    'text',btrim(f->>'text'),'scope',scope,'classification','sales_safe',
    'source','course_transcripts:'||source_uuid::text,'source_id',source_uuid,
    'source_revision',t.source_revision,'source_sha256',t.content_sha256,
    'text_sha256',encode(sha256(convert_to(btrim(f->>'text'),'UTF8')),'hex'),
    'source_binding_block_id',b.block_id,'source_binding_updated_at',b.updated_at,
    'review_scope','editorial_sales_summary');
  -- Missing key must preserve every byte of the legacy normalized object/hash.
  -- No default empty key: legacy snapshots remain readable and verifiable.
  IF f ? 'reply_text' THEN
   normalized:=normalized||jsonb_build_object('reply_text',btrim(f->>'reply_text'),
    'reply_text_sha256',encode(sha256(convert_to(btrim(f->>'reply_text'),'UTF8')),'hex'));
  END IF;
  IF scope='curriculum' THEN
   normalized:=normalized||jsonb_build_object('module_id',target.module_id,'binding_block_id',target.id,
     'binding_block_updated_at',target.updated_at,'lesson_id',target.lesson_id);
  END IF;
  output:=output||jsonb_build_array(normalized);
 END LOOP;
 SELECT coalesce(jsonb_agg(value ORDER BY value->>'id'),'[]') INTO output FROM jsonb_array_elements(output);
 RETURN jsonb_build_object('valid',jsonb_array_length(errors)=0,'facts',output,'errors',errors,
   'count',jsonb_array_length(output),'facts_sha256',encode(sha256(convert_to(output::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.sales_check_knowledge_facts(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_check_knowledge_facts(uuid,jsonb) TO service_role;