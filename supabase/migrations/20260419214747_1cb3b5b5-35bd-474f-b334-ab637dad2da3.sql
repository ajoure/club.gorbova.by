-- Backfill 1: используем подтверждённый rehosted_content_type как source of truth
UPDATE public.instagram_messages
SET media_type = CASE
  WHEN (raw_payload->>'rehosted_content_type') ILIKE 'video/%' THEN 'video'
  WHEN (raw_payload->>'rehosted_content_type') ILIKE 'audio/%' THEN 'audio'
  WHEN (raw_payload->>'rehosted_content_type') ILIKE 'image/%' THEN 'image'
  ELSE media_type
END
WHERE direction = 'inbound'
  AND raw_payload ? 'rehosted_content_type'
  AND (
    ((raw_payload->>'rehosted_content_type') ILIKE 'video/%' AND media_type IS DISTINCT FROM 'video')
    OR ((raw_payload->>'rehosted_content_type') ILIKE 'audio/%' AND media_type IS DISTINCT FROM 'audio')
  );

-- Backfill 2: safety-case — URL по extension явно video/audio, а media_type='image' или NULL
UPDATE public.instagram_messages
SET media_type = 'video'
WHERE direction = 'inbound'
  AND media_url IS NOT NULL
  AND media_url ~* '\.(mp4|mov|webm|m4v)(\?|#|$)'
  AND (media_type IS NULL OR media_type IN ('image', 'file', ''));

UPDATE public.instagram_messages
SET media_type = 'audio'
WHERE direction = 'inbound'
  AND media_url IS NOT NULL
  AND media_url ~* '\.(mp3|m4a|ogg|opus|wav|aac)(\?|#|$)'
  AND (media_type IS NULL OR media_type IN ('image', 'file', ''));