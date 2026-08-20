UPDATE public.training_modules
SET title = 'АРХИВ — ' || title,
    is_active = false,
    updated_at = now()
WHERE public_id = 'TRN-000123'
  AND title NOT LIKE 'АРХИВ — %';