# PATCH-RB1.2 — fix payment rebind in runRebillFlow + STEP E re-routing

## Root cause (Case A live-fail)

Subscription webhook (`supabase/functions/bepaid-webhook/index.ts`, line ~1735) выполнял **STEP E** `upsertPaymentV2(order_id: orderV2Id = PARENT)` безусловно, даже после успешного `runRebillFlow` с `rebillHandled=true`. Это перетирало `payments_v2.order_id` обратно с REBILL-order на parent. `materialized` audit писался ДО этого перетирания и поэтому казался корректным.

Дополнительный риск: `updatePaymentOrderId` в адаптере и inline-deps link_order не верифицировал `affected_rows`. Тихий no-op был бы возможен.

## Изменения (минимальные, хирургические)

### 1. `index.ts` — subscription webhook
- Захват `rebillOrderIdFromFlow` из `rebillResult.rebill_order_id` рядом с `rebillHandled=true`.
- STEP E теперь использует `stepEOrderId = rebillHandled && rebillOrderIdFromFlow ? rebillOrderIdFromFlow : orderV2Id`.
- В `meta` payment добавлены маркеры `rebill_order_id` + `step_e_routed_to_rebill: true`, если шёл REBILL-маршрут.
- После STEP E добавлен **post-check**: `findPaymentByProviderUid` → если `order_id != rebillOrderIdFromFlow` → audit `bepaid.rebill.payment_rebind_post_check_failed` (severity=CRITICAL).

### 2. `index.ts` — link_order inline deps (line ~2693)
- `updatePaymentOrderId` теперь делает `.select('id')` и валидирует `affected_rows === 1`; иначе бросает `payment_rebind_failed:affected_rows=N`.

### 3. `rebill_deps_adapter.ts`
- Та же проверка `affected_rows === 1` в адаптерном `updatePaymentOrderId`.

### 4. `rebill_flow.ts`
- В fresh-flow ветке после `ensurePaymentRepointed.ok=false` теперь пишется **два** audit-row:
  - `bepaid.rebill.payment_rebind_failed` (новый, severity=CRITICAL, explicit cause)
  - `bepaid.rebill.materialized_partial` (legacy backwards-compat)
- В fresh-flow ветке после `grant.ok=true` добавлена **post-grant verify**:
  ```ts
  const verify = await deps.findMainPaymentByUid(input.payment.uid);
  if (!verify || verify.order_id !== rebillOrderId) {
    // audit: bepaid.rebill.payment_rebind_post_check_failed
    // materialization_status = partial_payment_rebind_post_check_failed
    return { decision: "materialized_partial", reason: "payment_rebind_post_check_failed", ... };
  }
  ```
  `materialized` audit теперь пишется ТОЛЬКО после прохождения post-check.

## Контракт (после фикса)

`bepaid.rebill.materialized` гарантирует одновременно:
1. REBILL-order существует со `status='paid'`;
2. payment row существует;
3. `payments_v2.order_id = REBILL-order.id` (post-check);
4. `grant-access-for-order` вернул success (или legacy short-circuit принят).

Любое нарушение → `materialized_partial` + один из:
- `bepaid.rebill.payment_rebind_failed` (repoint UPDATE упал / affected_rows!=1);
- `bepaid.rebill.payment_rebind_post_check_failed` (post-grant verify не сошёлся);
- `bepaid.rebill.materialized_grant_failed` (grant вернул error).

## Регрессионные тесты

`supabase/functions/bepaid-webhook/patch_rb1_2_post_check_test.ts` — 5 тестов:

| # | Сценарий | Ожидание |
|---|---|---|
| T1 | payment существует ДО flow → repoint OK | `materialized`, post-check pass |
| T2 | payment создаётся внутри flow (`insertPaymentRow`) | `materialized` |
| T3 | legacy перетирает payment на parent ПОСЛЕ grant (точная симуляция Case A) | `materialized_partial` + `payment_rebind_post_check_failed`, БЕЗ `materialized` |
| T4 | `updatePaymentOrderId` бросает (`affected_rows=0`) | `materialized_partial` + `payment_rebind_failed`, БЕЗ `materialized` |
| T5 | invariant: при `materialized` всегда `payment.order_id === rebill_order_id` | держится |

Дополнительно обновлены `rebill_wiring_test.ts` и `patch_rb1_wiring_test.ts` (stateful `findMainPaymentByUid`/`insertPaymentRow`/`updatePaymentOrderId` для прохождения новой post-check проверки).

## Результат test-run

```
ok | 65 passed | 0 failed (596ms)
```

## Что НЕ делалось

- secrets/mode (`BEPAID_REBILL_MATERIALIZATION` остаётся `on`);
- ручные правки `subscriptions_v2` / `entitlements` / `access_rules` / `telegram_*`;
- никаких provider API вызовов;
- никаких изменений в legacy ветках initial-activation / link_order failure paths.

## Deploy

Edge function `bepaid-webhook` пере-деплоится автоматически после правок. Mode остаётся `on`. Следующий live repeat payment пройдёт через исправленный путь:

- если он на subscription webhook (как Case A) — STEP E пойдёт на REBILL-order, post-check пройдёт;
- если он на link_order webhook (как Case B) — поведение не изменилось (там contract уже выполнялся).

## Trigger для немедленного rollback `on→dry_run`

Любое появление в audit_logs после deploy:
- `bepaid.rebill.payment_rebind_failed`
- `bepaid.rebill.payment_rebind_post_check_failed`
- `bepaid.rebill.materialized_partial`
- `bepaid.rebill.dispatcher_error`
- `bepaid.rebill.sbs_mismatch`
- `bepaid.rebill.conflict_uid`

→ rollback + investigate.

## Файлы

- `supabase/functions/bepaid-webhook/index.ts` — STEP E re-route + post-check + link_order updatePaymentOrderId guard
- `supabase/functions/bepaid-webhook/rebill_deps_adapter.ts` — updatePaymentOrderId affected_rows guard
- `supabase/functions/bepaid-webhook/rebill_flow.ts` — payment_rebind_failed audit + post-grant verify
- `supabase/functions/bepaid-webhook/patch_rb1_2_post_check_test.ts` — новый regression suite
- `supabase/functions/bepaid-webhook/rebill_wiring_test.ts` — stateful noopDeps
- `supabase/functions/bepaid-webhook/patch_rb1_wiring_test.ts` — stateful noopDeps
