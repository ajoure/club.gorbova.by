-- 1. FTS индекс для telegram_messages (приватные сообщения)
CREATE INDEX IF NOT EXISTS idx_telegram_messages_fts 
ON telegram_messages USING gin(to_tsvector('simple', coalesce(message_text, '')));

-- 2. FTS индекс для tg_chat_messages (групповые сообщения)
CREATE INDEX IF NOT EXISTS idx_tg_chat_messages_fts 
ON tg_chat_messages USING gin(to_tsvector('simple', coalesce(text, '')));

-- 3. FTS индекс для orders_v2 (заказы)
CREATE INDEX IF NOT EXISTS idx_orders_v2_search 
ON orders_v2 USING gin(to_tsvector('simple', 
  coalesce(order_number, '') || ' ' || 
  coalesce(customer_email, '') || ' ' || 
  coalesce(customer_phone, '')
));

-- 4. FTS индекс для profiles (контакты)
CREATE INDEX IF NOT EXISTS idx_profiles_search 
ON profiles USING gin(to_tsvector('simple', 
  coalesce(full_name, '') || ' ' || 
  coalesce(email, '') || ' ' || 
  coalesce(phone, '') || ' ' || 
  coalesce(telegram_username, '')
));

-- 5. RPC функция search_global
CREATE OR REPLACE FUNCTION search_global(
  p_query text,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_contacts jsonb;
  v_deals jsonb;
  v_messages jsonb;
  v_query text;
BEGIN
  -- Очистка запроса для LIKE
  v_query := '%' || lower(trim(p_query)) || '%';
  
  -- 1. Поиск контактов (profiles)
  SELECT coalesce(jsonb_agg(row_to_json(c)), '[]')
  INTO v_contacts
  FROM (
    SELECT 
      p.id as profile_id,
      p.full_name,
      p.email,
      p.phone,
      p.telegram_username,
      p.status
    FROM profiles p
    WHERE lower(coalesce(p.full_name, '')) LIKE v_query
       OR lower(coalesce(p.email, '')) LIKE v_query
       OR lower(coalesce(p.phone, '')) LIKE v_query
       OR lower(coalesce(p.telegram_username, '')) LIKE v_query
    LIMIT p_limit OFFSET p_offset
  ) c;

  -- 2. Поиск сделок (orders_v2)
  SELECT coalesce(jsonb_agg(row_to_json(d)), '[]')
  INTO v_deals
  FROM (
    SELECT 
      o.id as order_id,
      o.order_number,
      o.status::text as status,
      o.profile_id,
      o.customer_email,
      o.customer_phone,
      p.full_name as contact_name
    FROM orders_v2 o
    LEFT JOIN profiles p ON p.id = o.profile_id
    WHERE lower(coalesce(o.order_number, '')) LIKE v_query
       OR lower(coalesce(o.customer_email, '')) LIKE v_query
       OR lower(coalesce(o.customer_phone, '')) LIKE v_query
    LIMIT p_limit OFFSET p_offset
  ) d;

  -- 3. Поиск сообщений Telegram (private + group)
  SELECT coalesce(jsonb_agg(row_to_json(m)), '[]')
  INTO v_messages
  FROM (
    -- Приватные сообщения
    SELECT 
      tm.id,
      'private' as source,
      left(tm.message_text, 150) as snippet,
      tm.created_at,
      tm.user_id,
      tm.telegram_user_id,
      p.id as profile_id,
      p.full_name as contact_name
    FROM telegram_messages tm
    LEFT JOIN profiles p ON p.user_id = tm.user_id
    WHERE lower(tm.message_text) LIKE v_query
    
    UNION ALL
    
    -- Групповые сообщения
    SELECT 
      tcm.id,
      'group' as source,
      left(tcm.text, 150) as snippet,
      tcm.created_at,
      NULL as user_id,
      tcm.from_tg_user_id as telegram_user_id,
      p.id as profile_id,
      coalesce(p.full_name, tcm.from_display_name) as contact_name
    FROM tg_chat_messages tcm
    LEFT JOIN profiles p ON p.telegram_user_id = tcm.from_tg_user_id
    WHERE lower(tcm.text) LIKE v_query
    
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) m;

  -- Собираем результат
  v_result := jsonb_build_object(
    'contacts', v_contacts,
    'deals', v_deals,
    'messages', v_messages
  );

  RETURN v_result;
END;
$$;