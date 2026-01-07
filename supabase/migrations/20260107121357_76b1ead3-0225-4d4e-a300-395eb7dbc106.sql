-- Таблица графика платежей рассрочки
CREATE TABLE public.installment_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions_v2(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders_v2(id) ON DELETE CASCADE,
  payment_plan_id UUID REFERENCES payment_plans(id),
  user_id UUID NOT NULL,
  
  -- График платежей
  payment_number INTEGER NOT NULL DEFAULT 1,
  total_payments INTEGER NOT NULL DEFAULT 1,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BYN',
  
  -- Сроки
  due_date TIMESTAMP WITH TIME ZONE NOT NULL,
  paid_at TIMESTAMP WITH TIME ZONE,
  
  -- Статусы: pending, processing, succeeded, failed, skipped, cancelled
  status TEXT NOT NULL DEFAULT 'pending',
  
  -- Связь с реальным платежом
  payment_id UUID REFERENCES payments_v2(id),
  error_message TEXT,
  charge_attempts INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMP WITH TIME ZONE,
  
  -- Служебные
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  meta JSONB
);

-- Индексы для быстрого поиска
CREATE INDEX idx_installment_due ON public.installment_payments(due_date, status);
CREATE INDEX idx_installment_subscription ON public.installment_payments(subscription_id);
CREATE INDEX idx_installment_user ON public.installment_payments(user_id);
CREATE INDEX idx_installment_order ON public.installment_payments(order_id);

-- Триггер обновления updated_at
CREATE TRIGGER update_installment_payments_updated_at
  BEFORE UPDATE ON public.installment_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Добавляем поле is_installment в tariff_offers
ALTER TABLE public.tariff_offers ADD COLUMN IF NOT EXISTS is_installment BOOLEAN DEFAULT false;

-- RLS политики
ALTER TABLE public.installment_payments ENABLE ROW LEVEL SECURITY;

-- Пользователи видят только свои рассрочки
CREATE POLICY "Users can view own installments"
  ON public.installment_payments
  FOR SELECT
  USING (auth.uid() = user_id);

-- Админы могут всё
CREATE POLICY "Admins can manage installments"
  ON public.installment_payments
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));

-- Системные операции (edge functions)
CREATE POLICY "System can insert installments"
  ON public.installment_payments
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update installments"
  ON public.installment_payments
  FOR UPDATE
  USING (true);