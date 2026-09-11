-- Additive provenance for reviewed public captions. Existing rows retain provider_api.
-- No sources, transcript text, jobs, client messages or sales attachments are seeded.
ALTER TABLE public.course_transcription_sources
  ADD COLUMN revision_basis text NOT NULL DEFAULT 'provider_api'
    CHECK (revision_basis IN ('provider_api','public_caption_snapshot')),
  ADD COLUMN caption_sha256 text CHECK (caption_sha256 ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT course_caption_snapshot_identity CHECK (
    (revision_basis='provider_api' AND caption_sha256 IS NULL) OR
    (revision_basis='public_caption_snapshot' AND caption_sha256 IS NOT NULL
      AND audio_track_id IS NULL AND audio_bytes IS NULL
      AND source_revision=encode(sha256(convert_to(
        'public_caption_snapshot:v1:' || video_id::text || ':' || duration_ms::text || ':' || caption_sha256,'UTF8')),'hex'))
  );
ALTER TABLE public.course_transcripts ADD COLUMN caption_provenance jsonb;

CREATE OR REPLACE FUNCTION public.course_transcription_create_job(_source_id uuid, _actor uuid, _duration_ms bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE s public.course_transcription_sources; j public.course_transcription_jobs;
BEGIN
  SELECT * INTO s FROM public.course_transcription_sources WHERE id=_source_id FOR UPDATE;
  IF NOT FOUND OR NOT s.enabled THEN RAISE EXCEPTION 'source_not_enabled'; END IF;
  IF NOT coalesce(public.has_role_v2(_actor,'super_admin'),false) THEN RAISE EXCEPTION 'owner_required'; END IF;
  IF s.revision_basis <> 'provider_api' THEN RAISE EXCEPTION 'public_caption_requires_reviewed_path'; END IF;
  IF EXISTS (SELECT 1 FROM public.course_transcripts WHERE source_id=s.id) THEN RAISE EXCEPTION 'transcript_already_exists'; END IF;
  IF s.audio_track_id IS NULL OR s.audio_bytes IS NULL THEN RAISE EXCEPTION 'audio_metadata_required'; END IF;
  IF _duration_ms IS NULL OR abs(_duration_ms-s.duration_ms)>1000 THEN RAISE EXCEPTION 'duration_mismatch'; END IF;
  SELECT * INTO j FROM public.course_transcription_jobs WHERE source_id=s.id;
  IF FOUND THEN
    IF j.duration_ms<>_duration_ms THEN RAISE EXCEPTION 'job_duration_mismatch'; END IF;
    RETURN jsonb_build_object('job_id',j.id,'status',j.status,'reused',true);
  END IF;
  INSERT INTO public.course_transcription_jobs(source_id,requested_by,duration_ms,total_parts)
    VALUES(s.id,_actor,_duration_ms,(_duration_ms+89999)/90000) RETURNING * INTO j;
  INSERT INTO public.course_transcription_parts(job_id,part_index,start_ms,end_ms)
    SELECT j.id,i,i::bigint*90000,least((i::bigint+1)*90000,_duration_ms)
    FROM generate_series(0,j.total_parts-1) i;
  RETURN jsonb_build_object('job_id',j.id,'status',j.status,'reused',false);
END $$;

-- This service-only path accepts an explicitly reviewed public snapshot.
-- Provenance is stored without URLs; unexpected fields are rejected.
CREATE FUNCTION public.course_transcription_import_reviewed_captions(
  _source_id uuid, _source_revision text, _text text, _metadata jsonb, _provenance jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE s public.course_transcription_sources; existing public.course_transcripts;
  txt text:=btrim(_text); transform text; expected_keys text[]:=ARRAY[
    'schema_version','revision_basis','raw_sha256','normalized_sha256','transform',
    'cue_count','inversions','max_backstep_ms','moved_positions','duplicate_cues',
    'original_cue_multiset_sha256','normalized_cue_multiset_sha256','video_id','duration_ms'];
BEGIN
  SELECT * INTO s FROM public.course_transcription_sources WHERE id=_source_id FOR UPDATE;
  IF NOT FOUND OR NOT s.enabled OR s.source_revision IS DISTINCT FROM _source_revision
    OR s.revision_basis<>'public_caption_snapshot' THEN RAISE EXCEPTION 'review_source_changed'; END IF;
  IF txt IS NULL OR length(txt) NOT BETWEEN 1 AND 10000000 THEN RAISE EXCEPTION 'invalid_transcript'; END IF;
  IF _provenance IS NULL OR jsonb_typeof(_provenance)<>'object'
    OR NOT (_provenance ?& expected_keys) OR _provenance-expected_keys<>'{}'::jsonb
    OR _provenance->>'schema_version' IS DISTINCT FROM '1'
    OR _provenance->>'revision_basis' IS DISTINCT FROM 'public_caption_snapshot'
    OR _provenance->>'video_id' IS DISTINCT FROM s.video_id::text
    OR (_provenance->>'duration_ms')::bigint IS DISTINCT FROM s.duration_ms
    OR _provenance->>'raw_sha256' IS DISTINCT FROM s.caption_sha256
    OR coalesce(_provenance->>'normalized_sha256','') !~ '^[a-f0-9]{64}$'
    OR coalesce(_provenance->>'original_cue_multiset_sha256','') !~ '^[a-f0-9]{64}$'
    OR _provenance->>'original_cue_multiset_sha256' IS DISTINCT FROM _provenance->>'normalized_cue_multiset_sha256'
    OR coalesce((_provenance->>'cue_count')::integer,0)<1
    OR coalesce((_provenance->>'duplicate_cues')::integer,-1)<0
    THEN RAISE EXCEPTION 'invalid_caption_provenance'; END IF;
  transform:=_provenance->>'transform';
  IF transform='none' THEN
    IF (_provenance->>'inversions')::integer IS DISTINCT FROM 0
      OR (_provenance->>'max_backstep_ms')::integer IS DISTINCT FROM 0
      OR (_provenance->>'moved_positions')::integer IS DISTINCT FROM 0
      OR _provenance->>'raw_sha256' IS DISTINCT FROM _provenance->>'normalized_sha256'
      THEN RAISE EXCEPTION 'invalid_caption_transform'; END IF;
  ELSIF transform='stable_cue_order_v1' THEN
    IF NOT coalesce((_provenance->>'inversions')::integer BETWEEN 1 AND 3,false)
      OR NOT coalesce((_provenance->>'max_backstep_ms')::integer BETWEEN 1 AND 30000,false)
      OR NOT coalesce((_provenance->>'moved_positions')::integer BETWEEN 1 AND 32,false)
      OR (_provenance->>'duplicate_cues')::integer IS DISTINCT FROM 0
      THEN RAISE EXCEPTION 'invalid_caption_transform'; END IF;
  ELSE RAISE EXCEPTION 'invalid_caption_transform'; END IF;
  IF _metadata IS NULL OR jsonb_typeof(_metadata)<>'object'
    OR _metadata-ARRAY['language','cue_count','subtitle_sha256','first_ms','last_ms','covered_ms',
      'max_gap_ms','uncovered_ms','gap_count_gt60','quality_flags']<>'{}'::jsonb
    OR _metadata->>'language' IS DISTINCT FROM 'ru'
    OR _metadata->>'subtitle_sha256' IS DISTINCT FROM s.caption_sha256
    OR (_metadata->>'cue_count')::integer IS DISTINCT FROM (_provenance->>'cue_count')::integer
    OR _metadata->'quality_flags' IS DISTINCT FROM '[]'::jsonb
    OR NOT coalesce((_metadata->>'first_ms')::bigint BETWEEN 0 AND 60000,false)
    OR NOT coalesce((_metadata->>'last_ms')::bigint BETWEEN s.duration_ms-60000 AND s.duration_ms+greatest(2000,s.duration_ms/200),false)
    OR NOT coalesce((_metadata->>'covered_ms')::bigint BETWEEN s.duration_ms/2 AND s.duration_ms,false)
    OR NOT coalesce((_metadata->>'max_gap_ms')::bigint BETWEEN 0 AND 120000,false)
    OR (_metadata->>'uncovered_ms')::bigint IS DISTINCT FROM s.duration_ms-(_metadata->>'covered_ms')::bigint
    OR coalesce((_metadata->>'gap_count_gt60')::integer,-1)<0
    THEN RAISE EXCEPTION 'review_caption_quality_required'; END IF;
  IF EXISTS (SELECT 1 FROM public.course_transcription_jobs WHERE source_id=s.id) THEN RAISE EXCEPTION 'stt_job_exists_reconcile_first'; END IF;
  SELECT * INTO existing FROM public.course_transcripts WHERE source_id=s.id;
  IF FOUND THEN
    IF existing.transcript_text<>txt OR existing.source_revision<>s.source_revision
      OR existing.origin<>'provider_subtitles' OR existing.caption_provenance IS DISTINCT FROM _provenance
      OR existing.subtitle_metadata IS DISTINCT FROM _metadata
      THEN RAISE EXCEPTION 'review_transcript_conflict'; END IF;
    RETURN jsonb_build_object('source_id',s.id,'chars',existing.char_count,'sha256',existing.content_sha256,'reused',true);
  END IF;
  INSERT INTO public.course_transcripts(source_id,origin,source_revision,transcript_text,content_sha256,
    char_count,duration_ms,subtitle_metadata,caption_provenance)
    VALUES(s.id,'provider_subtitles',s.source_revision,txt,encode(sha256(convert_to(txt,'UTF8')),'hex'),
      length(txt),s.duration_ms,_metadata,_provenance);
  RETURN jsonb_build_object('source_id',s.id,'chars',length(txt),'sha256',encode(sha256(convert_to(txt,'UTF8')),'hex'),'reused',false);
END $$;

REVOKE ALL ON FUNCTION public.course_transcription_import_reviewed_captions(uuid,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.course_transcription_import_reviewed_captions(uuid,text,text,jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.course_transcription_import_subtitles(_source_id uuid, _source_revision text, _text text, _metadata jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE s public.course_transcription_sources; existing public.course_transcripts; txt text:=btrim(_text);
BEGIN
  SELECT * INTO s FROM public.course_transcription_sources WHERE id=_source_id FOR UPDATE;
  IF NOT FOUND OR NOT s.enabled OR s.source_revision IS DISTINCT FROM _source_revision THEN RAISE EXCEPTION 'source_revision_changed'; END IF;
  IF s.revision_basis <> 'provider_api' THEN RAISE EXCEPTION 'public_caption_requires_reviewed_path'; END IF;
  IF txt IS NULL OR length(txt) NOT BETWEEN 1 AND 10000000 THEN RAISE EXCEPTION 'invalid_transcript'; END IF;
  IF _metadata IS NULL OR jsonb_typeof(_metadata)<>'object'
    OR _metadata->>'language' IS DISTINCT FROM 'ru'
    OR coalesce((_metadata->>'cue_count')::integer,0)<1
    OR coalesce(_metadata->>'subtitle_sha256','') !~ '^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'invalid_subtitle_metadata'; END IF;
  IF EXISTS (SELECT 1 FROM public.course_transcription_jobs WHERE source_id=s.id) THEN RAISE EXCEPTION 'stt_job_exists_reconcile_first'; END IF;
  SELECT * INTO existing FROM public.course_transcripts WHERE source_id=s.id;
  IF FOUND THEN
    IF existing.transcript_text<>txt OR existing.source_revision<>s.source_revision
      OR existing.subtitle_metadata->>'subtitle_sha256' IS DISTINCT FROM _metadata->>'subtitle_sha256'
      THEN RAISE EXCEPTION 'transcript_conflict'; END IF;
    RETURN jsonb_build_object('source_id',s.id,'chars',existing.char_count,'sha256',existing.content_sha256,'reused',true);
  END IF;
  INSERT INTO public.course_transcripts(source_id,origin,source_revision,transcript_text,content_sha256,char_count,duration_ms,subtitle_metadata)
    VALUES(s.id,'provider_subtitles',s.source_revision,txt,encode(sha256(convert_to(txt,'UTF8')),'hex'),length(txt),s.duration_ms,
      jsonb_build_object('language','ru','cue_count',(_metadata->>'cue_count')::integer,
        'subtitle_sha256',_metadata->>'subtitle_sha256','first_ms',(_metadata->>'first_ms')::bigint,
        'last_ms',(_metadata->>'last_ms')::bigint,'covered_ms',(_metadata->>'covered_ms')::bigint,
        'max_gap_ms',(_metadata->>'max_gap_ms')::bigint,'uncovered_ms',(_metadata->>'uncovered_ms')::bigint,
        'gap_count_gt60',(_metadata->>'gap_count_gt60')::integer,'quality_flags',_metadata->'quality_flags'));
  RETURN jsonb_build_object('source_id',s.id,'chars',length(txt),'sha256',encode(sha256(convert_to(txt,'UTF8')),'hex'),'reused',false);
END $$;
