-- A verified all-zero PCM window is evidence of silence, not an ASR retry.
-- Only historical live-event sources may use this owner/service-only path.
CREATE TABLE public.course_historical_gap_silence_proofs (
  audit_id uuid NOT NULL,
  part_index integer NOT NULL CHECK (part_index IN (0,1)),
  audio_sha256 text NOT NULL CHECK (audio_sha256 ~ '^[a-f0-9]{64}$'),
  pcm_bytes integer NOT NULL CHECK (pcm_bytes > 0 AND pcm_bytes <= 2880000),
  previous_status text NOT NULL CHECK (previous_status IN ('uncertain','pending')),
  previous_text_sha256 text,
  verified_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (audit_id, part_index),
  FOREIGN KEY (audit_id, part_index)
    REFERENCES public.course_caption_gap_parts(audit_id, part_index)
);
ALTER TABLE public.course_historical_gap_silence_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_historical_gap_silence_proofs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.course_historical_gap_silence_proofs TO authenticated;
GRANT ALL ON public.course_historical_gap_silence_proofs TO service_role;
CREATE POLICY owner_read ON public.course_historical_gap_silence_proofs
  FOR SELECT TO authenticated
  USING (public.has_role_v2((SELECT auth.uid()), 'super_admin'));

CREATE FUNCTION public.course_historical_gap_accept_digital_silence(
  _audit_id uuid, _actor uuid, _part_index integer,
  _manifest_sha256 text, _audio_sha256 text, _pcm_bytes integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a public.course_caption_gap_audits;
  s public.course_transcription_sources;
  p public.course_caption_gap_parts;
  proof public.course_historical_gap_silence_proofs;
  old_status text;
  old_hash text;
  marker text := '[цифровая тишина]';
BEGIN
  IF _part_index IS NULL OR _part_index NOT IN (0,1)
    OR _pcm_bytes IS NULL OR _pcm_bytes <= 0 OR _pcm_bytes > 2880000
    OR _pcm_bytes % 2 <> 0
    THEN RAISE EXCEPTION 'historical_silence_part_invalid'; END IF;
  SELECT * INTO a FROM public.course_caption_gap_audits WHERE id=_audit_id FOR UPDATE;
  IF NOT FOUND OR a.requested_by IS DISTINCT FROM _actor
    OR a.expected_parts <> 3 OR a.classification <> 'paid_private'
    OR a.quality_status <> 'unreviewed'
    OR a.manifest_sha256 IS DISTINCT FROM _manifest_sha256
    OR NOT coalesce(public.has_role_v2(_actor,'super_admin'),false)
    THEN RAISE EXCEPTION 'historical_silence_audit_changed'; END IF;
  SELECT * INTO s FROM public.course_transcription_sources WHERE id=a.source_id FOR SHARE;
  IF NOT FOUND OR NOT s.enabled OR s.source_scope <> 'historical_live_event'
    OR s.source_revision IS DISTINCT FROM a.source_revision
    OR NOT EXISTS (SELECT 1 FROM public.course_historical_event_bindings b
      WHERE b.source_id=s.id)
    OR EXISTS (SELECT 1 FROM public.course_transcription_bindings b
      WHERE b.source_id=s.id)
    THEN RAISE EXCEPTION 'historical_silence_source_changed'; END IF;
  SELECT * INTO p FROM public.course_caption_gap_parts
    WHERE audit_id=a.id AND part_index=_part_index FOR UPDATE;
  IF NOT FOUND OR p.gap_index<>0 OR p.audio_sha256 IS DISTINCT FROM _audio_sha256
    OR p.start_ms<>_part_index*90000 OR p.end_ms<>(_part_index+1)*90000
    OR _pcm_bytes<>(p.end_ms-p.start_ms)*32
    THEN RAISE EXCEPTION 'historical_silence_audio_changed'; END IF;
  SELECT * INTO proof FROM public.course_historical_gap_silence_proofs
    WHERE audit_id=a.id AND part_index=_part_index;
  IF FOUND THEN
    IF proof.verified_by IS DISTINCT FROM _actor
      OR proof.audio_sha256 IS DISTINCT FROM _audio_sha256
      OR proof.pcm_bytes IS DISTINCT FROM _pcm_bytes
      OR p.status <> 'evidence' OR p.attempts <> 1
      OR (proof.previous_status='uncertain' AND
        (p.text_sha256 IS DISTINCT FROM proof.previous_text_sha256
         OR p.error_code IS DISTINCT FROM 'asr_outcome_uncertain'))
      OR (proof.previous_status='pending' AND
        (p.asr_text IS DISTINCT FROM marker OR p.text_sha256 IS DISTINCT FROM
         encode(sha256(convert_to(marker,'UTF8')),'hex')))
      THEN RAISE EXCEPTION 'historical_silence_proof_conflict'; END IF;
    RETURN jsonb_build_object('status','evidence','reused',true);
  END IF;
  IF _part_index=0 THEN
    IF NOT ((a.status='review_required' AND p.status='uncertain'
      AND p.attempts=1 AND p.error_code='asr_outcome_uncertain'
      AND p.asr_text IS NOT NULL AND length(btrim(p.asr_text)) BETWEEN 1 AND 100000
      AND p.asr_text !~ '[А-Яа-яЁё]'
      AND p.text_sha256=encode(sha256(convert_to(p.asr_text,'UTF8')),'hex'))
      OR (a.status='pending' AND p.status='pending' AND p.attempts=0
      AND p.asr_text IS NULL AND p.text_sha256 IS NULL))
      THEN RAISE EXCEPTION 'historical_silence_held_changed'; END IF;
  ELSE
    IF a.status <> 'pending' OR p.status <> 'pending' OR p.attempts<>0
      OR p.asr_text IS NOT NULL OR p.text_sha256 IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM public.course_historical_gap_silence_proofs x
        WHERE x.audit_id=a.id AND x.part_index=0)
      THEN RAISE EXCEPTION 'historical_silence_pending_changed'; END IF;
  END IF;
  old_status:=p.status; old_hash:=p.text_sha256;
  IF old_status='uncertain' THEN
    UPDATE public.course_caption_gap_parts SET status='evidence',updated_at=now()
      WHERE audit_id=a.id AND part_index=0;
    UPDATE public.course_caption_gap_audits SET status='pending' WHERE id=a.id;
  ELSE
    UPDATE public.course_caption_gap_parts
      SET status='evidence',attempts=1,asr_text=marker,
      text_sha256=encode(sha256(convert_to(marker,'UTF8')),'hex'),updated_at=now()
      WHERE audit_id=a.id AND part_index=_part_index;
  END IF;
  INSERT INTO public.course_historical_gap_silence_proofs
    (audit_id,part_index,audio_sha256,pcm_bytes,previous_status,previous_text_sha256,verified_by)
    VALUES(a.id,_part_index,_audio_sha256,_pcm_bytes,old_status,old_hash,_actor);
  RETURN jsonb_build_object('status','evidence','reused',false);
END $$;
REVOKE ALL ON FUNCTION public.course_historical_gap_accept_digital_silence(
  uuid,uuid,integer,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.course_historical_gap_accept_digital_silence(
  uuid,uuid,integer,text,text,integer) TO service_role;

-- A silence proof can only be published with an explicit non-speech decision.
CREATE FUNCTION public.course_historical_gap_silence_decision_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE proof public.course_historical_gap_silence_proofs;
BEGIN
  FOR proof IN SELECT * FROM public.course_historical_gap_silence_proofs
    WHERE audit_id=NEW.audit_id LOOP
    IF jsonb_typeof(NEW.decisions) IS DISTINCT FROM 'array'
      OR NEW.decisions->proof.part_index->>'kind' IS DISTINCT FROM 'non_speech'
      OR NEW.decisions->proof.part_index->'text' IS DISTINCT FROM 'null'::jsonb
      THEN RAISE EXCEPTION 'historical_silence_review_required'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER course_historical_gap_silence_decision_guard
  BEFORE INSERT OR UPDATE ON public.course_gap_reviews
  FOR EACH ROW EXECUTE FUNCTION public.course_historical_gap_silence_decision_guard();
REVOKE ALL ON FUNCTION public.course_historical_gap_silence_decision_guard()
  FROM PUBLIC,anon,authenticated;
