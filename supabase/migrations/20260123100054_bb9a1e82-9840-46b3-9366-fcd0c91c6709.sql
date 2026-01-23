-- PATCH 13.7: Синхронизировать email в profiles с auth.users для Глушковой Ольги
-- Причина: несовпадение email (84 vs 83) мешает привязке карты через webhook

UPDATE profiles
SET email = 'v.glushkova83@gmail.com',
    updated_at = now()
WHERE user_id = 'a27f0213-acaf-4c8a-8e7f-b6ad824936c2'
  AND email = 'v.glushkova84@gmail.com';