# Stripe Phase 3.1 — Discovery A1: модель acquiring accounts

Дата: 2026-06-03. Режим: read-only discovery. Никаких изменений кода/схемы.

## 1. Вывод
Существующая модель `acquiring_connections` + `_shared/acquiring/*` **полностью покрывает** требования multi-account Stripe для Phase 3.1. **Новая таблица `stripe_accounts` не нужна** и создаваться не должна — это привело бы к дублированию SOT.

## 2. SOT: `public.acquiring_connections`
Колонки (16):
- `id uuid PK`
- `provider text NOT NULL` — CHECK in (`stripe`, `bepaid`)
- `account_code text NOT NULL` — машинный ключ аккаунта (например `stripe_poland`)
- `account_name text NOT NULL` — человекочитаемое имя
- `is_default bool NOT NULL DEFAULT false`
- `test_mode bool NOT NULL DEFAULT true`
- `status text NOT NULL` — CHECK in (`pending`,`active`,`disabled`,`invalid`)
- `publishable_key text` (для фронта)
- `success_url`, `cancel_url`, `locale`
- `capabilities_snapshot jsonb NOT NULL DEFAULT '{}'` — снимок capabilities Stripe-аккаунта
- `last_verified_at`, `last_error`
- `created_at`, `updated_at`

Constraints:
- UNIQUE(`provider`, `account_code`) — `acquiring_connections_account_code_unique`
- INDEX(`provider`, `account_code`)

RLS: только `super_admin` (SELECT + ALL).

Текущие записи (test):
| provider | account_code   | account_name        | is_default | test_mode | status | last_verified_at |
|----------|----------------|---------------------|------------|-----------|--------|------------------|
| stripe   | stripe_poland  | Stripe - Gorbova.pl | true       | true      | active | 2026-06-03       |

**Вердикт**: `account_code` уже играет роль primary identifier per-account. `is_default` решает «дефолтный аккаунт» без хардкода. `test_mode` отделяет sandbox от live (используется в защите от боевых charge в `stripe-create-checkout`).

## 3. Резолверы секретов
Два слоя, оба per-account aware:

### 3.1 `_shared/acquiring/vault.ts` (канонический)
- `readAcquiringSecret(provider, account_code, kind)` — читает из Postgres Vault через SECURITY DEFINER RPC `get_acquiring_secret(p_provider, p_account_code, p_kind)`.
- Имя секрета в Vault: `acq:{provider}:{account_code}:{kind}`, где `kind ∈ {secret_key, webhook_signing_secret}`.
- Fallback на env: `STRIPE_SECRET_KEY_<ACCOUNT_CODE_UPPER>` → `STRIPE_SECRET_KEY` (single-account dev).
- Используется в `stripe-adapter.ts`, `stripe-webhook` (refund-ветка), `acquiring-test-connection` и т. д.

### 3.2 `_shared/acquiring/secrets.ts` (env-only, legacy)
- `getAcquiringSecret(account_code, key_name)` — только env, тот же fallback-порядок.
- Используется реже; основной путь — Vault.

**Вердикт**: добавление нового Stripe-аккаунта **не требует изменения кода** — оператор кладёт секреты в Vault или env по конвенции, и `account_code` сразу резолвится.

## 4. Связанные сущности (фактическое использование)
- `tariff_offers.meta.business_stream`, `products_v2.meta.business_stream` — источник `business_stream` (resolver `_shared/acquiring/business-stream-resolver.ts`, priority offer → product → override → null).
- `bepaid_product_mappings` (12 колонок, `provider text DEFAULT 'bepaid'`) — bePaid-специфичный mapping plan_title → product/tariff/offer. Stripe-аналог **не нужен**: Stripe-флоу не зависит от plan_title-маппинга, а идёт через прямые `product_id`/`tariff_id`/`offer_id` в metadata Checkout Session.
- `payment_settings` (key-value) — глобальные настройки оплаты, никакого provider-binding.
- `provider_subscriptions`, `provider_events` — уже multi-account: содержат `account_code` (см. `stripe-webhook` запись в `provider_events.account_code`).

## 5. Связь с `business_stream`
- `business_stream` — **независимая от `account_code` ось** (логический поток выручки: `accounting_school`, `consulting`, `documents`, `club`, `marketplace`, или ad-hoc string).
- Резолвится из `tariff_offers.meta.business_stream` → `products_v2.meta.business_stream` → override → `null`.
- В Stripe metadata валидируется и при отсутствии записывается `'default'` (`stripe-metadata.ts:49`). Это **gap** — фиксируется в A2.

## 6. Что НЕ покрыто существующей моделью (релевантно Phase 3.1)
1. Per-account хранение Stripe `Customer.id` для конкретного пользователя — нет места в БД. Нужно добавить в `profiles.meta.stripe.customers[account_code].customer_id` (B-этап, add-only JSON merge, миграция не требуется).
2. Per-account хранение `PaymentMethod.id` — Stripe = SOT по картам, локально хранить не нужно. Достаточно `Customer.id`.
3. Расширенная капабилити-карта (поддерживает ли аккаунт Subscriptions / Schedule / Billing Portal) — частично уже есть в `capabilities_snapshot jsonb` (заполняется `acquiring-test-connection`).

## 7. Что **не** меняется в Phase 3.1
- Schema `acquiring_connections` — без изменений.
- Schema `bepaid_product_mappings`, `payment_settings`, `provider_events`, `provider_subscriptions` — без изменений.
- Vault RPC `get_acquiring_secret` — без изменений.

## 8. Решение по таблице `stripe_accounts`
**Отклонено.** Используем существующую `acquiring_connections`. Если в будущем понадобится Stripe-специфичное расширение, оно идёт add-only в `acquiring_connections.capabilities_snapshot` или новой nullable колонке через отдельный mini-plan.
