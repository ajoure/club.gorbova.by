-- A reviewed caption-gap assembly is private teaching material. Only a trusted
-- service caller may publish the exact owner-reviewed manifest; no STT retry.
CREATE TABLE public.course_gap_reviews (
  audit_id uuid PRIMARY KEY REFERENCES public.course_caption_gap_audits(id),
  reviewed_by uuid NOT NULL REFERENCES auth.users(id),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  decisions jsonb NOT NULL CHECK (jsonb_typeof(decisions)='array' AND jsonb_array_length(decisions) BETWEEN 1 AND 7),
  transcript_sha256 text NOT NULL CHECK (transcript_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.course_gap_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_gap_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.course_gap_reviews TO authenticated;
GRANT ALL ON public.course_gap_reviews TO service_role;
CREATE POLICY owner_read ON public.course_gap_reviews FOR SELECT TO authenticated
  USING (public.has_role_v2((SELECT auth.uid()),'super_admin'));

CREATE FUNCTION public.course_gap_publish_reviewed(
  _audit_id uuid, _actor uuid, _manifest_sha256 text, _decisions jsonb,
  _transcript_text text, _metadata jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a public.course_caption_gap_audits; s public.course_transcription_sources;
  c public.course_gap_continuations; p public.course_caption_gap_parts;
  r public.course_gap_reviews; existing public.course_transcripts;
  decision jsonb; idx integer:=0; digest text; clean text:=btrim(_transcript_text);
BEGIN
  IF _manifest_sha256 IS NULL OR _manifest_sha256 !~ '^[a-f0-9]{64}$'
    OR NOT coalesce(public.has_role_v2(_actor,'super_admin'),false)
    THEN RAISE EXCEPTION 'review_owner_required'; END IF;
  SELECT * INTO a FROM public.course_caption_gap_audits WHERE id=_audit_id FOR UPDATE;
  IF NOT FOUND OR a.requested_by IS DISTINCT FROM _actor OR a.status<>'review_required'
    OR a.expected_parts<>7 OR a.classification<>'paid_private' OR a.quality_status<>'unreviewed'
    OR a.caption_sha256 IS DISTINCT FROM encode(sha256(convert_to(a.raw_vtt,'UTF8')),'hex')
    THEN RAISE EXCEPTION 'review_audit_changed'; END IF;
  SELECT * INTO s FROM public.course_transcription_sources WHERE id=a.source_id FOR UPDATE;
  IF NOT FOUND OR NOT s.enabled OR s.source_revision IS DISTINCT FROM a.source_revision
    OR s.revision_basis<>'provider_api' THEN RAISE EXCEPTION 'review_source_changed'; END IF;
  SELECT * INTO c FROM public.course_gap_continuations WHERE audit_id=a.id FOR UPDATE;
  IF NOT FOUND OR c.status<>'collected' OR c.reviewed_by IS DISTINCT FROM _actor
    OR c.audit_context IS DISTINCT FROM (to_jsonb(a)-'raw_vtt'-'created_at')
    OR c.held_part_snapshot IS DISTINCT FROM
      (SELECT to_jsonb(x) FROM public.course_caption_gap_parts x WHERE audit_id=a.id AND part_index=0)
    THEN RAISE EXCEPTION 'review_continuation_changed'; END IF;
  IF (SELECT count(*) FROM public.course_gap_evidence_annotations
      WHERE audit_id=a.id AND continuation_id=c.id AND part_index BETWEEN 1 AND 6)<>6
    THEN RAISE EXCEPTION 'review_evidence_incomplete'; END IF;
  IF jsonb_typeof(_decisions) IS DISTINCT FROM 'array' OR jsonb_array_length(_decisions)<>7
    OR clean IS NULL OR length(clean) NOT BETWEEN 1 AND 10000000
    OR jsonb_typeof(_metadata) IS DISTINCT FROM 'object'
    OR _metadata->>'language' IS DISTINCT FROM 'ru'
    OR _metadata->>'subtitle_sha256' IS DISTINCT FROM a.caption_sha256
    OR _metadata->>'gap_review_status' IS DISTINCT FROM 'reviewed'
    OR (_metadata->>'reviewed_gap_parts')::integer IS DISTINCT FROM 7
    OR _metadata->>'reviewer_id' IS DISTINCT FROM _actor::text
    THEN RAISE EXCEPTION 'review_assembly_invalid'; END IF;
  FOR decision IN SELECT value FROM jsonb_array_elements(_decisions) LOOP
    SELECT * INTO p FROM public.course_caption_gap_parts
      WHERE audit_id=a.id AND part_index=idx FOR UPDATE;
    IF NOT FOUND OR p.attempts<>1 OR (idx=0 AND p.status<>'uncertain')
      OR (idx>0 AND p.status<>'evidence')
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
    IF idx>0 AND NOT EXISTS (
      SELECT 1 FROM public.course_gap_evidence_annotations e WHERE e.audit_id=a.id
        AND e.continuation_id=c.id AND e.part_index=idx AND e.text_sha256=p.text_sha256
    ) THEN RAISE EXCEPTION 'review_annotation_changed'; END IF;
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
      jsonb_build_object('schema_version',1,'revision_basis','provider_api',
        'gap_audit_id',a.id,'review_manifest_sha256',_manifest_sha256,
        'source_caption_sha256',a.caption_sha256));
  RETURN jsonb_build_object('source_id',s.id,'sha256',digest,'reused',false);
END $$;

REVOKE ALL ON FUNCTION public.course_gap_publish_reviewed(uuid,uuid,text,jsonb,text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.course_gap_publish_reviewed(uuid,uuid,text,jsonb,text,jsonb)
  TO service_role;
