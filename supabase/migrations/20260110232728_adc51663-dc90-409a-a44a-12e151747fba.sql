-- Функция для автоматической связки нового пользователя с архивным профилем по email
CREATE OR REPLACE FUNCTION public.link_new_user_to_archived_profile()
RETURNS TRIGGER AS $$
DECLARE
  archived_profile_id uuid;
  archived_data record;
BEGIN
  -- Ищем архивный профиль с таким email
  SELECT id, full_name, first_name, last_name, phone, phones, emails, telegram_username, 
         telegram_user_id, was_club_member
  INTO archived_data
  FROM profiles
  WHERE (email = NEW.email OR emails @> to_jsonb(NEW.email::text))
    AND status = 'archived'
    AND user_id IS NULL
  LIMIT 1;
  
  IF archived_data.id IS NOT NULL THEN
    -- Обновляем архивный профиль: связываем с новым пользователем
    UPDATE profiles SET
      user_id = NEW.id,
      status = 'active',
      updated_at = NOW()
    WHERE id = archived_data.id;
    
    -- Переносим заказы на нового пользователя
    UPDATE orders_v2 SET
      user_id = NEW.id,
      updated_at = NOW()
    WHERE user_id = archived_data.id;
    
    -- Переносим подписки на нового пользователя
    UPDATE subscriptions_v2 SET
      user_id = NEW.id,
      updated_at = NOW()
    WHERE user_id = archived_data.id;
    
    -- Создаем entitlements для оплаченных заказов по клубу
    INSERT INTO entitlements (user_id, product_code, status, expires_at, meta)
    SELECT 
      NEW.id,
      'club',
      'active',
      NOW() + INTERVAL '1 month',
      jsonb_build_object('source', 'archived_profile_link', 'original_profile_id', archived_data.id)
    FROM orders_v2 o
    WHERE o.user_id = NEW.id 
      AND o.status = 'paid'
      AND o.product_id = '11c9f1b8-0355-4753-bd74-40b42aa53616'
      AND NOT EXISTS (
        SELECT 1 FROM entitlements e WHERE e.user_id = NEW.id AND e.product_code = 'club'
      );
    
    -- Логируем связку
    INSERT INTO audit_logs (actor_user_id, action, target_user_id, meta)
    VALUES (
      NEW.id,
      'archived_profile_linked',
      NEW.id,
      jsonb_build_object(
        'archived_profile_id', archived_data.id,
        'was_club_member', archived_data.was_club_member,
        'linked_at', NOW()
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Удаляем старый триггер если есть
DROP TRIGGER IF EXISTS on_profile_created_link_archived ON profiles;

-- Создаем триггер на создание профиля
CREATE TRIGGER on_profile_created_link_archived
  AFTER INSERT ON profiles
  FOR EACH ROW
  WHEN (NEW.user_id IS NOT NULL AND NEW.status = 'active')
  EXECUTE FUNCTION link_new_user_to_archived_profile();