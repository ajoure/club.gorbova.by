# да, согласен, с учетом правок:





## **1. Не устанавливать**

`upstream_outcome='created'` **до успешной финализации**

В блоке 3 предложено:

`rr_reconcile_confirm_created` выставит `upstream_outcome='created'` до делегирования в canonical

Такой порядок создаёт ложное промежуточное состояние. Если canonical finalize завершится ошибкой или будет обработан exception, заказ не должен остаться с утверждением `upstream_outcome='created'`.

Требуемый порядок должен быть атомарным:

```text
проверка ambiguous source-state
→ canonical success transition
→ upstream_outcome='created'
→ reconciliation_status='confirmed_created'
→ upstream_call_state='completed'
→ create_order_succeeded
→ reconciliation_confirmed_created
→ commit
```

Ни один success-marker не записывается до гарантированной успешной финализации.

### **Предпочтительная реализация**

Вынести единое изменение success-state во внутреннюю SQL-функцию:

```text
rr_finalize_created_order_internal(...)
```

Она:

- не получает `EXECUTE` для `anon`, `authenticated`, `service_role`;
- вызывается только из `rr_finalize_created_order` и `rr_reconcile_confirm_created`;
- является единственным writer канонического success-state.

Публичные wrappers выполняют свои source-state guards, затем вызывают internal helper в той же транзакции.

Это не новая бизнес-сущность и не новая edge-функция, а технический SQL helper. Если helper не создаётся, необходимо явно показать, как исключено дублирование canonical update logic между двумя RPC.





## **2. Уточнить смысл**

`upstream_call_state='started'` **после полного post-call persistence failure**

В тесте №4 указано:

marker double failure → `upstream_call_state` не остаётся `started` навсегда

Это противоречит fail-closed модели.

Если после внешнего вызова не удалось записать ни:

- `upstream_outcome='unknown'`;
- ни `local_persist_failed`;

то единственное достоверное durable состояние — ранее записанное:

```text
upstream_call_state='started'
```

Оно **обязано сохраниться**, пока reconciler или оператор не установит подтверждённый исход. Именно это предотвращает второй `rrCreateOrder`.

Исправить тест №4:

```text
post-call marker падает дважды
→ HTTP 500 local_state_unconfirmed
→ upstream_call_state остаётся started
→ повторный submit через 10 и 31 минуту
→ тот же order_id
→ HTTP 503 rr_call_in_flight
→ 0 дополнительных rrCreateOrder
```

Переход из `started` в `outcome_unknown` или `completed_unpersisted` проверяется только когда соответствующий marker RPC успешно выполнен.

## **3. Разделить два сценария post-call marker failure**

Нужны отдельные тесты:

### **3.1 Marker полностью не записан**

```text
rrCreateOrder завершён
→ marker RPC падает дважды
→ state остаётся started
→ следующий submit блокируется как rr_call_in_flight
```

### **3.2 Первая попытка marker упала, retry успешен**

```text
rrCreateOrder завершён
→ первая marker-запись упала
→ retry записал outcome_unknown либо completed_unpersisted
→ следующий submit попадает в reconciliation либо recovery
→ не попадает в rr_call_in_flight
```

Иначе тест №4 смешивает два разных постусловия.

Матрицу увеличить до **14 тестов** либо объединить доказательства как два явно раздельных subcase теста №4.

## **4. Typed result должен проверяться не только в edge**

Typed state необходим, но RPC также должны обеспечивать строгую семантику.

Например, `rr_mark_call_started` не должен возвращать:

```json
{ "ok": true, "state": "terminal" }
```

как эквивалент успешного pre-call перехода.

Допустимые подходы:

- вернуть `ok:false, state:'terminal'`;
- либо оставить `ok:true`, но edge обязан принимать только `state='call_started'`.

В плане выбран второй подход. Зафиксировать его для всех RPC:


| **RPC**            | **Допустимый success-state для текущего действия**   |
| ------------------ | ---------------------------------------------------- |
| pre-call           | только `call_started`                                |
| unknown marker     | `unknown_marked` или `already_unknown`               |
| recovery marker    | `persist_failed_marked` или `already_persist_failed` |
| canonical finalize | `finalized` или совместимый `already_created`        |
| rejection          | `rejected` или совместимый `already_rejected`        |


Слово «совместимый» означает проверку фактического payload:

- тот же URL;
- тот же rejection code;
- тот же lifecycle outcome.

Один только текст `already_*` недостаточен.

## **5. При unexpected typed state перечитывание должно быть fail-closed**

В блоке 4 сказано:

перечитать заказ и вернуть фактическое состояние

Добавить точный mapping:


| **Прочитанное состояние**            | **Ответ**                                             |
| ------------------------------------ | ----------------------------------------------------- |
| `created` + валидный URL             | 200 с существующим URL                                |
| `local_persist_failed=true`          | 503 `rr_recovery_pending` либо выполнить recovery     |
| `upstream_outcome='unknown'`         | 503 `rr_reconciliation_pending`                       |
| `upstream_call_state='started'`      | 503 `rr_call_in_flight`                               |
| `failed/rejected`                    | 502 `rr_create_order_rejected`                        |
| `failed/not_created`                 | terminal response без нового вызова в текущем request |
| противоречивое/неизвестное состояние | 500 `local_state_unconfirmed`                         |
| ошибка SELECT                        | 500 `rr_state_recheck_failed`                         |


После unexpected state внешний `rrCreateOrder` запрещён независимо от результата reread.

## **6. Исправить operator branch в reuse-приоритете**

В блоке 2 указано:

```text
operator_resolution ∈ (keep_blocked, allow_new_order)
```

`allow_new_order` переводит старый заказ в terminal `failed`, поэтому такой заказ не должен возвращаться reuse RPC и не должен обрабатываться как reuse-ветка.

Правильная модель:

```text
operator_resolution='keep_blocked'
→ reuse того же заказа без временного окна
→ HTTP 503

operator_resolution='confirm_created'
→ initiation_status='created'
→ возврат существующего URL

operator_resolution='allow_new_order'
→ старый заказ terminal
→ не является reuse-кандидатом
→ следующий отдельный submit может создать новый order_id
```

Убрать `allow_new_order` из runtime reuse-order edge.





## **7.**

`not_started` **либо реально записывать, либо не объявлять persisted-значением**

Сейчас initial meta содержит `initiation_status='pending'`, но `upstream_call_state='not_started'` явно не записывается.

Нужно выбрать:

- добавить `upstream_call_state:'not_started'` в `initialMeta`;
- либо определить, что отсутствие ключа семантически эквивалентно `not_started`.

Предпочтительно записывать явно, чтобы runtime proof и state machine не зависели от `NULL`-семантики.

Добавить тест:

```text
новый order до pre-call marker
→ upstream_call_state='not_started'
```

## **8. Recovery URL должен повторно валидироваться перед canonical finalize**

Recovered URL читается из БД, но его нельзя автоматически считать безопасным только потому, что он когда-то был получен от adapter.

Перед возвратом клиенту и перед canonical finalize проверить:

```text
тип string
непустой
https
без username/password
```

Использовать общий helper валидации, чтобы happy path и recovery не расходились.

При невалидном recovered URL:

```text
HTTP 503 rr_recovery_pending
audit recovery_blocked_invalid_url
rrCreateOrder запрещён
```

Если новый audit type не добавляется, использовать существующий `recovery_blocked_no_url` с redacted `reason='invalid_url'`.

## **9. Integration tests должны проверять реальный edge, а не только SQL RPC**

Формулировка:

Deno test-модуль в preview/test Supabase

должна включать два уровня.

### **SQL integration**

Проверяет:

- RPC transitions;
- guards;
- events;
- idempotency;
- grants.

### **Edge integration**

Вызывает deployed preview edge и проверяет:

- HTTP status/body;
- число вызовов mock RR;
- повторный submit;
- polling/reuse priority;
- typed-result unexpected state;
- fault injection.

Мокирование только функции `rrCreateOrder` внутри unit test не доказывает поведение реально развернутой edge-функции.

## **10. Зафиксировать безопасный fault injection**

Для тестов marker failure и unexpected typed states указать механизм:

```text
только preview/test
test-only dependency injection либо test schema
включение по secret server-side flag
недоступно из публичного payload
после теста hook удалён/выключен
production deployment hook не содержит
```

Нельзя делать failure mode управляемым полем публичного запроса.

В `integration_tests.md` приложить:

- способ включения;
- способ подтверждения test environment;
- способ выключения;
- итоговую проверку отсутствия активного hook.

## **11. Production snapshot не должен включать тестовый прогон**

Последовательность должна быть такой:

```text
production snapshot before
→ применение production-safe migration/code
→ production snapshot after
```

Все 13/14 integration tests выполняются отдельно в preview/test и не входят в production interval.

`production_diff.txt` должен показывать:

- отсутствие новых RR orders/events с correlation marker работы;
- отдельно допустимые реальные пользовательские строки, если они появились параллельно;
- отсутствие cleanup/delete.

Простое требование «diff ожидаем пусто» может быть невыполнимо, если в это время реальный пользователь создаст заявку. Нужен attribution по correlation/runtime/source, а не только абсолютный count.

## **12. Полная privilege matrix должна учитывать новые internal helpers**

Если создаётся `rr_finalize_created_order_internal`, проверить:

```text
anon=false
authenticated=false
service_role=false
PUBLIC=false
```

Также проверить owner и `prosecdef`.

Internal helper не должен случайно получить default `EXECUTE` для `PUBLIC`.

## **13. Уточнить итоговый PASS**

Gate A.1 v3.1 получает PASS только если:

- исправлены state priority и semantic call states;
- direct ambiguous canonical finalize невозможен;
- typed-state checks работают в deployed preview edge;
- полный post-call marker failure оставляет durable `started` block;
- successful marker retry переводит заказ в recovery/reconciliation state;
- пройдены все SQL и edge integration tests;
- production proof подтверждает отсутствие тестовых writes;
- нет активного test/fault-injection hook;
- полный runtime proof приложен.

## **Обновлённая тестовая матрица**

Минимум **14 сценариев**:

1. Happy path.
2. Idempotent finalize с тем же URL.
3. URL conflict.
4. Post-call marker падает дважды: durable `started`, повтор через 31 минуту — без нового RR call.
5. Первая marker-запись падает, retry успешен: переход в `outcome_unknown` или `completed_unpersisted`.
6. Recovery не перехватывается `rr_call_in_flight`.
7. Ambiguous не перехватывается `rr_call_in_flight`.
8. Pre-call marker failure: внешний вызов отсутствует.
9. Terminal result из `rr_mark_call_started`: внешний вызов отсутствует.
10. Direct ambiguous canonical finalize запрещён.
11. Reconcile из не-ambiguous запрещён.
12. `not_created` contract disabled.
13. `allow_new_order` contract disabled.
14. Safe-default 4xx classifier.

Дополнительно внутри сценариев 4–9 подтвердить correlation evidence и точное количество mock RR calls.

После внесения этих уточнений план можно запускать. Gate A.2 и Gate B остаются заблокированными до фактического PASS Gate A.1 v3.1.

&nbsp;

План: Gate A.1 v3.1 — исправление state priority и integration proof

Ответ на вердикт ревью. Все 5 блокеров + пробелы runtime proof закрываются одной итерацией. Integration tests выполняются в рамках Gate A.1 v3.1 (не переносятся в A.2).

Работа только на существующих сущностях: `orders_v2.meta.rr`, `provider_events`, RPC уже созданные в миграции `20260710204120_*`. Новых таблиц, enum-типов, edge-функций не создаём. Все артефакты и комментарии — на русском.

## Блок 1. Модель `upstream_call_state` (Блокер №1, №2)

Зафиксировать конечный набор значений в `meta.rr.upstream_call_state`:

```text
not_started            — заказ создан, вызов РР ещё не начат
started                — pre-call marker записан, вызов РР в процессе
outcome_unknown        — вызов завершён, исход неопределён (timeout/5xx/invalid)
completed_unpersisted  — РР вернул created, но canonical finalize упал
completed              — терминальное состояние post-call зафиксировано локально
```

Новая миграция (следующая по timestamp) обновляет тела следующих RPC — сигнатуры и grants не меняются:


| RPC                             | Дополнительно устанавливает                                  |
| ------------------------------- | ------------------------------------------------------------ |
| `rr_mark_call_started`          | `upstream_call_state='started'` (уже есть)                   |
| `rr_mark_upstream_unknown`      | `upstream_call_state='outcome_unknown'`                      |
| `rr_mark_local_persist_failed`  | `upstream_call_state='completed_unpersisted'`                |
| `rr_finalize_created_order`     | `upstream_call_state='completed'` (уже есть)                 |
| `rr_finalize_order_rejected`    | `upstream_call_state='completed'`                            |
| `rr_finalize_order_not_created` | `upstream_call_state='completed'`                            |
| `rr_reconcile_confirm_created`  | `upstream_call_state='completed'` (через canonical finalize) |


Все RPC дополнительно возвращают `jsonb` c типизированным `state`:

- `rr_mark_call_started` → `'call_started'` | `'terminal'` | `'already_started'`
- `rr_mark_upstream_unknown` → `'unknown_marked'` | `'already_unknown'` | `'terminal'`
- `rr_mark_local_persist_failed` → `'persist_failed_marked'` | `'already_persist_failed'` | `'terminal'`
- `rr_finalize_order_rejected` → `'rejected'` | `'already_rejected'`
- `rr_finalize_order_not_created` → `'not_created'` | `'already_not_created'` | `'contract_disabled'`
- `rr_finalize_created_order` → `'finalized'` | `'already_created'`

## Блок 2. Reuse-приоритет в edge (Блокер №1, №2)

Изменить порядок ветвлений в `supabase/functions/public-rr-installment-initiate/index.ts` строго на:

```text
1. initiation_status='created' + валидный payment_url          → возврат существующего URL
2. operator_resolution ∈ (keep_blocked, allow_new_order)       → соответствующий ответ
3. local_persist_failed=true                                    → recovery finalize
4. upstream_outcome='unknown'                                   → HTTP 503 rr_reconciliation_pending
5. upstream_call_state='started' (только не покрытое выше)      → HTTP 503 rr_call_in_flight
6. новый заказ / concurrency pending window                     → happy path
```

Ключевое: после блока 1 миграции состояния `completed_unpersisted` и `outcome_unknown` больше не совпадают с `started`, поэтому ветка `rr_call_in_flight` перехватывает только реальный in-flight pre-call.

Обновить `state_machine.md`, `recovery_contract.md`, `ambiguous_upstream_contract.md` в соответствии с новым порядком.

## Блок 3. Закрыть прямой ambiguous → created через canonical (Блокер №3)

В `rr_finalize_created_order` добавить guard:

```sql
IF v_status = 'pending'
   AND (v_meta#>>'{rr,upstream_outcome}') IS NOT NULL
   AND (v_meta#>>'{rr,upstream_outcome}') <> 'created'
   AND COALESCE((v_meta#>>'{rr,local_persist_failed}')::boolean, false) = false
THEN
  RAISE EXCEPTION 'rr_finalize_ambiguous_source_forbidden' USING ERRCODE='22023';
END IF;
```

Разрешённые source-state:

- `pending` + `upstream_outcome IS NULL` (happy path)
- `pending` + `local_persist_failed=true` (recovery)
- `created` с тем же URL (идемпотентность)

`rr_reconcile_confirm_created` продолжает быть единственным входом для ambiguous → created; внутри он выставит `upstream_outcome='created'` **до** делегирования в canonical, чтобы пройти guard (согласовать порядок операций в теле функции).

## Блок 4. Typed-result checks в edge (Блокер №4)

В `public-rr-installment-initiate/index.ts` заменить все проверки `result.ok === true` на пары `ok + ожидаемый state`:


| Вызов                                        | Ожидаемый `state` для продолжения                      |
| -------------------------------------------- | ------------------------------------------------------ |
| `rr_mark_call_started` (перед rrCreateOrder) | `'call_started'`                                       |
| `rr_finalize_created_order` (happy/recovery) | `'finalized'` | `'already_created'`                    |
| `rr_mark_upstream_unknown`                   | `'unknown_marked'` | `'already_unknown'`               |
| `rr_mark_local_persist_failed`               | `'persist_failed_marked'` | `'already_persist_failed'` |
| `rr_finalize_order_rejected`                 | `'rejected'` | `'already_rejected'`                    |


При любом другом state:

- НЕ выполнять `rrCreateOrder`;
- перечитать заказ через `orders_v2` select;
- вернуть фактическое terminal/blocking состояние клиенту.

Единичный retry (`callWithSingleRetry`) сохраняется, но проверка расширяется на `state`, а не только на `error`/`ok`.

## Блок 5. Integration tests в preview/test DB (Блокер №5)

Не переносить в A.2. Создать `supabase/functions/rr-test-create-order/*_test.ts` или отдельный Deno test-модуль, покрывающий 13 сценариев в изолированной preview/test Supabase (production `orders_v2`/`provider_events` не трогаем).

Матрица тестов:

1. Happy path: pending → created; provider_events содержит `create_order_succeeded`.
2. Идемпотентный повтор finalize с тем же URL → `already_created`, без второго provider_event.
3. Finalize с другим URL → `rr_finalize_url_conflict`.
4. Post-call marker double failure → HTTP 500 `local_state_unconfirmed`, `upstream_call_state` не остаётся `started` навсегда (второй submit после успешной записи маркера → recovery/reconciliation).
5. Recovery flow: `local_persist_failed=true` → следующий submit вызывает canonical finalize (НЕ `rr_call_in_flight`).
6. Ambiguous flow: `upstream_outcome='unknown'` → следующий submit → HTTP 503 `rr_reconciliation_pending` (НЕ `rr_call_in_flight`).
7. Pre-call marker failure → HTTP 503 `persist_failed_pre_call`, `rrCreateOrder` не вызывается.
8. Pre-call marker для terminal-заказа → state `terminal`, edge НЕ вызывает `rrCreateOrder`, возвращает фактическое состояние.
9. Прямой вызов `rr_finalize_created_order` на ambiguous-заказе → `rr_finalize_ambiguous_source_forbidden`.
10. `rr_reconcile_confirm_created` из НЕ-ambiguous source → guard error.
11. `rr_finalize_order_not_created` с выключенным флагом → `contract_disabled`.
12. `rr_operator_resolve('allow_new_order')` с выключенным флагом → `contract_disabled`.
13. Safe-default classifier: 4xx с кодом вне пустого allowlist → `upstream_outcome_unknown`, а не `rejected`.

Каждый тест сохраняет: input payload, correlation_id, финальное состояние `orders_v2.meta.rr`, список записей `provider_events` за интервал. Отчёт — `gate_a1_v3_1/runtime_proof/integration_tests.md`.

## Блок 6. Дополнение runtime proof

В `docs/audit/2026-07-10-sprint-b-runtime-proof/gate_a1_v3_1/runtime_proof/`:

- `privilege_matrix.txt` — полная матрица `function × {anon, authenticated, service_role}` по всем 11 RR-RPC (`has_function_privilege`).
- `functiondef_all.txt` — `pg_get_functiondef` для всех изменённых RPC (полные тела после миграции v3.1).
- `production_snapshot_before.txt` и `production_snapshot_after.txt` — по каждому: `count(*)` + список `id, created_at` для `orders_v2 WHERE provider='rr'` и `provider_events WHERE provider='rr'` за интервал миграции; timestamps начала/конца.
- `production_diff.txt` — diff строк `before` vs `after` (ожидаем пусто).
- `integration_tests.md` — отчёт по 13 тестам (см. блок 5).
- `README.md` — сводка v3.1, ссылки на артефакты, статусы всех блокеров.

## Блок 7. Обновление документации и статуса

- `ERRATA_and_gate_status.md`: секция «Gate A.1 v3.1» с фактическими статусами блокеров и общим Sprint B — FAIL до полного A.2.
- `gate_a1_v3/README.md`: пометка «superseded by v3.1».
- `state_machine.md`: обновлённая таблица переходов с `upstream_call_state` и порядком reuse-веток.
- `.lovable/plan.md`: краткая запись «Gate A.1 v3.1 доставлен, A.2 остаётся BLOCKED до отдельного согласования».

## Что НЕ входит в v3.1

- Reconciler edge-функция и её тесты — Gate A.2.
- Реальные вызовы РР provider — Gate A.2 (в v3.1 РР адаптер мокается на уровне HTTP).
- Retry/backoff policy для reconciler — Gate A.2.
- `rr_provider_contract.md` заполнение реальным поведением РР — Gate A.2.
- UI patch и public E2E — Gate B.

## Технический раздел

Файлы, которые будут изменены/созданы после одобрения:

- `supabase/migrations/<new_ts>_gate_a1_v3_1.sql` — обновление тел 7 RPC (значения `upstream_call_state`, типизированные `state` в возврате, guard в `rr_finalize_created_order`, корректировка порядка в `rr_reconcile_confirm_created`).
- `supabase/functions/public-rr-installment-initiate/index.ts` — новый порядок reuse-веток, typed-result checks.
- `supabase/functions/rr-test-create-order/state_machine_test.ts` (или аналог) — 13 integration tests.
- Документы в `docs/audit/2026-07-10-sprint-b-runtime-proof/gate_a1_v3_1/` (README + runtime_proof/*).
- Обновление `ERRATA_and_gate_status.md`, `state_machine.md`, `.lovable/plan.md`.

Не изменяются:

- Сигнатуры RPC.
- Grants/ownership (остаются service_role only).
- `rr-adapter.ts`/`rr-http.ts` (safe-default classifier и redaction уже приняты).
- Contract flags (остаются выключенными).

## DoD Gate A.1 v3.1

1. Миграция применена, все 7 RPC содержат новые значения `upstream_call_state` и типизированные `state`; `rr_finalize_created_order` отклоняет ambiguous source.
2. Edge выполняет reuse-ветки в утверждённом порядке и проверяет typed `state` перед `rrCreateOrder` и после каждого критичного RPC.
3. Все 13 integration tests пройдены в preview/test DB; отчёт с evidence приложен.
4. Runtime proof полный: privilege matrix (11×3), functiondef всех RPC, before/after snapshots production с пустым diff.
5. Документы `state_machine.md`, `ERRATA_and_gate_status.md`, `gate_a1_v3_1/README.md` обновлены и внутренне согласованы.
6. Sprint B статус: FAIL (до A.2). Sprint C не начинать. Gate B BLOCKED.