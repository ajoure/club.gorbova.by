да, согласен, с учетом правок:

1. **Case A — это не “частичный успех”, а контрактное нарушение.**  
Если REBILL-order создан, но payments_v2.order_id остался на parent, это должно быть:

bepaid.rebill.materialized_partial

или

bepaid.rebill.payment_rebind_failed

А не обычный bepaid.rebill.materialized.

2. **Нельзя ждать ещё один такой же случай.**  
mode=on можно оставить, но PATCH-RB1.2 нужно делать сразу. Это не новый research, а обязательный фикс payment-rebind.
3. **bepaid.rebill.materialized должен писаться только после полного успеха:**

REBILL-order создан

payment.order_id = [REBILL-order.id](http://REBILL-order.id)

grant-access-for-order прошёл / либо корректно skipped по правилам

Если payment rebind не выполнен — materialized писать нельзя.

**Что отправить Lovable**

План принимаю с правками.

&nbsp;

Case A считать не частичным успехом, а нарушением основного контракта:

&nbsp;

successful repeat payment должен быть:

payment → REBILL-order

&nbsp;

Если REBILL-order создан, но payment остался на parent, это не PASS.

&nbsp;

Требую немедленно запустить PATCH-RB1.2.

&nbsp;

PATCH-RB1.2 — fix payment rebind in runRebillFlow

&nbsp;

Цель:

исправить ветку, где runRebillFlow создаёт REBILL-order и даже пишет materialized audit, но не перепривязывает payments_v2.order_id на REBILL-order.

&nbsp;

Обязательные изменения:

&nbsp;

1. `bepaid.rebill.materialized` писать только после проверки:

   - REBILL-order существует;

   - payment row существует;

   - payments_v2.order_id = [REBILL-order.id](http://REBILL-order.id).

&nbsp;

2. Если payment row уже существует на parent:

   - выполнить UPDATE payments_v2.order_id → [REBILL-order.id](http://REBILL-order.id);

   - проверить affected_rows = 1;

   - если affected_rows != 1 → audit `bepaid.rebill.payment_rebind_failed`, не писать materialized.

&nbsp;

3. Если payment row ещё не существует в момент materialization:

   - не терять это молча;

   - либо передать REBILL-order id в последующую вставку payment;

   - либо выполнить deferred rebind после создания payment;

   - обязательно audit `bepaid.rebill.payment_rebind_pending`;

   - затем финальный audit `bepaid.rebill.materialized` только после успешного rebind.

&nbsp;

4. Legacy parent branch не должен финализировать payment на parent после успешного REBILL-order.

   Если runRebillFlow handled=true, дальнейшая legacy-привязка к parent запрещена.

&nbsp;

5. Добавить regression tests:

   - payment существует ДО REBILL flow → rebind successful;

   - payment создаётся ПОСЛЕ REBILL row, но до финального audit → rebind successful;

   - payment отсутствует → `payment_rebind_pending/failed`, НЕ `materialized`;

   - affected_rows=0 → `payment_rebind_failed`, НЕ `materialized`;

   - successful materialization всегда означает `payments_v2.order_id = rebill_order.id`.

&nbsp;

6. Деплой `bepaid-webhook` после зелёных тестов.

&nbsp;

PATCH-RB3 — repair Case A

&nbsp;

После RB1.2 или параллельно отдельным execute:

&nbsp;

- payment `f2892a00-5731-4adb-97d8-ff8d3472f953`

- provider uid `111dfc17-80c2-477c-8ecd-9b768744e8b7`

- parent `91b98bf3-282a-4ef0-854d-f71a86577139`

- REBILL-order `06f22ceb-9792-464e-adfb-d15519352d21`

&nbsp;

Разрешён только financial repair:

- UPDATE payments_v2.order_id с parent → REBILL-order;

- grant-access-for-order НЕ вызывать;

- subscriptions_v2 / entitlements НЕ трогать;

- Telegram НЕ трогать;

- provider API НЕ вызывать.

&nbsp;

Причина:

доступ уже продлён canonical writer'ом до 2026-06-17 12:00Z.

&nbsp;

Proof:

- `.lovable/proofs/patch_rb1_2_payment_rebind_fix_2026_05.md`

- `.lovable/proofs/patch_rb3_case_a_payment_rebind_repair_2026_05.md`

&nbsp;

Mode:

- `BEPAID_REBILL_MATERIALIZATION=on` оставить включённым, но PATCH-RB1.2 выполнить срочно.

- Если после RB1.2 ещё раз появится REBILL-order без payment rebind — rollback mode в dry_run/off и стоп.

Коротко: base_price исправлен, но теперь найден второй баг — **REBILL создаётся, а payment не переезжает**. Это надо чинить в коде сразу, а Case A перепривязать финансово без повторного grant.

&nbsp;

План: PATCH-RB1.1 runtime-watch — read-only verify по двум live REBILL после фикса base_price

Только наблюдение, ноль DML, ноль изменений edge-функций/секретов.

## Что найдено

После deploy фикса `base_price` (PATCH-RB1.1) в окне `[2026-05-17T13:45Z; сейчас]` найдено **два** реальных REBILL-события через новый flow с `mode=on`:


| #   | дата (UTC)          | sbs                  | provider_payment_uid                 | parent_order                         | REBILL-order                                               | payment_id                           |
| --- | ------------------- | -------------------- | ------------------------------------ | ------------------------------------ | ---------------------------------------------------------- | ------------------------------------ |
| A   | 2026-05-17 18:01:10 | sbs_e1f92ff0e3fa4bff | 111dfc17-80c2-477c-8ecd-9b768744e8b7 | 91b98bf3-282a-4ef0-854d-f71a86577139 | 06f22ceb-9792-464e-adfb-d15519352d21 (REBILL-111dfc17-80c) | f2892a00-5731-4adb-97d8-ff8d3472f953 |
| B   | 2026-05-18 07:15:22 | sbs_9d30ab4a6e029b61 | e83818b8-10f6-46fc-9cec-cbb9043555ab | 0ecbeebd-493f-4672-a900-403da0365caf | 36d690fb-8b3b-4d11-8b17-79bcac7c0d5c (REBILL-e83818b8-10f) | fa537e59-27cd-4858-b950-412a29ca3e44 |


## Чек-лист (7 пунктов)


| #   | Проверка                                                                                                                               | Case A                                                                                     | Case B                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 1   | `bepaid.rebill.materialized` появился (без `_partial`)                                                                                 | ✅                                                                                          | ✅                                                                                              |
| 2   | REBILL-order создан, `status=paid`, `base_price=final_price=paid_amount=250.00`                                                        | ✅                                                                                          | ✅                                                                                              |
| 3   | `payments_v2.order_id` указывает на REBILL-order                                                                                       | ❌ payment остался на parent `91b98bf3…`                                                    | ✅ `fa537e59→36d690fb`                                                                          |
| 4   | Parent-order не получил payment                                                                                                        | ❌ parent держит payment `f2892a00…`                                                        | ✅                                                                                              |
| 5   | `grant-access-for-order` отработал успешно                                                                                             | ✅ extended до `2026-06-17 12:00Z`, `primary_entitlement_verified=true`, ledger writes есть | ✅ webhook → `bepaid.webhook.canonical_writer_only` + `link_order_processed` после materialized |
| 6   | Нет `dispatcher_error` / `sbs_mismatch` / `skip_blocked_stale_access` / `materialized_partial` / `conflict_uid` / `skip_grant_blocked` | ✅ 0 событий                                                                                | ✅ 0 событий                                                                                    |
| 7   | `BEPAID_REBILL_MATERIALIZATION=on` остался                                                                                             | ✅ secret присутствует, оба materialized с `meta.mode='on'`                                 | ✅                                                                                              |


## Главное наблюдение (новый sub-bug, не базовый base_price)

Case A — частичный успех:

- REBILL-order создан корректно (base_price есть → фикс работает).
- Grant отработал — доступ продлён каноническим writer'ом.
- НО `payments_v2.111dfc17….order_id` НЕ перепривязан на REBILL → **payment всё ещё склеен с parent**.
- В audit нет `bepaid.rebill.skipped_payment_rebind`, нет `dispatcher_error` — rebind тихо не выполнился, события об этом нет.

Case B — полный успех, все 7 пунктов зелёные.

Разница тайминга: в A payment-row создалась через ~360 ms после REBILL-row и за 12 s до `materialized`. В B payment-row создалась за 260 ms ДО REBILL-row. Это намёк на race условие или ветку, где `runRebillFlow` не вызывает payment-repoint, если payment ещё не существует в момент materialization (но вообще не должно — webhook должен сам инициировать).

## Вердикт runtime-watch

- Фикс `base_price` (PATCH-RB1.1) работает: больше нет `materialized_partial`, нет ошибок dispatcher/sbs/conflict.
- Контракт «отдельная REBILL-сделка на каждый repeat payment» выполняется в `orders_v2` для обоих кейсов.
- Контракт «payment.order_id → REBILL» выполняется для Case B, нарушен для Case A.
- Bullet rollback (вернуть secret в `dry_run`) НЕ запускаю — это не регресс по сравнению с pre-PATCH-RB1.1 (там было хуже: REBILL вообще не создавался). Финансово Case A в том же состоянии, что и три исторических кейса в PATCH-RB2.
- Secret оставлен `on`.

## Что предлагаю дальше (отдельными патчами, не сейчас)

1. **PATCH-RB1.2 (code, обязательный):** диагностика и фикс ветки `runRebillFlow`, где `payments_v2.order_id` не получает rebind. Добавить явный audit `bepaid.rebill.skipped_payment_rebind` или `payment_rebind_failed` с причиной, чтобы такие случаи не пропадали тихо. Покрыть тестом (payment вставляется ПОСЛЕ REBILL-row, но ДО materialization — это сценарий Case A).
2. **PATCH-RB3 (financial repair, отдельно от RB1.2):** перепривязать `payments_v2.f2892a00….order_id` с `91b98bf3…` → `06f22ceb…`. Grant НЕ вызывать — доступ уже продлён каноническим writer'ом до `2026-06-17 12:00Z`. Те же гарантии и форма, что и в PATCH-RB2 case 2 (Ольга Черкашина), proof-only DML.
3. Продолжать runtime-watch на следующие live repeat payments. Триггер немедленного rollback `on→dry_run` сохраняется при: `materialized_partial` / `dispatcher_error` / `sbs_mismatch` / `conflict_uid` / повторении приклейки payment к parent на ≥1 дополнительном кейсе.

## DoD данного watch-цикла

- Зафиксированы оба live кейса с фактическими ID и таймштампами.
- 7-пунктовый чек-лист пройден явно по каждому.
- Найден и описан новый sub-bug (rebind), без попытки фикса в этом цикле.
- Secret подтверждён `on`, никаких изменений в БД/коде/секретах не сделано.
- Будет создан proof-файл `.lovable/proofs/patch_rb1_1_runtime_watch_2026_05.md` с фактическими SQL-выдержками и решением «оставить on, завести RB1.2 + RB3».

## Запрещено в этом цикле

DML, edit edge functions, secrets/mode changes, provider API, Telegram, `grant-access-for-order` ручной вызов, ручные правки subscriptions_v2/entitlements/access_rules/payments_v2.