-- Шаг 1: Создаём таблицу-счётчик для ticket_number (атомарная генерация)
CREATE TABLE IF NOT EXISTS public.support_ticket_counters (
  year TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0
);

-- Включаем RLS (только сервер будет писать через SECURITY DEFINER)
ALTER TABLE public.support_ticket_counters ENABLE ROW LEVEL SECURITY;

-- Шаг 2: Функция атомарной генерации номера тикета
CREATE OR REPLACE FUNCTION public.generate_ticket_number_atomic()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_year TEXT := to_char(now(), 'YY');
  next_seq INTEGER;
BEGIN
  -- Атомарно увеличиваем счётчик или создаём новый для года
  INSERT INTO support_ticket_counters (year, seq)
  VALUES (current_year, 1)
  ON CONFLICT (year) DO UPDATE SET seq = support_ticket_counters.seq + 1
  RETURNING seq INTO next_seq;
  
  RETURN 'TKT-' || current_year || '-' || lpad(next_seq::text, 5, '0');
END;
$$;

-- Шаг 3: Основная функция создания тикета (атомарно тикет + первое сообщение)
CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_subject TEXT,
  p_description TEXT,
  p_category TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_profile_id UUID;
  v_ticket_id UUID;
  v_ticket_number TEXT;
  v_message_id UUID;
BEGIN
  -- 1. Проверяем авторизацию
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING HINT = 'User must be logged in to create a ticket';
  END IF;
  
  -- 2. Находим профиль пользователя
  SELECT id INTO v_profile_id
  FROM profiles
  WHERE user_id = v_user_id
  LIMIT 1;
  
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING HINT = 'User profile not found. Please contact support.';
  END IF;
  
  -- 3. Генерируем уникальный номер тикета
  v_ticket_number := generate_ticket_number_atomic();
  
  -- 4. Создаём тикет
  INSERT INTO support_tickets (
    ticket_number,
    subject,
    category,
    user_id,
    profile_id,
    status,
    priority
  ) VALUES (
    v_ticket_number,
    p_subject,
    COALESCE(p_category, 'general'),
    v_user_id,
    v_profile_id,
    'open',
    'normal'
  )
  RETURNING id INTO v_ticket_id;
  
  -- 5. Создаём первое сообщение (описание)
  INSERT INTO ticket_messages (
    ticket_id,
    author_id,
    author_type,
    message
  ) VALUES (
    v_ticket_id,
    v_user_id,
    'user',
    p_description
  )
  RETURNING id INTO v_message_id;
  
  -- 6. Возвращаем результат
  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', v_ticket_id,
    'ticket_number', v_ticket_number,
    'message_id', v_message_id
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'error_code', SQLSTATE
    );
END;
$$;

-- Шаг 4: Инициализируем счётчик текущим максимумом (чтобы не было коллизий с существующими)
INSERT INTO support_ticket_counters (year, seq)
SELECT 
  to_char(now(), 'YY'),
  COALESCE(
    (SELECT MAX(NULLIF(regexp_replace(ticket_number, '[^0-9]', '', 'g'), '')::integer) 
     FROM support_tickets 
     WHERE ticket_number LIKE 'TKT-' || to_char(now(), 'YY') || '-%'),
    0
  )
ON CONFLICT (year) DO UPDATE SET seq = EXCLUDED.seq
WHERE support_ticket_counters.seq < EXCLUDED.seq;

-- Шаг 5: Даём права на вызов функции аутентифицированным пользователям
GRANT EXECUTE ON FUNCTION public.create_support_ticket(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_ticket_number_atomic() TO authenticated;