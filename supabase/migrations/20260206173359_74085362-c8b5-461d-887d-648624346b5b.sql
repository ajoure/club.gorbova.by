-- Добавить fallback длительность 600 секунд (10 минут) для проблемного блока видео
UPDATE lesson_blocks 
SET content = content || '{"duration_seconds": 600}'::jsonb
WHERE id = '5f4fb22c-7b28-4d5f-9fde-d977072fae00'
  AND (content->>'duration_seconds') IS NULL;