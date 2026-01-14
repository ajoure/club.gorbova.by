-- Создаём таблицу связки entitlement_orders
CREATE TABLE IF NOT EXISTS public.entitlement_orders (
  order_id uuid PRIMARY KEY,
  entitlement_id uuid NOT NULL REFERENCES public.entitlements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  product_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_entitlement_orders_user_product
  ON public.entitlement_orders(user_id, product_code);

CREATE INDEX IF NOT EXISTS idx_entitlement_orders_entitlement_id
  ON public.entitlement_orders(entitlement_id);

-- RLS для entitlement_orders
ALTER TABLE public.entitlement_orders ENABLE ROW LEVEL SECURITY;

-- Политика: админы видят всё
CREATE POLICY "Admins can manage entitlement_orders"
  ON public.entitlement_orders
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Политика: пользователи видят свои записи
CREATE POLICY "Users can view own entitlement_orders"
  ON public.entitlement_orders
  FOR SELECT
  USING (auth.uid() = user_id);