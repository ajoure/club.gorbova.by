UPDATE public.calls
SET transcript = NULL,
    summary = NULL,
    transcript_status = 'skipped_empty_recording',
    transcript_error = 'recording_1197b_invalid_mp3_hallucinated_transcript_purged'
WHERE public_id = 'CALL-000013';