-- Добавить колонки для отслеживания источника контактов
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS external_id_amo TEXT,
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

-- Индекс для быстрого поиска по amoCRM ID
CREATE INDEX IF NOT EXISTS idx_profiles_external_id_amo ON profiles(external_id_amo);

-- Комментарии для документации
COMMENT ON COLUMN profiles.external_id_amo IS 'ID контакта в amoCRM';
COMMENT ON COLUMN profiles.source IS 'Источник создания профиля (manual, amocrm_import, getcourse_import, etc.)';

-- Обновить ранее импортированные контакты (созданные сегодня со статусом archived)
UPDATE profiles 
SET source = 'amocrm_import'
WHERE status = 'archived' 
  AND created_at >= '2026-01-11'::date
  AND created_at < '2026-01-12'::date;