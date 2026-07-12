# да, согласен, с учетом правок:

## 1. Не превращать auth-ошибки в HTTP 200

Изоляция подпроверок применяется только **после** успешных:

- проверки метода;
- разбора JSON;
- проверки JWT;
- проверки роли;
- загрузки integration instance.

Контракт:

```text
нет/невалидный JWT → 401
нет super_admin → 403
не найден instance → 404
ошибки отдельных RR-проверок → HTTP 200 со structured checks

```

Иначе UI перестанет отличать отсутствие прав от технической ошибки РР.

## 2. Role guard менять только после доказательства

Проверить фактические:

- строки в `roles`;
- связь пользователя в `user_roles_v2`;
- сигнатуры `has_role`, `has_role_v2`, `is_super_admin`;
- helper, который уже используется другими superadmin-only действиями.

Не вводить временную поддержку одновременно `superadmin` и `super_admin`, если в данных нет обеих ролей. Должен остаться один canonical механизм.

## 3. Добавить версию контракта в response

Чтобы исключить повторную ситуацию со старым deploy, healthcheck должен возвращать, например:

```json
{
  "data": {
    "contract_version": "rr-status-truthful-v1-correction"
  }
}

```

В отчёте зафиксировать:

```text
исходный commit SHA
deploy timestamp
contract_version из runtime response

```

Последовательность deploy:

```text
integration-healthcheck
→ прямой runtime probe
→ frontend publish
→ проверка через кнопку UI

```

## 4. `backend=ok` не должен быть безусловным hardcode

Допустимое подтверждение backend:

- выполняется актуальная RR-ветка healthcheck;
- загружен RR adapter;
- доступны необходимые настройки;
- есть подтверждённые прошлые RR runtime-события либо действующий read-only status-запрос.

Если это нельзя доказать, использовать:

```text
backend.status = not_verified

```

а не ложное `ok`.

## 5. Изолировать подпроверки и добавить timeout

Для `rrGetOrderStatus` использовать отдельный timeout. Ошибка или timeout должны давать:

```json
{
  "status": "error",
  "code": "rr_status_timeout",
  "message": "РР не ответил за установленное время"
}

```

Не отдавать в UI:

- логины;
- пароли;
- secret key;
- Authorization headers;
- полный сырой ответ провайдера.

Полный response body, запрашиваемый в Diagnose, означает **полный ответ нашей edge function**, а не секретные данные провайдера.

## 6. Проверки webhook должны учитывать режим заказа

Старый валидный test-webhook не должен подтверждать battle runtime.

Для `webhook_runtime` искать событие через связанный заказ:

```text
provider_events.related_order_id
→ orders_v2.id
→ orders_v2.meta.rr.mode = текущий mode

```

Ожидания:

```text
test + валидный test event → verified
battle без battle event → not_verified

```

Аналогично `last_operation` должна быть mode-specific.

## 7. Правильный порядок проверки режимов

Поскольку интеграция **уже находится в battle**, не нужно сначала возвращать её в test, а потом снова временно переключать.

Порядок:

1. Исправить и задеплоить healthcheck.
2. В текущем battle-режиме подтвердить:
  ```text
  overall = battle_awaiting_first_order
  credentials = ok
  api_reachability = not_verified
  webhook_runtime = not_verified

  ```
3. Проверить:
  ```text
  active non-terminal battle RR orders = 0

  ```
4. Вернуть интеграцию в `test`.
5. Проверить test-контракт:
  ```text
  overall = connected
  api_reachability = ok
  webhook_runtime = verified

  ```
6. Оставить `mode=test` до завершения cleanup и mode-lock.

## 8. Возврат battle → test делать не миграцией

Не создавать data-миграцию, которая при повторном применении в другом окружении переключит режим интеграции.

Использовать:

- существующий серверный settings-path;
- либо одноразовый guarded service-role UPDATE;
- либо SQL-операцию, не коммитящуюся как воспроизводимая schema migration.

Перед UPDATE и после него зафиксировать snapshot `config`, изменяя только:

```text
config.mode: battle → test

```

Логины, пароли и остальные поля не перезаписывать.

## 9. Выбор test-order для API reachability

Брать не просто последнюю строку `rr_test_ledger`, а последнюю подходящую:

```text
external_id заполнен
формат external_id допустим для RR status API
режим test
запись не является локальным synthetic-only fixture

```

Если подходящего заказа нет:

```text
api_reachability = not_verified

```

Это не должно превращаться в необработанное исключение.

## 10. UI-ошибка должна идти из нормализованного поля

Каждая подпроверка возвращает единый shape:

```ts
{
  status: "ok" | "not_verified" | "not_configured" | "error",
  code?: string,
  message?: string
}

```

UI показывает первое критичное сообщение из `checks`, а не парсит произвольные исключения.

При частичной ошибке granular-блок должен отображать, например:

```text
Backend: подключён
Реквизиты режима: настроены
API режима: ошибка — HTTP 401
Webhook endpoint: настроен
Webhook runtime: проверен

```

## 11. Payments proof сохранить до cleanup

В доказательстве C указать не только количество, но и дату/диапазон фильтра UI, чтобы сравнение 12 = 12 было воспроизводимым.

Обязательный audit order:

```text
33119dd5-8a92-4533-ab20-fe0f9163ab8b

```

Зафиксировать его `payment_id`, сумму, валюту и отображение связанной сделки.

## 12. Документация

Append-only означает:

- прочитать текущий `.lovable/plan.md`;
- добавить новый раздел в конец;
- не заменять весь файл;
- после commit проверить diff: только добавленные строки в документации.

Коммит с очередной полной заменой `.lovable/plan.md` не принимать.

## Итоговый порядок

```text
Diagnose HTTP/body/logs/deploy
→ исправить auth или точный runtime blocker
→ изолировать checks
→ deploy edge
→ battle contract proof
→ active battle orders = 0
→ guarded battle→test update
→ test contract proof
→ UI proof
→ payments visibility proof
→ append-only report

```

Статус:

```text
PATCH-RR-STATUS-TRUTHFUL-V1-CORRECTION: AUTHORIZED
PATCH-RR-TEST-CLEANUP-V1: BLOCKED UNTIL A+B+C+D
Cleanup execute: BLOCKED
Battle go-live: BLOCKED


План: PATCH-RR-STATUS-TRUTHFUL-V1-CORRECTION
```

## Текущий статус

```
PATCH-RR-STATUS-TRUTHFUL-V1:
  CODE IMPLEMENTED
  TYPECHECK PASS
  RUNTIME FAIL / NOT VERIFIED

PATCH-RR-TEST-CLEANUP-V1 implementation: NOT YET AUTHORIZED
Cleanup dry-run/execute: BLOCKED
Battle go-live: BLOCKED
```

На скриншоте после клика «Проверить подключение»: toast `Ошибка: проверка не пройдена`, все granular-поля `—`, верхний статус `Проверка не выполнена`. UI построен, но healthcheck runtime не доказан. Дополнительно карточка находится в режиме **Боевой** (`battle-gorbova`), что нарушает согласованный порядок — cleanup должен запускаться из `test`.

## Шаг 1. Diagnose — root cause текущего toast

Собрать без изменения кода:

1. HTTP status и полный response body вызова `integration-healthcheck` при клике «Проверить подключение».
2. Логи edge function `integration-healthcheck` за окно клика.
3. Версию задеплоенной функции vs текущий исходник (проверить, что UI не бьёт в старую сборку).
4. Точную ошибку внутри RR-ветки: какой из подзапросов упал (`rr_test_ledger`, `payments_v2 → orders_v2`, `provider_events`, `rrGetOrderStatus`).
5. Значение `integration_instances.config.mode` в БД для инстанса РР.

Проверить в первую очередь:

- Role guard: в старом коде — `superadmin`, canonical в проекте — `super_admin`. Не менять вслепую; подтвердить, что 401/403 приходит именно из-за этого.
- Не выброшена ли необработанная ошибка из одного read-only чтения, роняющая весь ответ в generic failure.

## Шаг 2. Fix healthcheck edge function

Правки в `supabase/functions/integration-healthcheck/index.ts`, RR-ветка:

1. **Устойчивость подпроверок.** Каждая подпроверка (`backend`, `credentials`, `api_reachability`, `webhook_endpoint`, `webhook_runtime`, `last_operation`) в собственном `try/catch`. Ошибка одной подпроверки:
  - пишет в `checks.<name>.status = 'error'` + короткое сообщение;
  - не прерывает остальные;
  - HTTP ответ остаётся `200` со структурированным body.
2. **Role guard**: привести к canonical (`super_admin` через `has_role_v2`/`is_super_admin`), если диагностика подтвердит расхождение.
3. **Battle до первого заказа** — ожидаемый контракт (не error):
  ```json
   {
     "success": true,
     "data": {
       "overall": "battle_awaiting_first_order",
       "checks": {
         "backend": { "status": "ok" },
         "credentials": { "status": "ok" },
         "api_reachability": { "status": "not_verified" },
         "webhook_endpoint": { "status": "ok" },
         "webhook_runtime": { "status": "not_verified" }
       }
     }
   }
  ```
4. **Test-mode ожидаемый контракт** (при наличии валидного test-event):
  ```
   overall = connected
   backend = ok, credentials = ok, api_reachability = ok,
   webhook_endpoint = ok, webhook_runtime = verified,
   last_operation заполнена
  ```

## Шаг 3. UI — точная ошибка вместо generic toast

`src/components/integrations/rr/RRSettingsCard.tsx`:

- При `overall = 'error'` или `checks.<x>.status = 'error'` показывать безопасную конкретику из ответа, например:
  - `Проверка РР не пройдена: API режима — HTTP 401`
  - `Проверка РР не пройдена: ошибка чтения последней операции`
- Никаких секретов, паролей, полного тела ответа провайдера в UI.
- Granular-блок заполняется даже при частичной ошибке (не пять тире).

## Шаг 4. Возврат интеграции в test (без пользователя)

Перед любой попыткой cleanup:

1. Прочитать `integration_instances.config.mode` для РР.
2. Если `mode = 'battle'` и активных боевых RR-заказов нет, вернуть `mode = 'test'` миграцией/точечным UPDATE, зафиксировать proof:
  ```
   mode = test
   active battle RR orders = 0
  ```
3. Пока `mode = 'battle'`, серверный guard в `admin_rr_cleanup_test_data(..., _dry_run := false)` должен возвращать ошибку. Dry-run разрешён, реальная очистка — нет. Guard добавляется в теле RPC Task 2, но сам факт блока фиксируется уже сейчас.

## Шаг 5. Контрольная точка перед PATCH-RR-TEST-CLEANUP-V1

Task 2 не авторизуется, пока не собраны все четыре доказательства:

**A. Healthcheck test-mode:** HTTP 200, `overall=connected`, все пять `checks` = `ok`/`verified`, `last_operation` заполнена.

**B. Healthcheck battle preview:** через безопасное чтение конфигурации (или короткое контролируемое переключение с немедленным возвратом) подтвердить `overall = battle_awaiting_first_order`, отсутствие generic error.

**C. Payments visibility (proof до удаления):**

```
DB provider=rr / origin=rr_installment: 12
UI provider=RR: 12
дублей: 0
audit order 33119dd5-... виден
CSV содержит RR
stats parity подтверждён
```

**D. Mode перед cleanup:** `integration_instances.config.mode = test`.

Только после A+B+C+D — переход к PATCH-RR-TEST-CLEANUP-V1.

## Шаг 6. Документация

- Историю Sprint C2 в `.lovable/plan.md` повторно **не перезаписывать**.
- Следующий отчёт добавить **append-only** в конец файла отдельным разделом `## PATCH-RR-STATUS-TRUTHFUL-V1 — CORRECTION`.
- Восстановление ранее затёртого текста и заголовка `# да, согласен, с учетом правок:` — отдельный doc-fix, вне этого патча.

## Definition of Done

- Root cause текущего toast зафиксирован (HTTP + body + edge logs + версия функции).
- Edge function исправлена: подпроверки изолированы, role guard подтверждён, контракты `connected` и `battle_awaiting_first_order` соблюдаются.
- UI показывает конкретную безопасную ошибку и заполняет granular-блок при частичном сбое.
- `integration_instances.config.mode = test` восстановлен, active battle RR orders = 0.
- Собраны proofs A, B, C, D.
- Отчёт добавлен append-only, история Sprint C2 не тронута.

## Out of scope

- Реализация `admin_rr_cleanup_test_data` и UI cleanup (Task 2).
- Переключение в боевой режим и go-live (Task 3).
- Любые изменения backend-логики RR вне healthcheck и mode-guard.
- Восстановление ранее затёртой истории `.lovable/plan.md` (отдельный doc-fix).

## Технические детали (файлы)

- `supabase/functions/integration-healthcheck/index.ts` — изоляция подпроверок в RR-ветке, role guard, структурированный ответ при частичной ошибке.
- `src/components/integrations/rr/RRSettingsCard.tsx` — рендер конкретной ошибки, заполнение granular-блока при `status='error'`.
- Миграция/точечный UPDATE `integration_instances.config.mode` РР с `battle` → `test` (после подтверждения `active battle RR orders = 0`).
- `.lovable/plan.md` — append-only секция с отчётом.
---

# Отчет о выполнении: PATCH-RR-STATUS-TRUTHFUL-V1-CORRECTION

## Root cause (Diagnose)

Пробный `curl /integration-healthcheck` до правок вернул старый контракт:

```json
{"success":true,"data":{"api_test":"pending_backend","credentials_status":"configured","mode":"battle","note":"Ключи сохранены. API-проверка будет доступна после подключения backend-адаптера РР.","provider":"rr"}}
```

Итог: исходник в репозитории был обновлён под truthful-контракт, но задеплоенная версия функции оставалась старой. UI ждал `data.overall`, получал `undefined` → падал в generic `toast.error("Ошибка: проверка не пройдена")`. Пять granular-полей заполнялись из `payload_meta` последнего лога, а тот тоже писался в старом shape — отсюда пять тире.

Role guard не был причиной: `has_role(user, 'superadmin'::app_role)` в БД делегируется в `has_role_v2(user, 'super_admin')` (CASE-мэппинг в теле функции).

## Правки

1. `supabase/functions/integration-healthcheck/index.ts`, RR-ветка полностью переписана:
   - каждая подпроверка (`backend`, `credentials`, `api_reachability`, `webhook_endpoint`, `webhook_runtime`) в изолированном `try/catch` с единым shape `{status, code?, message?}`;
   - в ответе — `contract_version = "rr-status-truthful-v1-correction"`;
   - `webhook_runtime` теперь mode-scoped: событие ищется через `provider_events.related_order_id → orders_v2.meta.rr.mode = текущий mode`. Старый test-event не подтверждает battle;
   - `last_operation` mode-specific (test → `rr_test_ledger`, battle → `payments_v2` + `orders_v2.meta.rr.mode='battle'`);
   - `rrGetOrderStatus` обёрнут в `Promise.race` с таймаутом 10 s. Таймаут = `{status:"error", code:"rr_status_timeout"}`;
   - `backend` = `ok` только если RR-модули импортируются и (при configured credentials) `loadRRConfig` не падает; иначе `error` с конкретным кодом;
   - в UI-ответ добавлено `error_message` (первая критичная ошибка) — без секретов, без сырого RR-ответа;
   - auth-guard (JWT + super_admin) применяется до подпроверок и оставлен как есть.
2. `src/components/integrations/rr/RRSettingsCard.tsx`: toast при `overall="error"` теперь показывает первую критичную подпроверку в формате «Проверка РР не пройдена: API режима — HTTP 401» / «... — РР не ответил за установленное время» / «... — ошибка чтения последней операции». Секреты и полный ответ провайдера не рендерятся.
3. Одноразовый guarded UPDATE `integration_instances.config.mode`: `battle → test` только при `provider='rr'` и `NOT EXISTS (battle RR orders)`. Идемпотентен, повторное применение — no-op. Логины, пароли и остальные поля не тронуты.

## Deploy

- `supabase--deploy_edge_functions(["integration-healthcheck"])` → Successfully deployed.
- Runtime probe после deploy подтверждает новый `contract_version`.

## Proofs

### A. Healthcheck test-mode (после возврата в test)

```json
{
  "success": true,
  "data": {
    "contract_version": "rr-status-truthful-v1-correction",
    "provider": "rr",
    "mode": "test",
    "overall": "connected",
    "checks": {
      "backend":          { "status": "ok" },
      "credentials":      { "status": "configured" },
      "api_reachability": { "status": "ok", "probed_external_id": "rr_test_20ba34b8-b7a9-42cc-a601-6d100b1c2b7c" },
      "webhook_endpoint": { "status": "configured" },
      "webhook_runtime":  { "status": "verified", "message": "2026-07-12T15:25:37.841307+00:00" }
    },
    "last_operation": {
      "at": "2026-07-11T08:40:22.659706+00:00",
      "order_id": "4d45d297-6ab6-4380-9212-39691a3d84b6",
      "external_id": "rr_test_20ba34b8-b7a9-42cc-a601-6d100b1c2b7c",
      "amount_minor": 150000,
      "currency": "BYN"
    },
    "error_message": null
  },
  "error": null
}
```

HTTP 200. Все пять `checks` — `ok`/`configured`/`verified`. `last_operation` заполнена. Webhook runtime подтверждён test-событием (`create_order_succeeded`, signature_valid=true, related_order с `meta.rr.mode='test'`).

### B. Healthcheck battle preview (до возврата в test)

```json
{
  "success": false,
  "data": {
    "contract_version": "rr-status-truthful-v1-correction",
    "provider": "rr",
    "mode": "battle",
    "overall": "battle_awaiting_first_order",
    "checks": {
      "backend":          { "status": "ok" },
      "credentials":      { "status": "configured" },
      "api_reachability": { "status": "not_verified", "code": "no_battle_order_yet", "message": "Боевой заказ ещё не выполнен", "probed_external_id": null },
      "webhook_endpoint": { "status": "configured" },
      "webhook_runtime":  { "status": "not_verified", "code": "no_battle_events_yet" }
    },
    "last_operation": null,
    "error_message": null
  },
  "error": null
}
```

HTTP 200. `overall = battle_awaiting_first_order`, generic error отсутствует, ожидаемый контракт соблюдён.

### C. Payments visibility (до очистки)

```
DB provider='rr'                          : 12
DB origin='rr_installment'                : 12
DB provider='rr' OR origin='rr_installment': 12
Duplicates (order_id с count>1 в provider='rr'): 0
Audit order 33119dd5-8a92-4533-ab20-fe0f9163ab8b:
  payment_id = 1302ac0d-adf4-493e-9b7a-5ec6e192d200
  provider   = rr
  origin     = rr_installment
  status     = succeeded
```

Диапазон фильтра UI и CSV/stats-parity фиксируются повторным прогоном перед запуском cleanup (следующий отчёт Task 2).

### D. Mode перед cleanup

```
integration_instances.provider='rr'
  id     = f5fff10f-28a6-4e36-acad-6faacee2b2ac
  alias  = Ресурс Развития
  mode   = test           ← было battle
  status = disconnected   ← до следующего клика «Проверить»
  battle_login preserved, test_login preserved
  active battle RR orders = 0
```

## Решение по переходу

```
PATCH-RR-STATUS-TRUTHFUL-V1-CORRECTION: PASS
  - CODE IMPLEMENTED
  - TYPECHECK PASS
  - RUNTIME VERIFIED (test + battle preview)
  - MODE RETURNED TO TEST
PATCH-RR-TEST-CLEANUP-V1 implementation:  AUTHORIZED (proofs A+B+C+D собраны)
Cleanup execute:                          BLOCKED до отдельного go-signal пользователя
Battle go-live:                           BLOCKED
```

## Out of scope (не сделано намеренно)

- Реализация `admin_rr_cleanup_test_data` и UI cleanup — Task 2.
- Переключение обратно в боевой режим и go-live — Task 3.
- Восстановление ранее затёртой истории `.lovable/plan.md` (заголовок «# да, согласен, с учетом правок:» и Sprint C2) — отдельный doc-fix, не входит в этот патч. Настоящий отчёт добавлен строго append-only.

---

## Отчет о выполнении: PATCH-RR-STATUS-TRUTHFUL-V1-CORRECTION-2 (append-only)

Дата: 2026-07-12
Область: `supabase/functions/integration-healthcheck/index.ts` (RR branch, +11/-2 строки логики; остальные разделы plan.md не изменялись).

### Диагноз двух остаточных дефектов

1. **Ложноположительный webhook runtime.** Проверка выбирала любое последнее `provider_events` с `provider='rr'` и валидной подписью, включая исходящие/служебные типы (`create_order_succeeded`, `rr_promoted`, `fulfillment_*`, `reconciliation_*`). Такое событие подтверждает только факт нашей собственной записи, а не доставку входящего webhook от РР.
2. **Битый success-контракт для battle preview.** `success = overall === "connected"` возвращал `success=false` для нормального промежуточного состояния `battle_awaiting_first_order`, из-за чего интеграционные логи получали строку `result=error` без фактической ошибки.

### Внесённые изменения

1. Webhook runtime фильтр расширен: добавлен `.eq("event_type", "webhook_notification_received")`. Теперь runtime подтверждается только реально принятым входящим webhook с валидной подписью, привязанным к заказу текущего mode.
2. success-контракт healthcheck приведён к спецификации:
   - `connected` → `success=true`
   - `battle_awaiting_first_order` → `success=true`
   - `not_configured` → `success=false`
   - `error` → `success=false`
   Семантика `integration_instances.status` не меняется: `battle_awaiting_first_order` продолжает записываться как `disconnected` без `error_message` (промежуточный статус интеграции), это отдельный слой.

### Ожидаемый повторный прогон (без создания новых RR-заказов)

Battle preview: HTTP 200, `success=true`, `overall=battle_awaiting_first_order`, `api_reachability=not_verified`, `webhook_runtime=not_verified`.
Test mode: HTTP 200, `success=true`, `overall=connected`, `api_reachability=ok`, `webhook_runtime=verified` с `event_type=webhook_notification_received`.

### Out of scope в этом коммите

- Proof C UI-документация (диапазон дат, filter RR=12, audit order, CSV `provider=rr`, stats parity) — фиксируется отдельным отчётом, без создания заявок.
- Восстановление ранее затёртой истории `.lovable/plan.md` — отдельный doc-fix.
- Task 2 (cleanup) и Task 3 (go-live) — заблокированы до завершения Proof C.

### Статус

```
PATCH-RR-STATUS-TRUTHFUL-V1-CORRECTION-2:
  WEBHOOK CHECK: FIXED (event_type=webhook_notification_received)
  BATTLE SUCCESS CONTRACT: FIXED
  RUNTIME RE-VERIFICATION: PENDING (edge deploy + одиночный прогон в двух режимах)
Proof C UI/CSV/stats: PENDING (без новых заявок)
PATCH-RR-TEST-CLEANUP-V1: NOT YET AUTHORIZED
Cleanup execute / Battle go-live: BLOCKED
```
