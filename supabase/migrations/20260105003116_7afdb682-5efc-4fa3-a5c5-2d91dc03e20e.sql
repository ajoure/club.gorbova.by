-- ============================================
-- ФАЗА 1: FIELD REGISTRY (Справочник полей)
-- ============================================

-- Enum для типов сущностей
CREATE TYPE public.field_entity_type AS ENUM (
  'client', 
  'order', 
  'subscription', 
  'product', 
  'tariff', 
  'payment', 
  'company',
  'telegram_member',
  'custom'
);

-- Enum для типов данных полей
CREATE TYPE public.field_data_type AS ENUM (
  'string',
  'number', 
  'boolean',
  'date',
  'datetime',
  'money',
  'enum',
  'json',
  'email',
  'phone'
);

-- ============================================
-- Таблица справочника полей (Field Registry)
-- ============================================
CREATE TABLE public.fields (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type field_entity_type NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  data_type field_data_type NOT NULL DEFAULT 'string',
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_required BOOLEAN NOT NULL DEFAULT false,
  default_value TEXT,
  enum_options JSONB, -- для type=enum
  validation_rules JSONB, -- правила валидации
  -- Внешние ID для интеграций
  external_id_amo TEXT,
  external_id_gc TEXT,
  external_id_b24 TEXT,
  -- Метаданные
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  -- Уникальность key в рамках entity_type
  CONSTRAINT fields_entity_key_unique UNIQUE (entity_type, key)
);

-- ============================================
-- Таблица значений полей (EAV)
-- ============================================
CREATE TABLE public.field_values (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  field_id UUID NOT NULL REFERENCES public.fields(id) ON DELETE CASCADE,
  entity_type field_entity_type NOT NULL,
  entity_id UUID NOT NULL,
  -- Типизированные значения
  value_text TEXT,
  value_number NUMERIC,
  value_boolean BOOLEAN,
  value_date DATE,
  value_datetime TIMESTAMP WITH TIME ZONE,
  value_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  -- Уникальность: одно значение на поле+сущность
  CONSTRAINT field_values_unique UNIQUE (field_id, entity_type, entity_id)
);

-- Индексы для быстрого поиска
CREATE INDEX idx_field_values_entity ON public.field_values(entity_type, entity_id);
CREATE INDEX idx_field_values_field ON public.field_values(field_id);
CREATE INDEX idx_fields_entity_type ON public.fields(entity_type);
CREATE INDEX idx_fields_key ON public.fields(key);
CREATE INDEX idx_fields_external_amo ON public.fields(external_id_amo) WHERE external_id_amo IS NOT NULL;
CREATE INDEX idx_fields_external_gc ON public.fields(external_id_gc) WHERE external_id_gc IS NOT NULL;

-- Триггер обновления updated_at
CREATE TRIGGER update_fields_updated_at
  BEFORE UPDATE ON public.fields
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_field_values_updated_at
  BEFORE UPDATE ON public.field_values
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_values ENABLE ROW LEVEL SECURITY;

-- Fields: только чтение для всех, редактирование для админов
CREATE POLICY "Fields are viewable by authenticated users"
  ON public.fields FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fields are editable by admins"
  ON public.fields FOR ALL
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

-- Field values: пользователи видят только свои данные (для client)
-- Админы видят все
CREATE POLICY "Field values viewable by admins"
  ON public.field_values FOR SELECT
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

CREATE POLICY "Field values editable by admins"
  ON public.field_values FOR ALL
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

-- ============================================
-- СИСТЕМНЫЕ ПОЛЯ (is_system = true)
-- ============================================

-- CLIENT fields
INSERT INTO public.fields (entity_type, key, label, data_type, is_system, is_required, description, display_order) VALUES
('client', 'email', 'Email', 'email', true, true, 'Email клиента (первичный ключ)', 1),
('client', 'phone', 'Телефон', 'phone', true, true, 'Телефон в формате E.164', 2),
('client', 'first_name', 'Имя', 'string', true, false, 'Имя клиента', 3),
('client', 'last_name', 'Фамилия', 'string', true, false, 'Фамилия клиента', 4),
('client', 'telegram_id', 'Telegram ID', 'number', true, false, 'ID пользователя в Telegram', 5),
('client', 'telegram_username', 'Telegram Username', 'string', true, false, 'Username в Telegram', 6),
('client', 'full_name', 'Полное имя', 'string', true, false, 'Полное имя клиента', 7),
('client', 'avatar_url', 'Аватар', 'string', true, false, 'URL аватара', 8),
('client', 'status', 'Статус', 'enum', true, false, 'Статус клиента', 9);

-- ORDER fields
INSERT INTO public.fields (entity_type, key, label, data_type, is_system, is_required, description, display_order) VALUES
('order', 'order_number', 'Номер заказа', 'string', true, true, 'Уникальный номер заказа', 1),
('order', 'status', 'Статус', 'enum', true, true, 'Статус заказа', 2),
('order', 'amount', 'Сумма', 'money', true, true, 'Сумма заказа', 3),
('order', 'currency', 'Валюта', 'string', true, true, 'Валюта заказа', 4),
('order', 'payment_method', 'Способ оплаты', 'enum', true, false, 'Способ оплаты', 5),
('order', 'product_id', 'ID продукта', 'string', true, false, 'Ссылка на продукт', 6),
('order', 'tariff_id', 'ID тарифа', 'string', true, false, 'Ссылка на тариф', 7),
('order', 'discount_percent', 'Скидка %', 'number', true, false, 'Процент скидки', 8),
('order', 'final_price', 'Итоговая цена', 'money', true, false, 'Зафиксированная цена', 9),
('order', 'created_at', 'Дата создания', 'datetime', true, true, 'Дата создания заказа', 10);

-- SUBSCRIPTION fields
INSERT INTO public.fields (entity_type, key, label, data_type, is_system, is_required, description, display_order) VALUES
('subscription', 'status', 'Статус', 'enum', true, true, 'Статус подписки (active/trial/past_due/canceled/expired)', 1),
('subscription', 'access_start_at', 'Начало доступа', 'datetime', true, true, 'Дата начала доступа', 2),
('subscription', 'access_end_at', 'Окончание доступа', 'datetime', true, false, 'Дата окончания доступа', 3),
('subscription', 'next_charge_at', 'Следующее списание', 'datetime', true, false, 'Дата следующего автосписания', 4),
('subscription', 'trial_enabled', 'Trial включён', 'boolean', true, false, 'Используется trial период', 5),
('subscription', 'trial_end_at', 'Окончание trial', 'datetime', true, false, 'Дата окончания trial', 6);

-- PRODUCT fields
INSERT INTO public.fields (entity_type, key, label, data_type, is_system, is_required, description, display_order) VALUES
('product', 'product_name', 'Название', 'string', true, true, 'Название продукта', 1),
('product', 'product_code', 'Код', 'string', true, true, 'Уникальный код продукта', 2),
('product', 'description', 'Описание', 'string', true, false, 'Описание продукта', 3),
('product', 'is_active', 'Активен', 'boolean', true, false, 'Продукт активен', 4);

-- TARIFF fields  
INSERT INTO public.fields (entity_type, key, label, data_type, is_system, is_required, description, display_order) VALUES
('tariff', 'tariff_name', 'Название', 'string', true, true, 'Название тарифа', 1),
('tariff', 'tariff_code', 'Код', 'string', true, true, 'Уникальный код тарифа', 2),
('tariff', 'access_days', 'Срок доступа (дней)', 'number', true, true, 'Количество дней доступа', 3),
('tariff', 'trial_enabled', 'Trial доступен', 'boolean', true, false, 'Доступен пробный период', 4),
('tariff', 'trial_days', 'Trial дней', 'number', true, false, 'Длительность пробного периода', 5),
('tariff', 'trial_price', 'Цена trial', 'money', true, false, 'Стоимость trial (0 = бесплатно)', 6);

-- PAYMENT fields
INSERT INTO public.fields (entity_type, key, label, data_type, is_system, is_required, description, display_order) VALUES
('payment', 'amount', 'Сумма', 'money', true, true, 'Сумма платежа', 1),
('payment', 'currency', 'Валюта', 'string', true, true, 'Валюта платежа', 2),
('payment', 'status', 'Статус', 'enum', true, true, 'Статус платежа', 3),
('payment', 'payment_method', 'Метод оплаты', 'enum', true, false, 'Способ оплаты', 4),
('payment', 'provider_id', 'ID в платёжной системе', 'string', true, false, 'ID транзакции у провайдера', 5),
('payment', 'paid_at', 'Дата оплаты', 'datetime', true, false, 'Дата успешной оплаты', 6);