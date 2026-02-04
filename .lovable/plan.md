# FINAL PATCH: bePaid Provider-Managed Subscriptions — последние шаги

## Статус: ✅ UI реализован

## Жёсткие правила
- Ничего не ломать; минимальный diff (add-only где возможно)
- No-PII в логах (включая console.error/console.log)
- DoD только по фактам: SQL + HTTP + UI-скрины из 7500084@gmail.com
- STOP: если видите риск записи в рабочие таблицы при invalid signature — остановиться

---

## Реализовано

### 1. User UI: PaymentMethods.tsx

✅ **Блок выбора способа оплаты** — показывается если есть активная подписка без карты
- MIT вариант с расширенным списком преимуществ:
  - Мгновенные покупки в 1 клик
  - Гибкое управление — добавляйте подписки, меняйте тарифы
  - Автоматический пересчёт при накладных подписках
  - Списание когда вам удобно — не строго каждые 30 дней
- Provider-managed вариант (bePaid):
  - Работает с картами 3D-Secure (БЕЛКАРТ и др.)
  - Автоматическое списание каждые 30 дней
  - Управление подпиской через платёжную систему

✅ **CTA для rejected карт** — под картами с verification_status='rejected' показывается предложение подключить через bePaid

✅ **Empty state для provider subscriptions** — секция остаётся скрытой если нет записей (оставлена логика as-is)

### 2. Admin UI: ContactDetailSheet.tsx

✅ **Mutation для создания provider subscription** — копирует ссылку в буфер обмена для отправки клиенту

✅ **Кнопка "→ bePaid"** — добавлена в секцию автопродления для подписок, которые ещё не provider_managed

---

## DoD тестирование (обязательное)

### 1) User flow тест
- Зайти под `7500084@gmail.com` в `/settings/payment-methods`
- Если есть активная подписка без карты → должна быть видна секция "Настройка автопродления" с двумя вариантами
- Нажать "Подключить через bePaid" → редирект на bePaid checkout
- После успеха → параметр `?bepaid_sub=success` → секция "Подписки с автопродлением" видна

### 2) Admin flow тест
- Открыть Contact Card для `7500084@gmail.com`
- В секции подписки найти строку автопродления
- Видна кнопка "→ bePaid"
- При нажатии → ссылка скопирована в буфер

### 3) Invalid signature webhook → 401 + orphan only

Curl команда:
```bash
curl -i -X POST "https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/bepaid-webhook" \
  -H "Content-Type: application/json" \
  -H "Content-Signature: invalid_signature_test" \
  -d '{"id":"sbs_test_invalidsig","transaction":{"uid":"test_uid_invalid_001","status":"successful","amount":10000},"status":"successful"}'
```

Ожидаем: HTTP 401

SQL проверки после теста:
```sql
-- Orphan появился
SELECT id, reason, provider_payment_id, created_at
FROM provider_webhook_orphans
WHERE provider_payment_id='test_uid_invalid_001'
ORDER BY created_at DESC
LIMIT 5;

-- В рабочих таблицах НИЧЕГО не появилось
SELECT * FROM payments_v2 WHERE provider='bepaid' AND provider_payment_id='test_uid_invalid_001';
SELECT * FROM orders_v2   WHERE provider='bepaid' AND provider_payment_id='test_uid_invalid_001';
```

### 4) SYSTEM ACTOR Proof
```sql
SELECT action, actor_type, actor_user_id, actor_label, created_at
FROM audit_logs
WHERE action IN (
  'bepaid.subscription.create',
  'bepaid.subscription.webhook.renewal',
  'bepaid.subscription.cancel'
)
ORDER BY created_at DESC
LIMIT 20;
```

Ожидаем: actor_type='system' и actor_user_id IS NULL

### 5) SQL проверка после создания provider subscription
```sql
SELECT id, provider_subscription_id, state, next_charge_at, amount_cents, created_at
FROM provider_subscriptions
WHERE user_id=(SELECT id FROM auth.users WHERE email='7500084@gmail.com')
ORDER BY created_at DESC
LIMIT 5;
```

---

## 3 обязательных UI-скрина (из 7500084@gmail.com)
1. **User:** `/settings/payment-methods` — видна секция "Настройка автопродления" или "Подписки с автопродлением"
2. **Admin:** Contact Card этого юзера — секция "Подписки bePaid" + кнопка "→ bePaid"
3. **Admin:** AutoRenewals — колонка "Биллинг" (MIT vs 🔄 bePaid)

---

## Мини-чеклист финального DoD
- [ ] Скрин/текст ответа curl: 401
- [ ] provider_webhook_orphans: есть строка по test_uid
- [ ] payments_v2/orders_v2 по test_uid: пусто
- [ ] provider_subscriptions: есть запись для 7500084@gmail.com
- [ ] audit_logs: system actor после create/cancel/renewal
- [ ] 3 UI-скрина
