# Discovery: acquiring_accounts (multi-account readiness)

Дата: 2026-06-02. Статус: проектирование без миграции. Текущий режим: single-account (Stripe Poland).

## 1. Цель
Заранее зашить в архитектуру понятие «эквайринговый аккаунт», чтобы при добавлении второго/третьего Stripe-аккаунта (Stripe Company A, Stripe USA и т.д.) не пришлось переписывать adapter layer, payment_links, checkout flow и edge-функции.

**На MVP таблица НЕ создаётся.** Используется неявный single-account режим с фолбэками. Таблица появляется в Фазе 3, когда аккаунтов станет >1.

## 2. Будущая сущность `acquiring_accounts`

| Поле | Тип | Назначение |
|---|---|---|
| `id` | uuid PK | — |
| `provider` | text | `bepaid` | `stripe` |
| `account_code` | text UNIQUE | например `stripe_poland`, `stripe_company_a`, `bepaid_main` |
| `account_name` | text | человекочитаемое |
| `is_default` | bool | один true per provider |
| `status` | text | `active` | `disabled` | `test` |
| `country` | text | `PL`, `BY`, `US` |
| `currency_whitelist` | text[] | фактически поддерживаемые валюты (заполняется discovery, см. `stripe_currency_support_v1.md`) |
| `metadata` | jsonb | webhook secret reference, capabilities snapshot |
| `created_at`, `updated_at` | timestamptz | — |

## 3. Контракт чтения секретов (Фаза 1)

Новый helper `_shared/acquiring/secrets.ts`:

```ts
function getAcquiringSecret(account_code: string, key_name: string): string {
  // 1) per-account env: STRIPE_SECRET_KEY_STRIPE_POLAND
  const scoped = Deno.env.get(`${key_name}_${account_code.toUpperCase()}`);
  if (scoped) return scoped;
  // 2) fallback global env: STRIPE_SECRET_KEY (single-account режим)
  const global = Deno.env.get(key_name);
  if (global) return global;
  throw new Error(`secret_not_found:${key_name}:${account_code}`);
}
```

На MVP в Cloud secrets лежит только `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `STRIPE_PUBLISHABLE_KEY`. Когда добавится второй аккаунт — добавляются `STRIPE_SECRET_KEY_STRIPE_COMPANY_A` и т.д., БЕЗ изменения кода.

## 4. Контракт записи (Фаза 1, add-only)

- `payments_v2.meta.account_code` (текст, default `null` → резолвится в `stripe_poland` для stripe-платежей).
- `provider_subscriptions.meta.account_code`.
- `payment_links.account_code` (nullable column, добавляется миграцией Фазы 1).
- `orders_v2.meta.account_code` — snapshot на момент заказа.

## 5. Карта мест, читающих `(provider, account_code)`

| Точка | Сейчас | Фаза 1 |
|---|---|---|
| `_shared/acquiring/index.ts` (новый) `resolveAdapter(provider, account_code?)` | — | принимает оба параметра, default `account_code='stripe_poland'` |
| `_shared/create-payment-checkout.ts` | hardcode `provider='bepaid'` | принимает `provider`, `account_code` опционально |
| `stripe-create-checkout` (Фаза 2) | — | читает `account_code` из `payment_link.account_code` или из `tariff_offers.meta.stripe.account_code` |
| `stripe-webhook` (Фаза 2) | — | резолвит `account_code` по webhook signing secret (per-account endpoint) |
| `payment_links` writer | — | принимает `account_code` параметром (default null) |
| `AdminPaymentsHub` фильтры | — | фильтр по `account_code` (single-value на MVP) |

## 6. Что НЕ делаем сейчас

- ❌ Не создаём таблицу `acquiring_accounts`.
- ❌ Не строим UI multi-account.
- ❌ Не добавляем per-account routing в Stripe Dashboard (один webhook endpoint).
- ❌ Не реализуем миграцию между аккаунтами.

## 7. DoD проектирования

- ✅ Все будущие точки чтения секретов перечислены с пометкой `single-account-safe` (читают global env) vs `needs account_code` (читают per-account).
- ✅ Helper `getAcquiringSecret` спроектирован; реализация — в Фазе 1.
- ✅ Все новые поля помечены `nullable`/`default` так, что single-account работает без заполнения.
- ✅ Triple-check: ни одна сущность не предполагает, что Stripe аккаунт может быть только один.
