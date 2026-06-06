да, согласен, с учетом правок:

1. **audit result выбрать** `ok`**, не** `manual_review`

Для final-failure это уже не ручная проверка, а штатное действие:

```text
result='ok'
revoke_scheduled_via_reconcile=true
access_revoke_path='subscriptions_reconcile.executeRevoke'
```

`manual_review` использовать только если:

- не найден `subscription_v2`;
- нет связи с `provider_subscriptions`;
- конфликт данных;
- невозможно определить продукт/доступ.

2. **cancel_reason оставить отдельный**

Использовать разные причины:

```text
stripe_dunning_final_failure
stripe_dunning_canceled_after_dunning
```

Не унифицировать с `stripe_subscription_deleted`, чтобы в отчётах было понятно, что это именно финальный dunning.

3. **Reconcile не вызывать из webhook**

Оставить только cron / существующий reconcile.

Webhook только маркирует:

```text
status='canceled'
cancel_at=now()
cancel_reason=...
auto_renew=false
meta.stripe.dunning_status=...
```

Фактический revoke делает `subscriptions-reconcile`.

4. **Уточнить scope по canceled**

Не трогать обычный пользовательский self-cancel / cancel at period end.

Новая логика должна срабатывать только если:

```text
wasInGrace = true
AND stripeStatus IN ('unpaid', 'canceled')
```

То есть отмена подписки через Portal без failed-payment grace не должна запускать dunning final failure.

5. **Runtime G44b сделать optional**

Stripe test-mode не всегда удобно довести до `canceled_after_dunning`.

Обязательный runtime:

```text
G44a unpaid → marker/cancel_at
G45 reconcile revoke
G48 bePaid freeze
```

G44b можно оставить как optional, если Stripe Dashboard/test mode позволяет.

6. **Cross-provider proof обязателен**

Обязательно доказать:

```text
Stripe canceled/unpaid не снимает доступ,
если у пользователя есть другой активный коммерческий доступ через bePaid.
```

Это главный safety guard.

После этих правок Phase 3.5-B можно запускать.

&nbsp;

План: Phase 3.5-B — Stripe Final Failure Marker for Reconcile Revoke

## Контекст

Phase 3.5-A Discovery подтвердил:

- `stripe-subscription-resolver.ts` (H-блок, строки 493–527) уже маркирует `meta.stripe.dunning_status = 'final_failure' | 'canceled_after_dunning'` при переходе `past_due_grace → unpaid/canceled`, но `subv2.status`/`cancel_at` НЕ трогает и доступ НЕ отзывает (комментарий: `access_revoke_deferred_to_phase_3_5: true`).
- `subscriptions-reconcile/index.ts` (строки 48–80) уже сам закрывает доступ через канонический `executeRevoke` для всех подписок, у которых `cancel_at < now()`, провайдер-агностично.
- Все остальные операции с `entitlements`, `telegram_access`, `access_rules` остаются за reconcile и существующими writers.

Значит самый безопасный способ закрыть Phase 3.5 — НЕ писать новый revoke-writer в Stripe-webhook, а в том же H-блоке дополнительно выставить `subscriptions_v2.cancel_at = now()` + `cancel_reason`. Существующий cron `subscriptions-reconcile` сам подхватит и отзовёт доступ + Telegram через канонический путь.

## Иммутабельные правила (фиксируем перед implementation)

1. Stripe webhook НЕ вызывает `telegram-revoke-access` напрямую.
2. Stripe webhook НЕ делает UPDATE/DELETE по `entitlements`, `access_rules`, `telegram_access`, `access_grant_ledger`.
3. Stripe webhook только: ставит `cancel_at`, `status`, `cancel_reason`, `auto_renew=false`, мержит `meta.stripe.*`, пишет `audit_logs`.
4. Фактический revoke выполняет `subscriptions-reconcile` через `executeRevoke` + `hasCommercialAccess`.
5. `grant-access-for-order` НЕ меняется (restore — отдельная задача через стандартный invoice.paid).
6. bePaid (`bepaid-webhook`, `subscription-charge`, `subscriptions-reconcile` bePaid-ветка) НЕ затронут.
7. Add-only: миграций нет, новых таблиц/RPC/cron нет, существующее поведение `past_due_grace` (grace без revoke) сохраняется.

## Scope (add-only, один файл)

Файл: `supabase/functions/_shared/stripe-subscription-resolver.ts`, H-блок `onSubscriptionUpdated` (строки 493–527).

Сейчас при `wasInGrace && (stripeStatus === 'unpaid' || stripeStatus === 'canceled')`:

- merge `meta.stripe.dunning_status = final_failure | canceled_after_dunning`
- merge `meta.stripe.dunning_final_at = now()`
- audit `stripe.dunning.final_failure` / `stripe.dunning.canceled_after_dunning` с `result=manual_review`

Изменения (только внутри этой же if-ветки, без новых функций/импортов/таблиц):

1. К существующему UPDATE `subscriptions_v2.meta` добавить поля:
  - `status = 'canceled'` (если ещё не canceled — гард по текущему значению)
  - `cancel_at = now().toISOString()` (если ещё NULL или > now)
  - `cancel_reason = 'stripe_dunning_final_failure'` (для unpaid) или `'stripe_dunning_canceled_after_dunning'` (для canceled)
  - `canceled_at = now().toISOString()` (если NULL)
  - `auto_renew = false`
2. `result` audit-записи: оставить `manual_review` (уже соответствует semantics финального состояния dunning) ИЛИ заменить на `ok` с явным флагом `revoke_scheduled_via_reconcile=true` в `extra`. Решаем при approve.
3. В `extra` audit-записи добавить:
  - `revoke_scheduled_via_reconcile: true`
  - `cancel_at: <iso>`
  - `cancel_reason: <string>`
  - убрать/заменить `access_revoke_deferred_to_phase_3_5: true` на `access_revoke_path: 'subscriptions_reconcile.executeRevoke'`
4. Idempotency: гард `if (subv2.status === 'canceled' && subv2.cancel_at)` — пропускаем UPDATE статуса/cancel_at, маркер dunning_status всё равно мержим (как сейчас).
5. Cross-provider safety: текущий блок уже выполняется только если найден `provider_subscriptions` row со stripe-account_code (проверяется выше в `onSubscriptionUpdated`). Дополнительной проверки не нужно — bePaid-подписка того же продукта живёт в отдельном `subscriptions_v2` row и не затрагивается.

## Что НЕ делаем

- НЕ трогаем `onSubscriptionDeleted` (C.3, строки 535–602): он уже ставит `status=canceled`, `cancel_reason='stripe_subscription_deleted'`, `auto_renew=false`, но БЕЗ `cancel_at`. В отдельной итерации можно добавить туда такой же `cancel_at=now()`, но это вне scope 3.5-B и требует отдельного обоснования (риск: ломает natural-expiration сценарий self-cancel через Portal `cancel_at_period_end`, где `subscription.deleted` приходит в конце периода). На текущем шаге не трогаем.
- НЕ добавляем revoke-вызовы в `onInvoicePaymentFailed` (grace-блок).
- НЕ трогаем восстановление доступа (restore) — оно уже работает через стандартный `invoice.paid → grant-access-for-order` (Phase 3.5-A зафиксировал, что отдельный код не нужен).

## Stage E — Runtime Proof (read-only после деплоя)

Артефакт: `.lovable/proofs/stripe_final_failure_marker_v1.md`.

Сценарии (Stripe test mode, без изменений кода после деплоя 3.5-B):

- **G44a (unpaid после Smart Retries)**: subscription с тестовой картой `4000 0000 0000 0341`; дождаться окончания Smart Retries → Stripe переводит в `unpaid` → webhook ставит `subv2.status=canceled`, `cancel_at=now()`, `cancel_reason='stripe_dunning_final_failure'`, `meta.stripe.dunning_status='final_failure'`; audit `stripe.dunning.final_failure` с `revoke_scheduled_via_reconcile=true`.
- **G44b (canceled после Smart Retries)**: при настройке Stripe «cancel after retries» → `subscription.deleted` со статусом `canceled` приходит в `past_due_grace` → marker `canceled_after_dunning`.
- **G45 (reconcile отзывает)**: следующий запуск `subscriptions-reconcile` (или ручной вызов) находит запись с `cancel_at < now()` → `executeRevoke` закрывает `entitlements`, `access_rules`, дергает `telegram-revoke-access` через стандартный путь; ledger пишет `reconcileBasis='cancel_at_passed'`.
- **G46 (restore через invoice.paid)**: новый успешный `invoice.paid` после revoke → стандартная активация через `grant-access-for-order`, доступ возвращается, audit `stripe.invoice.paid.activated`.
- **G47 (Telegram возвращается)**: после G46 — стандартный `grant-access-for-order → telegram-grant-access` (канонический write-path).
- **G48 (bePaid не затронут)**: за тестовое окно проверить `bepaid_sync_logs` + `subscriptions_v2 where provider='bepaid'` → 0 изменений в `cancel_at`/`status`/`meta.stripe` из-за Stripe events; счётчик успешных bePaid rebill orders не падает.
- **Cross-provider G**: пользователь с двумя активными подписками (Stripe unpaid + bePaid active) на одном продукте → после G44a Stripe-subv2 закрыт, bePaid-subv2 жив, `entitlement` остаётся открытым за счёт `hasCommercialAccess` guard в `executeRevoke`, Telegram не отзывается.
- **Idempotency G**: повторный `customer.subscription.updated unpaid` после уже выставленного `cancel_at` → UPDATE статуса skip-ается, dunning_status мержится без изменений, новый audit пишется (или дедуплицируется по `provider_events_idem_unique` — фиксируем в proof).

## Definition of Done

- В H-блоке `onSubscriptionUpdated` при `past_due_grace → unpaid/canceled` ставится `cancel_at=now()`, `status=canceled`, `cancel_reason`, `auto_renew=false`.
- `meta.stripe.dunning_status` маркер сохраняется (`final_failure` / `canceled_after_dunning`).
- `subscriptions-reconcile` сам отзывает доступ + Telegram через `executeRevoke` — без новых вызовов из webhook.
- `grant-access-for-order`, `entitlements`, `access_rules`, `telegram-*` функции, bePaid-контур — не меняются.
- Runtime proof (`G44a/b`, `G45`, `G46`, `G47`, `G48`, cross-provider, idempotency) выполнен в test-mode и зафиксирован в `.lovable/proofs/stripe_final_failure_marker_v1.md`.
- Никаких миграций, новых RPC, новых cron, новых таблиц.

## Открытые вопросы оператору (решаем до execute)

1. `audit_logs.result` для final-failure: оставить `manual_review` (как сейчас) или поменять на `ok` с явным `revoke_scheduled_via_reconcile=true`? Влияет только на фильтры в admin UI.
2. `cancel_reason` для unpaid: `stripe_dunning_final_failure` или унифицировать со строкой, которую уже использует reconcile (`stripe_subscription_deleted`)? Разные строки облегчают разбор причин в репортах.
3. `subscriptions-reconcile` timing: текущий интервал крона достаточен (revoke может произойти с задержкой до интервала). Принимаем как есть или вызываем reconcile прямо из webhook после маркировки? Рекомендация: оставить cron — это и есть смысл "single write-path".