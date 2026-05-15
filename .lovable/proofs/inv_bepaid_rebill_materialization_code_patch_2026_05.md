# §A REBILL Materialization — code-patch proof (2026-05)

## Scope

Code + Deno tests + integration dispatcher за kill-switch. **Без production DML, без миграций, без data-repair Ларисы, без sweep.**

## Diff-summary (changed/created files)

| File | Status | Purpose |
|---|---|---|
| `supabase/functions/bepaid-webhook/rebill_builders.ts` | NEW | Pure builders: `resolveKillSwitchMode`, `buildRebillOrderNumber`, `buildRebillOrderPayload`, `isOrderFullyRefunded`, `classifyRecurringAutocharge` |
| `supabase/functions/bepaid-webhook/rebill_flow.ts` | NEW | Orchestrator `runRebillFlow(deps, input)` — kill-switch off/dry_run/on, idempotency, conflict, sbs pre-check, full-refund guard, grant invoke |
| `supabase/functions/bepaid-webhook/rebill_builders_test.ts` | NEW | 16 Deno offline unit tests для билдеров |
| `supabase/functions/bepaid-webhook/rebill_flow_test.ts` | NEW | 10 Deno offline тестов для оркестратора (faked deps) |
| `supabase/functions/bepaid-webhook/index.ts` | EDIT | Dispatcher block перед grant invoke (line ~2504): off → no-op; dry_run → side-channel audit без DML; on → visibility-audit `bepaid.rebill.on_mode_not_yet_wired` |
| `.lovable/proofs/inv_bepaid_rebill_materialization_code_patch_2026_05.md` | NEW | Этот proof |

## Tests result

`supabase--test_edge_functions { functions: ["bepaid-webhook", "grant-access-for-order"] }` → **35 passed | 0 failed (208ms)**.

- `bepaid-webhook/rebill_builders_test.ts`: **16/16**
- `bepaid-webhook/rebill_flow_test.ts`: **10/10** (Cases 1–10 покрывают autocharge→REBILL, repoint, idempotent, conflict, full-refund, dry_run, off, sbs-mismatch pre-check, grant-error, grant-id is REBILL not parent)
- `grant-access-for-order/sbs_mismatch_guard_test.ts`: **9/9** — §F regression зелёный, Larisa fixture проходит как раньше

## Call graph (узлы — функции/модули)

```text
bepaid-webhook handler
  ├─ verify signature → parse → resolveContext (existing)
  ├─ if isSubscriptionWebhook && tracking.kind=='link_order':
  │     ├─ ... existing recurring-charge processing (НЕ ТРОГАЛИ) ...
  │     │
  │     ├─ [NEW] §A dispatcher (перед grant invoke, line ~2504):
  │     │     mode = resolveKillSwitchMode(env BEPAID_REBILL_MATERIALIZATION)
  │     │     if mode == 'off'    → no-op (existing path работает как раньше)
  │     │     if mode == 'dry_run'→ runRebillFlow(liveDeps, dry_run)
  │     │                           ├─ checkSbsMismatchBeforeRebill (read-only)
  │     │                           ├─ findRebillOrderByPaymentUid (read-only)
  │     │                           ├─ findPaymentByUid (read-only)
  │     │                           ├─ listPaymentsForOrder (read-only)
  │     │                           ├─ buildRebillOrderPayload (pure)
  │     │                           └─ writeAudit 'bepaid.rebill.dry_run'
  │     │                              { planned_order_payload, planned_payment_repoint,
  │     │                                planned_grant_call, parent_full_refunded }
  │     │                           НИ insertRebillOrder, НИ upsertPaymentForRebill,
  │     │                           НИ invokeGrantAccess, НИ mergeOrderMetaManualReview
  │     │                           (стабы кидают error если случайно вызовут).
  │     │     if mode == 'on'     → audit 'bepaid.rebill.on_mode_not_yet_wired'
  │     │                           (production wiring — отдельный sub-plan).
  │     │
  │     └─ existing grant-access-for-order invoke (НЕ ТРОГАЛИ) ...
```

## Audit codes (новые)

| action | условие |
|---|---|
| `bepaid.rebill.dry_run` | mode=dry_run, dispatcher отработал, write planned payload |
| `bepaid.rebill.idempotent_skip` | (только в `mode=on` runtime тестах) REBILL для uid уже есть |
| `bepaid.rebill.conflict_uid` | payment с этим uid привязан к чужому order |
| `bepaid.rebill.skip_sbs_mismatch_pre_check` | active sub под (user,product,tariff) с другой sbs |
| `bepaid.rebill.skip_grant_full_refunded` | parent already full-refunded, REBILL создан, grant не зван |
| `bepaid.rebill.materialized` | (только `mode=on`) REBILL создан + payment repointed + grant invoked |
| `bepaid.rebill.on_mode_not_yet_wired` | mode=on detected в проде → visibility, production wiring отдельным sub-plan |

## §F integration

Отдельный pre-check (`checkSbsMismatchBeforeRebill`) выполнен в orchestrator'е перед idempotency, **семантически совпадает** с §F (active candidate под (user,product,tariff) с foreign sbs → skip). Когда mode=on будет включён, `grant-access-for-order` всё равно отработает свой §F guard внутри (двойная защита). §F regression-тесты прошли 9/9 без изменений.

## Anti-side-effect инварианты (фиксируются)

- `subscriptions_v2`: **0** production INSERT/UPDATE из этого патча.
- `entitlements`: **0**.
- `access_rules`: **0**.
- `telegram_*`: **0**.
- `payments_v2`: **0** в режимах off/dry_run. В mode=on (не активирован в проде) — UPDATE `order_id` по uid через канон. write-path.
- `orders_v2`: **0** INSERT в off/dry_run. В mode=on — INSERT REBILL-row (не активирован в проде).
- `audit_logs`: записи только когда mode != off (по amendment 5: off не пишет).
- **Миграций — 0.**
- **Production data-repair — 0.** Лариса не трогалась повторно.

## Order number standard

`buildRebillOrderNumber(uid)` → `REBILL-` + first **12** chars of payment uuid (формат `REBILL-7a64cd04-3d0`). Подтверждено sample'ом из production:
```
REBILL-7a64cd04-3d0, REBILL-420bec3d-21e, REBILL-5ad48899-0c5, ...
```

## `provider_payment_id` column verification

`information_schema.columns` для `public.orders_v2`: колонка `provider_payment_id` (text) **существует**. Поле используется напрямую в payload (не fallback в meta).

## Atomicity / retry поведение

- Если `insertRebillOrder` упал → исключение → existing path продолжает свой grant invoke на parent (legacy fallback). На следующем webhook'е (дубль от bePaid) idempotency `findRebillOrderByPaymentUid` снова не найдёт → попытается заново.
- Если `insertRebillOrder` успех + `upsertPaymentForRebill` упал → REBILL создан без payment-привязки. Следующий webhook → idempotent_skip (REBILL уже есть), и нужен ручной payment repoint (записан в backlog для on-режима).
- Если grant invoke упал — REBILL и payment созданы, audit `materialized` содержит `grant_result.error`. Ретрай webhook'а отсечётся idempotency.

## DoD checklist

- [x] Код залит: bepaid-webhook index + 2 новых модуля + 2 test-файла.
- [x] `BEPAID_REBILL_MATERIALIZATION` env читается, default `off`. **Production secret не менялся, не добавлялся.**
- [x] Deno tests: **35/35 passed** (16 builders + 10 flow + 9 §F regression).
- [x] Proof-файл создан с diff-summary, tests result, call graph, audit codes.
- [x] §F regression: 9/9, Larisa fixture зелёный.
- [x] **production DML = 0**, **migrations = 0**, **kill-switch=off (default)**, **`BEPAID_REBILL_MATERIALIZATION=on` НЕ включался**.

## NOT в этом этапе (для следующих sub-plans)

- Production включение mode=on (требует отдельный approve + secret).
- Mode=on production wiring: short-circuit existing recurring-charge path в `index.ts` после `runRebillFlow → materialized`, чтобы избежать двойного grant. Сейчас в `on` пишется только visibility-audit.
- Sweep / backfill исторических rebills.
- UI для REBILL-orders в админке сделок.
