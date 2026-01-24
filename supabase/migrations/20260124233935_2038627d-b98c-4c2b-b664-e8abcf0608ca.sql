-- 1. Добавить недостающие колонки page_key и kind
ALTER TABLE user_menu_sections 
  ADD COLUMN IF NOT EXISTS page_key text,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'page';

-- 2. Backfill существующих данных
-- Корневые секции (parent_key IS NULL) = page, page_key = их собственный key
UPDATE user_menu_sections 
SET page_key = key, kind = 'page' 
WHERE parent_key IS NULL AND page_key IS NULL;

-- Дети = tab, наследуют page_key от parent
UPDATE user_menu_sections 
SET page_key = parent_key, kind = 'tab' 
WHERE parent_key IS NOT NULL AND page_key IS NULL;

-- 3. Триггер защиты от удаления секций с модулями или детьми
CREATE OR REPLACE FUNCTION public.prevent_section_delete_with_modules()
RETURNS TRIGGER AS $$
BEGIN
  -- Проверяем наличие модулей
  IF EXISTS (SELECT 1 FROM training_modules WHERE menu_section_key = OLD.key AND is_active = true) THEN
    RAISE EXCEPTION 'Cannot delete section with associated training modules. Move modules first.';
  END IF;
  -- Проверяем наличие дочерних секций
  IF EXISTS (SELECT 1 FROM user_menu_sections WHERE parent_key = OLD.key) THEN
    RAISE EXCEPTION 'Cannot delete section with child sections. Delete children first.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Удалить триггер если существует и создать заново
DROP TRIGGER IF EXISTS check_section_before_delete ON user_menu_sections;

CREATE TRIGGER check_section_before_delete
BEFORE DELETE ON user_menu_sections
FOR EACH ROW EXECUTE FUNCTION public.prevent_section_delete_with_modules();