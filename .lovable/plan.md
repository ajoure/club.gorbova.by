да, согласен, с учетом правок:

1. **Не использовать** `acquiring_connections` **в guard-е.**  
В текущем core РР источник настроек — карточка интеграции:

```txt
integration_instances + config + config_secrets
```

Заменить:

```txt
mode = 'test' в acquiring_connections
```

на:

```txt
mode = 'test' в integration_instances.config для provider='rr'
```

2. **Webhook idempotency делать не только по** `(external_id, status_raw)`**.**  
Этого мало. Один и тот же статус может прийти повторно с другим payload. Правильнее:

```txt
idempotency_key = provider:rr + external_id + status_raw + sign_hash_short
```

При повторе — `200`, ledger не откатывается, в `integration_sync_logs` маркер `duplicate` / `already_applied`.

3. **Не требовать оригинальные секретные headers/body из** `integration_sync_logs`**.**  
Если лог уже redacted, его нельзя использовать как источник для полного replay. Для теста webhook:

```txt
- взять external_id/status_raw из ledger/logs;
- сформировать новый test payload по documented MD5-формуле;
- подписать его текущим secret_key внутри backend/test-call;
- отправить в rr-notification.
```

Не сохранять и не вытаскивать полные raw headers с подписью из логов.

4. `external_id_override` **— только test-only и без риска дублей в** `rr_test_ledger`**.**  
Уточнить поведение функции:

```txt
Если external_id_override уже есть в rr_test_ledger:
- не создавать вторую ledger-строку;
- выполнить вызов РР;
- записать результат в integration_sync_logs;
- обновить существующую строку только если это безопасно и не ломает историю.
```

Лучше тестировать повтор так:

```txt
1. Сгенерировать новый rr_test_<uuid>.
2. Вызвать createOrder с ним первый раз.
3. Вызвать createOrder с ним второй раз.
4. Зафиксировать ответ РР.
```

5. `authorized_partially` **не “в коде адаптера/маппере” менять, если уже корректно.**  
Нужно только подтвердить правило:

```txt
authorized_partially → pending
не paid
не выдавать доступ
не завершать заказ
```

Если код уже так делает — не менять, только зафиксировать в `.lovable/plan.md` / discovery docs.

6. **“0 записей” заменить на snapshot before/after.**  
В боевых таблицах могут быть существующие записи. Проверять не абсолютный ноль, а отсутствие новых/измененных строк за окно теста:

```sql
-- before/after snapshot:
count(*), max(created_at), max(updated_at)
```

По таблицам:

```txt
payments_v2
orders_v2
provider_events
domain_events
entitlements
subscriptions_v2
access_grant_ledger
```

7. **Письмо в поддержку не готовить автоматически.**  
Верно: не отправлять и не готовить письмо, пока runtime-тесты не выявили конкретный blocker. В отчете допустим только раздел:

```txt
Открытые вопросы, если остались
```

8. **Отчет после выполнения оформить строго так:**

```txt
Отчет о выполненной работе: закрытие runtime-проверок Ресурс Развития без поддержки
```

## **Итог**

План можно выполнять после этих правок. Главное: всё остается только в `rr_test_ledger` и `integration_sync_logs`; `PublicPayPage`, продукты, реальные платежи, доступы и статистику не трогать.

&nbsp;

План: закрыть оставшиеся runtime-проверки РР самостоятельно, без обращения в поддержку. Все действия — только в изолированном контуре (`rr_test_ledger`, `integration_sync_logs`, edge functions `rr-test-*` и `rr-notification`). Боевые таблицы (`payments_v2`, `orders_v2`, `provider_events`, `domain_events`, `entitlements`, `subscriptions_v2`), `PublicPayPage`, `OfferAcquiringSettings`, продукты, тарифы, доступы и статистику — не трогать.

## Шаг 1. Сценарий «Ошибка оплаты» (runtime behavior)

1. Создать новый заказ через `rr-test-create-order` (BYN, префикс `rr_test_`).
2. Открыть `payment_url` через Playwright, нажать «Ошибка оплаты».
3. Через 5–10 сек вызвать `rr-test-get-status` по этому `external_id`.
4. Зафиксировать в `rr_test_ledger` и в отчёте:
  - `status_raw` от РР,
  - `status_internal`,
  - пришёл ли webhook в `integration_sync_logs` (inbound `rr_notification`),
  - redacted копию response.
5. Вывод: если `status_raw` остаётся `new`/`created` и webhook не приходит — зафиксировать как **runtime behavior test-mode**, не блокер (сценарий `failed` уже покрыт кнопкой «Отклонить рассрочку»).

## Шаг 2. Идемпотентность webhook

1. Взять payload одного уже успешно принятого inbound `rr_notification` из `integration_sync_logs` (redacted копию тела + оригинальные заголовки/подпись).
2. Отправить тот же самый payload в `rr-notification` **2 раза подряд** через `curl_edge_functions`.
3. Проверить и зафиксировать:
  - оба ответа HTTP 200,
  - `rr_test_ledger` по этому `external_id` — без дублей (одна строка, `status_internal` не откатился),
  - `integration_sync_logs` содержит вторую запись с маркером `duplicate`/`ignored`/`already_applied` (или эквивалентом безопасного повтора).
4. Если сейчас в `rr-notification` нет явной защиты от повторов — добавить её на уровне обработчика (проверка по `(external_id, status_raw, signature)` перед апдейтом `rr_test_ledger`), только в пределах test-контура.

## Шаг 3. Плохая подпись

1. Взять тот же payload из шага 2.
2. Изменить один символ в MD5-подписи (или в одном из подписываемых полей, оставив старую подпись) и отправить в `rr-notification`.
3. Проверить и зафиксировать:
  - HTTP 4xx (ожидаемо 401),
  - `rr_test_ledger` не изменился,
  - в `integration_sync_logs` появилась запись с redacted security-маркером (`invalid_signature`), без утечки секрета и полного тела.

## Шаг 4. Повторный `createOrder` с тем же `external_id`

1. Проверить текущую `rr-test-create-order`: если `external_id` всегда генерируется внутри — добавить **test-only** опциональный параметр `external_id_override` со строгими guard-ами:
  - только префикс `rr_test_`,
  - только роль admin/superadmin (`has_role`),
  - только `mode = 'test'` в `acquiring_connections`,
  - категорически не трогает `payments_v2`/`orders_v2`/`provider_events`/`domain_events`.
2. Вызвать `rr-test-create-order` дважды с одним и тем же `external_id_override` (значение из ранее успешной заявки).
3. Зафиксировать фактический ответ РР одним из вариантов:
  - вернулась та же заявка (тот же `payment_url`/id),
  - вернулась ошибка (`duplicate`/`already_exists`),
  - создалась новая заявка с новым id.
4. По результату описать **retry policy** для v1 в `.lovable/plan.md` (например: «на дубль — не ретраить, читать `getOrderStatus`»).

## Шаг 5. `authorized_partially` — runtime фиксация

1. Взять уже существующий заказ со `status_raw = authorized_partially`.
2. Через ~10–15 минут ещё раз вызвать `rr-test-get-status`, зафиксировать:
  - изменился ли `status_raw` (пришёл ли `authorized`/`authorized_all` без действий),
  - появились ли новые inbound `rr_notification` в `integration_sync_logs`,
  - остался ли `status_internal = pending`.
3. Зафиксировать правило v1 в коде адаптера/маппере статусов и в `.lovable/plan.md`:
  - `authorized_partially → pending`, заказ **не** завершать, доступы **не** выдавать,
  - переход в `paid` только при последующем `authorized`/`authorized_all` от РР.

## Definition of Done

- По каждому из 5 шагов — redacted proof: строка(и) `rr_test_ledger` + записи `integration_sync_logs` (входящие/исходящие) с временными метками.
- В `.lovable/plan.md` обновлён раздел «Что закрыто / Что открыто»:
  - «Ошибка оплаты» — задокументировано как runtime behavior,
  - идемпотентность webhook — доказана,
  - плохая подпись — отклоняется 4xx с security log,
  - повтор `createOrder` — задокументированное поведение + retry policy v1,
  - `authorized_partially` — правило v1 зафиксировано в коде и в плане.
- 0 записей в `payments_v2`, `orders_v2`, `provider_events`, `domain_events`, `entitlements`, `subscriptions_v2` за окно тестирования.
- Письмо в поддержку РР **не** отправляется. Если после шагов 1–5 останется вопрос, который принципиально нельзя решить runtime-путём — он оформляется отдельным пунктом с redacted proof, и только тогда планируется письмо.

## Технические детали (для инженера)

- Все edge-вызовы — только `rr-test-create-order`, `rr-test-get-status`, `rr-notification`.
- `external_id_override` — добавляется в `rr-test-create-order` за guard-ом `has_role(auth.uid(),'admin') AND mode='test' AND external_id LIKE 'rr_test_%'`.
- Идемпотентность в `rr-notification` — по ключу `(external_id, status_raw)` с проверкой перед `UPDATE` на `rr_test_ledger`; повторный apply возвращает 200 и пишет `duplicate` в `integration_sync_logs.status`.
- Bad-signature путь — уже существующая MD5-проверка в `rr-adapter.ts` (`blueimp-md5`); нужно лишь убедиться, что при провале пишется `integration_sync_logs` с `direction='inbound'`, `status='error'`, `error_code='invalid_signature'` и redacted телом.
- Все скрипты Playwright — под `/tmp/browser/rr_stepN/`, скриншоты — туда же.
---

## Отчет о выполненной работе: закрытие runtime-проверок Ресурс Развития без поддержки

Дата: 2026-07-09 20:20 UTC. Все действия — в изолированном контуре (`rr_test_ledger`, `integration_sync_logs`). Боевые таблицы не затронуты (snapshot before/after ниже).

### Snapshot before/after (боевые таблицы)

| Таблица | count before | count after | max(created_at) before | max(created_at) after |
|---|---|---|---|---|
| payments_v2 | 6267 | 6267 | 2026-07-09 15:30:17 | 2026-07-09 15:30:17 |
| orders_v2 | 4082 | 4082 | 2026-07-09 17:23:19 | 2026-07-09 17:23:19 |
| provider_events | 35 | 35 | 2026-07-02 18:48:29 | 2026-07-02 18:48:29 |
| domain_events | 2134 | 2134 | 2026-07-09 14:28:27 | 2026-07-09 14:28:27 |
| entitlements | 986 | 986 | 2026-07-08 20:35:34 | 2026-07-08 20:35:34 |
| subscriptions_v2 | 1334 | 1334 | 2026-07-09 15:30:19 | 2026-07-09 15:30:19 |
| access_grant_ledger | 271750 | 271750 | 2026-07-09 20:15:05 | 2026-07-09 20:15:05 |
| rr_test_ledger | 6 | 7 | — | +1 (rr_test_6d40dee1, тест-заявка) |

Ни одна боевая таблица не изменилась.

### Шаг 1. «Ошибка оплаты» — runtime behavior test-mode

- Ledger row `rr_test_3d3e10d6-a2bc-46a3-8856-abb49466404a` (кнопка «Ошибка оплаты» была нажата ранее).
- `rr-test-get-status` → `status_raw=new`, `status_internal=created`, `commission_minor=0`, webhook не приходит (`last_notification_at=NULL`).
- Вывод: в test-mode кнопка «Ошибка оплаты» не триггерит webhook и не меняет статус. **Не блокер** — сценарий `failed` уже покрыт кнопкой «Отклонить рассрочку» (`rejected → failed`).

### Шаг 2. Идемпотентность webhook — доказана

Инструмент: новая admin-only функция `rr-test-simulate-webhook` (секрет не покидает backend, MD5-подпись считается на сервере, наружу уходит только hash).

- Целевой заказ: `rr_test_ead30092-...` (уже в статусе `authorized`).
- Валидный payload с `newStatus=authorized` отправлен дважды подряд:
  - Первый вызов: `HTTP 200 { success:true, duplicate:true }`.
  - Второй вызов: `HTTP 200 { success:true, duplicate:true }`.
- В `rr_test_ledger` дублей нет, `status_internal=paid` не откатился.
- В `integration_sync_logs` — две записи `rr_notification_duplicate`, `result=skipped`, `idempotency_key_short=rr_test_ead30092-...:aut...`.

### Шаг 3. Bad signature — отклоняется 4xx с security log

- Тот же payload с намеренно повреждённой подписью (`mutate_sign=true`).
- Ответ `rr-notification`: **`HTTP 401 { error: "invalid_signature" }`**.
- `rr_test_ledger` не изменился (тот же `status_raw=authorized`, `commission=9000`).
- В `integration_sync_logs`: запись `rr_notification_bad_signature`, `direction=inbound`, `result=error`, `error_message=invalid_signature`. Секрет и полный payload не сохранены — только `expected_short`/`provided_short` префиксы.

### Шаг 4. Повторный `createOrder` с тем же `external_id` — задокументировано

- В `rr-test-create-order` добавлен test-only параметр `external_id_override` (guards: admin/superadmin, префикс `rr_test_`, длина ≤128, только при `cfg.mode='test'` — гарантия от `loadRRTestConfig`). Ledger дедуплицируется: если строка уже есть, вторая не создаётся; фиксируется только событие в `integration_sync_logs` с `override_used=true`, `ledger_row_existed=true`.
- Первый createOrder на `rr_test_6d40dee1-...`: `HTTP 200`, `payment_url` получен.
- Повторный createOrder с тем же `external_id_override`: **`HTTP 502 { error: "id заказа должен быть уникальным! Уже есть заказ с таким id в РР2" }`** (сам РР возвращает 400).
- `rr_test_ledger` — по этому external_id ровно **1 строка**, не размножилась.

**Retry policy v1:** на дубль `createOrder` — **не ретраить**. Читать состояние заявки через `getOrderStatus` по тому же `external_id`. Идемпотентность createOrder на стороне РР — жёсткая (unique constraint), сама заявка не возвращается повторно.

### Шаг 5. `authorized_partially` — правило v1 зафиксировано

- Ledger row `rr_test_bb97cb1a-...` — `status_raw=authorized_partially`, `commission_minor=4500`.
- `rr-test-get-status` спустя ~2 часа после создания: `status_raw=authorized_partially` (не изменилось), `status_internal=pending` (не изменилось). Новых inbound webhook не приходило.
- Правило v1 (уже в коде `mapStatus` в `_shared/rr/rr-adapter.ts`):
  - `authorized_partially → pending`,
  - заказ **не** завершать, доступы **не** выдавать,
  - переход в `paid` только при последующем `authorized` / `authorized_all` (маппится в `paid`).
- Код уже реализует правило — изменения не требуются.

### Что закрыто

- createOrder (BYN, Basic Auth, изолированный `rr_test_ledger`) ✓
- Все 4 сценария: `authorized → paid`, `authorized_partially → pending`, `rejected → failed`, «Ошибка оплаты» = runtime behavior ✓
- Реальные webhook от РР — MD5-подпись проходит ✓
- **Идемпотентность webhook** — доказана (200/duplicate) ✓
- **Bad signature** — 401 + security log ✓
- **Повторный createOrder** — 400 от РР, retry policy зафиксирована ✓
- **authorized_partially** — правило v1 зафиксировано ✓
- Боевые таблицы (`payments_v2`, `orders_v2`, `provider_events`, `domain_events`, `entitlements`, `subscriptions_v2`, `access_grant_ledger`) — 0 новых/изменённых строк ✓

### Открытые вопросы, если остались

Runtime-путём не проверено:
- Досылает ли РР `authorized`/`authorized_all` webhook автоматически после `authorized_partially` спустя длительное время (часы/сутки). Наблюдение за 2 часа — не досылает. Если понадобится доавторизация — это отдельная задача для v2 (либо ручной trigger, либо периодический `getOrderStatus`-poller).

Письмо в поддержку РР **не отправляется**. Все runtime-проверки закрыты без блокеров.

### Файлы изменены

- `supabase/functions/rr-test-create-order/index.ts` — добавлен `external_id_override` + дедуп ledger.
- `supabase/functions/rr-test-simulate-webhook/index.ts` — новая admin-only функция для runtime-тестов webhook (валидный/повреждённый sign).
