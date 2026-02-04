# SUBSCRIPTIONS_ORIGIN_MAP.md

## Карта источников создания bePaid subscriptions

**Дата создания**: 2026-02-04  
**Статус**: Post-PATCH (после исправлений PATCH-2..PATCH-7)

---

## КРИТИЧЕСКАЯ ПРОБЛЕМА (ИСПРАВЛЕНА)

**ROOT CAUSE**: Edge Function `bepaid-create-token` использовал bePaid Subscriptions API (`POST https://api.bepaid.by/subscriptions`) для ВСЕХ рекуррентных платежей, включая случаи когда пользователь выбирал "MIT / Привязать карту".

**Последствия**:
1. "Привязать карту (MIT)" фактически НЕ токенизировал карту
2. Вместо этого создавалась реальная provider-managed subscription bePaid (30-дневный цикл)
3. Клиенты получали "скрытые" автосписания без явного согласия

---

## Источники создания bePaid subscriptions (ПОСЛЕ ПАТЧА)

### 1. Frontend → Edge Functions

| UI Экран | Компонент | Кнопка/Действие | Edge Function | Создает subscription? |
|----------|-----------|-----------------|---------------|----------------------|
| Landing + PaymentDialog | `PaymentDialog.tsx` | "Оплатить" с `paymentFlowType='mit'` | `bepaid-create-token` с `useMitTokenization=true` | **НЕТ** (ИСПРАВЛЕНО) |
| Landing + PaymentDialog | `PaymentDialog.tsx` | "Оплатить" с `paymentFlowType='provider_managed'` | `bepaid-create-subscription-checkout` | ДА (с `explicit_user_choice`) |
| /settings/payment-methods | `PaymentMethods.tsx` | "Привязать карту" | `payment-methods-tokenize` | **НЕТ** |
| /settings/payment-methods | `PaymentMethods.tsx` | "Создать подписку bePaid" | `bepaid-create-subscription` | ДА (с `explicit_user_choice`) |
| Админка ContactDetailSheet | `ContactDetailSheet.tsx` | "Перевести на bePaid" | `bepaid-admin-create-subscription-link` | ДА |

### 2. Edge Functions и их API calls

| Edge Function | API Endpoint | Назначение | Создаёт subscription |
|--------------|--------------|------------|---------------------|
| `bepaid-create-token` (isOneTime=true) | `checkout.bepaid.by` | Разовый платеж | НЕТ |
| `bepaid-create-token` (useMitTokenization=true) | `checkout.bepaid.by` с `contract: ['recurring']` | MIT токенизация | **НЕТ** (НОВОЕ) |
| `bepaid-create-token` (default, recurring) | `api.bepaid.by/subscriptions` | Legacy (для обратной совместимости) | ДА |
| `bepaid-create-subscription-checkout` | `api.bepaid.by/subscriptions` | Явный bePaid flow | ДА (guard: `explicit_user_choice`) |
| `bepaid-create-subscription` | `api.bepaid.by/subscriptions` | Переключение на bePaid | ДА (guard: `explicit_user_choice`) |
| `bepaid-admin-create-subscription-link` | `api.bepaid.by/subscriptions` | Админ-генерация ссылки | ДА |
| `payment-methods-tokenize` | `checkout.bepaid.by` с `transaction_type: 'tokenization'` | Привязка карты | **НЕТ** |
| `direct-charge` | `gateway.bepaid.by/transactions/payments` | MIT списание | НЕТ |

---

## Guards (PATCH-4)

Все функции создания bePaid subscriptions теперь требуют:

1. **`explicit_user_choice: true`** — обязательный параметр
2. **Audit log** при попытке создания без флага: `bepaid.subscription.create_blocked`
3. **403 Forbidden** при отсутствии флага

Функции с guard:
- `bepaid-create-subscription-checkout`
- `bepaid-create-subscription`

---

## Audit Log Actions

| Action | Описание |
|--------|----------|
| `bepaid.mit_checkout.create` | MIT токенизация (новый flow) |
| `bepaid.subscription.create` | Успешное создание bePaid subscription |
| `bepaid.subscription.create_blocked` | Попытка создания без explicit_user_choice |
| `bepaid.subscription_checkout.create` | Subscription checkout создан |

---

## Целевая архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│ PaymentDialog                                                   │
│                                                                 │
│ ┌─────────────────┐      ┌──────────────────────────────────┐  │
│ │ Выбор: MIT      │ ──→  │ bepaid-create-token              │  │
│ │ (Привязать карту)│      │   useMitTokenization=true       │  │
│ └─────────────────┘      │ → checkout.bepaid.by (payment)   │  │
│                          │ → contract: ['recurring']         │  │
│                          │ → НЕ создаёт subscription        │  │
│                          └──────────────────────────────────┘  │
│                                                                 │
│ ┌─────────────────┐      ┌──────────────────────────────────┐  │
│ │ Выбор: bePaid   │ ──→  │ bepaid-create-subscription-       │  │
│ │ (Подписка bePaid)│      │   checkout                       │  │
│ └─────────────────┘      │   explicit_user_choice=true      │  │
│                          │ → api.bepaid.by/subscriptions    │  │
│                          │ → Создаёт subscription bePaid    │  │
│                          └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Файлы изменённые в патче

| Файл | Изменение |
|------|-----------|
| `supabase/functions/bepaid-create-token/index.ts` | Добавлен `useMitTokenization` параметр и MIT checkout flow |
| `supabase/functions/bepaid-create-subscription-checkout/index.ts` | Guard `explicit_user_choice` |
| `supabase/functions/bepaid-create-subscription/index.ts` | Guard `explicit_user_choice` |
| `src/components/payment/PaymentDialog.tsx` | MIT → useMitTokenization, provider_managed → explicit_user_choice |
| `src/pages/settings/PaymentMethods.tsx` | explicit_user_choice при вызове subscription функций |
| `src/pages/admin/AdminBepaidSubscriptions.tsx` | Новая страница диагностики |
| `.lovable/SUBSCRIPTIONS_ORIGIN_MAP.md` | Этот документ |

---

## SQL для диагностики

```sql
-- 1. Заказы с MIT flow (новые):
SELECT id, order_number, status, meta->>'payment_flow' as flow
FROM orders
WHERE meta->>'payment_flow' = 'mit_tokenization'
ORDER BY created_at DESC LIMIT 20;

-- 2. Заказы с bePaid subscription (legacy):
SELECT id, status, meta->>'bepaid_subscription_id' as sub_id
FROM orders
WHERE meta->>'bepaid_subscription_id' IS NOT NULL
ORDER BY created_at DESC LIMIT 20;

-- 3. Попытки создания subscription без explicit_user_choice:
SELECT created_at, action, actor_label, meta
FROM audit_logs
WHERE action = 'bepaid.subscription.create_blocked'
ORDER BY created_at DESC LIMIT 50;

-- 4. MIT checkouts (новые):
SELECT created_at, action, meta
FROM audit_logs
WHERE action = 'bepaid.mit_checkout.create'
ORDER BY created_at DESC LIMIT 50;
```
