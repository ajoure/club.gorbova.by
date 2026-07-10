# да, согласен, с учетом правок:

## **Статус ранее выданных 13 замечаний**


| **№** | **Замечание**                                               | **Статус**           |
| ----- | ----------------------------------------------------------- | -------------------- |
| 1     | Identity и правильные `meta.rr` paths                       | **Внесено**          |
| 2     | Сигнатура `rr_get_or_create_pending_order` не меняется      | **Внесено**          |
| 3     | Recovery только через canonical `rr_finalize_created_order` | **Внесено**          |
| 4     | Working reconciliation не переносится в Gate B              | **Внесено**          |
| 5     | Однозначная state machine и условия снятия блока            | **Частично внесено** |
| 6     | Полная классификация upstream и `failureKind`               | **Внесено**          |
| 7     | Разделение `external_id` и `provider_request_id`            | **Внесено**          |
| 8     | Атомарный rejected-finalizer                                | **Внесено**          |
| 9     | Проверка восстановления URL и поведения РР                  | **Частично внесено** |
| 10    | Schema-first UI discovery                                   | **Внесено**          |
| 11    | Запрет production fixture                                   | **Внесено**          |
| 12    | Integration tests и доказательство числа вызовов РР         | **Внесено**          |
| 13    | DoD без skeleton/TODO                                       | **Частично внесено** |


План существенно исправлен и в целом пригоден к реализации. До запуска необходимо устранить следующие логические неоднозначности.



## **1. Исправить семантику**

`operator_resolved`

Сейчас `operator_resolved` одновременно используется как:

- состояние, при котором durable block сохраняется;
- состояние после решения оператора;
- возможное terminal resolution;
- reuse-кандидат без временного ограничения;
- состояние, после которого новый заказ «зависит от резолюции».

Это не даёт RPC однозначно определить, блокировать или разрешать новую заявку.

Заменить одним из двух вариантов.

### **Предпочтительный вариант**

Разделить статус reconciliation и решение оператора:

```json
{
  "reconciliation_status": "pending" | "confirmed_created" | "not_found" | "operator_required" | "resolved",
  "operator_resolution": "keep_blocked" | "confirm_created" | "allow_new_order" | null
}
```

Правила:


| **Состояние**                | **Поведение reuse**                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `pending`                    | вернуть тот же заказ, новый create запрещён                                            |
| `operator_required`          | вернуть тот же заказ, новый create запрещён                                            |
| `resolved + keep_blocked`    | вернуть тот же заказ                                                                   |
| `resolved + confirm_created` | заказ должен быть канонически финализирован как `created`                              |
| `resolved + allow_new_order` | старый заказ должен стать terminal `failed/canceled`, после commit можно создать новый |
| `confirmed_created`          | вернуть существующий `payment_url`                                                     |
| `not_found`                  | старый заказ terminal, новый разрешён                                                  |


Нельзя оставлять `operator_resolved` в списке вечных reuse-кандидатов, если одна из операторских резолюций разрешает новый заказ.





## **2.**

`rr_operator_resolve` **должен выполнять решение, а не только записывать marker**

Для каждого разрешённого действия определить атомарную операцию:

```text
confirm_created
→ rr_finalize_created_order
→ reconciliation_status='confirmed_created'
→ durable block снят, новый заказ запрещён

allow_new_order
→ terminal state старого заказа
→ operator_resolution='allow_new_order'
→ operator_intervention event
→ commit
→ новый заказ разрешён

keep_blocked
→ pending/operator_required
→ новый заказ запрещён
```

RPC должен принимать ограниченный enum действия, проверять текущий state и быть идемпотентным.

Произвольное изменение JSON оператором запрещено.





## **3. Не приравнивать одиночный**

`not found` **к definitive rejection**

Фраза:

заявка не найдена / definitive not_found

недостаточна. Ответ `not found` может возникнуть из-за:

- неверного endpoint или формата ID;
- задержки появления заявки;
- eventual consistency;
- ошибки credentials или test/prod environment;
- недокументированного ответа РР;
- временного сбоя, ошибочно интерпретированного как отсутствие заказа.

До подтверждения контракта РР `not found` должно вести в:

```text
reconciliation_status='operator_required'
durable block сохраняется
новый заказ запрещён
```

Автоматически вызывать `rr_finalize_order_rejected` и разрешать новый заказ можно только при наличии документированного definitive-кода РР либо подтверждённой retry/grace policy.

В `rr_provider_contract.md` добавить:

- точный HTTP status;
- точное поле/код ответа;
- минимальное количество проверок;
- интервалы между проверками;
- grace period после `createOrder`;
- различие test/prod endpoint;
- правило, после которого отсутствие заявки считается окончательным.





## **4. Не использовать**

`rejected` **для подтверждённого отсутствия заявки**

`upstream_outcome='rejected'` означает, что РР получил запрос и отклонил его. `not_found` означает, что наличие заявки не подтверждено. Это разные факты.

Добавить terminal outcome, например:

```json
{
  "upstream_outcome": "unknown" | "rejected" | "not_created"
}
```

Либо оставить `upstream_outcome='unknown'`, но добавить отдельное:

```json
{
  "reconciliation_status": "not_found",
  "resolution": "allow_new_order"
}
```

Не записывать ложное `create_order_rejected`, если фактически РР не сообщал rejection.

Для подтверждённого отсутствия использовать отдельное событие:

```text
create_order_not_found
```

или:

```text
create_order_confirmed_not_created
```

## **5. Разделить два атомарных terminal-finalizer**

Текущий `rr_finalize_order_rejected` подходит только для документированного отказа РР.

Нужны разные контракты:

```text
rr_finalize_order_rejected
→ РР явно отклонил запрос
→ upstream_outcome='rejected'
→ create_order_rejected
```

```text
rr_finalize_order_not_created
→ reconciler достоверно подтвердил отсутствие заявки
→ reconciliation_status='not_found'
→ create_order_confirmed_not_created
→ разрешить новый external_id
```

Не смешивать эти события в одном RPC.

## **6. Идемпотентность событий описать через реальный DB-контракт**

Формулировка:

уникальный `(order_id, event_type)`

недостаточна, если в таблице нет такого unique constraint.

Для каждого события использовать детерминированный `idempotency_key`, например:

```text
<order_id>:create_order_succeeded
<order_id>:create_order_recovered
<order_id>:create_order_outcome_unknown
<order_id>:reconciliation_confirmed_created
<order_id>:reconciliation_not_found
<order_id>:recovery_blocked_no_url
<order_id>:operator_intervention:<resolution>
```

И вставлять через:

```sql
ON CONFLICT (idempotency_key) DO NOTHING
```

Для повторяемых reconciliation attempts нужен отдельный attempt ledger либо ключ с номером попытки. Нельзя одновременно требовать историю всех попыток и дедуплицировать их одним постоянным ключом.



## **7. Уточнить атомарность**

`rr_reconcile_confirm_created`

Формулировка:

внутри вызывает canonical `rr_finalize_created_order`

может оказаться неисполняемой как вложенный RPC-вызов в предполагаемом виде.

Выбрать один конкретный контракт:

- edge вызывает `rr_finalize_created_order`, проверяет успешный результат, затем отдельным идемпотентным вызовом пишет audit-event;
- либо создать SQL wrapper, который вызывает PL/pgSQL-функцию в той же транзакции и добавляет reconciliation event.

Предпочтителен SQL wrapper, если требуется атомарность:

```text
canonical finalize
+ reconciliation_status='confirmed_created'
+ reconciliation_confirmed_created event
= одна транзакция
```

При сбое audit-вставки заказ не должен остаться в противоречивом состоянии.

## **8. Canonical finalizer должен явно очищать recovery/unknown markers**

В §3 указано снятие `local_persist_failed`, но в DoD нужно перечислить полный postcondition:

```json
{
  "initiation_status": "created",
  "payment_url": "<canonical>",
  "provider_request_id": "<real or null>",
  "local_persist_failed": false,
  "upstream_outcome": null,
  "reconciliation_status": "confirmed_created"
}
```

Также удалить или архивировать:

```text
rr_payment_url_recovered
rr_request_id_recovered
local_persist_error
```

Допустимо не физически удалять forensic-поля, но тогда перенести их в отдельный audit subtree, чтобы рабочая логика больше не принимала их за активный recovery-marker.



## **9. Recovery не должен требовать**

`provider_request_id`

В §3 указано:

если оба присутствуют

Но для canonical recovery обязательным является известный валидный `payment_url`. Provider ID может отсутствовать или не быть отдельным ID.

Исправить:

```text
payment_url обязателен
provider_request_id nullable
```

Если `payment_url` есть, а request ID отсутствует, recovery не должен бессрочно блокироваться исключительно из-за отсутствия необязательного провайдерского идентификатора.

При этом нельзя подставлять вместо него `external_id`.

## **10. Указать защиту непубличной reconciliation edge**

Фраза «не публичная» должна быть превращена в проверяемый контракт:

- `verify_jwt=true`;
- вызов только service role или внутренним cron;
- проверка роли/секрета внутри handler;
- отсутствие CORS для браузерного публичного вызова;
- запрет передавать произвольный `order_id` без проверки provider/flow/state;
- rate limit и structured audit;
- secret не передаётся через query string;
- ручной запуск фиксируется отдельным audit-event с actor/source.

Добавить negative tests:

- anon получает 401/403;
- authenticated non-admin получает 403;
- order другого provider отклоняется;
- order другого flow отклоняется;
- terminal order не меняется.

## **11. Cron не должен создавать бесконечный reconciliation loop**

Добавить в state:

```json
{
  "reconciliation_attempts": 0,
  "last_reconciliation_at": null,
  "next_reconciliation_at": null,
  "last_reconciliation_error": null
}
```

Определить:

- максимальное число автоматических попыток;
- backoff;
- переход в `operator_required`;
- какие ошибки повторяемы;
- какие ошибки terminal;
- запрет повторной проверки terminal-заказа.





## **12. Уточнить**

`failureKind` **для HTTP 2xx без URL**

`failureKind='http'` не вполне точно: HTTP-вызов успешен, но нарушен provider response contract.

Добавить значение:

```ts
failureKind:
  | "timeout"
  | "network"
  | "invalid_json"
  | "http"
  | "invalid_response"
  | null
```

Тогда:


| **Случай**                  | `failureKind`      |
| --------------------------- | ------------------ |
| 2xx без ссылки              | `invalid_response` |
| 2xx с неверным типом `link` | `invalid_response` |
| 2xx с пустым `link`         | `invalid_response` |
| JSON syntactically invalid  | `invalid_json`     |
| HTTP 4xx/5xx                | `http`             |


Также валидировать `payment_url`:

- тип `string`;
- непустой;
- допустимый `https`;
- ожидаемый host или documented allowlist;
- без credentials в URL.

## **13. Уточнить DoD при вынесении Gate A.2**

Сейчас написано:

Gate A.1 PASS, если reconciliation реализована в Gate A.1 либо вынесена в Gate A.2 с PASS до Gate B.

Это создаёт временную неоднозначность.

Зафиксировать:

```text
Если working reconciliation вынесена в Gate A.2:
- Gate A.1 получает PARTIAL PASS / PASS WITH BLOCKER;
- общий Gate A остаётся FAIL;
- Gate B заблокирован;
- полный Gate A PASS выдаётся только после Gate A.2 PASS.
```

Нельзя выдать окончательный Gate A.1 PASS на основании будущего обещания выполнить Gate A.2.

## **14. Добавить обязательные проверки миграции**

Перед применением миграции:

1. Получить `pg_get_functiondef` всех заменяемых RPC.
2. Зафиксировать grants до изменения.
3. Найти все callers `rr_get_or_create_pending_order`.
4. Проверить типы enum и ограничения `orders_v2.status`.
5. Dry-run SQL на preview/test.
6. Проверить, что function replacement не сбросил privileges или owner.
7. После миграции доказать:

```sql
has_function_privilege('anon', ..., 'EXECUTE') = false
has_function_privilege('authenticated', ..., 'EXECUTE') = false
has_function_privilege('service_role', ..., 'EXECUTE') = true
```

## **Итоговый статус**

После этих правок план можно запускать как **Gate A.1**.

Критичные обязательные уточнения до реализации:

1. Разделить `operator_required`, операторское решение и terminal resolution.
2. Не считать неподтверждённый `not found` rejection.
3. Разделить `rejected` и `confirmed not created`.
4. Recovery разрешать при наличии URL даже без `provider_request_id`.
5. Зафиксировать реальную идемпотентность `provider_events`.
6. Описать auth, retry/backoff и terminal policy для reconciler.
7. Не выдавать полный PASS при ещё не выполненном Gate A.2.

Отправить план Lovable в plan mode не удалось: операция вернула `403 insufficient_scope: projects:write`. Код проекта не изменялся.

&nbsp;

План: Sprint B — Gate A.1 hardening (v2, с учётом ревью)

## Область и запреты

- Sprint C не открывать. Sprint B остаётся FAIL до полного Gate B PASS.
- Gate B (UI patch, deploy, публичный E2E, negative proofs v2 на реальном сайте) не запускать в этом шаге.
- **Production fixture запрещён.** Никаких production-миграций для fixture. Fallback в production — только deferred contingency при отдельном письменном согласовании. Integration proofs выполняются исключительно в **отдельной preview/test Supabase environment**.
- Никаких новых `orders_v2` / `provider_events` на боевом РР-оффере во время работы над Gate A.1.
- React/UI-код не меняется в этом шаге. UI mini-план — только discovery-документ, без предзаданной schema.
- Сумма для тестов — 1650 BYN. 1 BYN / 100 BYN — только после письменного подтверждения РР.
- Все артефакты, комментарии и итоговый отчёт — на русском.

## 0. Терминология

- `external_id` — локальный `orders_v2.id`. Никогда не заменяется провайдерским.
- `provider_request_id` — только реально полученный `json.id` из ответа РР. При timeout/network failure может отсутствовать.
- Fallback `json.id ?? external_id` **запрещён**: он не подтверждает создание заявки у провайдера.
- Identity заказа (для reuse и recovery): существующая модель RPC — `offer_id + user_id + email_norm + phone_norm`. Никакого нового `contact_hash`.
- JSON-path для recovery-полей: только внутри `meta.rr`:
  - `meta->'rr'->>'local_persist_failed'`
  - `meta->'rr'->>'rr_payment_url_recovered'`
  - `meta->'rr'->>'rr_request_id_recovered'`
  - `meta->'rr'->>'upstream_outcome'` (`'unknown' | 'rejected'`)
  - `meta->'rr'->>'reconciliation_status'` (`'pending' | 'confirmed_created' | 'not_found' | 'operator_resolved'`)

## 1. State machine (add-only, без новых значений `initiation_status`)

Значения `initiation_status` не расширяются в этом шаге. Всё дополнительное состояние — только в `meta.rr` (add-only ключи):

```
{
  "initiation_status": "pending" | "created" | "failed",
  "meta.rr.local_persist_failed": true?,
  "meta.rr.upstream_outcome": "unknown" | "rejected"?,
  "meta.rr.reconciliation_status": "pending" | "confirmed_created" | "not_found" | "operator_resolved"?
}
```

Терминальные и промежуточные переходы:


| Из                                                                                    | В                                                                              | Кто                    | RPC                                                                                    | Событие                                                          | Снятие durable-блока | Новый заказ после           |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------- | --------------------------- |
| `pending` (fresh, <120s)                                                              | `pending` (reuse)                                                              | edge, публичный вызов  | `rr_get_or_create_pending_order`                                                       | —                                                                | —                    | нет                         |
| `pending` + `local_persist_failed`                                                    | `created`                                                                      | edge, повторный submit | canonical `rr_finalize_created_order` (из recovered полей)                             | `create_order_succeeded` + опц. `create_order_recovered` (audit) | сразу после commit   | нет (тот же order)          |
| `pending` + `upstream_outcome='unknown'`                                              | `created`                                                                      | reconciler             | `rr_reconcile_confirm_created` → внутри вызывает canonical `rr_finalize_created_order` | `reconciliation_confirmed_created` + `create_order_succeeded`    | после commit         | нет                         |
| `pending` + `upstream_outcome='unknown'`                                              | `failed` + `upstream_outcome='rejected'` + `reconciliation_status='not_found'` | reconciler             | атомарный `rr_finalize_order_rejected`                                                 | `reconciliation_not_found` + `create_order_rejected`             | после commit         | **да**, новым `external_id` |
| `pending` + `upstream_outcome='unknown'` (URL не восстановим, заявка у РР существует) | `pending` + `reconciliation_status='operator_resolved'`                        | оператор               | `rr_operator_resolve`                                                                  | `operator_intervention`                                          | только оператором    | зависит от резолюции        |
| определённый rejection РР                                                             | `failed` + `upstream_outcome='rejected'`                                       | edge                   | атомарный `rr_finalize_order_rejected`                                                 | `create_order_rejected`                                          | сразу                | да                          |


`local_persist_failed` используется **исключительно** для случая, когда РР уже вернул валидный `payment_url`, но локальный commit упал. Для rejection он не используется.

## 2. Reuse RPC — расширение без слома контракта (замечание §1, §2)

2.1. Расширить `public.rr_get_or_create_pending_order`:

- identity остаётся: `offer_id + user_id + email_norm + phone_norm`;
- кандидаты reuse под advisory lock (в порядке приоритета):
  1. существующий `pending` с `meta.rr.local_persist_failed = 'true'` — **без 120-секундного окна и без обычного 30-минутного окна**;
  2. существующий `pending` с `meta.rr.upstream_outcome = 'unknown'` и `reconciliation_status IN ('pending','operator_resolved')` — **без временных окон**;
  3. существующий `pending` без маркеров, младше 120 секунд (текущая concurrency-логика);
- **сигнатура возврата не меняется**: остаётся `(order_id, was_reused, order_number)`;
- при `was_reused = true` edge читает `orders_v2.meta.rr` отдельным SELECT и решает ветку (recovery / reconciliation-pending / обычный polling).

2.2. Альтернатива, если добавление полей неизбежно — только через **versioned RPC** с новым именем (`rr_get_or_create_pending_order_v2`) и явным mapping всех callers. В рамках этого плана предпочтителен вариант 2.1.

## 3. Durable recovery через canonical finalizer (замечание §3)

Не создавать отдельный второй writer для recovery. Повторный submit при `local_persist_failed`:

1. edge получает тот же `order_id` из reuse RPC, `was_reused=true`;
2. SELECT `meta.rr.rr_payment_url_recovered`, `meta.rr.rr_request_id_recovered`;
3. если оба присутствуют → вызов canonical `rr_finalize_created_order(order_id, payment_url, provider_request_id)`;
4. finalizer идемпотентно: переносит поля в канонические, ставит `initiation_status='created'`, снимает `meta.rr.local_persist_failed`, пишет `create_order_succeeded` (уникальный `(order_id, event_type)`);
5. дополнительно (audit-only): `create_order_recovered` — допускается, идемпотентно, после успешного canonical finalize;
6. edge возвращает `{ payment_url, order_id, reused:true, recovered:true }`;
7. если recovered URL/ID отсутствуют → HTTP `503 rr_recovery_pending`, **новый `orders_v2.id` запрещён, `rrCreateOrder` запрещён**, `provider_events` тип `recovery_blocked_no_url` (идемпотентно).

Никакого повторного `rrCreateOrder` в recovery-ветке. Никакого нового `external_id`.

## 4. Классификация upstream-ответов (замечание §6, §7)

Add-only поле в HTTP-слое:

```ts
failureKind: "timeout" | "network" | "invalid_json" | "http" | null
```

Классификация не по тексту исключения, а по типу события `fetch`/`AbortController`:


| Результат                                                         | Класс                                      | `failureKind`    |
| ----------------------------------------------------------------- | ------------------------------------------ | ---------------- |
| Документированный validation rejection РР (4xx с ожидаемым телом) | `upstream_rejected`                        | `"http"`         |
| Timeout (AbortController)                                         | `upstream_outcome_unknown`                 | `"timeout"`      |
| Network error / status 0                                          | `upstream_outcome_unknown`                 | `"network"`      |
| HTTP 5xx                                                          | `upstream_outcome_unknown`                 | `"http"`         |
| HTTP 408/425/429                                                  | `upstream_outcome_unknown`                 | `"http"`         |
| HTTP 2xx без `payment_url`                                        | `upstream_outcome_unknown`                 | `"http"`         |
| Невалидный JSON                                                   | `upstream_outcome_unknown`                 | `"invalid_json"` |
| Недокументированный 4xx                                           | `upstream_outcome_unknown` (консервативно) | `"http"`         |


`provider_request_id` записывается только если РР реально вернул `json.id` в 2xx-ответе.

## 5. Ambiguous upstream: working reconciliation в Gate A.1 (замечание §4)

Skeleton/TODO не допускается. Использовать **существующий** `rrGetOrderStatus` из текущего RR-адаптера (не создавать `rrClient.ts` и не дублировать).

5.1. При `upstream_outcome_unknown` в публичном flow:

- атомарный RPC `rr_mark_upstream_unknown(order_id, provider_request_id?)`:
  - lock order → сохраняет `meta.rr.upstream_outcome='unknown'`, `reconciliation_status='pending'`, `provider_request_id` (если есть) → пишет `create_order_outcome_unknown` → commit;
  - `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `EXECUTE` только `service_role`;
- edge отвечает HTTP `504 rr_upstream_unknown` c `{ order_id }`;
- любой повторный submit того же identity получает через reuse RPC тот же `order_id`. Если `reconciliation_status='pending'` — HTTP `503 rr_reconciliation_pending`, **без нового заказа и без `rrCreateOrder**`.

5.2. Reconciler (edge-функция `rr-reconcile-order`, вызывается вручную/cron, **не публичная**):

- вход: `order_id`;
- вызывает `rrGetOrderStatus(external_id = orders_v2.id)`;
- маппинг результата:
  - заявка существует и известен `payment_url` → `rr_reconcile_confirm_created(order_id, payment_url, provider_request_id)` (внутри — canonical `rr_finalize_created_order` + событие `reconciliation_confirmed_created`);
  - заявка не найдена / definitive not_found → атомарный `rr_finalize_order_rejected` + `reconciliation_status='not_found'` + событие `reconciliation_not_found`. После этого разрешён новый заказ (новым `external_id`);
  - заявка существует, URL не восстановим → `reconciliation_status='operator_resolved'` pending-block сохраняется, событие `operator_intervention`, alert; новый заказ запрещён до оператора.

5.3. Если по документации/test-response РР **не подтверждена** возможность восстановить `payment_url` через `getOrderStatus` и не подтверждена идемпотентность повторного `createOrder` с тем же external ID (см. §9), reconciler-ветка «confirm_created» остаётся заблокированной; допускаются только `not_found` и `operator_resolved`. Повторный `createOrder` запрещён даже с прежним ID.

5.4. Если по инфраструктурным причинам working reconciliation невозможно доставить одновременно с recovery, план разбивается: Gate A.1 — durable recovery + классификация + блокировка; **обязательный Gate A.2 — working reconciliation с PASS до старта Gate B**. Никакого «skeleton в Gate B».

## 6. Атомарный rejected-finalizer (замечание §8)

Новый RPC `public.rr_finalize_order_rejected(order_id, reason_code, http_status?, response_snippet?)`:

- lock order → `initiation_status='failed'`, `meta.rr.upstream_outcome='rejected'` → вставка `create_order_rejected` (идемпотентная по `(order_id, event_type)`) → commit;
- `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `EXECUTE` только `service_role`, `REVOKE` у `anon`/`authenticated`;
- edge для definitive rejection вызывает этот RPC вместо раздельных UPDATE+INSERT;
- `local_persist_failed` для rejection не используется.

## 7. SECURITY DEFINER hardening (замечание §5, §3)

Миграция `ALTER FUNCTION ... SET search_path = public, pg_temp` для:

- `public.rr_finalize_created_order`
- `public.rr_mark_local_persist_failed`
- `public.rr_get_or_create_pending_order` (после правки)
- `public.rr_mark_upstream_unknown`
- `public.rr_reconcile_confirm_created`
- `public.rr_finalize_order_rejected`
- `public.rr_operator_resolve`

Grants: `EXECUTE` — только `service_role`; `REVOKE ALL FROM anon, authenticated, PUBLIC` для всех перечисленных.

## 8. Подтверждение поведения РР до включения reconciliation (замечание §9)

До активации ветки «confirm_created» в reconciler зафиксировать в `docs/audit/2026-07-10-sprint-b-runtime-proof/gate_a1/rr_provider_contract.md`:

- возвращает ли `getOrderStatus` `payment_url` (по документации + test-response);
- существует ли отдельный endpoint получения URL;
- идемпотентен ли повторный `createOrder` с тем же external ID (что происходит: 200 с тем же URL / 4xx conflict / новая заявка);
- какое поле однозначно идентифицирует «not found».

До подтверждения — повторный `createOrder` запрещён даже с прежним ID; reconciler работает только по веткам `not_found` и `operator_resolved`. Если заявка существует, но URL не восстановим — controlled blocked state + audit + operator alert + запрет нового заказа.

## 9. UI mini-план — schema-first discovery (замечание §10)

Документ `docs/audit/2026-07-10-sprint-b-runtime-proof/ui_wiring_mini_plan.md` — **только discovery, без предзаданной schema**:

1. Прочитать фактические `site_pages.blocks` страницы `d5a5c2e0-...` (slug `cb`, домен `gorbova.by`) и выписать все блоки с ценами/CTA.
2. Определить реальный renderer каждого блока (`UniversalPricingSection`, `ButtonSection`, кастомный).
3. Найти в проекте существующий рабочий binding CTA того же типа для `bank_installment` (эталон).
4. Подтвердить фактическую schema `content.action` из кода-рендерера, а не из предположения.
5. Для каждого из трёх офферов (`15ce91ec…`, `2a07af43…`, `4f64def7…`) показать **фактический binding в блоке или его отсутствие**. Не утверждать заранее, что офферы привязаны.
6. Найти реальный источник цен 1490/1690 BYN (hardcoded в блоке vs. динамика из `tariff_offers`).
7. По итогам — предложить data-only patch **только если** подтверждённая schema это допускает; иначе — зафиксировать необходимость React-правки как отдельного шага Gate B с обоснованием.

Никаких формулировок вида `action.type='open_lead_form'` / `action.target='<offer_id>'` до подтверждения schema.

## 10. Fixture (замечание §11)

- Обновить `test_fixture_discovery.md`: убрать `tariffs.is_active=false` (edge отвечает `tariff_inactive`).
- Зафиксировать: **production fixture запрещён**, production migration для fixture запрещена, production fallback — только deferred contingency, требующая отдельного письменного согласования.
- Все integration proofs — только в отдельной preview/test Supabase environment. Сумма — 1650 BYN.
- Обновить `cleanup_test_fixture.sql`: параметризация по фиктивной среде, никаких массовых DELETE в production.

## 11. Integration tests (замечание §12)

Терминология: тесты RPC против реальной test-БД — **integration tests**, а не unit tests. Обязательные сценарии (все в preview/test environment):

1. Recovery заказа старше 120 секунд и старше обычного 30-минутного окна reuse.
2. Пять параллельных повторов старого `local_persist_failed`: ровно 1 `order_id`, 0 новых `rrCreateOrder`, ровно 1 `create_order_succeeded`.
3. Recovery без recovered URL: HTTP 503, 0 новых заказов, 0 вызовов РР, событие `recovery_blocked_no_url`.
4. `upstream_outcome_unknown` блокирует повторный `createOrder`: HTTP 503, 0 новых заказов.
5. Reconciliation снимает блок только после terminal resolution (`confirmed_created` / `not_found` / `operator_resolved`).
6. Повторная reconciliation идемпотентна (тот же итог, ноль дублирующих событий).
7. Повторный canonical `rr_finalize_created_order` идемпотентен.
8. `rr_finalize_order_rejected` атомарен: сбой на любом шаге не оставляет частичного состояния.
9. Другой identity-key (`offer_id`/`user_id`/`email_norm`/`phone_norm`) не переиспользует чужой заказ — отдельный тест на каждую из четырёх осей.
10. Классификатор: 8 сценариев из таблицы §4, проверка `failureKind` и итогового класса.
11. **Количество обращений к РР подтверждается ledger/correlation evidence** (счётчик в моке РР + `provider_request_id`-корреляция в `provider_events`), а не только логами приложения.

## 12. Артефакты

- `docs/audit/2026-07-10-sprint-b-runtime-proof/gate_a1/README.md` — сводка Gate A.1.
- `.../gate_a1/state_machine.md` — таблица переходов (см. §1), кто/RPC/событие/снятие блока/разрешение нового заказа.
- `.../gate_a1/recovery_contract.md` — durable recovery через canonical finalizer.
- `.../gate_a1/ambiguous_upstream_contract.md` — классификация + reconciliation.
- `.../gate_a1/rr_provider_contract.md` — подтверждение поведения РР (§8).
- `.../gate_a1/integration_tests_report.md` — прогон 11 сценариев в preview/test env.
- Обновления: `ERRATA_and_gate_status.md`, `test_fixture_discovery.md`, новый `ui_wiring_mini_plan.md`.
- Итоговый отчёт — на русском.

## 13. DoD (замечание §13)

Gate A.1 PASS только при одновременном выполнении **всех** пунктов:

- durable recovery выполнен через canonical `rr_finalize_created_order`, отдельного второго writer нет;
- reuse RPC возвращает те же старые заказы с `local_persist_failed` / `upstream_outcome='unknown'` **вне обычных временных окон** pending reuse;
- working reconciliation реализована в Gate A.1 либо явно вынесена в обязательный Gate A.2 с PASS до старта Gate B; skeleton/TODO не допускается;
- state transitions (§1) и условия снятия durable-блока задокументированы и покрыты тестами;
- rejected-state фиксируется атомарным `rr_finalize_order_rejected`;
- `local_persist_failed` используется только для post-createOrder локальных сбоев, не для rejection;
- integration proofs (§11) выполнены **только** в preview/test environment; production `orders_v2` и `provider_events` при работе Gate A.1 не создавались (подтверждается snap до/после);
- все новые/изменённые RPC — `EXECUTE` только `service_role`, `REVOKE` у `anon`/`authenticated`;
- все SECURITY DEFINER функции — `SET search_path = public, pg_temp`;
- сигнатура `rr_get_or_create_pending_order` не сломана (или введён versioned RPC с явным mapping всех callers);
- `external_id` ≠ `provider_request_id`; fallback `json.id ?? external_id` отсутствует в коде;
- classifier покрыт integration-тестами; счётчик обращений к РР подтверждён ledger/correlation evidence;
- UI mini-план — schema-first discovery без предзаданных значений `action.*`;
- React/UI не изменён;
- Sprint B остаётся FAIL; Sprint C не начинать до полного Gate B PASS.

## Mapping изменений (для трассировки ревью)

- `contact_hash` → существующая identity `offer_id + user_id + email_norm + phone_norm`.
- `meta->>'local_persist_failed'` → `meta->'rr'->>'local_persist_failed'`.
- `needsRecovery` в изменённом return type RPC → чтение `meta.rr` в edge после `was_reused=true`, либо versioned RPC.
- `rr_recover_persist_failed_order` → canonical `rr_finalize_created_order` (+ опц. audit-событие).
- reconciliation skeleton в Gate B → working reconciliation в Gate A.1 (или обязательный Gate A.2).
- новый `rrClient.ts` / `rrReconcileByExternalId` → существующий RR-адаптер и `rrGetOrderStatus`.
- `initiation_status='upstream_unknown'` → `initiation_status='pending'` + `meta.rr.upstream_outcome` + `meta.rr.reconciliation_status`.
- раздельные `UPDATE + INSERT` при rejection → атомарный `rr_finalize_order_rejected`.
- предположительная UI-схема `action.type='open_lead_form'` → discovery фактической schema и binding до любого патча.
- production fixture / production migration → отдельная preview/test env; production — только deferred contingency.

## Файлы

- Новая миграция: правка `rr_get_or_create_pending_order` (identity+кандидаты, без смены сигнатуры), новые `rr_mark_upstream_unknown`, `rr_reconcile_confirm_created`, `rr_finalize_order_rejected`, `rr_operator_resolve`, `ALTER FUNCTION ... SET search_path` для всех перечисленных.
- `supabase/functions/public-rr-installment-initiate/index.ts` — ветки: reuse+recovery через canonical finalize, reuse+reconciliation-pending → 503, definitive rejection → atomic finalizer, ambiguous → `rr_mark_upstream_unknown` + 504. Никакого fallback `json.id ?? external_id`. Добавить `failureKind`.
- Новая непубличная edge `supabase/functions/rr-reconcile-order/index.ts` — использует существующий `rrGetOrderStatus` из RR-адаптера.
- `docs/audit/2026-07-10-sprint-b-runtime-proof/gate_a1/*` — новые документы.
- Обновления: `ERRATA_and_gate_status.md`, `test_fixture_discovery.md`, новый `ui_wiring_mini_plan.md`.