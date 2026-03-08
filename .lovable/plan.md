

# Микропатч: TTL source-of-truth + subscription TTL

## Что меняем (2 правки, add-only)

### 1. TTL считать от `existingOrder.created_at` (колонка), а не от `meta.checkout_created_at`

**Проблема:** `meta.checkout_created_at` не гарантирован для старых заказов. `created_at` — колонка таблицы, есть всегда.

**Правка (one_time, строка ~132):**
```typescript
// Было:
const orderCreatedAt = new Date(existingOrder.meta?.checkout_created_at || existingOrder.meta?.created_at || 0).getTime();

// Станет:
const orderCreatedAt = new Date(existingOrder.created_at).getTime();
```

Для этого нужно добавить `created_at` в select (строка 112):
```typescript
.select('id, meta, created_at')
```

`meta.checkout_created_at` остаётся записываться как есть — для аналитики, но не используется для TTL.

### 2. Subscription: TTL 24 часа вместо 15 минут

**Проблема:** Subscription checkout URL может жить дольше 15 минут. TTL=15m будет лишний раз создавать новые заказы/подписки.

**Правка (subscription, строки ~362-364):**
```typescript
// Было:
const SUB_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const subMeta = (reusableProvSub?.meta || {}) as Record<string, any>;
const subCreatedAt = new Date(subMeta.checkout_created_at || existingSubOrder.meta?.checkout_created_at || 0).getTime();

// Станет:
const SUB_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const subCreatedAt = new Date(existingSubOrder.created_at).getTime();
```

И добавить `created_at` в select (строка 330):
```typescript
.select('id, meta, created_at')
```

## Файл
`supabase/functions/_shared/create-payment-checkout.ts` — 4 точечных правки (2 select + 2 TTL).

## Редеплой
`admin-create-payment-link`, `subscription-renewal-reminders`.

## НЕ трогаем
Всё остальное: логику dedup, audit_logs, actor_type, bePaid API, UI, миграции.

