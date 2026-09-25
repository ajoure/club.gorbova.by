-- Private publication of complete evidence audits; old continuation path unchanged.
CREATE FUNCTION public.course_gap_publish_evidence(
  _audit_id uuid, _actor uuid, _manifest_sha256 text, _decisions jsonb,
  _transcript_text text, _metadata jsonb, _capture_manifest text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a public.course_caption_gap_audits; s public.course_transcription_sources;
  p public.course_caption_gap_parts; capture jsonb; normalization jsonb; provenance jsonb;
  r public.course_gap_reviews; existing public.course_transcripts;
  decision jsonb; idx integer:=0; digest text; clean text:=btrim(_transcript_text);
BEGIN
  IF _manifest_sha256 IS NULL OR _manifest_sha256 !~ '^[a-f0-9]{64}$'
    OR NOT coalesce(public.has_role_v2(_actor,'super_admin'),false)
    THEN RAISE EXCEPTION 'review_owner_required'; END IF;
  SELECT * INTO a FROM public.course_caption_gap_audits WHERE id=_audit_id FOR UPDATE;
  IF NOT FOUND OR a.requested_by IS DISTINCT FROM _actor OR a.status<>'evidence'
    OR a.expected_parts NOT BETWEEN 1 AND 7 OR a.classification<>'paid_private' OR a.quality_status<>'unreviewed'
    OR a.caption_sha256 IS DISTINCT FROM encode(sha256(convert_to(a.raw_vtt,'UTF8')),'hex')
    THEN RAISE EXCEPTION 'review_audit_changed'; END IF;
  SELECT * INTO s FROM public.course_transcription_sources WHERE id=a.source_id FOR UPDATE;
  IF NOT FOUND OR NOT s.enabled OR s.source_revision IS DISTINCT FROM a.source_revision
    OR s.revision_basis<>'provider_api' OR s.source_scope<>'course' THEN RAISE EXCEPTION 'review_source_changed'; END IF;
  IF EXISTS(SELECT 1 FROM public.course_gap_continuations WHERE audit_id=a.id)
    THEN RAISE EXCEPTION 'evidence_has_continuation'; END IF;
  IF _capture_manifest IS NULL OR octet_length(_capture_manifest)>2000000
    OR encode(sha256(convert_to(_capture_manifest,'UTF8')),'hex') IS DISTINCT FROM a.manifest_sha256
    THEN RAISE EXCEPTION 'evidence_capture_manifest_changed'; END IF;
  capture:=_capture_manifest::jsonb;
  normalization:=capture#>'{source,caption_provenance}';
  IF capture->>'mode' IS DISTINCT FROM 'caption_gap_dry_run'
    OR (capture->>'schema_version')::integer IS DISTINCT FROM 1
    OR capture#>>'{source,source_revision}' IS DISTINCT FROM s.source_revision
    OR capture#>>'{source,video_id}' IS DISTINCT FROM s.video_id::text
    OR (capture#>>'{source,duration_ms}')::bigint IS DISTINCT FROM s.duration_ms
    OR capture#>>'{source,caption_sha256}' IS DISTINCT FROM a.caption_sha256
    OR jsonb_typeof(capture->'parts') IS DISTINCT FROM 'array'
    OR jsonb_array_length(capture->'parts') IS DISTINCT FROM a.expected_parts
    THEN RAISE EXCEPTION 'evidence_capture_manifest_changed'; END IF;
  IF jsonb_typeof(normalization) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(normalization))<>12
    OR NOT (normalization ?& ARRAY['schema_version','revision_basis','raw_sha256','normalized_sha256',
      'transform','cue_count','inversions','max_backstep_ms','moved_positions','duplicate_cues',
      'original_cue_multiset_sha256','normalized_cue_multiset_sha256'])
    OR normalization->>'schema_version' IS DISTINCT FROM '1'
    OR normalization->>'revision_basis' IS DISTINCT FROM 'provider_api'
    OR normalization->>'raw_sha256' IS DISTINCT FROM a.caption_sha256
    OR coalesce(normalization->>'normalized_sha256','') !~ '^[a-f0-9]{64}$'
    OR coalesce(normalization->>'original_cue_multiset_sha256','') !~ '^[a-f0-9]{64}$'
    OR normalization->>'original_cue_multiset_sha256' IS DISTINCT FROM normalization->>'normalized_cue_multiset_sha256'
    OR coalesce(normalization->>'transform','') NOT IN ('none','stable_cue_order_v1')
    OR coalesce((normalization->>'cue_count')::integer,0)<1
    OR coalesce((normalization->>'inversions')::integer,-1) NOT BETWEEN 0 AND 3
    OR coalesce((normalization->>'max_backstep_ms')::integer,-1) NOT BETWEEN 0 AND 30000
    OR coalesce((normalization->>'moved_positions')::integer,-1) NOT BETWEEN 0 AND 32
    OR (normalization->>'duplicate_cues')::integer IS DISTINCT FROM 0
    OR (normalization->>'transform'='none' AND
      (normalization->>'raw_sha256' IS DISTINCT FROM normalization->>'normalized_sha256'
       OR (normalization->>'inversions')::integer IS DISTINCT FROM 0))
    THEN RAISE EXCEPTION 'evidence_normalization_invalid'; END IF;
  IF (SELECT count(*) FROM public.course_caption_gap_parts WHERE audit_id=a.id)<>a.expected_parts
    THEN RAISE EXCEPTION 'review_evidence_incomplete'; END IF;
  PERFORM 1 FROM public.course_transcription_bindings WHERE source_id=s.id FOR SHARE;
  IF jsonb_typeof(capture#>'{source,bindings}') IS DISTINCT FROM 'array'
    OR jsonb_array_length(capture#>'{source,bindings}')<1
    OR (SELECT count(*) FROM public.course_transcription_bindings WHERE source_id=s.id)
       <>jsonb_array_length(capture#>'{source,bindings}')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(capture#>'{source,bindings}') b
      WHERE NOT EXISTS(SELECT 1 FROM public.course_transcription_bindings l WHERE l.source_id=s.id
        AND l.block_id::text=b->>'block_id' AND l.lesson_id::text=b->>'lesson_id'
        AND l.product_id::text=b->>'product_id' AND l.block_updated_at=(b->>'block_updated_at')::timestamptz))
    THEN RAISE EXCEPTION 'review_binding_changed'; END IF;
  provenance:=jsonb_build_object('schema_version',1,'revision_basis','provider_api',
    'gap_audit_id',a.id,'review_manifest_sha256',_manifest_sha256,
    'source_caption_sha256',a.caption_sha256,'caption_normalization',normalization,
    'capture_manifest_sha256',a.manifest_sha256,'publication_path','evidence_v1');
  IF jsonb_typeof(_decisions) IS DISTINCT FROM 'array' OR jsonb_array_length(_decisions)<>a.expected_parts
    OR clean IS NULL OR length(clean) NOT BETWEEN 1 AND 10000000
    OR jsonb_typeof(_metadata) IS DISTINCT FROM 'object'
    OR _metadata->>'language' IS DISTINCT FROM 'ru'
    OR _metadata->>'subtitle_sha256' IS DISTINCT FROM a.caption_sha256
    OR _metadata->>'gap_review_status' IS DISTINCT FROM 'reviewed'
    OR (_metadata->>'reviewed_gap_parts')::integer IS DISTINCT FROM a.expected_parts
    OR _metadata->>'normalized_caption_sha256' IS DISTINCT FROM normalization->>'normalized_sha256'
    OR _metadata->>'reviewer_id' IS DISTINCT FROM _actor::text
    THEN RAISE EXCEPTION 'review_assembly_invalid'; END IF;
  FOR decision IN SELECT value FROM jsonb_array_elements(_decisions) LOOP
    SELECT * INTO p FROM public.course_caption_gap_parts
      WHERE audit_id=a.id AND part_index=idx FOR UPDATE;
    IF NOT FOUND OR p.attempts<>1 OR p.status<>'evidence' OR p.asr_text IS NULL OR p.text_sha256 IS NULL
      OR capture->'parts'->idx->>'audio_sha256' IS DISTINCT FROM p.audio_sha256
      OR (capture->'parts'->idx->>'part_index')::integer IS DISTINCT FROM idx
      OR (capture->'parts'->idx->>'start_ms')::integer IS DISTINCT FROM p.start_ms
      OR (capture->'parts'->idx->>'end_ms')::integer IS DISTINCT FROM p.end_ms
      OR (capture->'parts'->idx->>'gap_index')::integer IS DISTINCT FROM p.gap_index
      OR p.text_sha256 IS DISTINCT FROM encode(sha256(convert_to(p.asr_text,'UTF8')),'hex')
      OR jsonb_typeof(decision) IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(decision))<>7
      OR NOT (decision ?& ARRAY['part_index','kind','text','evidence_sha256','audio_sha256','reviewer_id','note'])
      OR (decision->>'part_index')::integer IS DISTINCT FROM idx
      OR decision->>'evidence_sha256' IS DISTINCT FROM p.text_sha256
      OR decision->>'audio_sha256' IS DISTINCT FROM p.audio_sha256
      OR decision->>'reviewer_id' IS DISTINCT FROM _actor::text
      OR decision->>'note' IS NULL OR length(btrim(decision->>'note')) NOT BETWEEN 8 AND 1000
      OR decision->>'kind' IS NULL OR decision->>'kind' NOT IN ('speech','non_speech')
      OR (decision->>'kind'='speech' AND
        (decision->>'text' IS NULL OR length(btrim(decision->>'text')) NOT BETWEEN 1 AND 100000
         OR decision->>'text' !~ '[А-Яа-яЁё]'))
      OR (decision->>'kind'='non_speech' AND decision->'text'<>'null'::jsonb)
      THEN RAISE EXCEPTION 'review_decision_invalid'; END IF;
    idx:=idx+1;
  END LOOP;
  digest:=encode(sha256(convert_to(clean,'UTF8')),'hex');
  IF _metadata->>'review_decisions_sha256' IS NULL
    OR _metadata->>'review_decisions_sha256' !~ '^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'review_digest_missing'; END IF;
  SELECT * INTO existing FROM public.course_transcripts WHERE source_id=s.id FOR UPDATE;
  SELECT * INTO r FROM public.course_gap_reviews WHERE audit_id=a.id FOR UPDATE;
  IF FOUND THEN
    IF existing.source_id IS DISTINCT FROM s.id OR existing.content_sha256 IS DISTINCT FROM digest
      OR existing.transcript_text IS DISTINCT FROM clean OR existing.source_revision IS DISTINCT FROM s.source_revision
      OR existing.classification<>'paid_private' OR existing.quality_status<>'unreviewed'
      OR existing.subtitle_metadata IS DISTINCT FROM _metadata OR existing.caption_provenance IS DISTINCT FROM provenance
      OR r.manifest_sha256 IS DISTINCT FROM _manifest_sha256 OR r.decisions IS DISTINCT FROM _decisions
      OR r.transcript_sha256 IS DISTINCT FROM digest OR r.reviewed_by IS DISTINCT FROM _actor
      THEN RAISE EXCEPTION 'review_publication_conflict'; END IF;
    RETURN jsonb_build_object('source_id',s.id,'sha256',digest,'reused',true);
  END IF;
  IF existing.source_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.course_transcription_jobs WHERE source_id=s.id)
    THEN RAISE EXCEPTION 'review_existing_transcript_or_job'; END IF;
  INSERT INTO public.course_gap_reviews(audit_id,reviewed_by,manifest_sha256,decisions,transcript_sha256)
    VALUES(a.id,_actor,_manifest_sha256,_decisions,digest);
  INSERT INTO public.course_transcripts(source_id,origin,source_revision,transcript_text,content_sha256,char_count,duration_ms,subtitle_metadata,caption_provenance)
    VALUES(s.id,'provider_subtitles',s.source_revision,clean,digest,length(clean),s.duration_ms,_metadata,
      provenance);
  RETURN jsonb_build_object('source_id',s.id,'sha256',digest,'reused',false);
END $$;

REVOKE ALL ON FUNCTION public.course_gap_publish_evidence(uuid,uuid,text,jsonb,text,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.course_gap_publish_evidence(uuid,uuid,text,jsonb,text,jsonb,text)
  TO service_role;
