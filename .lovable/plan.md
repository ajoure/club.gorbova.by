## да, согласен, с учетом правок:

1. **Full-refund guard не должен проверять parent.**  
В плане написано: `full-refund guard на parent`. Это неверно. Проверять нужно именно **REBILL-order / payment uid**, а не parent initial-order.  
Правильно:
  - если по текущему `provider_payment_id` уже есть refund/full-refund → no grant;
  - parent-order refund state не использовать для решения по новому REBILL.
2. **При** `idempotent_skip` **нельзя всегда “no grant”.**  
Если REBILL уже создан, но предыдущая попытка упала до grant, то простой `idempotent_skip` оставит доступ непродлённым.  
Нужно различать:
  &nbsp;
  &nbsp;
  - REBILL существует + grant уже успешен → skip;
  - REBILL существует + payment привязан + grant не был выполнен/failed → retry grant или manual_review.  
  Минимум: добавить audit/status marker в `meta` или проверку `access_grant_ledger`/результата grant, чтобы не терять доступ.
3. `materialized_partial` **нельзя оставлять только на ручной backlog без статуса.**  
Если order создан, а payment-repoint упал, нужна машинная метка:
  - `meta.materialization_status='partial_payment_repoint_failed'`;
  - audit;
  - повторный webhook должен продолжить с этого места, а не просто idempotent-skip.
4. **Grant invoke error тоже должен оставлять retryable/manual_review marker.**  
Если grant упал:
  - не fallback на legacy path — правильно;
  - но обязательно `meta.grant_status='failed'`, `manual_review=true`, `grant_error`;
  - повторный webhook должен понимать, можно ли retry grant.
5. `mode=on` **conflict должен обновлять meta у правильной строки.**  
В плане написано `merge meta.manual_review parent`. Если conflict связан с уже существующим payment/order, manual_review лучше ставить:
  - на конфликтующий order, если он найден;
  - на parent_order только как дополнительный context.  
  Иначе ручная проверка будет искать проблему не там.
6. `UPSERT payments_v2` **формулировку заменить на точную.**  
Если payment уже есть — `UPDATE order_id`.  
Если payment отсутствует — `INSERT`.  
Не использовать общий термин `UPSERT`, если нет уникального constraint по `provider_payment_id`, иначе можно получить дубль.
7. **Перед** `UPDATE payments_v2.order_id` **проверить transaction_type.**  
Repoint должен применяться только к основному payment:
  - `transaction_type='Платеж'`;
  - не refund-row;
  - `amount` совпадает;
  - `provider_payment_id=uid`.  
  Refund обрабатывается отдельной веткой через `record_refund_atomic`.
8. `orders_v2.provider_payment_id` **снова проверить в коде.**  
Если поле есть — ок. Если нет — использовать только `meta.materialized_from_payment_uid`. Не допускать silent field mismatch.
9. **Short-circuit должен возвращать HTTP 200 только после audit.**  
Для всех terminal outcomes:
  - `idempotent_skip`;
  - `conflict_uid`;
  - `sbs_mismatch`;
  - `grant_failed`;
  - `materialized_partial`  
  нужен audit до ответа, чтобы не терять причину.
10. **Test coverage добавить по resume-сценариям.**  
Добавить тесты:

&nbsp;

- REBILL exists, payment not repointed → повторный webhook делает repoint;
- REBILL exists, grant missing → повторный webhook делает grant или manual_review;
- REBILL exists, grant already done → skip.

11. **Не полагаться на** `SELECT-then-INSERT` **без race-handling.**  
Если уникального индекса нет — race возможен. В proof нужно явно подтвердить:

- есть unique constraint/index по `orders_v2.provider_payment_id`;
- или race считается manual_review risk и production `on` не включается до миграции.

12. **DoD обновить по количеству тестов после добавления resume-сценариев.**  
Не фиксировать заранее `≥45`, а писать: все существующие + новые tests passed, 0 failed.
13. **В proof добавить отдельную таблицу terminal outcomes.**  
Для каждого outcome указать:

- создаётся ли REBILL;
- repoint payment;
- вызывается ли grant;
- запускается ли legacy path;
- какой audit;
- какой retry/manual_review marker.

После этих правок план можно запускать. Главное: `mode=on` подключить в коде, но **не включать env в production** и не делать никаких data-repair.

&nbsp;

План: §A.2 REBILL Materialization mode=on wiring

### Цель

Подключить `mode=on` к production-пути `bepaid-webhook` так, чтобы recurring autocharge создавал REBILL-order, привязывал payment к нему и вызывал `grant-access-for-order` по REBILL-id. Старый recurring path должен short-circuit'иться, чтобы не было double-write/double-grant. Включение env в проде — отдельным approve, не в этом плане.

### Scope

- Только код + Deno tests + обновление proof.
- Без production data DML.
- Без миграций.
- Без data-repair.
- Без изменения secret `BEPAID_REBILL_MATERIALIZATION` в проде (default остаётся `off`).
- §F guard не трогаем — он уже на месте и проходит регрессию.

### Файлы


| File                                                                      | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/functions/bepaid-webhook/rebill_flow.ts`                        | EDIT — реализовать ветку `mode=on`: insertRebillOrder → upsertPaymentForRebill (repoint) → invokeGrantAccess(REBILL.id) → audit `materialized`. Использовать те же deps-стабы для тестируемости.                                                                                                                                                                                                                                                                                         |
| `supabase/functions/bepaid-webhook/rebill_builders.ts`                    | EDIT (минимально) — при необходимости вынести helper для merge `orders_v2.meta` (manual_review).                                                                                                                                                                                                                                                                                                                                                                                         |
| `supabase/functions/bepaid-webhook/index.ts`                              | EDIT — в recurring-charge ветке: после `runRebillFlow` с `mode=on`, при результате `materialized` → **short-circuit**: не выполнять старый `grant-access-for-order` invoke по `linkOrder.id` и не апдейтить даты на parent. При `idempotent_skip` / `skip_*` / ошибке — fallback на старый path не делаем (audit + return 200), чтобы не было double-grant. При `mode=off` поведение полностью прежнее. При `mode=dry_run` — старый path продолжает работать (dry_run только наблюдает). |
| `supabase/functions/bepaid-webhook/rebill_flow_test.ts`                   | EDIT — добавить `mode=on` кейсы поверх faked deps.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `supabase/functions/bepaid-webhook/rebill_wiring_test.ts`                 | NEW — интеграционный тест диспетчера в `index.ts` (или unit-тест экспортированной wiring-функции), проверяет short-circuit и отсутствие двойного grant.                                                                                                                                                                                                                                                                                                                                  |
| `.lovable/proofs/inv_bepaid_rebill_materialization_code_patch_2026_05.md` | EDIT — добавить раздел §A.2 wiring + final verify.                                                                                                                                                                                                                                                                                                                                                                                                                                       |


### Поведение по режимам (после патча)

```text
mode=off
  → no-op в dispatcher
  → старый recurring path работает как раньше (legacy grant на parent.id)

mode=dry_run
  → dispatcher пишет audit `bepaid.rebill.dry_run` (planned payload)
  → старый recurring path работает как раньше
  → 0 DML из rebill_flow

mode=on
  → dispatcher вызывает runRebillFlow:
      sbs-mismatch pre-check (read-only) → если mismatch: audit skip, return, старый path НЕ зовём (§F всё равно его остановит, но избегаем повторного hit)
      idempotency по provider_payment_id:
        already exists → audit `idempotent_skip`, short-circuit (старый path НЕ зовём)
      conflict: payment uid привязан к чужому order → audit `conflict_uid`, merge meta.manual_review=true в parent, short-circuit
      happy path:
        INSERT orders_v2 REBILL-row (status=paid, provider_payment_id, meta.source=bepaid_rebill, payment_flow=bepaid_subscription_charge, parent_link_order_id, sbs)
        UPSERT payments_v2: SET order_id=REBILL.id WHERE provider_payment_id=uid (repoint)
        full-refund guard на parent → если parent fully refunded: audit `skip_grant_full_refunded`, grant НЕ зовём, short-circuit
        invoke grant-access-for-order { order_id: REBILL.id }
        audit `bepaid.rebill.materialized` (rebill_order_id, grant_result)
      ⇒ возвращаем сигнал "handled" → index.ts SHORT-CIRCUIT'ит legacy grant
```

### Idempotency / atomicity

- Идемпотентность по `orders_v2.provider_payment_id` (UNIQUE-предположение проверим в коде через SELECT-then-INSERT с onConflict-обработкой; если INSERT падает на уникальности — рассматриваем как idempotent).
- Если INSERT REBILL прошёл, а payment-repoint упал → audit `materialized_partial`, short-circuit (повторный webhook найдёт REBILL и сделает только repoint+grant).
- Если grant invoke упал → audit `materialized` с `grant_result.error`, short-circuit (повторный webhook отсечётся idempotency, далее ручной ретрай grant — backlog).
- Никаких commit/rollback нескольких таблиц — пишем последовательно с явным audit на каждом шаге.

### Anti-side-effect инварианты

- `subscriptions_v2`: 0 прямых INSERT/UPDATE из rebill_flow. Все изменения — только через `grant-access-for-order` (где §F и каноничный write-path).
- `entitlements`, `access_rules`, `telegram_*`: 0 прямых записей.
- `payments_v2`: только UPDATE `order_id` по `provider_payment_id` (repoint), без модификации сумм/refunded_amount.
- `orders_v2`: INSERT REBILL-row + при conflict — merge meta.manual_review parent. Никаких UPDATE дат на parent.
- `audit_logs`: записи только в `mode != off`.
- Production DML до approve env=on — **0** (env остаётся off).
- Migrations — **0**.

### Тесты (новые/обновлённые)

`rebill_flow_test.ts` — добавить:

1. `mode=on` happy path → insert REBILL + repoint payment + invoke grant с REBILL.id + audit `materialized`.
2. `mode=on` idempotent (REBILL уже есть) → no insert, no grant, audit `idempotent_skip`, signal=handled.
3. `mode=on` conflict (uid у чужого order) → merge meta manual_review, no insert REBILL, no grant, audit `conflict_uid`, signal=handled.
4. `mode=on` full-refund parent → insert REBILL + repoint, no grant, audit `skip_grant_full_refunded`.
5. `mode=on` sbs-mismatch pre-check → no insert, no grant, audit `skip_sbs_mismatch_pre_check`, signal=handled.
6. `mode=on` grant invoke error → audit `materialized` с error, signal=handled (no fallback).
7. `mode=on` insert REBILL falls on UNIQUE → treated as idempotent.

`rebill_wiring_test.ts` (NEW) — изолированный тест функции-обёртки short-circuit:
8. `mode=off` → wiring возвращает `proceedLegacy=true`.
9. `mode=dry_run` → `proceedLegacy=true` + audit dry_run.
10. `mode=on` + handled (любой terminal outcome) → `proceedLegacy=false`, legacy grant НЕ дернут (мокаем legacy invoker).

### §F regression

- `grant-access-for-order/sbs_mismatch_guard_test.ts` 9/9 должен остаться зелёным (не трогаем модуль).

### DoD

- Код: `rebill_flow.ts` mode=on реализован; `index.ts` short-circuit подключён.
- Тесты: новые кейсы 1–10 + старые 35 → итого ≥45 passed, 0 failed.
- §F regression 9/9 зелёный.
- Proof обновлён: diff-summary, новые audit-коды, mode-таблица, tests result.
- Production DML = **0**.
- Migrations = **0**.
- `BEPAID_REBILL_MATERIALIZATION` env в проде остаётся `off`, `on` не включался.
- dry_run на проде — НЕ включаем в этом плане (по вашему требованию).

### NOT в этом плане

- Включение `BEPAID_REBILL_MATERIALIZATION=on` или `dry_run` на проде.
- Sweep / backfill исторических rebills.
- UI для REBILL-orders в админке.
- Ручной ретрай grant при `materialized_partial` — backlog.
- Изменение поведения !tariffMatch + recurring + foreign sbs (отдельный backlog-risk из §F).

Жду approve, чтобы перейти к реализации.