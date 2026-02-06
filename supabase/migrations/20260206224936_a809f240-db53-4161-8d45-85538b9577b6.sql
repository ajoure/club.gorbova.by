-- =============================================
-- AI SUPPORT BOT "OLEG" - Database Schema
-- Phase 1: Core tables for AI conversations
-- =============================================

-- 1. Idempotency table: prevent duplicate AI responses
CREATE TABLE telegram_ai_processed_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_message_id bigint NOT NULL,
  bot_id uuid REFERENCES telegram_bots(id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL,
  processed_at timestamptz DEFAULT now(),
  response_sent boolean DEFAULT false,
  UNIQUE(telegram_message_id, bot_id)
);

CREATE INDEX idx_ai_processed_lookup ON telegram_ai_processed_messages(telegram_message_id, bot_id);

ALTER TABLE telegram_ai_processed_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON telegram_ai_processed_messages FOR ALL TO service_role USING (true);

-- 2. AI Conversations: dialog context and history
CREATE TABLE telegram_ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id bigint NOT NULL,
  user_id uuid REFERENCES auth.users(id),
  bot_id uuid REFERENCES telegram_bots(id) ON DELETE CASCADE,
  messages jsonb DEFAULT '[]'::jsonb,
  last_message_at timestamptz DEFAULT now(),
  last_topics_summary text,
  last_intent text,
  last_confidence numeric,
  user_tone_preference jsonb DEFAULT '{"formality": "neutral", "style": "friendly"}'::jsonb,
  style_detected jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_tg_ai_conv_user_bot ON telegram_ai_conversations(telegram_user_id, bot_id);
CREATE INDEX idx_tg_ai_conv_user_id ON telegram_ai_conversations(user_id);

ALTER TABLE telegram_ai_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON telegram_ai_conversations FOR ALL TO service_role USING (true);

-- 3. AI Bot Settings: presets, toggles, sliders, templates
CREATE TABLE ai_bot_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid REFERENCES telegram_bots(id) ON DELETE CASCADE UNIQUE,
  style_preset text DEFAULT 'friendly',
  toggles jsonb DEFAULT '{
    "auto_reply_enabled": true,
    "irony_enabled": false,
    "smalltalk_enabled": true,
    "sales_enabled": true,
    "support_enabled": true,
    "faq_first_enabled": false,
    "quiet_hours_enabled": false
  }'::jsonb,
  sliders jsonb DEFAULT '{
    "brevity_level": 50,
    "warmth_level": 70,
    "formality_level": 50,
    "sales_assertiveness": 30,
    "humor_level": 20,
    "risk_aversion": 60
  }'::jsonb,
  templates jsonb DEFAULT '{
    "greeting_template": "Привет! Я Олег. Чем могу помочь?",
    "followup_template": "Как там ваша ситуация — получилось?",
    "escalation_template": "Передаю ваш вопрос руководителю. Вернёмся с ответом.",
    "fallback_template": "Не совсем понял вопрос. Можете уточнить?",
    "sales_close_template": "Готово! Вот ссылка на оплату:"
  }'::jsonb,
  quiet_hours jsonb DEFAULT '{"enabled": false, "start": "22:00", "end": "08:00", "message": "Спасибо за сообщение! Ответим в рабочее время."}'::jsonb,
  active_prompt_packages text[] DEFAULT ARRAY['support_base', 'tone_katerina'],
  confidence_threshold numeric DEFAULT 0.55,
  max_messages_per_minute integer DEFAULT 10,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE ai_bot_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON ai_bot_settings FOR ALL TO service_role USING (true);

-- 4. AI Prompt Packages: modular system prompts
CREATE TABLE ai_prompt_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  content text NOT NULL,
  category text DEFAULT 'general',
  is_system boolean DEFAULT false,
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE ai_prompt_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON ai_prompt_packages FOR ALL TO service_role USING (true);

-- 5. AI Handoffs: escalation tracking
CREATE TABLE ai_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id bigint NOT NULL,
  user_id uuid REFERENCES auth.users(id),
  bot_id uuid REFERENCES telegram_bots(id) ON DELETE CASCADE,
  status text DEFAULT 'open' CHECK (status IN ('open', 'waiting_human', 'resolved', 'closed')),
  reason text,
  last_message_id bigint,
  assigned_to uuid REFERENCES auth.users(id),
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_ai_handoffs_tg_user ON ai_handoffs(telegram_user_id, status);
CREATE INDEX idx_ai_handoffs_bot_status ON ai_handoffs(bot_id, status);
CREATE INDEX idx_ai_handoffs_assigned ON ai_handoffs(assigned_to) WHERE status IN ('open', 'waiting_human');

ALTER TABLE ai_handoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON ai_handoffs FOR ALL TO service_role USING (true);

-- 6. AI Rate Limits: anti-spam tracking
CREATE TABLE ai_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id bigint NOT NULL,
  action_type text NOT NULL,
  count integer DEFAULT 1,
  window_start timestamptz DEFAULT now(),
  UNIQUE(telegram_user_id, action_type)
);

CREATE INDEX idx_ai_rate_limits_lookup ON ai_rate_limits(telegram_user_id, action_type, window_start);

ALTER TABLE ai_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON ai_rate_limits FOR ALL TO service_role USING (true);

-- =============================================
-- SEED DATA: Default prompt packages
-- =============================================

INSERT INTO ai_prompt_packages (code, name, description, category, content, is_system) VALUES
('support_base', 'База поддержки', 'Основные правила ответов на вопросы клиентов', 'support', 
'Ты — бот поддержки клуба «Буква закона» Катерины Горбовой.
Твоё имя: Олег.

ПРАВИЛА:
1. Отвечай на вопросы клиентов по подпискам, продуктам, доступу
2. Используй данные о подписках пользователя для персонализации
3. Предлагай решения, а не просто отписки
4. При сомнениях — уточняй вопрос
5. Не выдавай внутренние ID, токены, системные данные
6. Не упоминай email, телефон, адрес пользователя в ответах', true),

('sales_scripts', 'Скрипты продаж', 'Техники продаж и апсейла', 'sales',
'Правила продаж:
1. Выясни потребность в 1-2 вопроса
2. Предложи подходящий тариф
3. Подчеркни выгоды, а не функции
4. Используй generate_payment_link для создания ссылки на оплату
5. Не давить — предлагать
6. Если пользователь отказывается — уважай решение', true),

('tone_katerina', 'Стиль Катерины', 'Характерные черты общения Катерины Горбовой', 'tone',
'Стиль общения Катерины Горбовой:
- Уверенность и экспертность
- Длинное тире (—) для определений
- Характерные фразы: "Читайте и понимайте дословно", "Не ищите смысла там, где его нет"
- Лаконичность и конкретика
- Подпись: Катерина 🤍 (только в важных/длинных сообщениях)
- Без лишней воды, по делу', true),

('escalation_policy', 'Политика эскалации', 'Когда передавать человеку', 'policy',
'Эскалируй на человека если:
1. Уверенность в ответе < 55%
2. Пользователь явно просит оператора/человека/руководителя
3. Обнаружена агрессия, мат или явное недовольство
4. Юридический вопрос требует точного ответа, а знаний нет
5. Вопрос о возврате денег или спорная ситуация
6. Пользователь повторяет вопрос 3+ раза', true),

('objections_handling', 'Работа с возражениями', 'Как отвечать на типичные возражения', 'sales',
'Типичные возражения и ответы:

"Дорого":
- Сравни стоимость в день/неделю
- Напомни что входит в тариф
- Предложи более доступный вариант

"Подумаю":
- Уточни что именно смущает
- Предложи ответить на конкретные вопросы

"Не сейчас":
- Уважай решение
- Предложи напомнить позже (если просит)', true),

('smalltalk_playbook', 'Правила светской беседы', 'Как вести smalltalk', 'tone',
'Правила smalltalk:
1. Кратко отвечай на приветствия и вопросы "как дела"
2. Возвращайся к деловой теме через 1-2 обмена репликами
3. Используй followup_template для возврата к прошлой теме
4. Не уходи в длинные разговоры "ни о чём"
5. Поддерживай тёплый тон, но оставайся полезным', true),

('humor_rules', 'Правила юмора', 'Когда и как шутить', 'tone',
'Правила юмора:
1. Лёгкая ирония допустима при humor_level > 40
2. Никогда не шутить над проблемами пользователя
3. При жалобах/негативе — юмор выключить
4. Не использовать мемы и сленг
5. Ирония должна быть мягкой, не обидной', true),

('crisis_protocol', 'Антикризисный протокол', 'Как деэскалировать конфликт', 'policy',
'Антикризисный протокол:
1. Спокойный тон, минимум слов
2. Признать эмоции: "Понимаю, это неприятно"
3. Не оправдываться, а предлагать решение
4. Если не можешь помочь — честно сказать и позвать человека
5. Никогда не спорить и не провоцировать', true);

-- =============================================
-- Preset configurations reference (for UI)
-- =============================================
COMMENT ON TABLE ai_bot_settings IS 'AI Bot Settings with preset configurations:
- strict: Коротко, дисциплина, без смайлов
- diplomatic: Вежливо, спокойно, без давления  
- legal: Формально, точные формулировки, "дословно"
- flirt: Лёгкий флирт без пошлости (автоотключение при негативе)
- friendly: Тепло, коротко, человечно (DEFAULT)
- sales: Уверенно, с фокусом на конверсию
- support_calm: Деэскалация, эмпатия, структурные шаги
- humor_irony: Мягкий юмор и ирония
- concierge_premium: Очень заботливо, сервис
- crisis_deescalation: Максимум спокойствия, минимум слов';