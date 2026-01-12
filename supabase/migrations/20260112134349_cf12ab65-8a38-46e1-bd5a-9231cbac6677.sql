-- Patch-ТЗ v2: Переписать search_global с LIKE на FTS + проверка прав + chat_id
-- ВАЖНО: FTS выражения точно совпадают с существующими GIN индексами

CREATE OR REPLACE FUNCTION search_global(
  p_query text,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_contacts jsonb;
  v_deals jsonb;
  v_messages jsonb;
  v_user_id uuid;
BEGIN
  -- 1. ПРОВЕРКА ПРАВ (admin или users.view permission)
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  
  IF NOT (
    public.has_role(v_user_id, 'admin'::app_role) OR
    public.has_permission(v_user_id, 'users.view')
  ) THEN
    RAISE EXCEPTION 'Forbidden: admin access required' USING ERRCODE = '42501';
  END IF;

  -- 2. Контакты через FTS (соответствует индексу idx_profiles_search)
  SELECT coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb) INTO v_contacts
  FROM (
    SELECT p.id as profile_id, p.full_name, p.email, p.phone, 
           p.telegram_username, p.status
    FROM profiles p
    WHERE to_tsvector('simple', 
      coalesce(p.full_name, '') || ' ' || 
      coalesce(p.email, '') || ' ' || 
      coalesce(p.phone, '') || ' ' || 
      coalesce(p.telegram_username, '')
    ) @@ websearch_to_tsquery('simple', p_query)
    LIMIT p_limit OFFSET p_offset
  ) c;

  -- 3. Сделки через FTS (соответствует индексу idx_orders_v2_search)
  SELECT coalesce(jsonb_agg(row_to_json(d)), '[]'::jsonb) INTO v_deals
  FROM (
    SELECT o.id as order_id, o.order_number, o.status::text, o.profile_id,
           o.customer_email, o.customer_phone, p.full_name as contact_name
    FROM orders_v2 o
    LEFT JOIN profiles p ON p.id = o.profile_id
    WHERE to_tsvector('simple', 
      coalesce(o.order_number, '') || ' ' || 
      coalesce(o.customer_email, '') || ' ' || 
      coalesce(o.customer_phone, '')
    ) @@ websearch_to_tsquery('simple', p_query)
    LIMIT p_limit OFFSET p_offset
  ) d;

  -- 4. Сообщения через FTS (соответствует idx_telegram_messages_fts и idx_tg_chat_messages_fts)
  SELECT coalesce(jsonb_agg(row_to_json(m)), '[]'::jsonb) INTO v_messages
  FROM (
    -- Приватные сообщения
    SELECT 
      tm.id,
      'private'::text as source,
      left(tm.message_text, 150) as snippet,
      tm.created_at,
      tm.user_id,
      tm.telegram_user_id,     -- ОБЯЗАТЕЛЬНО для private
      NULL::bigint as chat_id, -- NULL для private
      p.id as profile_id,
      p.full_name as contact_name
    FROM telegram_messages tm
    LEFT JOIN profiles p ON p.user_id = tm.user_id
    WHERE to_tsvector('simple', coalesce(tm.message_text, '')) 
          @@ websearch_to_tsquery('simple', p_query)
    
    UNION ALL
    
    -- Групповые сообщения
    SELECT 
      tcm.id,
      'group'::text as source,
      left(tcm.text, 150) as snippet,
      tcm.created_at,
      NULL::uuid as user_id,
      tcm.from_tg_user_id as telegram_user_id, -- отправитель
      tcm.chat_id,                              -- ОБЯЗАТЕЛЬНО для group
      p.id as profile_id,
      coalesce(p.full_name, tcm.from_display_name) as contact_name
    FROM tg_chat_messages tcm
    LEFT JOIN profiles p ON p.telegram_user_id = tcm.from_tg_user_id
    WHERE to_tsvector('simple', coalesce(tcm.text, '')) 
          @@ websearch_to_tsquery('simple', p_query)
    
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) m;

  RETURN jsonb_build_object(
    'contacts', v_contacts,
    'deals', v_deals,
    'messages', v_messages
  );
END;
$$;