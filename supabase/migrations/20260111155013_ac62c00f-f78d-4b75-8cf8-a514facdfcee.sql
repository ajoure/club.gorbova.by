-- 1. Функция для определения правильных ID
CREATE OR REPLACE FUNCTION public.resolve_user_id(input_id uuid)
RETURNS TABLE(auth_user_id uuid, profile_id uuid, resolved_from text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Сначала проверяем, это profiles.user_id?
  SELECT p.user_id, p.id, 'direct_user_id'
  INTO auth_user_id, profile_id, resolved_from
  FROM profiles p
  WHERE p.user_id = input_id
  LIMIT 1;
  
  IF FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;
  
  -- Затем проверяем, это profiles.id?
  SELECT p.user_id, p.id, 'from_profile_id'
  INTO auth_user_id, profile_id, resolved_from
  FROM profiles p
  WHERE p.id = input_id
  LIMIT 1;
  
  IF FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;
  
  -- Не найдено
  auth_user_id := NULL;
  profile_id := NULL;
  resolved_from := 'not_found';
  RETURN NEXT;
END;
$$;

-- 2. Добавить колонку profile_id в orders_v2
ALTER TABLE public.orders_v2 ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.profiles(id);

-- 3. Триггерная функция для автоматической нормализации user_id
CREATE OR REPLACE FUNCTION public.normalize_order_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  resolved_auth_id uuid;
  resolved_profile_id uuid;
BEGIN
  -- Если user_id указан, проверяем и нормализуем
  IF NEW.user_id IS NOT NULL THEN
    -- Проверяем, это profile.id а не auth user_id?
    SELECT p.user_id, p.id INTO resolved_auth_id, resolved_profile_id
    FROM profiles p WHERE p.id = NEW.user_id;
    
    IF FOUND THEN
      -- Это был profile.id, исправляем на user_id (если он есть)
      IF resolved_auth_id IS NOT NULL THEN
        -- Сохраняем profile_id
        NEW.profile_id := resolved_profile_id;
        -- Нормализуем user_id
        NEW.user_id := resolved_auth_id;
        NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
          '_user_id_normalized', true,
          '_original_input', NEW.user_id::text,
          '_normalized_at', now()::text
        );
      ELSE
        -- Ghost profile - оставляем profile.id как user_id, но помечаем
        NEW.profile_id := resolved_profile_id;
        NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
          '_is_ghost_profile', true,
          '_profile_id', resolved_profile_id::text
        );
      END IF;
    ELSE
      -- Это уже правильный auth user_id, находим и сохраняем profile_id
      SELECT p.id INTO resolved_profile_id
      FROM profiles p WHERE p.user_id = NEW.user_id;
      
      IF FOUND THEN
        NEW.profile_id := resolved_profile_id;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- 4. Создать триггер
DROP TRIGGER IF EXISTS trg_normalize_order_user_id ON public.orders_v2;
CREATE TRIGGER trg_normalize_order_user_id
  BEFORE INSERT OR UPDATE OF user_id ON public.orders_v2
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_order_user_id();

-- 5. Исправить существующие данные: заполнить profile_id где его нет
UPDATE public.orders_v2 o
SET profile_id = p.id
FROM public.profiles p
WHERE o.profile_id IS NULL
  AND (p.user_id = o.user_id OR p.id = o.user_id);

-- 6. Исправить заказы где user_id = profile.id (должен быть auth user_id)
UPDATE public.orders_v2 o
SET 
  user_id = p.user_id,
  profile_id = p.id,
  meta = COALESCE(o.meta, '{}'::jsonb) || jsonb_build_object(
    '_user_id_fixed', true,
    '_was_profile_id', o.user_id::text,
    '_fixed_at', now()::text
  )
FROM public.profiles p
WHERE p.id = o.user_id 
  AND p.user_id IS NOT NULL 
  AND p.user_id != o.user_id;

-- 7. Индекс для быстрого поиска по profile_id
CREATE INDEX IF NOT EXISTS idx_orders_v2_profile_id ON public.orders_v2(profile_id);