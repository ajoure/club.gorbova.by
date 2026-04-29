&nbsp;

да, согласен, с учетом правок:

1. В миграции provider_subscriptions.order_id добавить IF NOT EXISTS и index CONCURRENTLY только если ваш migration-runner это поддерживает. Если нет — обычный index, но с коротким комментарием.
2. test-payment-complete лучше не смешивать с production-fix. Можно включить, но как отдельный подпункт PATCH-SIMULATION-CANONICAL, чтобы не блокировать checkout-fix.
3. В create-payment-checkout.ts обязательно:
  - rollback pre-created subscriptions_v2 при любой ошибке bePaid;
  - order.status='failed';
  - orders_v2.meta.last_provider_error с sanitized provider response.
4. В DoD добавить grep:

rg -n "access_days:|billing_type: 'internal_installment'|from\\('subscriptions_v2'\\).*insert" supabase/functions/_shared supabase/functions/bepaid-webhook supabase/functions/test-payment-complete

5. Старые failed-заказы не чинить в этом патче — только диагностика.

Можно выполнять.

План:

## 1. Проблема

На публичной оплате сейчас воспроизводится ошибка `Failed to pre-create subscription`. Это не «случайная» ошибка bePaid, а конкретный backend-регресс в новой ветке finite subscription для рассрочек/подписок.

Фактический root cause по логам backend:

```text
subscriptions_v2 pre-create failed:
PGRST204: Could not find the 'access_days' column of 'subscriptions_v2' in the schema cache
```

В `supabase/functions/_shared/create-payment-checkout.ts` при pre-create `subscriptions_v2` записывается top-level поле `access_days`, но в реальной таблице `subscriptions_v2` такого столбца нет. В других частях системы `access_days` хранится в `tariffs.access_days` или в `meta`, поэтому текущая вставка ломает создание checkout до вызова bePaid.

Дополнительно ревизия показала несколько мест, которые нужно исправить вместе, чтобы проблема не повторялась:

1. В webhook provider-managed подписок текущая логика после оплаты выставляет `auto_renew: true` для всех provider-managed подписок, включая finite installment. Для finite-рассрочки ожидается `auto_renew=false`.
2. В старой link-order ветке webhook есть fallback с `billing_type='internal_installment'`, но реальный constraint `subscriptions_v2.billing_type` допускает только `mit` и `provider_managed`.
3. `test-payment-complete` в симуляции вручную создает `subscriptions_v2` и `entitlements`, обходя канонический `grant-access-for-order`. Это противоречит текущему SOT и может давать расхождения между тестом и реальной оплатой.
4. `provider_subscriptions` сейчас не имеет отдельного `order_id` столбца, хотя контракт требует сохранять связь с order. Сейчас order лежит только в `meta.order_id`, что слабее для диагностики и join-proof.
5. Пользовательская ошибка сейчас пробрасывается как технический текст `Failed to pre-create subscription`, вместо нормализованного безопасного сообщения.

## 2. Диагностика

Проверено:

- `docs/ENGINEERING_RULES.md` прочитан, работаю по Diagnose → Plan → Dry run → Execute → Verify.
- Реальная схема `subscriptions_v2` не содержит `access_days`.
- Реальная схема `provider_subscriptions` содержит `subscription_v2_id`, `provider_subscription_id`, `meta`, но не содержит `order_id`.
- Constraint `subscriptions_v2_billing_type_check` допускает только:

```sql
billing_type IN ('mit', 'provider_managed')
```

- В логах `public-checkout` зафиксированы две ошибки pre-create на одной публичной ссылке:

```text
Could not find the 'access_days' column of 'subscriptions_v2'
```

- В базе уже есть failed-заказы от этих попыток:

```text
status=failed
payment_flow=renewal_subscription
payment_link_id=9cd076e2-a448-4ef0-8810-d3791310d1d8
amount=150.00 BYN
```

- В `test-payment-direct` уже используется `grant-access-for-order`, а `test-payment-complete` еще использует ручной bypass.

## 3. Предлагаемое решение

### 3.1. Срочный backend fix создания payment checkout

В `supabase/functions/_shared/create-payment-checkout.ts`:

- Убрать top-level `access_days` из insert в `subscriptions_v2`.
- Сохранять `access_days` только в `meta.access_days` / `meta.tariff_access_days`.
- При ошибке pre-create:
  - помечать `orders_v2.status='failed'`;
  - писать `orders_v2.meta.precreate_subscription_error` с safe-payload;
  - писать `audit_logs` с `action='payment_checkout.subscription_precreate_failed'`;
  - возвращать стабильный error-code, например `subscription_precreate_failed`, а не raw English.
- Сохранить уже добавленную rollback-логику после bePaid `/subscriptions` 4xx/5xx, но дополнить audit/meta proof.

### 3.2. Finite installment subscription contract

В `supabase/functions/_shared/create-payment-checkout.ts`:

- Для finite installment сохранять в `subscriptions_v2.meta`:
  - `model: 'bepaid_finite_subscription'`;
  - `installment_count`;
  - `billing_cycles`;
  - `installment_per_payment_amount_byn`;
  - `installment_total_amount_byn`;
  - `tracking_id` после получения bePaid response;
  - `access_days` из тарифа в meta, не как колонку.
- Для обычных подписок оставить прежний режим infinite provider subscription.

### 3.3. `provider_subscriptions.order_id` как явная связь

Добавить безопасную миграцию:

```sql
ALTER TABLE public.provider_subscriptions
ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders_v2(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_provider_subscriptions_order_id
ON public.provider_subscriptions(order_id)
WHERE order_id IS NOT NULL;
```

Затем backfill только там, где `meta->>'order_id'` выглядит как UUID и соответствующий order существует:

```sql
UPDATE public.provider_subscriptions ps
SET order_id = (ps.meta->>'order_id')::uuid
WHERE ps.order_id IS NULL
  AND ps.meta->>'order_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1 FROM public.orders_v2 o
    WHERE o.id = (ps.meta->>'order_id')::uuid
  );
```

В коде upsert `provider_subscriptions` дополнительно писать:

- `order_id: order.id`;
- `provider_subscription_id`;
- `subscription_v2_id`;
- `meta.tracking_id`;
- `meta.installment_count`;
- `meta.billing_cycles`.

### 3.4. Webhook fix для finite installments

В `supabase/functions/bepaid-webhook/index.ts`, provider-managed branch `subv2:{sub_id}:order:{order_id}`:

- До update определить `isInstallmentFinite` по `subscriptions_v2.meta.installment_count >= 2` или `meta.model='bepaid_finite_subscription'`.
- Для finite installment при активации:
  - `billing_type='provider_managed'`;
  - `auto_renew=false`;
  - `meta.model='bepaid_finite_subscription'` сохранить;
  - `meta.billing_cycles=N` сохранить;
  - `meta.tracking_id` сохранить;
  - audit `model: 'bepaid_finite_subscription'` оставить/усилить;
  - не материализовать `installment_payments`.
- Для обычных provider-managed подписок оставить `auto_renew=true`.

### 3.5. Старый internal installment fallback в webhook

В старой link-order ветке `bepaid-webhook`:

- Не использовать несуществующий/запрещенный `billing_type='internal_installment'`.
- Для legacy internal installment fallback использовать допустимый `billing_type='mit'` + явный `meta.model='internal_installment'` / `meta.source='bepaid_link_order_installment_fallback'`.
- Новая finite bePaid installment ветка должна обходить `installment_payments`, поэтому DoD для новых рассрочек остается `count(*) = 0`.

### 3.6. Исправить симуляцию оплаты

В `supabase/functions/test-payment-complete/index.ts`:

- Убрать ручное создание `subscriptions_v2`.
- Убрать ручной upsert `entitlements`.
- После перевода order в `paid` и создания `payments_v2` вызывать канонический `grant-access-for-order`.
- Возвращать results:
  - `order_updated`;
  - `payment_created`;
  - `grant_access_invoked`;
  - `subscription_action`;
  - `entitlement_action`;
  - ошибки grant, если есть.
- Сохранить super_admin guard.
- Добавить audit proof, что симуляция прошла через canonical grant path.

`test-payment-direct` уже ближе к канону, но будет проверен на соответствие тем же result-полям и audit-proof.

### 3.7. Нормализация UI-ошибок

В `src/utils/normalizeEdgeFunctionError.ts`:

- Добавить mapping для:
  - `subscription_precreate_failed`;
  - `bePaid subscription creation failed`;
  - `Failed to pre-create subscription`.

Пользователь должен видеть не raw backend-текст, а нормальное сообщение, например:

```text
Не удалось подготовить платёж. Мы уже зафиксировали ошибку, попробуйте ещё раз через минуту или обратитесь в поддержку.
```

В `src/pages/PublicPayPage.tsx` дополнительная логика не должна принимать бизнес-решения; только показывать нормализованную ошибку.

## 4. Изменяемые компоненты

### Edge functions

- `supabase/functions/_shared/create-payment-checkout.ts`
- `supabase/functions/bepaid-webhook/index.ts`
- `supabase/functions/test-payment-complete/index.ts`
- при необходимости точечно: `supabase/functions/test-payment-direct/index.ts`

### UI

- `src/utils/normalizeEdgeFunctionError.ts`
- при необходимости только отображение: `src/pages/PublicPayPage.tsx`

### Database

- `provider_subscriptions`: добавить nullable `order_id` + index + safe backfill.
- Не добавлять `subscriptions_v2.access_days`, потому что это противоречит текущей модели: duration берется из `tariffs.access_days` и/или `meta`.

### Не трогать

- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/types.ts`
- `.env`
- роли/права пользователей
- публичные payment links массово не инвалидировать
- старые оплаченные заказы не repair-ить в этом patch, кроме диагностического backfill `provider_subscriptions.order_id`

## 5. Dry-run

Перед Execute выполнить безопасные проверки:

### 5.1. Schema proof

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='subscriptions_v2'
ORDER BY ordinal_position;
```

Ожидание: `access_days` отсутствует.

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid='public.subscriptions_v2'::regclass;
```

Ожидание: `billing_type` только `mit/provider_managed`.

### 5.2. Failed checkout scope

```sql
SELECT count(*)
FROM orders_v2
WHERE status='failed'
  AND meta->>'payment_link_id' IS NOT NULL
  AND meta->>'payment_flow'='renewal_subscription'
  AND created_at > now() - interval '24 hours';
```

Только диагностика, без repair.

### 5.3. Backfill scope для provider_subscriptions.order_id

После добавления nullable column, до UPDATE:

```sql
SELECT count(*) AS would_backfill
FROM provider_subscriptions ps
WHERE ps.order_id IS NULL
  AND ps.meta->>'order_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1 FROM orders_v2 o
    WHERE o.id = (ps.meta->>'order_id')::uuid
  );
```

STOP если rowcount неожиданно большой или есть невалидные UUID.

### 5.4. Code dry-run

- Поиск по коду на запрещенный insert:

```text
subscriptions_v2 insert + top-level access_days
```

Ожидание после patch: таких вставок нет.

- Поиск по коду на запрещенный billing_type:

```text
billing_type: 'internal_installment'
```

Ожидание после patch: не используется как значение колонки.

## 6. Execute

1. Внести миграцию `provider_subscriptions.order_id` + index + guarded backfill.
2. Исправить `create-payment-checkout.ts`:
  - убрать top-level `access_days`;
  - усилить pre-create error audit/meta;
  - писать `provider_subscriptions.order_id`;
  - сохранить finite installment meta.
3. Исправить `bepaid-webhook/index.ts`:
  - finite installment `auto_renew=false`;
  - audit model proof;
  - убрать запрещенный `internal_installment` billing_type fallback.
4. Исправить `test-payment-complete/index.ts`:
  - перейти на `grant-access-for-order`;
  - убрать ручные writes subscriptions/entitlements;
  - audit canonical simulation.
5. Добавить нормализацию ошибок в `normalizeEdgeFunctionError.ts`.
6. Задеплоить измененные backend functions:
  - `public-checkout` если изменился shared helper;
  - `admin-create-payment-link` если использует shared helper;
  - `bepaid-create-token` если использует shared helper;
  - `subscription-renewal-reminders` если тянет shared helper;
  - `bepaid-webhook`;
  - `test-payment-complete`.

## 7. STOP-guards

Остановить Execute, если:

- реальная схема отличается от уже проверенной;
- `provider_subscriptions.order_id` уже существует с другим типом;
- backfill затрагивает неожиданно большой объем строк;
- в `subscriptions_v2` обнаружены production-зависимости от несуществующего `access_days` как колонки;
- тестовый вызов public checkout возвращает ошибку provider credentials вместо исправленного pre-create flow;
- webhook finite installment не может определить `subscription_v2_id` и `order_id` из tracking_id.

## 8. DoD

Задача считается выполненной, когда выполнены все проверки:

### 8.1. Нет текущей ошибки pre-create

- `public-checkout` больше не пишет `access_days` как колонку `subscriptions_v2`.
- Повторная попытка создать checkout для подписки/рассрочки не падает с `PGRST204`.
- Ошибка `Failed to pre-create subscription` не появляется пользователю как raw-текст.

### 8.2. Proof finite installment после тестовой оплаты

Для тестового `:order_id`:

```sql
SELECT s.id, s.status, s.billing_type, s.auto_renew,
       s.meta->>'model' AS model,
       s.meta->>'billing_cycles' AS billing_cycles,
       ps.subscription_v2_id,
       ps.order_id,
       ps.meta->>'tracking_id' AS tracking_id
FROM subscriptions_v2 s
LEFT JOIN provider_subscriptions ps ON ps.subscription_v2_id = s.id
WHERE s.order_id = :order_id;
```

Ожидание:

```text
billing_type='provider_managed'
auto_renew=false
model='bepaid_finite_subscription'
billing_cycles=N
ps.order_id=:order_id
tracking_id='subv2:{sub_id}:order:{order_id}'
```

И:

```sql
SELECT count(*)
FROM installment_payments
WHERE order_id = :order_id;
```

Ожидание:

```text
0
```

### 8.3. Simulation proof

Для `test-payment-complete`:

- нет прямого insert в `subscriptions_v2`;
- нет прямого upsert в `entitlements`;
- доступ выдается через `grant-access-for-order`;
- audit содержит proof canonical simulation.

### 8.4. Regression checks

- One-time checkout работает по старой ветке.
- Обычная provider-managed subscription сохраняет `auto_renew=true`.
- Finite installment provider-managed subscription сохраняет `auto_renew=false`.
- Старый internal installment fallback не падает на `billing_type` constraint.
- `provider_subscriptions` содержит `provider_subscription_id`, `subscription_v2_id`, `order_id`, `meta.tracking_id`, `meta.installment_count`, `meta.billing_cycles` для finite installment.

## 9. Риски и зависимости

- Если bePaid отклонит payload `/subscriptions`, checkout не будет создан, но pre-created `subscriptions_v2` должен быть rollbacked в `canceled` с meta-error. Это уже предусмотрено и будет усилено audit-proof.
- Старые failed-заказы от текущей ошибки останутся failed; их repair/cleanup — отдельный PATCH, если понадобится.
- Добавление `provider_subscriptions.order_id` безопасно как nullable column; жесткий `NOT NULL` не вводится, чтобы не ломать legacy rows.
- `provider_subscriptions` backfill не меняет платежные статусы и не влияет на доступ.

## 10. Требуется дополнительная информация

Не требуется. Причина ошибки доказана логами и схемой. После approval можно выполнять Execute.