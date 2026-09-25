-- Permit an explicit owner non-speech review of one uncertain 3.36s pre-caption microfragment.
-- The original ASR result is preserved; no STT retry or lesson/public publication is introduced.
-- Publish exactly one owner-reviewed leading gap for an existing historical
-- live-event source. Course lesson bindings, access rules and sales facts stay untouched.
CREATE OR REPLACE FUNCTION public.course_historical_gap_publish_reviewed(
  _audit_id uuid, _actor uuid, _manifest_sha256 text, _decisions jsonb,
  _transcript_text text, _metadata jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a public.course_caption_gap_audits; s public.course_transcription_sources;
  b public.course_historical_event_bindings; p public.course_caption_gap_parts;
  r public.course_gap_reviews; existing public.course_transcripts;
  decision jsonb; idx integer:=0; digest text; clean text:=btrim(_transcript_text);
BEGIN
  IF _manifest_sha256 IS NULL OR _manifest_sha256 !~ '^[a-f0-9]{64}$'
    OR NOT coalesce(public.has_role_v2(_actor,'super_admin'),false)
    THEN RAISE EXCEPTION 'historical_review_owner_required'; END IF;
  SELECT * INTO a FROM public.course_caption_gap_audits WHERE id=_audit_id FOR UPDATE;
  IF NOT FOUND OR a.requested_by IS DISTINCT FROM _actor OR a.status NOT IN ('evidence','review_required')
    OR a.expected_parts<>3 OR a.classification<>'paid_private' OR a.quality_status<>'unreviewed'
    OR a.caption_sha256 IS DISTINCT FROM encode(sha256(convert_to(a.raw_vtt,'UTF8')),'hex')
    THEN RAISE EXCEPTION 'historical_review_audit_changed'; END IF;
  -- The only review_required case allowed is a single, already attempted,
  -- non-Cyrillic microfragment immediately before the first caption.
  IF a.status='review_required' AND (
    SELECT count(*) FROM public.course_caption_gap_parts x
    WHERE x.audit_id=a.id AND x.status='uncertain')<>1
    THEN RAISE EXCEPTION 'historical_review_held_part_changed'; END IF;
  SELECT * INTO s FROM public.course_transcription_sources WHERE id=a.source_id FOR UPDATE;
  SELECT * INTO b FROM public.course_historical_event_bindings WHERE source_id=a.source_id FOR SHARE;
  IF s.id IS NULL OR NOT s.enabled OR s.source_scope<>'historical_live_event'
    OR s.source_revision IS DISTINCT FROM a.source_revision OR s.revision_basis<>'provider_api'
    OR b.source_id IS NULL
    OR EXISTS (SELECT 1 FROM public.course_transcription_bindings WHERE source_id=s.id)
    OR EXISTS (SELECT 1 FROM public.course_transcription_jobs WHERE source_id=s.id)
    THEN RAISE EXCEPTION 'historical_review_source_changed'; END IF;
  IF jsonb_typeof(_decisions) IS DISTINCT FROM 'array' OR jsonb_array_length(_decisions)<>3
    OR clean IS NULL OR length(clean) NOT BETWEEN 1 AND 10000000
    OR jsonb_typeof(_metadata) IS DISTINCT FROM 'object'
    OR _metadata->>'language' IS DISTINCT FROM 'ru'
    OR _metadata->>'subtitle_sha256' IS DISTINCT FROM a.caption_sha256
    OR _metadata->>'gap_review_status' IS DISTINCT FROM 'reviewed'
    OR (_metadata->>'reviewed_gap_parts')::integer IS DISTINCT FROM 3
    OR _metadata->>'reviewer_id' IS DISTINCT FROM _actor::text
    OR coalesce(_metadata->>'review_decisions_sha256','') !~ '^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'historical_review_assembly_invalid'; END IF;
  FOR decision IN SELECT value FROM jsonb_array_elements(_decisions) LOOP
    SELECT * INTO p FROM public.course_caption_gap_parts
      WHERE audit_id=a.id AND part_index=idx FOR UPDATE;
    IF NOT FOUND OR p.attempts<>1
      OR (p.status<>'evidence' AND NOT (
        idx=2 AND a.status='review_required' AND p.status='uncertain'
        AND p.error_code='asr_outcome_uncertain'
        AND p.asr_text IS NOT NULL AND length(btrim(p.asr_text)) BETWEEN 1 AND 100000
        AND p.asr_text !~ '[А-Яа-яЁё]'
        AND decision->>'kind'='non_speech' AND decision->'text'='null'::jsonb))
      OR p.text_sha256 IS DISTINCT FROM encode(sha256(convert_to(p.asr_text,'UTF8')),'hex')
      OR p.gap_index<>0 OR (idx=0 AND p.start_ms<>0)
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
      THEN RAISE EXCEPTION 'historical_review_decision_invalid'; END IF;
    idx:=idx+1;
  END LOOP;
  IF idx<>3 OR (SELECT count(*) FROM public.course_caption_gap_parts WHERE audit_id=a.id)<>3
    OR EXISTS (SELECT 1 FROM public.course_caption_gap_parts x JOIN public.course_caption_gap_parts y
      ON y.audit_id=x.audit_id AND y.part_index=x.part_index+1
      WHERE x.audit_id=a.id AND x.end_ms<>y.start_ms)
    THEN RAISE EXCEPTION 'historical_review_parts_changed'; END IF;
  digest:=encode(sha256(convert_to(clean,'UTF8')),'hex');
  SELECT * INTO existing FROM public.course_transcripts WHERE source_id=s.id FOR UPDATE;
  SELECT * INTO r FROM public.course_gap_reviews WHERE audit_id=a.id FOR UPDATE;
  IF FOUND THEN
    IF existing.source_id IS DISTINCT FROM s.id OR existing.content_sha256 IS DISTINCT FROM digest
      OR existing.transcript_text IS DISTINCT FROM clean
      OR existing.source_revision IS DISTINCT FROM s.source_revision
      OR existing.classification<>'paid_private' OR existing.quality_status<>'unreviewed'
      OR r.manifest_sha256 IS DISTINCT FROM _manifest_sha256
      OR r.decisions IS DISTINCT FROM _decisions OR r.transcript_sha256 IS DISTINCT FROM digest
      OR r.reviewed_by IS DISTINCT FROM _actor
      THEN RAISE EXCEPTION 'historical_review_publication_conflict'; END IF;
    RETURN jsonb_build_object('source_id',s.id,'sha256',digest,'reused',true);
  END IF;
  IF existing.source_id IS NOT NULL
    THEN RAISE EXCEPTION 'historical_review_existing_transcript'; END IF;
  INSERT INTO public.course_gap_reviews(audit_id,reviewed_by,manifest_sha256,decisions,transcript_sha256)
    VALUES(a.id,_actor,_manifest_sha256,_decisions,digest);
  INSERT INTO public.course_transcripts(source_id,origin,source_revision,transcript_text,
    content_sha256,char_count,duration_ms,subtitle_metadata,caption_provenance)
    VALUES(s.id,'provider_subtitles',s.source_revision,clean,digest,length(clean),s.duration_ms,_metadata,
      jsonb_build_object('schema_version',1,'revision_basis','provider_api',
        'gap_audit_id',a.id,'review_manifest_sha256',_manifest_sha256,
        'source_caption_sha256',a.caption_sha256));
  RETURN jsonb_build_object('source_id',s.id,'sha256',digest,'reused',false);
END $$;

REVOKE ALL ON FUNCTION public.course_historical_gap_publish_reviewed(uuid,uuid,text,jsonb,text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.course_historical_gap_publish_reviewed(uuid,uuid,text,jsonb,text,jsonb)
  TO service_role;
