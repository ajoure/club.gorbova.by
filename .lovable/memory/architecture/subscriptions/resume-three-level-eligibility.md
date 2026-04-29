---
name: Resume Three-Level Eligibility SOT
description: Resume подписки требует прохождения 3 уровней (local + card + provider). Backend SOT через action check-resume; UI рендерит кнопку или CTA по resume_available.
type: feature
---

# Resume Eligibility — 3-Level Check

`subscription-actions` (case `resume`) НИКОГДА не включает `auto_renew=true` пока все три уровня не пройдены. UI спрашивает backend через `action: 'check-resume'` — это единственный SOT для решения «показывать кнопку Возобновить или CTA Оформить новую».

## Уровни (порядок строгий)

1. **Local state**: `status ∈ {active, trial, trialing}` И (`auto_renew=false` ИЛИ `cancel_at` в будущем). Иначе → `not_needed`.
2. **Payment method**: подвязанная к подписке карта (или дефолтная активная карта пользователя) имеет `status='active'` И `provider_token IS NOT NULL`. Иначе → `no_payment_method`.
3. **Provider (bePaid)**: если есть записи в `provider_subscriptions` (provider='bepaid', subscription_v2_id=...), хотя бы одна должна быть в `state ∈ {active, trial}`. Если все мертвы (`canceled/expired/terminated/failed/...`) → `provider_dead`. Если provider-записей нет вообще → legacy local-only, разрешено (карта уже валидирована).

Все три пройдены → `resume_available=true, reason='ok'`.

## Audit события

- `subscription.resumed` — успешный resume. Meta: `subscription_id, user_id, auto_renew, payment_method_id, provider_subscription_id, provider_state, prior_state`.
- `subscription.resume_blocked_no_payment_method`
- `subscription.resume_blocked_provider_dead`
- `subscription.resume_blocked_not_needed`
- `subscription.resume_blocked_provider_check_failed` (зарезервировано на случай таймаутов provider-вызова; текущая локальная проверка через `provider_subscriptions.state` не таймаутит)

Meta для blocked: `subscription_id, user_id, provider_subscription_id, payment_method_id, block_reason, provider_state, prior_state, has_card`.

## UI (SubscriptionDetailSheet)

При открытии Sheet вызывается `check-resume`. Слот resume показывается при `isActive AND (cancel_at OR auto_renew=false)`:
- `resume_available=true` → кнопка «Возобновить подписку».
- `resume_available=false, reason!='not_needed'` → информационная плашка + CTA «Оформить новую подписку» (deeplink `/<product_code>#tariffs` или `/?product=<id>#tariffs`).
- `reason='not_needed'` → ничего (подписка уже нормально активна).

Все ошибки resume action нормализуются `normalizeEdgeFunctionError`, маппинги по кодам `resume_blocked_*` уже добавлены.

## prior_state

Передаётся в audit и в meta подписки:
- `cancel_scheduled` — был задан будущий `cancel_at`.
- `auto_renew_off_legacy` — `auto_renew=false`, `cancel_at IS NULL` (Ирина-кейс).
- `active_normal` — для check-resume вернёт `not_needed`.

## Запреты

- НЕ вызывать `bepaid-get-subscription-details` из user-context (это admin-only). Provider state читаем из локальной таблицы `provider_subscriptions.state`, которая обновляется sync-задачами и webhook.
- НЕ включать `auto_renew=true` без validated `payment_token`.
- НЕ показывать «Возобновить» в UI без `resume_available=true` от backend — UI больше не считает eligibility сам.
