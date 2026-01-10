-- Функция для автоматической связки профиля с архивным при подключении Telegram
CREATE OR REPLACE FUNCTION public.link_profile_by_telegram()
RETURNS TRIGGER AS $$
DECLARE
  archived_data record;
BEGIN
  -- Проверяем: telegram_user_id был NULL, а теперь заполнен
  IF OLD.telegram_user_id IS NULL AND NEW.telegram_user_id IS NOT NULL THEN
    
    -- Ищем архивный профиль с таким telegram_user_id или telegram_username
    SELECT id, full_name, first_name, last_name, phone, phones, emails, 
           was_club_member, email
    INTO archived_data
    FROM profiles
    WHERE id != NEW.id
      AND status = 'archived'
      AND user_id IS NULL
      AND (
        telegram_user_id = NEW.telegram_user_id
        OR (NEW.telegram_username IS NOT NULL 
            AND telegram_username = NEW.telegram_username)
      )
    LIMIT 1;
    
    IF archived_data.id IS NOT NULL THEN
      -- Переносим данные из архивного профиля
      NEW.was_club_member := COALESCE(NEW.was_club_member, archived_data.was_club_member);
      NEW.full_name := COALESCE(NULLIF(NEW.full_name, ''), archived_data.full_name);
      NEW.first_name := COALESCE(NEW.first_name, archived_data.first_name);
      NEW.last_name := COALESCE(NEW.last_name, archived_data.last_name);
      NEW.phone := COALESCE(NEW.phone, archived_data.phone);
      
      -- Объединяем массивы телефонов и emails
      NEW.phones := COALESCE(NEW.phones, '[]'::jsonb) || 
                    COALESCE(archived_data.phones, '[]'::jsonb);
      NEW.emails := COALESCE(NEW.emails, '[]'::jsonb) || 
                    COALESCE(archived_data.emails, '[]'::jsonb);
      
      -- Добавляем email из архивного профиля
      IF archived_data.email IS NOT NULL AND NEW.email IS NULL THEN
        NEW.email := archived_data.email;
      ELSIF archived_data.email IS NOT NULL THEN
        NEW.emails := NEW.emails || to_jsonb(archived_data.email);
      END IF;
      
      -- Переносим заказы
      UPDATE orders_v2 SET
        user_id = NEW.id,
        updated_at = NOW()
      WHERE user_id = archived_data.id;
      
      -- Переносим подписки
      UPDATE subscriptions_v2 SET
        user_id = NEW.id,
        updated_at = NOW()
      WHERE user_id = archived_data.id;
      
      -- Создаём entitlements для клуба
      INSERT INTO entitlements (user_id, product_code, status, expires_at, meta)
      SELECT 
        NEW.user_id,
        'club',
        'active',
        NOW() + INTERVAL '1 month',
        jsonb_build_object(
          'source', 'telegram_profile_link', 
          'original_profile_id', archived_data.id
        )
      FROM orders_v2 o
      WHERE o.user_id = NEW.id 
        AND o.status = 'paid'
        AND o.product_id = '11c9f1b8-0355-4753-bd74-40b42aa53616'
        AND NOT EXISTS (
          SELECT 1 FROM entitlements e 
          WHERE e.user_id = NEW.user_id AND e.product_code = 'club'
        );
      
      -- Удаляем архивный профиль (данные перенесены)
      DELETE FROM profiles WHERE id = archived_data.id;
      
      -- Логируем
      INSERT INTO audit_logs (actor_user_id, action, target_user_id, meta)
      VALUES (
        NEW.user_id,
        'telegram_profile_linked',
        NEW.user_id,
        jsonb_build_object(
          'archived_profile_id', archived_data.id,
          'was_club_member', archived_data.was_club_member,
          'linked_at', NOW()
        )
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Удаляем старый триггер если есть
DROP TRIGGER IF EXISTS on_telegram_linked_merge_archived ON profiles;

-- Создаем триггер на UPDATE profiles когда telegram_user_id заполняется
CREATE TRIGGER on_telegram_linked_merge_archived
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  WHEN (OLD.telegram_user_id IS NULL AND NEW.telegram_user_id IS NOT NULL)
  EXECUTE FUNCTION link_profile_by_telegram();

-- Создаем записи платежей для импортированных заказов (с user_id из заказа)
INSERT INTO payments_v2 (order_id, user_id, amount, currency, status, meta)
SELECT 
  o.id,
  o.user_id,
  o.final_price,
  o.currency,
  'succeeded'::payment_status,
  jsonb_build_object('source', 'bepaid_import', 'imported_at', NOW())
FROM orders_v2 o
WHERE o.order_number LIKE 'IMP-%'
  AND NOT EXISTS (
    SELECT 1 FROM payments_v2 p WHERE p.order_id = o.id
  );