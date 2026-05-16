да, согласен, с учетом правок:

1. **План обрезан в конце.**  
Последняя строка — просто DoD. Нужно дописать финальный DoD полностью.
2. **C.2 data-repair Рабчевской убрать из текущего execution scope.**  
В этом патче допустим только:
  - code;
  - tests;
  - proof;
  - dry-run план по Рабчевской.
3. Реальный DML repair Рабчевской — отдельный PATCH после approve dry-run.
4. **Race guard не называть полностью race-safe без DB constraint/RPC.**  
Без транзакционного RPC/unique constraint по (order_id/user/product/tariff) это не абсолютная защита. Формулировка должна быть:

B.2 — best-effort pre-insert re-check.

Полная race-safe атомарность — отдельный H2b RPC/constraint, если потребуется.

4. **skip_already_processed опасен, если subscription есть, а entitlement нет.**  
Если writer нашёл existing subscription по order_id или meta.bepaid_subscription_id, он не должен просто skip’ать весь grant. Нужно различать:

- subscription есть + entitlement verified → skip_already_processed;

- subscription есть, но entitlement отсутствует/expired → reuse subscription + ensure primary entitlement;

- subscription есть, но данные конфликтуют → manual_review_existing_subscription_incomplete.

5. **Provider-sync UPDATE делать только по subscription_id, который вернул writer.**  
Не искать “по order_id” после writer’а, если есть риск нескольких строк. Правильно:

grant.outcome.subscription_id → provider-sync target

Если subscription_id не вернулся — provider-sync не делать, audit/manual_review.

6. **Не оставлять direct access writes даже при fallback/error.**  
Для всех outcome:

skip / error / manual_review / ambiguous_order_id

→ 0 access writes

→ audit

→ HTTP 200

7. **Static check уточнить.**  
Не просто entitlements\. по диапазону, потому что чтение может быть легитимным. Проверять именно write-паттерны:

from('entitlements').insert

from('entitlements').upsert

from('entitlements').update

subscriptions_v2 update payload with access_start_at/access_end_at/status

telegram-grant-access invoke

telegram_access insert/update/upsert

8. **subscriptions_v2.status не менять из webhook.**  
В 3DS ветке статус active/trial/past_due должен выставлять только writer. Webhook может писать только технический provider-sync, если это не влияет на платформенный доступ.
9. **B.1 candidate search по meta.bepaid_subscription_id должен быть безопасным.**  
Если найдено несколько кандидатов по одному sbs/order — manual_review_multi_candidate, не авто-выбор.
10. **Добавить test на incomplete existing subscription.**  
Новый тест:

existing subscription by order_id exists, but entitlement missing

→ writer reuses subscription / creates entitlement

→ no second subscription insert

11. **Добавить test на provider-sync target.**

writer returns subscription_id = X

→ webhook updates provider-sync only on X

→ no update by broad order_id query

12. **Перед deploy обязательно:**

- deno check;
- все H2.1b-i tests;
- новые H2.1b-ii tests;
- §F regression;
- static check.

13. **Финальный DoD добавить так:**

## DoD

&nbsp;

- 3DS finalize ветка больше не содержит прямых access writes:

  - subscriptions_v2.access_start_at/access_end_at/status;

  - entitlements insert/update/upsert;

  - telegram access / telegram-grant-access.

- Ветка вызывает grant-access-for-order с context='3ds_finalize'.

- Provider-sync пишет только технические поля и только по subscription_id, возвращённому writer'ом.

- skip/error/manual_review/ambiguous_order_id → no fallback-write, audit, HTTP 200.

- Existing subscription by order_id/sbs не создаёт дубль; если entitlement отсутствует — writer не skip’ает grant молча.

- Tests green.

- Static check green.

- Deploy successful.

- production DML = 0 ручных операций.

- migrations = 0.

- BEPAID_REBILL_MATERIALIZATION остаётся dry_run.

- mode=on не включался.

- Рабчевская data-repair не выполнялся.

- H2.1c legacy path не трогался.

После этих правок план можно выполнять. Главное: **в этом патче не чинить Рабчевскую данными**, а только закрыть кодовую причину дублей и direct access writes в 3DS finalize.

&nbsp;

# План: PATCH H2.1b-ii — replace 3DS finalize access writes with canonical writer (+ duplicate fix)

## Контекст

H2.1b-i закрыт: canonical writer умеет 3DS finalize через `context='3ds_finalize'`. Webhook 3DS finalize ветка всё ещё делает 8 прямых access-writes — это блокер перед `mode=on`.

Кейс **Рабчевская Юлия** (`user_id=7261e727-f6d4-4ccf-9c71-ba7ec49bcf6e`, `order_id=d1080bf5-c395-4b91-b8e7-afb89a599929`, product Gorbova Club, tariff BUSINESS) даёт прямое подтверждение: webhook + writer создали **две** `subscriptions_v2` с одним и тем же `order_id` и одним и тем же `(user_id, product_id, tariff_id)`:


| sub_id                                 | created_at     | billing_type     | bepaid_sub_id          | access_end_at | granted_by                         |
| -------------------------------------- | -------------- | ---------------- | ---------------------- | ------------- | ---------------------------------- |
| `4469a81d-2967-45a5-a7cc-4af9461b6e5e` | 16.05 07:54:55 | provider_managed | `sbs_2f634e38e892da31` | 15.06 20:59   | webhook (pending_provider_managed) |
| `f7fda1d7-b5a0-4ea2-aaa0-3d61a5e7301e` | 16.05 07:57:06 | mit              | —                      | 16.06 12:00   | grant-access-for-order             |


Это **race-INSERT**: webhook успел создать `provider_managed` skeleton (без SBS-binding в кандидатной выборке writer'а), затем writer не нашёл match по `bepaid_subscription_id` и **создал второй insert**. Multi-candidate guard в writer'е сейчас читает только уже существующие active subs, но при INSERT-гонке оба пути не видят друг друга. Это второй симптом той же проблемы, что 8 direct-writes в 3DS finalize — нужна единая точка записи.

## Scope / Constraints

- Менять ТОЛЬКО `supabase/functions/bepaid-webhook/index.ts` (3DS finalize ветка ≈4500–4951) + минимально `grant-access-for-order` (guard от race-INSERT).
- НЕ трогать LINK-ORDER, WEBHOOK-SUBSCRIPTION renewal, legacy one-time (H2.1c).
- Production DML = 0. Все исправления Рабчевской — отдельным data-repair шагом ниже, с явным dry-run первой стадии.
- Migrations = 0.
- `BEPAID_REBILL_MATERIALIZATION` = `dry_run`.
- `mode=on` НЕ включать.

## Часть A — Webhook 3DS finalize → canonical writer

### A.1. Делегирование

В 3DS finalize ветке заменить на единственный вызов:

```ts
const grant = await invokeGrantAccessForOrder({
  orderId,
  context: '3ds_finalize',
  source: 'bepaid_webhook'
});
```

Удалить локальные расчёты `access_start_at`, `access_end_at`, статусов подписки, бонус-дней, trial-bootstrap, past_due-reattach — всё это теперь делает writer.

### A.2. Запрещённые поля в webhook-write

После делегирования из 3DS ветки **запрещены** UPDATE/UPSERT на:

- `subscriptions_v2.access_start_at`
- `subscriptions_v2.access_end_at`
- `subscriptions_v2.status`
- `entitlements.*` (любые поля, любая ветка)
- `telegram_access_queue.*` напрямую
- любой `invoke('telegram-grant-access', …)` из 3DS ветки

Static check добавляется как тест (см. ниже).

### A.3. Provider-sync (что остаётся в webhook)

Только технические поля одной отдельной UPDATE-секцией:

- `billing_type`
- `next_charge_at` — берётся из `grant.outcome.next_charge_at_suggested`, если есть; иначе НЕ пишется
- `auto_renew` (true при активации, false при cancel)
- `meta.bepaid_*` (subscription_id, activated_at, source flags)
- `updated_at`

Цель UPDATE — найденная subscription (через `order_id = orderId` после writer'а). Если writer вернул `manual_review_multi_candidate` или `error`/`skip_*` — UPDATE провайдер-полей НЕ делается, fallback-write НЕ делается, audit ниже.

### A.4. Обработка outcome


| outcome.kind                     | webhook действие                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `bootstrap_created` / `extended` | provider-sync UPDATE по `order_id = orderId`; audit `bepaid.webhook.grant_ok`                                        |
| `manual_review_multi_candidate`  | 0 writes; audit `bepaid.webhook.grant_skipped_no_fallback` с `reason='multi_candidate'` и `candidate_ids`; HTTP 200  |
| `skip_*`                         | 0 writes; audit `bepaid.webhook.grant_skipped_no_fallback` с reason; HTTP 200                                        |
| `error`                          | 0 writes; audit `bepaid.webhook.grant_skipped_no_fallback` с reason; HTTP 200 (НЕ 500, иначе bePaid начнёт ретраить) |


### A.5. Ambiguous orderId

Если в webhook payload нет однозначного `order_id` (или mapping `transaction → order` дал ≥2 кандидата) — НЕ зовём writer, audit `bepaid.webhook.ambiguous_order_id`, HTTP 200, 0 writes.

## Часть B — Guard от race-INSERT в canonical writer

**Минимальная** правка `three_ds_writer.ts` / основной ветки writer'а — закрыть кейс Рабчевской на будущее без переноса логики из webhook.

### B.1. Расширить `classifyCandidates`

Добавить к выборке кандидатов:

- `subscriptions_v2.order_id = orderId` (поиск по тому же order даже если status уже active);
- `subscriptions_v2.meta->>'bepaid_subscription_id' = $sbsFromOrder` (если order содержит `meta.bepaid_subscription_id`).

Если найден кандидат по любому из этих ключей → **outcome `skip_already_processed**` (а не INSERT). Это закрывает race, когда webhook успел вставить provider_managed skeleton раньше.

### B.2. Pre-INSERT advisory-lock-style guard

Перед самим INSERT новой подписки повторно `SELECT … FOR UPDATE` по `(user_id, product_id, status IN active/past_due/trialing)`. Если за время вычислений появился новый active кандидат → НЕ INSERT, outcome `skip_concurrent_insert`, audit `grant.race_insert_avoided`.

### B.3. Без forceExtend

`forceExtend=true` НЕ вводится. Никаких новых Telegram-вызовов из writer'а — Telegram path остаётся unchanged.

## Часть C — Data-repair Рабчевской (отдельным шагом, после merge A+B)

### C.1. Dry-run отчёт

Read-only скрипт (через `supabase--read_query`) фиксирует:

- два `subscriptions_v2` с одним `order_id=d1080bf5-…`;
- предлагаемое решение: оставить `4469a81d` (provider_managed, привязан к `sbs_2f634e38e892da31`), погасить `f7fda1d7` как дубль с переносом метаданных:
  - `f7fda1d7.status = 'canceled'`
  - `f7fda1d7.cancel_reason = 'duplicate_race_h2_1b_ii'`
  - `f7fda1d7.meta.merged_into = '4469a81d-…'`
  - `4469a81d.access_end_at = max(оба, 16.06.26 12:00)` (НЕ уменьшать);
  - `4469a81d.billing_type` оставить `provider_managed`;
  - `4469a81d.meta.initial_order_id = 'd1080bf5-…'` (взять из погашенной);
  - `4469a81d.next_charge_at = max(оба)` (НЕ уменьшать).
- entitlements не трогаем — там единственная `934499af` уже корректна (`expires_at=16.06.26 12:00`).

### C.2. Execute

Выполнение C.1 только после явного approve пользователем отчёта dry-run. Это **не часть** DoD текущего патча — пойдёт отдельным мини-DML с миграцией-аудитом.

## Tests

`bepaid-webhook/three_ds_canonical_writer_test.ts` (новый):

1. **happy_path_bootstrap** — 3DS finalize, нет existing sub → writer вызван 1 раз, ZERO direct access writes, provider-sync UPDATE на subscription, созданную writer'ом.
2. **happy_path_extend** — existing active same tariff → writer extend, provider-sync UPDATE на ту же запись.
3. **multi_candidate_no_fallback** — 2 active subs → writer вернул `manual_review_multi_candidate` → ZERO writes, audit `grant_skipped_no_fallback`.
4. **skip_already_processed_no_fallback** — order уже привязан → ZERO writes, audit.
5. **error_no_fallback** — writer вернул `error` → ZERO writes, audit, HTTP 200.
6. **next_charge_at_provider_sync** — writer вернул `next_charge_at_suggested=X`, webhook записал ровно X в `next_charge_at`, НЕ трогая `access_*`/`status`.
7. **ambiguous_order_id** — 0 writes, audit `ambiguous_order_id`.
8. **static_check_no_access_writes** — `rg`-проверка по диапазону 3DS finalize ветки: 0 совпадений `access_start_at|access_end_at|entitlements\.|telegram-grant-access` (кроме чтения).
9. **race_insert_avoided** (writer-тест) — есть `subscriptions_v2.order_id = orderId` уже → новый INSERT не происходит, outcome `skip_already_processed`.
10. **race_insert_avoided_by_sbs** — кандидат найден по `meta.bepaid_subscription_id` → `skip_already_processed`.

DoD: новые 10 тестов + все существующие H2.1b-i (35) + H2.1b webhook-тесты должны быть green.

## Технические файлы

- **edit**: `supabase/functions/bepaid-webhook/index.ts` — 3DS finalize ветка переписана как (a) вызов writer'а, (b) outcome handling, (c) узкий provider-sync UPDATE.
- **edit (small)**: `supabase/functions/grant-access-for-order/three_ds_writer.ts` — расширить `classifyCandidates` (B.1) + pre-INSERT re-check (B.2).
- **create**: `supabase/functions/bepaid-webhook/three_ds_canonical_writer_test.ts`.
- **edit**: `supabase/functions/grant-access-for-order/three_ds_writer_test.ts` — добавить 2 race-теста.
- **create**: `.lovable/proofs/patch_h2_1b_ii_webhook_3ds_replace_2026_05.md`.
- **edit**: `.lovable/plan.md` — статусы цепочки.

## Proof (DoD)

`.lovable/proofs/patch_h2_1b_ii_webhook_3ds_replace_2026_05.md`:

- diff webhook 3DS finalize: before (8 direct writes) → after (0 writes + 1 writer call + 1 узкий provider-sync UPDATE);
- outcome × action матрица (см. A.4);
- static check вывод `rg`;
- список запрещённых полей и подтверждение их отсутствия;
- результаты тестов (10 new + 35 existing writer + existing webhook = all green);
- explicit: production DML = 0, migrations = 0, `BEPAID_REBILL_MATERIALIZATION = dry_run`, `mode=on` выключен;
- отдельная секция "Дубликат Рабчевской":
  - корневая причина (race INSERT между webhook и writer);
  - подтверждение, что B.1+B.2 закрывают этот класс на будущее;
  - dry-run план C.1 (без выполнения).

## Что НЕ входит

- Выполнение data-repair Рабчевской (C.2) — отдельный approve.
- H2.1c legacy one-time path.
- H2b atomic append через RPC.
- H3 широкий repair дублей по всей базе.
- H4 preconditions + `mode=on`.

## DoD

- 3DS finalize ветка не пишет в access-поля;
- writer вызывается ровно 1 раз на 3DS finalize;
- provider-sync — только 5 разрешённых полей;
- skip/error/manual_review → no fallback-write, HTTP 200, audit;
- `next_charge_at` из writer применяется без касания access;
- race-INSERT guard в writer закрывает кейс Рабчевской;
- 10 новых тестов + все existing — green;
- static check `rg` чист;
- proof файл создан;
- `.lovable/plan.md` обновлён: H2.1b-ii = closed;
- dry-run Рабчевской зафиксирован в proof, execute НЕ выполнен;
- production DML = 0, migrations = 0, `BEPAID_REBILL_MATERIALIZATION = dry_run`, `mode=on` выключен.