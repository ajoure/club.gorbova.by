# D9. Provider Migration Strategy (v1)

## Принцип
На одном продукте может существовать **только одна активная подписка** независимо от провайдера и аккаунта. Любая смена = строго `cancel → supersede → create new`. Никогда не создаём новую при наличии активной старой.

## Поддерживаемые сценарии
1. **bePaid → Stripe**
2. **Stripe → bePaid**
3. **Stripe (account A) → Stripe (account B)**
4. **Stripe (account A) → Stripe (account A)** — смена тарифа на том же продукте (тоже cancel→supersede→new по правилу «другой tariff_id = новая подписка»).

## Единый протокол миграции
```
1. Pre-flight check:
   - duplicate-subscription-prevention-guard (extended):
       * cross-provider
       * cross-account_code
       * scope = product_id (не tariff)
   - Если есть active OR past_due OR pending на target product → STOP, audit `provider_migration.blocked_active_exists`, manual_review.

2. Cancel old at provider:
   - bePaid: existing cancel API
   - Stripe: subscriptions.update(cancel_at_period_end=true)
     ИЛИ subscriptions.cancel(prorate=false) для immediate
   - Для Stripe Schedule: subscription_schedules.cancel
   - Audit `provider_migration.cancel_old` (с tracking_id, provider, account_code)

3. Local supersede:
   - subscriptions_v2.status = 'superseded'
   - meta.supersede = { reason, new_provider, new_account_code, ts, actor }
   - Доступ не уменьшаем (GREATEST на entitlements)
   - Audit `provider_migration.supersede`

4. Create new under target provider/account:
   - canonical create-flow целевого провайдера (с pre-create subscriptions_v2)
   - meta.previous = { provider, account_code, subscription_id }
   - Audit `provider_migration.create_new`
```

### Запрет «двух активных»
- DB-level: расширенный guard в `pre-create` (edge-функции `bepaid-create-subscription` / `stripe-create-subscription-checkout`):
  - выборка `subscriptions_v2 where product_id=? and user_id=? and status in ('pending','active','past_due') and id != ?`
  - если > 0 → HTTP 409 с кодом `active_subscription_exists`.

### Rollback / Manual review
- Если шаг 2 (cancel old) упал → шаг 3/4 не выполняем; audit `provider_migration.cancel_failed`; manual_review.
- Если шаг 4 упал после успешного cancel old → старая остаётся canceled; новая pre-created `pending` помечается `meta.create_failed=true`; access не теряется (GREATEST).

## Existing Payment Method Migration (обязательный раздел)

### Сценарии
- bePaid карта → Stripe карта
- Stripe карта → bePaid карта
- Stripe (account A) карта → Stripe (account B) карта

### Жёсткое правило
**Токены карт между провайдерами / аккаунтами никогда не переносятся.** Каждый новый провайдер (и каждый новый Stripe `Customer` в другом аккаунте) требует новой привязки карты пользователем — через свой Checkout/Portal/SetupIntent.

### Следствия
- Никаких попыток «копировать» PaymentMethod из bePaid в Stripe или из Stripe A в Stripe B.
- При миграции пользователю показывается экран «привяжите карту в новой системе оплаты».
- Старая карта остаётся прикреплена к старой (canceled) подписке только для возможных refund.

## SOT
- Активная подписка per (user_id, product_id) — наша БД (`subscriptions_v2`).
- Состояние конкретной подписки у каждого провайдера — провайдер.

## Что хранится локально
- `subscriptions_v2.meta.supersede`, `meta.previous`, audit_logs.

## Что хранится у провайдеров
- Cancelled/active объекты подписок и связанные карты — в bePaid/Stripe соответственно.

## Recovery
- При падении в середине миграции — manual_review с полным контекстом (см. шаги audit-actions выше).

## Multi-account
- `account_code` фигурирует на каждом шаге cancel/supersede/create.
- Cross-account миграция внутри Stripe — full re-attach карты обязателен (см. Existing Payment Method Migration).
