# §A REBILL Materialization — code-patch proof (2026-05)

Proof покрывает два этапа:
- **§A.1 preparation** — kill-switch, builders, orchestrator, dispatcher, dry_run.
- **§A.2 mode=on wiring** — `runRebillFlow` подключён к production-пути; dispatcher
  short-circuit'ит legacy grant при `proceedLegacy=false`. Production env остаётся `off`.

## Scope

Code + Deno tests + integration dispatcher за kill-switch. **Без production DML, без миграций, без data-repair Ларисы, без sweep, без включения env on в проде.**

## Diff-summary (changed/created files)

| File | Status | Purpose |
|---|---|---|
| `supabase/functions/bepaid-webhook/rebill_builders.ts` | NEW (§A.1) | Pure builders: `resolveKillSwitchMode`, `buildRebillOrderNumber`, `buildRebillOrderPayload`, `isOrderFullyRefunded`, `classifyRecurringAutocharge` |
| `supabase/functions/bepaid-webhook/rebill_flow.ts` | NEW §A.1 + EDIT §A.2 | Orchestrator `runRebillFlow(deps, input)` — kill-switch, sbs-mismatch pre-check, REBILL idempotency by order_number, conflict, full-refund (по uid), insert REBILL + repoint payment + invoke grant, **resume** для existing REBILL, **race-safe** через UNIQUE order_number, **proceedLegacy** signal для short-circuit |
| `supabase/functions/bepaid-webhook/rebill_builders_test.ts` | NEW (§A.1) | 16 Deno offline unit tests для билдеров |
| `supabase/functions/bepaid-webhook/rebill_flow_test.ts` | NEW §A.1 + EXTEND §A.2 | 17 Deno offline тестов для оркестратора (10 базовых + 7 resume/race/proceedLegacy) |
| `supabase/functions/bepaid-webhook/rebill_wiring_test.ts` | NEW §A.2 | 4 Deno теста контракта `proceedLegacy` (off/dry_run/on + dispatcher exception fallback) |
| `supabase/functions/bepaid-webhook/index.ts` | EDIT §A.1 + EDIT §A.2 | Dispatcher block перед grant invoke + **short-circuit step 6 legacy grant** при `rebillShortCircuit=true`. Mode=on теперь полностью подключён к live deps. |
| `.lovable/proofs/inv_bepaid_rebill_materialization_code_patch_2026_05.md` | NEW + EDIT | Этот proof |

## Tests result

`supabase--test_edge_functions { functions: ["bepaid-webhook", "grant-access-for-order"] }` →
**46 passed | 0 failed (257ms)**.

- `bepaid-webhook/rebill_builders_test.ts`: **16/16**
- `bepaid-webhook/rebill_flow_test.ts`: **17/17** (10 базовых + 7 resume/race/short-circuit)
- `bepaid-webhook/rebill_wiring_test.ts`: **4/4** (off/dry_run/on/error → правильный `proceedLegacy`)
- `grant-access-for-order/sbs_mismatch_guard_test.ts`: **9/9** — §F regression, Larisa fixture зелёный

## Call graph (узлы — функции/модули)

```text
bepaid-webhook handler
  ├─ verify signature → parse → resolveContext (existing)
  ├─ if isSubscriptionWebhook && tracking.kind=='link_order':
  │     ├─ ... existing recurring-charge processing (НЕ ТРОГАЛИ) ...
  │     │
  │     ├─ §A.2 dispatcher (line ~2505):
  │     │     mode = resolveKillSwitchMode(env BEPAID_REBILL_MATERIALIZATION)
  │     │
  │     │     if mode != 'off':
  │     │       runRebillFlow(liveDeps, { mode, parentOrder, payment, sbs })
  │     │         └─ см. таблицу terminal outcomes ниже
  │     │
  │     │     if mode == 'on' && !result.proceedLegacy:
  │     │       rebillShortCircuit = true   // ← блокирует legacy grant
  │     │
  │     │     dispatcher exception (transport / Supabase) → catch:
  │     │       audit `bepaid.rebill.dispatcher_error`
  │     │       rebillShortCircuit остаётся false → legacy grant РАБОТАЕТ
  │     │
  │     ├─ step 6 legacy grant invoke (line ~2675):
  │     │     if rebillShortCircuit: SKIP (log only)
  │     │     else: fetch grant-access-for-order(orderId=parent.id) ← legacy
  │     │
  │     └─ далее subscription resolve + bePaid date sync (НЕ ТРОГАЛИ)
```

## Terminal outcomes table (по amendment 13)

| decision | mode | REBILL created | Payment repoint | Grant invoked | Legacy short-circuit | Audit action | Retry/manual_review marker |
|---|---|---|---|---|---|---|---|
| `off_noop` | off | — | — | — | **no** (legacy runs) | — (no audit) | — |
| `dry_run_planned` (no existing) | dry_run | — | — | — | **no** (legacy runs) | `bepaid.rebill.dry_run` decision=`would_materialize` или `would_skip_grant_full_refunded` | — |
| `dry_run_planned` (existing REBILL) | dry_run | — | — | — | **no** | `bepaid.rebill.dry_run` decision=`would_resume` | — |
| `skip_sbs_mismatch_pre_check` | on | no | no | no | **yes** | `bepaid.rebill.skip_sbs_mismatch_pre_check` | parent: `manual_review=true` + `rebill_sbs_mismatch_pre_check` ctx |
| `idempotent_skip` | on | (existing) | no | no | **yes** | `bepaid.rebill.idempotent_skip` | (existing REBILL уже `grant_status=success`) |
| `resumed_grant` | on | (existing) | yes if needed | yes | **yes** | `bepaid.rebill.materialized` decision=`resumed_grant` | REBILL: `grant_status=success`, `manual_review=false` |
| `resumed_repoint_only` | on | (existing) | yes if needed | no (full-refund) | **yes** | `bepaid.rebill.skip_grant_full_refunded` | REBILL: `materialization_status=skipped_grant_full_refunded` |
| `conflict_uid` | on | no | no | no | **yes** | `bepaid.rebill.conflict_uid` | conflicting order: `manual_review=true` + `rebill_conflict_uid` ctx; parent: `rebill_conflict_uid_context` |
| `materialized` | on | yes | yes (insert или update) | yes (success) | **yes** | `bepaid.rebill.materialized` | REBILL: `grant_status=success` |
| `skip_grant_full_refunded` (fresh path) | on | yes | yes | no | **yes** | `bepaid.rebill.skip_grant_full_refunded` | REBILL: `materialization_status=skipped_grant_full_refunded` |
| `materialized_partial` | on | yes (или race-fail) | failed | no | **yes** | `bepaid.rebill.materialized_partial` | REBILL: `materialization_status=partial_payment_repoint_failed`, `manual_review=true`. Повторный webhook → resume через existing-ветку. |
| `materialized_grant_failed` | on | yes | yes | failed (HTTP/exception/`success:false`) | **yes** | `bepaid.rebill.materialized_grant_failed` | REBILL: `grant_status=failed`, `manual_review=true`, `last_grant_error`. Повторный webhook → resume retry grant. |

**HTTP 200 invariant (amendment 9)**: каждый terminal outcome пишет audit ДО возврата результата → audit никогда не теряется. Webhook отвечает 200 после dispatcher.

## §F integration

Pre-check `checkSbsMismatchBeforeRebill` выполняется в orchestrator'е перед idempotency, **семантически совпадает** с §F (active candidate под (user,product,tariff) с foreign sbs → skip). Когда `mode=on` материализует REBILL и зовёт `grant-access-for-order`, §F всё равно отработает свой guard внутри (двойная защита). §F regression-тесты прошли 9/9 без изменений.

## Idempotency model

- **REBILL orders**: UNIQUE constraint на `orders_v2.order_number` (verified в проде: `orders_v2_order_number_key`). REBILL `order_number = REBILL-<first 12 chars uid>`. Race-safe: при `INSERT` race → unique-violation ловится, re-fetch `findRebillOrderByOrderNumber` → resume через existing-ветку.
- **payments_v2**: НЕТ unique по `provider_payment_id` (verified). Поэтому `ensurePaymentRepointed` использует SELECT-then-INSERT/UPDATE, фильтр по `transaction_type ∈ {'Платеж','payment'}` (amendment 7) — refund-row никогда не repoint'ится.
- **Resume contract** (amendment 2): existing REBILL → читаем `meta.grant_status`. `success` → `idempotent_skip`. Любое другое → пытаемся доделать недостающие шаги (repoint + grant). Доступ не теряется.

## Anti-side-effect инварианты (фиксируются)

- `subscriptions_v2`: **0** прямых production INSERT/UPDATE из rebill_flow. Все изменения — только через `grant-access-for-order` (где §F и каноничный write-path).
- `entitlements`: **0**.
- `access_rules`: **0**.
- `telegram_*`: **0**.
- `payments_v2`: в `mode=off`/`dry_run` — **0**. В `mode=on` — INSERT нового payment row или UPDATE `order_id` существующего main payment (только если `transaction_type ∈ {'Платеж','payment'}`).
- `orders_v2`: в `mode=off`/`dry_run` — **0** INSERT. В `mode=on` — INSERT REBILL-row + merge `meta` (manual_review/grant_status/materialization_status) на REBILL/parent/conflicting orders.
- `audit_logs`: записи только когда `mode != off` (по amendment 5 §A.1: off не пишет).
- **Миграций — 0.**
- **Production data-repair — 0.** Лариса не трогалась повторно.
- **Production env `BEPAID_REBILL_MATERIALIZATION` остаётся `off`. mode=on в проде НЕ включался.**

## Order number standard

`buildRebillOrderNumber(uid)` → `REBILL-<first 12 chars of payment uuid>` (формат `REBILL-7a64cd04-3d0`). Подтверждено sample'ом из production:
```
REBILL-7a64cd04-3d0, REBILL-420bec3d-21e, REBILL-5ad48899-0c5, ...
```

## Schema verification (amendment 8, 11)

- `orders_v2.provider_payment_id` (text) — **существует**, используется напрямую в payload.
- `orders_v2.order_number` — **UNIQUE** (`orders_v2_order_number_key`) → race-safe идемпотентность.
- `payments_v2.provider_payment_id` — **НЕТ** unique constraint → SELECT-then-INSERT/UPDATE, без `upsert`/`onConflict` (amendment 6).
- `payments_v2.transaction_type` (production values): `Платеж` (canonical), `payment`, `tokenization`, `Возврат средств`, `refund`, `Отмена`, `void`. Repoint допускается только для `'Платеж'|'payment'`.

## DoD checklist

- [x] Код: bepaid-webhook index dispatcher + short-circuit step 6 + 2 модуля (`rebill_flow.ts`, `rebill_builders.ts`) + 3 test-файла.
- [x] `BEPAID_REBILL_MATERIALIZATION` env читается, default `off`. **Production secret не менялся, не добавлялся.**
- [x] Deno tests: **46/46 passed** (16 builders + 17 flow + 4 wiring + 9 §F regression). 0 failed.
- [x] Proof обновлён: diff-summary, tests result, call graph, audit codes, terminal outcomes table.
- [x] §F regression 9/9, Larisa fixture зелёный.
- [x] **production DML = 0**, **migrations = 0**, **kill-switch=off (default)**, **`BEPAID_REBILL_MATERIALIZATION=on`/`dry_run` в проде НЕ включался**.

## NOT в этом этапе

- Включение `BEPAID_REBILL_MATERIALIZATION=on` или `dry_run` в проде (отдельный approve).
- Sweep / backfill исторических rebills.
- UI для REBILL-orders в админке сделок.
- Изменение поведения `!tariffMatch + recurring + foreign sbs` (отдельный backlog-risk из §F).
- Авто-ретрай grant для `materialized_partial` / `materialized_grant_failed` без нового webhook'а — markers есть, ручной/cron retry — backlog.
