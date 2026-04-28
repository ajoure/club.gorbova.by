## Stage L3.5 — Smoke Protocol (ОБЯЗАТЕЛЬНЫЙ, не откладывается)

### Шаг 1. Создать тестовую installment-ссылку
В админке /admin/payments/links → New link:
- Продукт + тариф с installment-оффером (max_months >= 2)
- Выбрать срок рассрочки (напр. 3 мес.)
- Сохранить → получить url_token

### Шаг 2. PRE-PAYMENT proof (до оплаты)
SQL — проверить, что `payment_links` записан корректно:
```sql
SELECT
  id, url_token, payment_type, amount, currency, status,
  meta->'installment'->>'selected_installment_months' as months,
  meta->'installment'->>'per_payment_amount_byn' as per_payment,
  meta->'installment'->>'total_installment_amount' as total,
  meta->'installment'->>'max_installment_months' as max_months
FROM payment_links
ORDER BY created_at DESC
LIMIT 1;
```
**Контракт PRE-PAYMENT:**
- `payment_type = 'one_time'` ✅
- `amount = per_payment × 100` (kopecks) ✅
- `meta.installment.selected_installment_months` присутствует и >= 2 ✅
- `meta.installment.total_installment_amount = per_payment × selected_months` ✅
- `meta.installment.max_installment_months >= selected_months` ✅

Если хоть одно ❌ — стоп, чиним writer (admin-create-public-link) до оплаты.

### Шаг 3. Оплатить (тестовая карта bePaid)
Перейти `/pay/<url_token>` → ввести email → оплатить.

### Шаг 4. POST-PAYMENT proof (после прихода webhook)
SQL — единый запрос-сверка:
```sql
WITH last_link_order AS (
  SELECT o.id, o.user_id, o.currency, o.meta, o.status
  FROM orders_v2 o
  WHERE (o.meta->>'installment_count')::int >= 2
    AND o.status = 'paid'
  ORDER BY o.created_at DESC
  LIMIT 1
)
SELECT
  o.id as order_id,
  o.status as order_status,
  (o.meta->>'installment_count')::int as meta_count,
  (o.meta->>'installment_per_payment_amount_byn')::numeric as meta_per_payment,
  (o.meta->>'installment_total_amount_byn')::numeric as meta_total,
  COUNT(ip.*) as actual_count,
  SUM(ip.amount)::numeric as actual_sum,
  MIN(ip.amount)::numeric as min_amt,
  MAX(ip.amount)::numeric as max_amt,
  COUNT(*) FILTER (WHERE ip.status = 'succeeded') as succeeded_count,
  COUNT(*) FILTER (WHERE ip.status = 'pending') as pending_count,
  MIN(ip.payment_number) FILTER (WHERE ip.status = 'succeeded') as first_succeeded_n
FROM last_link_order o
LEFT JOIN installment_payments ip ON ip.order_id = o.id
GROUP BY o.id, o.status, o.meta;
```

**Контракт POST-PAYMENT (все ✅ — иначе фикс):**
1. `order_status = 'paid'`
2. `meta_count = actual_count` (ровно N строк)
3. `meta_per_payment = min_amt = max_amt` (суммы одинаковые)
4. `meta_total = actual_sum`
5. `succeeded_count = 1` И `first_succeeded_n = 1` (первая платёжка succeeded)
6. `pending_count = actual_count - 1` (остальные pending)

### Шаг 5. subscriptions_v2 sanity
```sql
SELECT
  s.id, s.billing_type, s.auto_renew, s.status, s.access_end_at, s.meta
FROM subscriptions_v2 s
JOIN orders_v2 o ON o.user_id = s.user_id AND o.product_id = s.product_id
WHERE (o.meta->>'installment_count')::int >= 2
  AND o.status = 'paid'
ORDER BY o.created_at DESC, s.created_at DESC
LIMIT 1;
```
**Контракт:**
- `auto_renew = false` ✅ (рассрочка НЕ должна получить auto_renew=true)
- `billing_type` IN ('internal_installment', 'mit') — но НЕ 'provider_managed' для рассрочки
- `status = 'active'`

### Шаг 6. Idempotency proof (опционально, но желательно)
Re-fire последнего bePaid webhook через провайдерское меню или вручную retrigger.
Затем повторно прогнать запрос из Шага 4 — `actual_count` НЕ должен измениться.
В audit_logs должен появиться `installment_schedule_already_exists`:
```sql
SELECT action, meta, created_at FROM audit_logs
WHERE action IN ('installment_started', 'installment_schedule_already_exists')
ORDER BY created_at DESC LIMIT 5;
```

### Если что-то не сошлось:
- PRE-PAYMENT fail → правка `admin-create-public-link` writer (Stage L2)
- `meta_count != actual_count` → правка `public-checkout` passthrough (L3.2) или `installment-schedule.ts` (L3.1)
- `auto_renew=true` → guard в `bepaid-webhook` PATCH-LINK-INLINE не сработал (L3.3)
- Дубль на re-fire → проверить UNIQUE constraint installment_payments_order_payment_number_unique
