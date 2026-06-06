# Proof: Phase 3.5-B — Stripe Final Failure Marker for Reconcile Revoke

Status: IMPLEMENTATION DONE — runtime proof PENDING (требует Stripe test-mode подписки и прохождения Smart Retries → unpaid).

## Изменения (add-only)

Файл: `supabase/functions/_shared/stripe-subscription-resolver.ts`, H-блок `onSubscriptionUpdated`.

При `wasInGrace (past_due_grace) && stripeStatus ∈ {unpaid, canceled}` webhook теперь маркирует subv2:

| Поле | Значение |
|------|----------|
| `status` | `canceled` |
| `cancel_at` | `now()` |
| `cancel_reason` | `stripe_dunning_final_failure` (unpaid) / `stripe_dunning_canceled_after_dunning` (canceled) |
| `canceled_at` | `now()` (если NULL) |
| `auto_renew` | `false` |
| `meta.stripe.dunning_status` | `final_failure` / `canceled_after_dunning` |
| `meta.stripe.dunning_final_at` | `now()` |

Audit:
- `action`: `stripe.dunning.final_failure` / `stripe.dunning.canceled_after_dunning`
- `result`: `ok` (не manual_review — это штатное действие)
- `extra`: `revoke_scheduled_via_reconcile`, `access_revoke_path='subscriptions_reconcile.executeRevoke'`, `cancel_at`, `cancel_reason`, `dunning_marker`, `idempotent_skip_status_update`

Idempotency: при повторном webhook subv2 уже `canceled + cancel_at` → UPDATE status/cancel_at skip, маркер `dunning_status` всё равно мержится; audit фиксирует `idempotent_skip_status_update=true`, `revoke_scheduled_via_reconcile=false`.

## Что НЕ изменилось

- `onInvoicePaymentFailed` (grace-блок) — без изменений.
- `onSubscriptionDeleted` (C.3, обычный self-cancel / cancel-at-period-end) — без изменений. Новая логика срабатывает ТОЛЬКО при `wasInGrace=true`.
- `onInvoicePaid` (activation/restore) — без изменений. Restore доступа после revoke работает через стандартный `grant-access-for-order`.
- `entitlements`, `access_rules`, `telegram_access`, `access_grant_ledger` — ни одного прямого write из webhook.
- `grant-access-for-order` — без изменений.
- bePaid (`bepaid-webhook`, `subscription-charge`, bePaid-ветка reconcile) — не затронут.
- Миграций, новых RPC, новых cron, новых таблиц — нет.

## Канонический revoke-путь (read-only подтверждение)

`subscriptions-reconcile/index.ts` (строки 48–80) уже выполняет:

```ts
.from('subscriptions_v2')
.select('id, user_id, product_id, cancel_at, status')
.lt('cancel_at', now.toISOString())
…
const revokeResult = await executeRevoke(supabase, {
  …
  reconcileBasis: 'cancel_at_passed',
});
```

`executeRevoke` (`_shared/access-revoker.ts`) применяет `hasCommercialAccess` guard (cross-provider safety: если у пользователя жив другой коммерческий доступ на тот же продукт — entitlement не закрывается, Telegram не отзывается).

## Runtime Proof Plan (исполнение после Stripe test-mode прогона)

Обязательные сценарии:
- **G44a (unpaid после Smart Retries)** — тестовая карта `4000 0000 0000 0341`; ожидание окончания retries → `customer.subscription.updated unpaid` → проверить:
  - `subscriptions_v2.status='canceled'`, `cancel_at≈now()`, `cancel_reason='stripe_dunning_final_failure'`, `auto_renew=false`, `meta.stripe.dunning_status='final_failure'`;
  - `audit_logs.action='stripe.dunning.final_failure'`, `result='ok'`, `extra.revoke_scheduled_via_reconcile=true`.
- **G45 (reconcile отзывает)** — следующий запуск `subscriptions-reconcile` → `entitlement.expires_at ≤ now()` (или закрыт), `access_grant_ledger` пишет запись `reconcileBasis='cancel_at_passed'`, при наличии `access_rules.club_id` → `telegram-revoke-access` через канонический путь, `telegram_club_members.status='removed'`.
- **G48 (bePaid freeze)** — за окно теста проверить `bepaid_sync_logs` и `subscriptions_v2 where provider='bepaid'`: ни одного изменения `cancel_at`/`status`/`meta.stripe`, счётчик успешных bePaid rebill не падает.
- **Cross-provider G** — у пользователя одновременно Stripe-subv2 (после G44a canceled) и bePaid-subv2 (active) на одном продукте → после G45 `entitlement` остаётся открытым (`hasCommercialAccess` guard), Telegram не отзывается, audit `executeRevoke` фиксирует skip.
- **Idempotency G** — повторный `customer.subscription.updated unpaid` после уже выставленного `cancel_at` → новый audit с `idempotent_skip_status_update=true`, `revoke_scheduled_via_reconcile=false`; subv2 status/cancel_at не перезаписываются.

Опционально:
- **G44b (canceled_after_dunning)** — если Stripe Dashboard настроен `cancel after retries`, проверить marker `canceled_after_dunning` + `cancel_reason='stripe_dunning_canceled_after_dunning'`.
- **G46 / G47 (restore через invoice.paid + Telegram)** — новый успешный invoice.paid → стандартный `grant-access-for-order` → доступ и Telegram возвращаются.

## Definition of Done

- [x] H-блок маркирует subv2 (status/cancel_at/cancel_reason/auto_renew + meta.stripe.dunning_status/dunning_final_at).
- [x] Audit `result='ok'` + `revoke_scheduled_via_reconcile` + `access_revoke_path`.
- [x] Idempotent повторный webhook — без перезаписи status/cancel_at.
- [x] Cross-provider safety обеспечена существующим `hasCommercialAccess` в `executeRevoke`.
- [x] `grant-access-for-order`, `entitlements`, `access_rules`, `telegram-*`, bePaid — не изменены.
- [x] Миграций / новых RPC / новых cron — нет.
- [ ] Runtime proof (G44a, G45, G48, cross-provider, idempotency) — после Stripe test-mode прогона.
