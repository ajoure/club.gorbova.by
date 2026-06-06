# Phase 3.5-A — Stripe Access Lifecycle Inventory (Discovery, read-only)

Дата: 2026-06-06. Цель: зафиксировать текущий жизненный цикл доступа на стыке Stripe → `subscriptions_v2` → `entitlements` → Telegram, без любых правок кода/БД. Этап **3.5-B Implementation** требует отдельного approve.

## 1. Карта Stripe-статусов → текущее поведение

SOT маппинга: `_shared/stripe-subscription-resolver.ts::mapStripeSubStatus`.

| Stripe `subscription.status` | `subscriptions_v2.status` | `provider_subscriptions.state` | `entitlements` | `telegram_access` | Audit (фактический) |
|---|---|---|---|---|---|
| `incomplete` | `pending` | `pending` | не создаётся (activation = `invoice.paid`) | без изменений | `stripe.subscription.created.*` |
| `trialing` / `active` | `active` | `active` | создаётся/extend через `grant-access-for-order` на `invoice.paid` | grant через `telegram-grant-access` (canonical single path) внутри `grant-access-for-order` | `stripe.invoice.paid.activated` |
| `past_due` | `past_due` | `past_due` | **не трогается** (grace) | **не трогается** | `stripe.invoice.payment_failed` → `stripe.dunning.payment_failed` (первый раз) / `stripe.dunning.retry_failed`; ставится `meta.stripe.dunning_status='past_due_grace'` |
| `unpaid` (после Smart Retries) | `past_due` *(см. §2 — gap!)* | `past_due` | **не закрывается** | **не отзывается** | `stripe.subscription.updated.synced`; **если** до этого был `past_due_grace` — дополнительно `stripe.dunning.final_failure` (только marker, **revoke не выполняется**) |
| `canceled` (через webhook `subscription.updated` или `subscription.deleted`) | `canceled` (`cancel_reason='stripe_subscription_status_canceled'` или `'stripe_subscription_deleted'`, `auto_renew=false`) | `canceled` | **не закрывается** (комментарий в коде: `access_preserved_until_entitlements_expiry: true`) | **не отзывается** | `stripe.subscription.deleted.canceled` или `stripe.subscription.updated.synced` + `stripe.dunning.canceled_after_dunning` (если был grace) |
| `incomplete_expired` | `canceled` | `canceled` | n/a (entitlement и не создавался) | n/a | `stripe.subscription.updated.synced` |

**Ключевое:** на сегодняшний день **ни одна Stripe-ветка резолвера не отзывает доступ.** `revoke()` для Stripe-подписок в `onSubscription{Updated,Deleted}` / `onInvoicePaymentFailed` / `onInvoicePaid` **не вызывается**. Маркеры Phase 3.4 (`past_due_grace`, `recovered`, `final_failure`, `canceled_after_dunning`) пишутся, но это исключительно snapshot в `subscriptions_v2.meta.stripe.*` + audit.

## 2. Gap-матрица «цель Phase 3.5» vs «как сейчас»

| Цель | Текущее состояние | Gap |
|---|---|---|
| `past_due` сохраняет доступ | сохраняет (нет revoke-кода) | **нет gap'a**, но отсутствует явный audit-маркер `stripe.access.grace_started/finished` (есть только dunning-маркеры) |
| recovery после `invoice.paid` сохраняет/восстанавливает доступ | работает через канонический `grant-access-for-order` | gap minor: нет отдельного `stripe.access.restored` (есть `stripe.dunning.recovered`) |
| `unpaid` → revoke entitlement + Telegram | **не отзывается** | **критический gap** — требует автоматизации с guards (см. §5) |
| `canceled` после dunning → revoke | **не отзывается** | то же |
| Новая оплата → restore | restore через `grant-access-for-order` уже работает | gap minor: audit-marker |

## 3. Кто сейчас имеет право отзывать доступ (матрица revoke-writers)

Источник: `grep -l "executeRevoke\|telegram-revoke-access" supabase/functions/`.

| Writer | Триггер | Guards | Учитывает другие active entitlements | Учитывает bePaid | Безопасно для Stripe? |
|---|---|---|---|---|---|
| `_shared/access-revoker.ts::executeRevoke` | вызывается из всех ниже | `hasCommercialAccess` — пропускает revoke, если есть другой active source; пишет ledger `action_type='skip'` | **да** (через `accessValidation.ts`) | **да** (bePaid sub = active source) | да, как primitive |
| `subscriptions-reconcile` (cron) | `subscriptions_v2.cancel_at < now()` AND `status != 'canceled'` | проходит через `executeRevoke` → cross-source check | да | да | **частично** — отзывает только когда уже `cancel_at < now()`, что для Stripe-`unpaid` не наступит автоматически |
| `telegram-check-expired` (cron) | `telegram_access.active_until < now()` | `executeRevoke` + `hasCommercialAccess` | да | да | safety net на уровне Telegram-projection; не отзывает entitlement, только Telegram |
| `telegram-revoke-access` (callable) | прямой вызов с `user_id` + `club_id` | guard `telegram-revoke-safety` (требует явный `club_id`); проходит через `executeRevoke` | да | да | да |
| `telegram-kick-violators` (cron) | бизнес-правила нарушения | через `executeRevoke` | да | да | не применимо к Stripe lifecycle |
| `subscription-admin-actions` (admin manual) | админский кнопочный cancel | manual JWT actor, audit | да | да | да, ручной путь |
| `cancel-trial` | trial cancel | через executeRevoke | да | да | вне Stripe lifecycle |
| `subscription-charge` (bePaid) | bePaid charge fail flow | через executeRevoke | да | да | не трогает Stripe |
| `system-health-remediate` | админский repair | manual JWT | да | да | да |
| `telegram-process-access-queue` | синхронизация очереди | guard'ы выше | да | да | вне scope |

**Вывод:** канонический primitive `executeRevoke` уже встроен в access-validation guard и cross-provider safety. Любая Phase 3.5-B реализация должна использовать **только его** + `telegram-revoke-access` для Telegram-projection. Создавать новый writer не требуется.

## 4. Текущее закрытие entitlement

- В коде НЕТ ни одного места, где `entitlements.status` напрямую переводится в `'expired'` по Stripe-сигналу.
- `executeRevoke` пишет в `access_grant_ledger`, но **физически entitlement-строку не закрывает** — он работает на уровне «решение о revoke + skip-ledger». Закрытие entitlement выполняется отдельно:
  - в `subscriptions-reconcile` после `executeRevoke({revoked:true})` блок ниже обновляет `subscriptions_v2.access_end_at = cancel_at` (но не `entitlements`).
  - `entitlements.expires_at` истекает естественно по `GREATEST`-логике (memory: `entitlement-sync-engine`).
- Telegram-projection отзывается отдельным вызовом `telegram-revoke-access` (с явным `club_id`).

**Архитектурный вывод:** в Phase 3.5-B нельзя «просто закрыть entitlement» — нужен либо новый канонический writer закрытия entitlement по `subscription_id`, либо использовать `subscriptions-reconcile`-путь (через выставление `cancel_at = now()`), который уже идёт через `executeRevoke`.

## 5. Риск-матрица для Phase 3.5-B (предварительная)

| Риск | Серьёзность | Mitigation |
|---|---|---|
| Ложный revoke при пропущенном `invoice.paid` recovery | критический | webhook-only маркировка `final_failure`; фактический revoke только через `subscriptions-reconcile` safety net с `hasCommercialAccess` guard |
| Cross-provider: bePaid даёт доступ на тот же продукт/club | критический | `executeRevoke` уже это покрывает через `hasCommercialAccess` (commercial-only) |
| Двойной revoke (re-entry events) | средний | idempotency по `subscriptions_v2.meta.stripe.dunning_status ∈ {final_failure, canceled_after_dunning}` + idempotency в `executeRevoke` ledger |
| Telegram revoke без `club_id` | критический | memory `telegram-revoke-safety` — guard внутри `telegram-revoke-access` уже требует explicit `club_id` |
| Прямой UPDATE на `entitlements` / `telegram_access` в новом коде | критический | запрет; только через `executeRevoke` + `telegram-revoke-access` + установка `cancel_at` |
| Подписка `canceled` без dunning (нормальный self-cancel through Portal с `cancel_at_period_end`) | критический | НЕ отзывать в этом сценарии — Stripe сам выставит `cancel_at`, дальше `subscriptions-reconcile` отрабатывает естественно по `entitlements.expires_at` |
| Hard cutoff для grace | средний | по запросу оператора **не вводим** — Stripe Smart Retries = SOT |

## 6. Предложение безопасной реализации Phase 3.5-B (черновик, на отдельный approve)

Минимальная имплементация без нового writer'а:

1. **Webhook (`stripe-subscription-resolver.ts`)** — расширить ветку Phase 3.4 H (`onSubscriptionUpdated` для `unpaid`/`canceled` после `past_due_grace`): помимо marker `final_failure` / `canceled_after_dunning` устанавливать `subscriptions_v2.cancel_at = now()` (с `cancel_reason='stripe_dunning_final_failure'`). **Никакого revoke прямо из webhook**.
2. **Safety net = существующий `subscriptions-reconcile` cron** — он уже находит `cancel_at < now()` и идёт через канонический `executeRevoke` + `telegram-revoke-access` с правильными guard'ами. **Доп. код не требуется**.
3. **Add audit-only** в `onInvoicePaid`: `stripe.access.restored` после успешного `grant-access-for-order`, если предыдущий `dunning_status ∈ {final_failure, canceled_after_dunning}`.
4. **Self-cancel через Portal** не затрагивается — `subscription.deleted` без предшествующего `past_due_grace` НЕ ставит `cancel_at=now()`, а оставляет естественное истечение.

Преимущества: 0 новых writers, 0 прямых UPDATE доступа, переиспользование 3-х уровней safety (`hasCommercialAccess`, `executeRevoke` skip-ledger, явный `club_id` в Telegram).

## 7. Runtime test plan G41–G48 (для Phase 3.5-B)

Без правок кода до отдельного approve. Сценарии остаются как в плане 3.5 (см. `.lovable/plan.md`), proof собирается через Stripe test-mode (Hosted Checkout / Portal / Dashboard) + replay `stripe trigger` как fallback.

## 8. Definition of Done — Phase 3.5-A

- [x] Карта 5 Stripe-статусов → текущие изменения в `subscriptions_v2` / `entitlements` / `telegram_access` / audit.
- [x] Полная матрица revoke-writers с guards и cross-provider учётом.
- [x] Gap-матрица «цель vs текущее».
- [x] Risk register для 3.5-B.
- [x] Предложение безопасной реализации без новых writers.
- [x] Подтверждение: НИ ОДНА строка кода/БД/конфига не изменена в этом этапе.
- [ ] **Отдельный approve оператора перед Phase 3.5-B Implementation.**
