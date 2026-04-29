да, согласен, с учетом правок:

1. resume_available лучше считать на backend или через единый view/helper, а не только в UI. UI не должен сам решать по разрозненным полям.
2. Если provider-check недоступен временно, не включать auto_renew=true. Возвращать safe-block:

Не удалось проверить статус подписки у провайдера. Попробуйте позже или оформите новую подписку.

3. CTA «Оформить новую подписку» должен вести на тариф этого же продукта, если product_id/tariff_id известны.
4. Audit по блокировкам должен содержать:

- subscription_id
- user_id
- provider_subscription_id
- payment_method_id
- block_reason
- provider_state, если удалось получить

Можно выполнять.

&nbsp;

План: Безопасный resume подписок с трёхуровневой проверкой (local + card + provider)

## Контекст

Пользователь Ирина (`a61b9879…`), подписка `207ed874-2b25-4d9a-add3-cbddbb7341e3` и ~187 аналогичных legacy-записей (`auto_renew=false, cancel_at=NULL, status=active`). UI показывает «Возобновить» → backend бьёт 400 «Subscription is not scheduled for cancellation». Нельзя ни молча включать `auto_renew=true`, ни глобально прятать кнопку: нужна детерминированная проверка способа списания и состояния provider-подписки.

## Архитектура решения

### Трёхуровневая проверка resume_available

Перед любой записью `auto_renew=true` обязательны ВСЕ три уровня:

1. **Local state**
  - `status = 'active'`
  - И (`auto_renew = false` ИЛИ `cancel_at` в будущем)
  - Иначе → `subscription.resume_blocked_not_needed` → «Подписка уже активна»
2. **Payment method**
  - `subscriptions_v2.payment_method_id IS NOT NULL` (или fallback: активная карта пользователя с `is_default`)
  - `payment_methods.status = 'active'`
  - `payment_methods.provider_token IS NOT NULL`
  - Иначе → `subscription.resume_blocked_no_payment_method` → «Нужно заново привязать карту или оформить новую подписку»
3. **Provider (bePaid)**
  - Если есть `provider_subscription_id` / `bepaid_subscription_id` или запись в `provider_subscriptions` — вызвать `bepaid-get-subscription-details`
  - Provider state должен быть `active`
  - Если `expired/canceled/failed/not_found` → `subscription.resume_blocked_provider_dead` → «Эту подписку нельзя возобновить, оформите новую»
  - Если provider-связи нет вовсе и подписка local-only → допускается (legacy ветка), но тогда обязательна валидная карта из шага 2

Только при прохождении всех трёх — выполнить resume и записать `subscription.resumed`.

## Шаги

### 1. Diagnose (read-only)

DoD-SQL по проблемной подписке:

```sql
SELECT s.id, s.status, s.auto_renew, s.cancel_at, s.access_end_at,
       s.payment_method_id,
       pm.status AS pm_status,
       pm.provider_token IS NOT NULL AS has_token,
       s.bepaid_subscription_id, s.provider_subscription_id
FROM subscriptions_v2 s
LEFT JOIN payment_methods pm ON pm.id = s.payment_method_id
WHERE s.id = '207ed874-2b25-4d9a-add3-cbddbb7341e3';
```

Профиль когорты `auto_renew=false AND cancel_at IS NULL AND status='active'`: разбивка по (a) с активной картой, (b) без карты, (c) с мёртвой provider-подпиской.

### 2. Backend: новая RPC / endpoint `subscription_resume_eligibility`

- Read-only резолвер, возвращает:
  ```ts
  { resume_available: boolean,
    reason: 'ok' | 'not_needed' | 'no_payment_method' | 'provider_dead',
    provider_state?: string,
    has_card: boolean }
  ```
- Используется и UI (для решения «показывать кнопку или CTA»), и edge function `subscription-actions` (для жёсткой проверки на сервере).
- Реализация: либо внутри `subscription-actions` отдельный action `'check-resume'`, либо новая лёгкая функция. Предпочтительно — action в существующей `subscription-actions` (не плодим функции).

### 3. Патч `supabase/functions/subscription-actions/index.ts` (case `'resume'`)

- Удалить текущее жёсткое условие `if (!subscription.cancel_at) → 400`.
- Прогнать три уровня (см. выше) через единый helper `evaluateResumeEligibility(supabase, subscription, userId)`.
- При `reason !== 'ok'`:
  - Записать соответствующий audit (`subscription.resume_blocked_*`) с `meta: { subscription_id, provider_state, has_card, reason }`.
  - Вернуть 400 с `code` (для маппинга в `normalizeEdgeFunctionError`) и `message`.
- При `reason === 'ok'`:
  - `auto_renew=true`, `cancel_at=NULL`, `canceled_at=NULL`, очистить `auto_renew_disabled_*`.
  - Привязать `payment_method_id` + `payment_token` из шага 2.
  - Audit `subscription.resumed` с `prior_state ∈ {'cancel_scheduled','auto_renew_off_legacy'}`, `provider_state`, `payment_method_id`.
  - Запустить `syncEntitlement` (как сейчас).

### 4. UI

Найти место кнопки «Возобновить подписку» (вероятно `src/components/subscriptions/...` или ЛК `src/pages/Dashboard.tsx`). Изменения:

- При загрузке карточки подписки звать `subscription-actions` action `check-resume` (или включить `resume_available` в существующий `useSubscriptions` хук).
- Если `resume_available === true` → показывать кнопку «Возобновить подписку».
- Если `resume_available === false` → вместо resume показывать CTA «Оформить новую подписку» (deeplink в checkout продукта).
- Все ошибки от resume action прогонять через `normalizeEdgeFunctionError`. Добавить mapping для:
  - `resume_blocked_no_payment_method` → «Нужно заново привязать карту или оформить новую подписку»
  - `resume_blocked_provider_dead` → «Эту подписку нельзя возобновить, оформите новую»
  - `resume_blocked_not_needed` → «Подписка уже активна»

### 5. Verify

- `curl` resume для `207ed874…`:
  - Без карты → 400 `resume_blocked_no_payment_method`, `auto_renew` в БД остался `false`.
  - С картой и живым provider → 200, `auto_renew=true`, `cancel_at=NULL`.
- Ещё 2-3 подписки разных классов когорты — поведение детерминированное.
- DoD-SQL после resume:
  ```sql
  -- Состояние после resume
  SELECT s.id, s.auto_renew, s.cancel_at, s.payment_method_id,
         pm.status, pm.provider_token IS NOT NULL AS has_token
  FROM subscriptions_v2 s
  LEFT JOIN payment_methods pm ON pm.id = s.payment_method_id
  WHERE s.id = '207ed874-2b25-4d9a-add3-cbddbb7341e3';
  ```
- Audit за последний час:
  ```sql
  SELECT action, meta, created_at FROM audit_logs
  WHERE created_at > now() - interval '1 hour'
    AND action IN ('subscription.resumed',
                   'subscription.resume_blocked_no_payment_method',
                   'subscription.resume_blocked_provider_dead',
                   'subscription.resume_blocked_not_needed')
  ORDER BY created_at DESC;
  ```

## DoD

- Edge function `subscription-actions` resume **никогда** не включает `auto_renew=true`, если хотя бы один уровень из {local, card, provider} не пройден.
- Все 4 audit-события (`resumed`, `resume_blocked_no_payment_method`, `resume_blocked_provider_dead`, `resume_blocked_not_needed`) пишутся корректно с `subscription_id` в `meta`.
- UI:
  - Кнопка «Возобновить подписку» показывается **только** при `resume_available=true`.
  - При `resume_available=false` показывается CTA «Оформить новую подписку».
  - Ошибки нормализуются через `normalizeEdgeFunctionError`, без сырых backend-сообщений.
- DoD-SQL по `207ed874…` приложен в отчёте: до resume + после (если проходит) или audit-запись о блокировке (если нет).
- Audit-выборка за час показывает корректные события для проверочных кейсов.
- Regress-проверка: классическая ветка (`cancel_at` в будущем + есть карта + provider жив) продолжает работать.

## Технические заметки

- `bepaid-get-subscription-details` уже существует и используется в INV-22. Переиспользуем; новых функций для provider-checks не создаём.
- В `subscriptions_v2` все нужные поля уже есть (`payment_method_id`, `payment_token`, `provider_subscription_id`, `bepaid_subscription_id`).
- В `payment_methods` ключевые поля: `status`, `provider_token`. Менять схему не нужно.
- Никаких новых таблиц/миграций.