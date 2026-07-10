# да, согласен, с учетом правок:

План закрывает большинство дефектов предыдущей реализации, но в текущем виде остаётся один архитектурный блокер: **двойной сбой post-call persistence всё ещё может привести к повторному** `rrCreateOrder`.

## **1. Добавить durable pre-call marker до обращения к РР**

Текущая схема:

```text
orders_v2 создан
→ create_order_requested записан
→ rrCreateOrder
→ запись результата/marker
```

Если РР уже обработал запрос, а затем дважды упали:

```text
rr_mark_upstream_unknown
```

или:

```text
rr_mark_local_persist_failed
```

ответ `local_state_unconfirmed` сам по себе не защищает от следующего submit. Через временное окно обычный pending перестанет переиспользоваться, и может быть создан новый `orders_v2.id`.

До вызова РР необходимо атомарно записывать в сам заказ durable pre-call marker, например:

```json
{
  "rr": {
    "upstream_call_state": "started",
    "upstream_call_started_at": "...",
    "upstream_call_correlation_id": "..."
  }
}
```

Порядок:

```text
создание orders_v2
→ atomic rr_mark_call_started
→ durable create_order_requested
→ только после подтверждения обеих записей rrCreateOrder
```

`rr_get_or_create_pending_order` должен без временного окна переиспользовать любой pending-заказ с:

```text
upstream_call_state='started'
```

до появления terminal результата:

```text
created
rejected
not_created
operator allow_new_order
```

Тогда даже при полном отказе post-call persistence следующий submit получит тот же `order_id` и будет заблокирован для reconciliation.

### **Mapping**

```text
две попытки post-call marker + HTTP 500
→ pre-call durable call_started + post-call marker retries
```

`HTTP 500 local_state_unconfirmed` остаётся необходимым alert-контрактом, но не является механизмом идемпотентности.





## **2. Не считать**

`provider_events.create_order_requested` **достаточным durable guard**

Само событие уже записывается до вызова РР, но reuse RPC его не анализирует. Есть два допустимых варианта:

### **Предпочтительно**

Хранить `upstream_call_state='started'` в `orders_v2.meta.rr`, чтобы reuse не зависел от join с ledger.

### **Альтернатива**

Reuse RPC проверяет существование `provider_events`:

```text
create_order_requested
```

без последующего terminal event.

Этот вариант сложнее и менее предпочтителен. Источником текущего состояния должен оставаться `orders_v2`, ledger — доказательством перехода.

## **3. Закрыть прямой вызов canonical finalizer из ambiguous state**

В §1 canonical `rr_finalize_created_order` допускает:

```text
pending + upstream_outcome='unknown'
```

с оговоркой «вызывается только через `rr_reconcile_confirm_created`». Но обе функции доступны `service_role`, поэтому технически canonical RPC можно вызвать напрямую и обойти reconciliation guards.

Закрепить один вариант.

### **Вариант A — предпочтительный**

`rr_finalize_created_order` допускает только:

```text
pending
AND upstream_outcome IS NULL
```

или:

```text
pending
AND local_persist_failed=true
```

Для ambiguous state `rr_reconcile_confirm_created` выполняет ту же внутреннюю canonical SQL-функцию, которая не выдана наружу:

```text
rr_finalize_created_order_internal
```

Internal helper:

- не получает `GRANT EXECUTE` ролям API;
- вызывается только публичными service-role wrappers;
- остаётся единственным SQL writer канонического success-state.

### **Вариант B**

Добавить обязательный `_transition_source` с allowlist:

```text
happy_path
recovery
reconciler
operator
```

и проверять соответствие source-state. При изменении сигнатуры обязательно удалить или закрыть старый overload.

Одной документальной оговорки «только через wrapper» недостаточно.



## **4. Явно обработать изменение сигнатуры**

`rr_operator_resolve`

В v2 функция имела сигнатуру без `_evidence`. В v3 для `allow_new_order` указана обязательная `_evidence`, но в разделе файлов не определено, как изменится SQL signature.

Нельзя просто создать новую перегрузку и оставить старую небезопасную функцию callable.

Зафиксировать:

```text
старый rr_operator_resolve(uuid,text,text,text,text,text)
→ DROP FUNCTION либо REVOKE ALL
```

Новая сигнатура, например:

```sql
rr_operator_resolve(
  _order_id uuid,
  _resolution text,
  _actor text,
  _payment_url text,
  _rr_request_id text,
  _note text,
  _evidence jsonb
)
```

После миграции доказать отсутствие доступного старого overload через `pg_proc` и `has_function_privilege`.

То же правило применяется ко всем функциям, сигнатуры которых меняются.





## **5. Определить режим блокировки**

`rr_finalize_order_not_created` **до Gate A.2**

План требует:

```text
attempts >= минимум из provider contract
```

но одновременно говорит, что `rr_provider_contract.md` остаётся незаполненным.

Следовательно, минимальное значение пока не определено.

До Gate A.2 функция должна быть fail-closed. Например:

```text
rr_not_created_contract_not_enabled
```

пока server-side config не содержит:

```json
{
  "not_created_resolution_enabled": true,
  "contract_version": "...",
  "minimum_attempts": 3,
  "grace_period_seconds": 300,
  "accepted_provider_codes": ["..."]
}
```

Не принимать threshold из `_evidence`: caller не должен сам определять достаточность доказательств.

Runtime-тест Gate A.1 может проверить:

- пустой/неполный evidence отклоняется;
- функция отклоняется при выключенном provider contract;
- разрешение возможно только после test-only включения policy в preview environment.

В production функция до Gate A.2 должна оставаться фактически заблокированной.





## **6.**

`rr_operator_resolve('allow_new_order')` **также должен быть contract-gated**

Операторское решение не должно обходить неопределённый provider contract только наличием `_note` и произвольного `_evidence`.

Для `allow_new_order` определить один из вариантов:

- доступ только superadmin через отдельную непубличную edge с сильным audit;
- обязательный explicit override-флаг;
- отдельный RPC `rr_operator_force_allow_new_order`, не используемый автоматическим reconciler;
- подтверждение actor identity сервером, а не свободным `_actor text`.

Передача `_actor` аргументом небезопасна: service-role caller может указать любое имя.

Предпочтительно:

```text
actor_id / actor_email определяется edge из проверенного JWT
→ передаётся RPC
→ audit сохраняет auth subject
```

До появления защищённого operator endpoint прямой вызов RPC не считать полноценным операторским процессом.

## **7. Retry marker RPC должен проверять итоговое состояние, а не только отсутствие ошибки**

После controlled retry желательно прочитать заказ и подтвердить postcondition:

Для ambiguous:

```text
upstream_outcome='unknown'
AND reconciliation_status='pending'
AND upstream_call_state='started'
```

Для recovery:

```text
local_persist_failed=true
AND rr_payment_url_recovered=<expected URL>
```

RPC может вернуть без ошибки из-за идемпотентного/terminal guard, но не записать ожидаемое состояние. Edge должен проверять фактический результат либо RPC должна возвращать typed result:

```json
{
  "ok": true,
  "state": "unknown_marked"
}
```

а не `RETURNS void`.



## **8. Не логировать полный provider response в**

`local_state_unconfirmed`

В alert/audit сохранять только redacted payload:

```text
order_id
correlation_id
failure_kind
http_status
provider_request_id при наличии
stage
```

Не сохранять:

- полный `payment_url`;
- полный provider response;
- email/phone/name;
- credentials;
- raw exception с возможными connection strings.

В текущем плане это в целом подразумевается, но нужно включить в DoD и negative proof.

## **9. Audit-события лучше вынести в service-role RPC**

Для:

```text
recovery_blocked_no_url
create_order_recovered
local_state_unconfirmed
```

предпочтительно создать единый RPC, например:

```text
rr_insert_idempotent_audit_event
```

с allowlist event types и:

```sql
ON CONFLICT (idempotency_key) DO NOTHING
```

Это исключит повторение небезопасных прямых insert-блоков в edge.

RPC не должна принимать произвольный `provider`, `event_type` и `related_order_id` без проверки связи с RR-order.

## **10. Усилить доказательство отсутствия production writes**

Сравнение только:

```sql
max(created_at), count(*)
```

недостаточно:

- строка могла быть создана и удалена;
- количество могло измениться из-за реального пользователя;
- `max(created_at)` мог измениться независимо от работы подрядчика.

Добавить:

```text
точное время начала/окончания работ
список order_id/provider_event id за этот интервал
offer_id
correlation_id
source/runtime marker
```

И доказать отсутствие строк с test-correlation prefix или Gate A.1 v3 marker.

Production snapshot должен быть read-only. Никаких cleanup DELETE для сокрытия тестовых строк.

## **11. Уточнить fault injection для integration test №9**

Фраза:

искусственная ошибка `rr_mark_upstream_unknown`

должна иметь безопасный способ реализации.

Допустимо только в preview/test:

- dependency injection;
- test-only environment flag;
- временная test schema/function с rollback;
- mock Supabase repository;
- отдельная test migration, не попадающая в production migration chain.

Запрещено:

- временно ломать production grants;
- заменять production RPC на падающую;
- тестировать через удаление таблиц/constraint;
- оставлять test hook доступным после теста.

Артефакт должен показать включение и удаление fault-injection механизма.

## **12. Расширить integration tests pre-call guard**

К 10 тестам добавить:

### **Тест 11 — post-call marker полностью недоступен**

```text
call_started записан
→ mock РР возвращает ambiguous
→ rr_mark_upstream_unknown падает дважды
→ HTTP 500 local_state_unconfirmed
→ повторный submit через 10 минут/31 минуту
→ тот же order_id
→ 0 дополнительных rrCreateOrder
```

### **Тест 12 — call_started не записан**

```text
rr_mark_call_started падает
→ rrCreateOrder не вызывается
→ HTTP 503/500 persist_failed_pre_call
```

### **Тест 13 — terminal state снимает pre-call block**

```text
call_started
→ canonical created
→ повторный submit возвращает существующий URL
→ не остаётся reconciliation block
```

Именно эти тесты доказывают fail-closed идемпотентность при полном post-call DB failure.

## **13. Скорректировать DoD**

Добавить обязательные условия:

- до каждого `rrCreateOrder` подтверждён durable `upstream_call_state='started'`;
- любой заказ с `upstream_call_state='started'` и без terminal outcome переиспользуется без временного окна;
- двойной сбой post-call marker не позволяет создать новый `order_id`;
- старые overload изменённых RPC удалены или полностью закрыты;
- direct canonical finalizer не может обойти ambiguous reconciliation guards;
- `rr_finalize_order_not_created` отключён до server-side активации подтверждённого provider contract;
- operator actor берётся из проверенного auth context, а не доверяется произвольному текстовому аргументу;
- integration suite включает минимум 13 сценариев после добавления pre-call failure tests.

## **Итоговый статус плана**

После добавления durable pre-call marker и указанных guard-уточнений план можно запускать.

Без pre-call marker повторный `rrCreateOrder` всё ещё возможен при сценарии:

```text
РР принял запрос
→ canonical finalize упал
→ recovery/unknown marker дважды упал
→ временное pending reuse истекло
→ новый submit создал новый order_id
```

Поэтому текущая редакция корректно устраняет большую часть найденных дефектов, но ещё не закрывает главный fail-closed инвариант Gate A.1.

&nbsp;

План: Gate A.1 v3 — устранение блокеров backend contract

Область: только backend (SQL миграция + edge `public-rr-installment-initiate` + адаптер РР + runtime-артефакты). Sprint C не открывать. Gate A.2 и Gate B остаются BLOCKED до PASS этого плана. React-код не меняется. Production `orders_v2`/`provider_events` не создавать.

## 1. Blocker A1.1 — canonical finalizer postcondition

Новая миграция полностью заменяет тело `public.rr_finalize_created_order` (не только `SET search_path`). Постусловие для success-ветки:

- `initiation_status = 'created'`
- `payment_url = <canonical https url>`
- `meta.rr.local_persist_failed = false` (маркер снят; сырое поле `local_persist_error` остаётся для forensics)
- `meta.rr.upstream_outcome = null` (нормализация ambiguous)
- `meta.rr.reconciliation_status = 'confirmed_created'`
- `meta.rr.provider_request_id` — реальный `json.id` или null; fallback на `external_id` запрещён

Guard-переходы:

- если текущий `initiation_status = 'created'` и `payment_url` совпадает — идемпотентный no-op (обновляется только `meta.rr.reconciliation_status` при необходимости), event не дублируется;
- если `initiation_status = 'created'` и `payment_url` отличается — `RAISE EXCEPTION 'rr_finalize_url_conflict'`;
- если `initiation_status = 'failed'` (rejected/not_created) — `RAISE EXCEPTION 'rr_finalize_from_terminal_forbidden'`;
- допустимые source-состояния: `pending` (happy path и recovery), `pending + local_persist_failed=true` (recovery), `pending + upstream_outcome='unknown'` (вызывается только через `rr_reconcile_confirm_created`).

Event `create_order_succeeded` — идемпотентный insert с `idempotency_key = '<order_id>:create_order_succeeded'`, дубликат — `ON CONFLICT DO NOTHING`. Второй writer для recovery не создаётся; recovery-ветка edge вызывает именно этот canonical finalizer.

## 2. Blocker A1.2 — durable failure persistence

Каждый marker/finalizer RPC в edge проверяется на ошибку. Нельзя отвечать клиенту так, будто durable state записан.

Изменения в `supabase/functions/public-rr-installment-initiate/index.ts`:

- `rr_mark_local_persist_failed` — при ошибке: одна controlled retry attempt (тот же RPC, короткий backoff). Если снова ошибка — response `HTTP 500 { error: "local_state_unconfirmed", order_id }`, structured log `create_order_persist_failed_marker_failed`, best-effort audit event `local_state_unconfirmed` (без `throw` в клиента как `local_persist_failed`). Клиенту НЕ отдаётся статус, при котором он воспринимает состояние как безопасно сохранённое.
- `rr_mark_upstream_unknown` — та же схема: 1 retry, при повторной ошибке — `HTTP 500 { error: "local_state_unconfirmed" }`, а не `504 rr_upstream_unknown`. Ambiguous-состояние без durable маркера НЕ считается защищённым.
- `rr_finalize_order_rejected` — при ошибке 1 retry, затем `HTTP 500 { error: "local_state_unconfirmed" }`. Клиент не получает `502 rr_upstream_rejected` без подтверждённой durable записи.
- `rr_finalize_created_order` (happy path) — при ошибке пытается `rr_mark_local_persist_failed` (см. выше). Если и этот RPC не подтверждён durable — `HTTP 500 { error: "local_state_unconfirmed" }`.
- Критические reads: reuse-lookup после `rr_get_or_create_pending_order` и polling reused-заказа проверяют `.error` явно. Ошибки БД возвращаются как `HTTP 500 { error: "rr_reuse_state_read_failed" }` / `rr_reuse_poll_read_failed` со structured log; не маскируются под `rr_reuse_wait_timeout` и пустое состояние.

Audit alert: во всех ветках `local_state_unconfirmed` — best-effort insert в `provider_events` с типом `local_state_unconfirmed` + structured console.error `[ALERT]` (без PII).

## 3. Blocker A1.3 — state guards в terminal/reconcile RPC

Миграция дополняет тела следующих функций строгими source-state guards. Идемпотентный повтор того же перехода с идентичным payload разрешён; попытка изменить уже принятое решение — ошибка.

### 3.1 `rr_reconcile_confirm_created`

Разрешён только при:

```
initiation_status = 'pending'
AND meta.rr.upstream_outcome = 'unknown'
AND meta.rr.reconciliation_status IN ('pending','operator_required')
```

Иначе — `RAISE EXCEPTION 'rr_reconcile_invalid_source_state'`. Идемпотентность: если заказ уже `created` с тем же `payment_url` — no-op success; иной URL — `rr_reconcile_url_conflict`.

### 3.2 `rr_finalize_order_not_created`

Разрешён только из ambiguous:

```
initiation_status = 'pending'
AND meta.rr.upstream_outcome = 'unknown'
AND meta.rr.reconciliation_status IN ('pending','operator_required')
```

Иначе — `rr_not_created_invalid_source_state`. Обязательная валидация `_evidence jsonb` контракта: обязательные поля `provider_error_code text`, `http_status int`, `attempts int (>=минимум из провайдер-контракта)`, `first_checked_at timestamptz`, `last_checked_at timestamptz`, `endpoint_mode text ('test'|'prod')`. Пустой `{}` отклоняется — `rr_not_created_evidence_invalid`. До Gate A.2 RPC остаётся недоступным рабочему reconciler (только через runtime proof).

### 3.3 `rr_operator_resolve`

Guards по каждому `_resolution`:

- `confirm_created` — только из `pending + upstream_outcome='unknown' + reconciliation_status IN ('pending','operator_required')`; делегирует `rr_reconcile_confirm_created` (обязателен `_payment_url`);
- `allow_new_order` — только из `pending + upstream_outcome='unknown' + reconciliation_status IN ('pending','operator_required')`; обязательные `_evidence` + `_note`; переводит заказ в terminal `failed` с `operator_resolution='allow_new_order'`;
- `keep_blocked` — только из `pending + upstream_outcome='unknown'` (без `resolved`);
Повтор того же `_resolution` с тем же payload — идемпотентный no-op. Иное решение поверх уже принятого — `rr_operator_resolution_override_forbidden` (замена только через отдельную будущую audited override RPC — вне этого гейта).

### 3.4 `rr_finalize_order_rejected`

Разрешён только из:

```
initiation_status = 'pending'
AND meta.rr.upstream_outcome IS NULL
AND meta.rr.local_persist_failed IS NOT TRUE
```

Иначе — `rr_rejected_invalid_source_state`. Идемпотентный повтор для того же `provider_error_code` — no-op.

## 4. Blocker A1.4 — conservative rejection classifier

В `supabase/functions/_shared/rr/rr-adapter.ts` / `rr-http.ts` `outcomeClass` пересматривается. До заполнения `gate_a1/rr_provider_contract.md`:

- пустой allowlist `RR_DOCUMENTED_REJECTION_CODES: Array<{ httpStatus: number; providerCode: string }>` = `[]`;
- `upstream_rejected` возвращается ТОЛЬКО при точном совпадении `(httpStatus, json.error.code)` с элементом allowlist;
- любые 4xx без совпадения (включая 400/401/403/404/409/422 с произвольным `error`) → `upstream_outcome_unknown` с `failureKind='http'`;
- 408/425/429/5xx/timeout/network/invalid_json → `upstream_outcome_unknown` с соответствующим `failureKind`;
- 2xx без валидного `payment_url` → `upstream_outcome_unknown` с `failureKind='invalid_response'`.

Ссылка в коде на `rr_provider_contract.md`: без заполненного документа allowlist остаётся пустым, и все rejection-заявления невозможны. Это осознанный safe-default.

## 5. Blocker A1.5 — runtime proof миграции

После применения миграции собрать в `docs/audit/2026-07-10-sprint-b-runtime-proof/gate_a1_v3/runtime_proof/`:

- `functiondef_before.txt` / `functiondef_after.txt` — `pg_get_functiondef` для всех затронутых RPC (`rr_finalize_created_order`, `rr_reconcile_confirm_created`, `rr_finalize_order_not_created`, `rr_operator_resolve`, `rr_finalize_order_rejected`, `rr_mark_upstream_unknown`, `rr_mark_local_persist_failed`, `rr_get_or_create_pending_order`);
- `proconfig.txt` — `SELECT proname, proconfig FROM pg_proc WHERE proname LIKE 'rr\_%'`;
- `owner_and_security.txt` — `proowner`, `prosecdef`;
- `grants.txt` — `SELECT grantee, privilege_type FROM information_schema.routine_privileges WHERE routine_name LIKE 'rr\_%'`;
- `has_function_privilege.txt` — проверки `EXECUTE` для `anon`, `authenticated`, `service_role` по каждой RPC;
- `no_production_writes.txt` — `SELECT max(created_at), count(*) FROM orders_v2 WHERE meta->'rr' IS NOT NULL` до/после миграции, тот же контроль для `provider_events`;
- `integration_tests.md` — минимум контролируемых state-transition тестов в preview/test DB (не production):
  1. happy path: pending → created, snapshot `meta.rr` — все поля нормализованы;
  2. recovery: искусственный `local_persist_failed=true` + recovered URL → повторный submit → `local_persist_failed=false`, `reconciliation_status='confirmed_created'`, один `create_order_succeeded`, ноль повторных `createOrder`;
  3. ambiguous: `rr_mark_upstream_unknown` → `rr_reconcile_confirm_created` — success; повторный вызов с иным URL — `rr_reconcile_url_conflict`;
  4. guard `rr_reconcile_confirm_created` из `failed` → `rr_reconcile_invalid_source_state`;
  5. guard `rr_finalize_order_not_created` из `rejected` → `rr_not_created_invalid_source_state`;
  6. guard `rr_operator_resolve('allow_new_order')` из `created` → forbidden;
  7. guard `rr_finalize_order_rejected` из `local_persist_failed=true` → forbidden;
  8. classifier: 401/403/404/409/422 с `error` → все `upstream_outcome_unknown`, не `upstream_rejected`;
  9. durable failure: искусственная ошибка `rr_mark_upstream_unknown` → edge отвечает `HTTP 500 local_state_unconfirmed`, не `504 rr_upstream_unknown`;

10. idempotent recovery: 5 параллельных повторов `local_persist_failed`-заказа → 1 `order_id`, 0 `rrCreateOrder`, 1 `create_order_succeeded`.

Все тесты — только в preview/test Supabase environment. Production fixture запрещён.

## 6. Уточнение audit-events

`recovery_blocked_no_url` и `create_order_recovered` пишутся с детерминированным `idempotency_key = '<order_id>:<event_type>'` через `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`. Ошибки логируются, но НЕ маскируются под success. В отчёте формулировка: «детерминированный idempotency_key; duplicate — DO NOTHING; иные ошибки логируются как audit_write_failed».

## 7. Документация и статусы

- `gate_a1/README.md` — обновить: убрать формулировку PARTIAL PASS, зафиксировать Gate A.1 v3 в работе;
- `gate_a1/state_machine.md` — таблица guards с exception-кодами;
- `gate_a1/recovery_contract.md` — postcondition из §1, снятие маркера;
- `gate_a1/ambiguous_upstream_contract.md` — правила durable failure и response `local_state_unconfirmed`;
- `gate_a1/rr_provider_contract.md` — оставить не заполненным; зафиксировать, что до заполнения allowlist rejection пуст;
- `ERRATA_and_gate_status.md` — новый раздел «Gate A.1 v3», корректный статус: Implementation PARTIAL / Acceptance FAIL до артефактов runtime proof; Sprint B FAIL, Sprint C не открывать;
- Финальный `REPORT_v3.md` с ссылками на все runtime-артефакты и intergation tests.

## Файлы (только на согласование, без правки в plan mode)

- новая миграция `supabase/migrations/<ts>_gate_a1_v3.sql` — тела RPC (§1, §3);
- `supabase/functions/public-rr-installment-initiate/index.ts` — обработка ошибок RPC, response-коды (§2), reuse/poll error handling, audit ON CONFLICT-семантика (§6);
- `supabase/functions/_shared/rr/rr-adapter.ts` + `rr-http.ts` — classifier §4 + пустой allowlist;
- `docs/audit/2026-07-10-sprint-b-runtime-proof/gate_a1_v3/**` — runtime proof, integration tests, обновлённые контрактные документы;
- обновление `ERRATA_and_gate_status.md`.

## Definition of Done (Gate A.1 v3)

- миграция применена, приложены `pg_get_functiondef`, `proconfig`, owner, grants, `has_function_privilege`;
- ни один из 10 integration tests не падает в preview/test DB;
- ни одна production `orders_v2`/`provider_events` строка не создана (snapshot до/после);
- edge ни в одной ветке не возвращает «безопасный» статус без подтверждённой durable записи;
- `rr_provider_contract.md` явно помечает allowlist пустым, поэтому `upstream_rejected` временно недостижим — это осознанный safe-default до Gate A.2.

Только после полного PASS этого плана открывается Gate A.2 (working reconciler + подтверждённый provider contract). Gate B остаётся BLOCKED.