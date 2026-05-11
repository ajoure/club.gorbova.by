-- Sprint: документные сценарии — фундамент
-- 1. Seed payment.* в fields_registry + document_token_registry
WITH new_fields(key, label, data_type, descr, ord) AS (
  VALUES
    ('payment.method',                  'Способ оплаты (код)',           'string', 'card / apple_pay / google_pay / erip / bank_transfer / other', 256),
    ('payment.method_label',            'Способ оплаты',                 'string', 'Карта / Apple Pay / Google Pay / ЕРИП / Банковский перевод / Иное', 257),
    ('payment.description',             'Описание платежа',              'string', 'Техническое описание платежа. Не путать с реквизитами плательщика.', 258),
    ('payment.card.brand',              'Бренд карты',                   'string', 'Может быть пустым для Apple/Google Pay', 259),
    ('payment.card.brand_normalized',   'Бренд карты (нормализованный)', 'string', 'Mastercard / Visa / Belkart / …', 260),
    ('payment.card.last4',              'Последние 4 цифры карты',       'string', 'Может быть пустым для Apple/Google Pay', 261),
    ('payment.card.holder',             'Держатель карты',               'string', 'Может быть пустым для Apple/Google Pay — это не ошибка', 262),
    ('payment.paid_at',                 'Дата оплаты',                   'date',   'Из payments_v2.paid_at', 263),
    ('payment.amount',                  'Сумма платежа',                 'number', 'Из payments_v2.amount', 264),
    ('payment.currency',                'Валюта платежа',                'string', 'Из payments_v2.currency', 265),
    ('payment.provider_transaction_id', 'ID транзакции у провайдера',    'string', 'Из payments_v2.provider_payment_id', 266),
    ('payment.external_reference',      'Внешняя ссылка/ref',            'string', 'Из payments_v2.meta.external_reference', 267)
)
INSERT INTO fields_registry (entity_type, key, label, data_type, description, display_order)
SELECT 'payment', key, label, data_type, descr, ord FROM new_fields
ON CONFLICT (entity_type, key) DO NOTHING;

WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY display_order) + 255 AS n
  FROM fields_registry WHERE entity_type='payment' AND public_id IS NULL
)
UPDATE fields_registry f
SET public_id = 'FLD-' || lpad(numbered.n::text, 6, '0')
FROM numbered WHERE f.id = numbered.id;

INSERT INTO document_token_registry
  (token_key, ui_label, description, category, source_type, field_id, resolver_key, data_type, display_order)
SELECT fr.key, fr.label, fr.description, 'payment', 'system', fr.id, fr.key, fr.data_type, fr.display_order
FROM fields_registry fr WHERE fr.entity_type='payment'
ON CONFLICT (token_key) DO NOTHING;

-- 2. RPC get_my_requisites_status() — auth.uid()-only
CREATE OR REPLACE FUNCTION public.get_my_requisites_status()
RETURNS TABLE (
  order_id uuid,
  payer_type text,
  requisites_status text,
  has_required_full_name boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    o.id,
    o.payer_type::text,
    CASE
      WHEN o.payer_type = 'individual' AND ir.id IS NOT NULL
           AND coalesce(ir.data->>'full_name','') <> '' THEN 'complete'
      WHEN o.payer_type = 'individual' THEN 'missing'
      WHEN o.payer_type = 'legal_entity' AND le.id IS NOT NULL
           AND coalesce(le.data->>'full_name','') <> '' THEN 'complete'
      ELSE 'missing'
    END,
    CASE
      WHEN o.payer_type = 'individual' THEN coalesce(ir.data->>'full_name','') <> ''
      WHEN o.payer_type = 'legal_entity' THEN coalesce(le.data->>'full_name','') <> ''
      ELSE false
    END
  FROM public.orders_v2 o
  LEFT JOIN public.individual_requisites ir
    ON ir.owner_user_id = auth.uid() AND ir.is_default = true
  LEFT JOIN public.legal_entities_requisites le
    ON le.owner_user_id = auth.uid() AND le.is_default = true
  WHERE o.user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.payments_v2 p
       WHERE p.order_id = o.id AND p.status = 'succeeded'
    );
$$;
REVOKE ALL ON FUNCTION public.get_my_requisites_status() FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_requisites_status() TO authenticated;

-- 3. RPC get_deal_requisites_status(order_id) — RBAC admin/super_admin
CREATE OR REPLACE FUNCTION public.get_deal_requisites_status(p_order_id uuid)
RETURNS TABLE (
  order_id uuid,
  payer_type text,
  payer_type_source text,
  requisites_status text,
  template_override uuid,
  executor_override uuid,
  has_required_full_name boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (
    public.has_role_v2(auth.uid(), 'super_admin') OR
    public.has_role_v2(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.payer_type::text,
    coalesce(o.meta#>>'{documents,payer_type_source}', 'auto'),
    CASE
      WHEN o.payer_type = 'individual' AND ir.id IS NOT NULL
           AND coalesce(ir.data->>'full_name','') <> '' THEN 'complete'
      WHEN o.payer_type = 'individual' THEN 'missing'
      WHEN o.payer_type = 'legal_entity' AND le.id IS NOT NULL
           AND coalesce(le.data->>'full_name','') <> '' THEN 'complete'
      ELSE 'missing'
    END,
    nullif(o.meta#>>'{documents,template_override}','')::uuid,
    nullif(o.meta#>>'{documents,executor_override}','')::uuid,
    CASE
      WHEN o.payer_type = 'individual' THEN coalesce(ir.data->>'full_name','') <> ''
      WHEN o.payer_type = 'legal_entity' THEN coalesce(le.data->>'full_name','') <> ''
      ELSE false
    END
  FROM public.orders_v2 o
  LEFT JOIN public.individual_requisites ir
    ON ir.owner_user_id = o.user_id AND ir.is_default = true
  LEFT JOIN public.legal_entities_requisites le
    ON le.owner_user_id = o.user_id AND le.is_default = true
  WHERE o.id = p_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_deal_requisites_status(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_deal_requisites_status(uuid) TO authenticated;