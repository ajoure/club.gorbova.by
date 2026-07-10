да, согласен, с учетом правок:

## **1. Исправить количество замечаний**

В предыдущем ревью было **6 замечаний**, а не 5:

1. Public E2E.
2. Неполные negative tests.
3. Honeypot.
4. Persistence hardening.
5. Нарушение изоляции тестовой среды.
6. Неверное имя миграции.

Исправить это в `REPORT.md`, `REPORT_v2.md` и DoD.

## **2. Honeypot**

Зафиксировать единственный допустимый ответ:

```json
{ "success": true }
```

Запрещено:

- возвращать фиктивные `order_id` или `payment_url`;
- создавать `provider_events` — бот сможет засорять ledger;
- сохранять значение honeypot или PII в логах.

Допустим только обезличенный server-side metric/log.

Старый FAIL-артефакт не перезаписывать. Новый PASS сохранить в `2_5_negative_v2/`.

## **3. Persistence failure разделить по стадиям**

Нельзя применять единое правило «при любой ошибке поставить `initiation_status='failed'`».

### **До вызова РР**

Если не удалось записать `create_order_requested`, внешний заказ ещё не создан. Вызов РР не выполнять.

### **После успешного ответа РР**

Если РР уже создал заявку, а локальное сохранение упало:

- не ставить обычный `failed`;
- не разрешать создание нового `orders_v2`;
- сохранить привязку к тому же `order_id`;
- вернуть 502 без `payment_url`;
- предусмотреть восстановление на том же `order_id`.

Иначе повторный запрос может создать вторую заявку РР.

## **4. Финализацию сделать атомарной**

Предпочтительно добавить отдельную `SECURITY DEFINER` RPC, например:

```text
rr_finalize_created_order(...)
```

Она в одной транзакции должна:

1. Проверить `order_id`, `provider='rr'`, `flow='rr_installment'`.
2. Зафиксировать `initiation_status='created'` и `payment_url`.
3. Вставить идемпотентный `create_order_succeeded`.
4. Вернуть подтверждённое состояние.

Порядок:

```text
create order row
→ durable create_order_requested
→ RR createOrder
→ atomic finalize RPC
→ HTTP 200
```

RPC должна иметь фиксированный `search_path`, закрытые grants и идемпотентность.

Событие `create_order_succeeded` нельзя записывать раньше канонического состояния заказа — иначе ledger утверждает успех, которого нет в `orders_v2`. Это соответствует требованию аудируемости и согласованности.  

## **5. Ошибка локальной финализации**

Добавить отдельное техническое состояние:

```text
local_persist_failed
```

или эквивалентный recovery marker.

Событие:

```text
create_order_persist_failed
```

должно быть best-effort и не превращать заказ в reusable=false с возможностью создания нового external order.

Ошибка polling должна сохранить текущий контракт `rr_reuse_wait_timeout`, а не без необходимости переименовываться в `reuse_timeout`.

## **6. Негативный persistence test**

Не использовать RLS violation:

- edge работает через `service_role`;
- тест потребует опасного изменения grants;
- результат не будет воспроизводить реальный failure-path.

Допустимы:

- dependency injection и unit/integration mock DB repository;
- отдельный preview deployment;
- отдельная test Supabase environment.

Production permissions и конфигурацию не менять.

## **7. Test fixture — сначала discovery**

До миграции подтвердить:

- фактические обязательные поля `products_v2`, `tariffs`, `tariff_offers`;
- наличие `workspace_id`;
- существующие test/hidden/archive-механизмы;
- реальные названия колонок;
- ограничения и FK;
- допустимую минимальную сумму РР.

`1 BYN` нельзя фиксировать без подтверждения, что РР принимает такую сумму.

Просто активный оффер с `meta.test_fixture=true` в production DB недостаточен: он может попасть в публичные или административные выборки.

Приоритет:

1. отдельная preview/test БД;
2. только при невозможности — скрытый fixture с серверным test-only guard, недоступным обычному public flow.

Публичный `force_fail` запрещён.

## **8. Исправить FK в cleanup**

В `orders_v2` используется:

```text
offer_id
```

а не `tariff_offer_id`.

Заказ fixture должен получать:

```json
{
  "test_fixture": true,
  "test_run_id": "..."
}
```

Cleanup должен:

1. Сначала выполнить dry-run `SELECT`.
2. Показать точные UUID и количество строк.
3. Использовать только exact `offer_id` + `test_run_id`.
4. Удалять child rows раньше parent rows.
5. Выполняться транзакционно.
6. Не запускаться автоматически.

Широкое условие `meta.test_fixture=true OR ...` не использовать. Удаление audit-событий допускается только отдельной командой после сохранения proof; предпочтительно оставить их как test evidence.

## **9. Inactive offer**

Не переключать один общий fixture между `true/false`.

Создать отдельный статичный inactive fixture либо использовать изолированную транзакционно управляемую тестовую среду. Это исключит race между тестами.

## **10. CreateOrder failure**

План содержит несуществующий механизм:

```text
RR_TIMEOUT_MS
```

Текущий HTTP-клиент использует переданный `timeoutMs` либо значение 15 секунд, а конфиг его сейчас не предоставляет.

Запрещено временно менять общий production RR config.

Тестировать только:

- в отдельном preview deployment с изолированной конфигурацией;
- либо mock-адаптером в integration test.

## **11. Webhook proof привести к реальному Sprint B контракту**

Подпись сейчас не HMAC. Используется формула MD5:

```text
newStatus_secretKey_salt
```

Полную подпись и секрет не сохранять в git-артефактах. Request proof должен содержать redacted значение.

Использовать фактическое поле:

```json
{ "id": "..." }
```

а не `orderId`.

Ожидания:

### **Duplicate**

- первый ответ: `200`;
- второй: `{ success:true, duplicate:true }`;
- одна строка `webhook_notification_received`;
- никаких `payment_succeeded`.

`payment_succeeded` относится к Sprint C и в этом спринте запрещён.

### **Unknown order**

```json
{ "success": true, "ignored": "unknown_order" }
```

Событие:

```text
webhook_unknown_order
```

### **Foreign/non-RR flow**

```json
{ "success": true, "ignored": "not_rr_installment" }
```

Событие:

```text
webhook_not_rr_installment
```

Не вводить новые response contracts без необходимости.

## **12. План содержит противоречие по UI**

Сейчас одновременно установлено:

- UI-код не изменять;
- public E2E должен завершиться PASS;
- Sprint B должен быть закрыт.

Если discovery подтвердит отсутствие wiring, это невозможно в одном этапе.

Разделить:

### **Gate A**

- backend hardening;
- fixture;
- negative proofs;
- UI discovery;
- точный mini-план UI;
- без изменения React/UI.

### **Gate B**

Только после отдельного письменного согласования:

- минимальный UI patch;
- deploy;
- E2E;
- финальная приёмка Sprint B.

## **13. Public E2E**

Preview с подменой `Host` не является доказательством production routing: TLS, DNS, redirects и domain routing могут отличаться.

Финальный proof выполнять по фактическому:

```text
https://gorbova.by/cb
```

после deployment.

Если невозможно подключить скрытый fixture и live proof создаст одну строку на рабочем оффере, перед тестом получить отдельное разрешение пользователя. Нельзя одновременно обещать:

```text
никаких production orders
```

и выполнять реальный happy path на боевом оффере.

## **14. Side-effects proof**

Не требовать абсолютного global diff = 0. В живой системе фоновые процессы уже меняли общие счётчики.

Обязательный scoped proof:

```text
payments_v2 по test order IDs = 0
entitlements по test contact/user = 0
access_grant_ledger по test order IDs = 0
domain_events по test order IDs = 0
telegram_access_grants по test contact/user = 0
CRM activity по test order IDs/contact = 0
```

Для Telegram дополнительно — grep отсутствия writer-вызова.

`crm_activity_log` использовать только после подтверждения существования. Иначе указать фактический CRM audit SoT.

Глобальные счётчики допустимы только как информационный snapshot.

## **15. Дополнить DoD**

Sprint B закрывается только после:

1. Backend persistence hardening PASS.
2. Fixture isolation PASS.
3. Все negative proofs PASS по реальным Sprint B контрактам.
4. Gate A discovery завершён.
5. Отдельный UI mini-план согласован.
6. Gate B реализован.
7. E2E выполнен на фактическом `gorbova.by/cb`.
8. Scoped side-effects = 0.
9. Все migration names указаны точно.
10. Получен письменный PASS ревьюера.

Sprint C до этого не начинать.

Передать этот план Lovable на запись не удалось: подключение Lovable доступно для чтения, но операция отправки требует разрешение `projects:write`.

&nbsp;

План: закрытие Sprint B — follow-up validation, UI-wiring и устранение замечаний ревью

## 0. Область и запреты

- Sprint C не начинать.
- Новые нагрузочные тесты на боевом РР-оффере запрещены. Всё дальнейшее runtime-тестирование — только на изолированном test fixture (см. §4).
- Не трогать legacy external_link для двух остальных тарифов, кроме доказательства того, что они по-прежнему идут по старому пути.

## 1. Исправление отчёта (быстрый фикс)

- В `docs/audit/2026-07-10-sprint-b-runtime-proof/REPORT.md` заменить все ссылки `20260710085555_*` на фактическое имя `20260710085550_3d877fb1-215b-4219-a311-d84952134c83.sql`.
- Добавить пометку «Sprint B: FAIL — требуется follow-up validation и UI-wiring», перечислить пять невыполненных пунктов из ревью.

## 2. Honeypot контракт

Файл: `supabase/functions/public-rr-installment-initiate/index.ts`.

- При срабатывании honeypot возвращать нейтральный ответ формата, идентичного happy-path, но с фиктивными безопасными значениями либо просто `{ success: true }` без поля `skipped`. Никакого `skipped:"honeypot"`, никаких признаков блокировки в теле и заголовках.
- Логирование причины оставить только в server-side логах (console.info) и в `provider_events` (или отдельном audit), но не в HTTP-ответе.
- Обновить `docs/audit/.../2_5_negative/honeypot.json` новым доказательством.

## 3. Persistence hardening (критичный риск)

Файл: `supabase/functions/public-rr-installment-initiate/index.ts`.

Проблема: сейчас после успешного `createOrder` в РР возможны молчаливые ошибки при:

- `INSERT` в `provider_events` (create_order_requested / create_order_succeeded),
- `UPDATE orders_v2 SET meta = jsonb_set(...) , initiation_status='created', payment_url=...`.

Требование: не отвечать клиенту 200, пока `payment_url` и `initiation_status='created'` не зафиксированы в БД.

Изменения:

1. Каждый вызов `supabase.from(...).insert/update(...)` проверять на `error`. При ошибке:
  - логировать в `console.error` со структурой `{ stage, order_id, rr_external_id, error }`;
  - попытаться пометить `orders_v2.initiation_status='failed'` и записать `provider_events` типа `create_order_persist_failed` (best-effort, отдельным try/catch);
  - вернуть HTTP 502 `{ error: 'persist_failed' }` без `payment_url`.
2. Порядок операций внутри happy-path:
  1. INSERT `create_order_requested` → check error;
  2. HTTP POST в РР;
  3. INSERT `create_order_succeeded` с полным payload → check error;
  4. UPDATE `orders_v2` (`payment_url`, `initiation_status='created'`, `meta.rr.*`) → check error;
  5. только теперь `return 200 { payment_url, order_id, reused:false }`.
3. Poll-ветка `wasReused=true` тоже проверяет, что после ожидания `initiation_status='created'` и `payment_url` реально присутствуют; иначе HTTP 504 `{ error: 'reuse_timeout' }`.

## 4. Изолированный test fixture

Цель: убрать зависимость future proofs от боевого оффера и избежать production-мусора.

1. Миграция (создать через supabase--migration):
  - вставить `products_v2` вида `rr_test_product` (или `is_test=true`, если поле есть; иначе — по name marker `[TEST] RR fixture`);
  - `tariffs` + `tariff_offers` с `offer_type='bank_installment'`, `payment_method='bank_installment'`, `provider='rr'`, суммой 1 BYN, `is_active=true`, но с marker `meta.test_fixture=true`;
  - миграция идемпотентна (`ON CONFLICT DO NOTHING` по стабильному public_id).
2. Все дальнейшие runtime-тесты (§5, §6) выполнять ТОЛЬКО против `tariff_offer_id` этого fixture.
3. Cleanup/retention шаг (отдельный контролируемый):
  - написать SQL-скрипт `docs/audit/2026-07-10-sprint-b-runtime-proof/cleanup_test_fixture.sql`, который удаляет `orders_v2` и `provider_events`, где `meta.test_fixture=true` OR `tariff_offer_id = <fixture id>`;
  - НЕ выполнять массового удаления существующих 8 production-строк без отдельной команды. Только задокументировать их id-ы в `docs/audit/.../production_leftover_orders.md` с рекомендацией ручного review.

## 5. Полный negative runtime proof

Директория: `docs/audit/2026-07-10-sprint-b-runtime-proof/2_5_negative_v2/`.

Все сценарии — против test fixture (кроме webhook, где нужен реальный секрет).

1. **inactive offer**: `UPDATE tariff_offers SET is_active=false` для fixture → invoke → HTTP 4xx `{ error:'offer_inactive' }` → вернуть `is_active=true`.
2. **createOrder failure**: временно установить `RR_BASE_URL` секрет на неотвечающий адрес ИЛИ смоделировать через невалидный `rr_config` (например, включить в fixture `meta.rr.force_fail=true` + в edge-функции добавить dev-only branch — НЕ добавлять; вместо этого использовать сетевой сбой: подменить `RR_TIMEOUT_MS` в config на 1 мс временно). Ожидание: HTTP 5xx, `orders_v2.initiation_status='failed'`, `provider_events` содержит `create_order_failed`, payment_url отсутствует. Восстановить конфиг.
3. **duplicate webhook с валидной подписью**: отправить один и тот же payload дважды на `rr-webhook` с корректной HMAC-подписью. Ожидание: оба 200, но `provider_events` содержит одну строку `payment_succeeded` (идемпотентность по external_id + event id).
4. **unknown external ID с валидной подписью**: payload с несуществующим `orderId`, подпись валидная. Ожидание: HTTP 202 или 200 `{ status:'ignored_unknown_order' }`, запись в `provider_events` типа `unknown_order` (для аудита), никаких side-effects.
5. **foreign-provider order**: создать вручную `orders_v2` c `provider='bepaid'`, отправить webhook РР с этим id и валидной подписью РР. Ожидание: HTTP 200/202 `{ status:'ignored_foreign_provider' }`, side-effects = 0.

Для каждого — сохранить request/response JSON + SQL snapshot до/после.

## 6. Public E2E именно через gorbova.by/cb

Согласованный путь: `gorbova.by/cb` → SitePages routing → iframe embed → postMessage → `SitePageBySlug` → `LeadRequestDialog` → `public-rr-installment-initiate`.

Сейчас `cb.gorbova.by` показывает preregistration overlay и другой ценник — это НЕ тот путь.

Разбить на две подзадачи:

### 6.1 UI-wiring discovery (обязательно до реализации)

Прочитать и задокументировать в `docs/audit/2026-07-10-sprint-b-runtime-proof/ui_wiring_discovery.md`:

- маршрут `/cb` на `gorbova.by` (см. `src/pages/`, `DomainRouter`, `site_pages` таблица — какая запись обслуживает `gorbova.by/cb`);
- где рендерится iframe и какие `postMessage` контракты используются;
- как передаётся `tariff_offer_id` в `LeadRequestDialog`;
- какие три оффера сейчас привязаны: РР bank_installment + два legacy external_link (id, provider, payment_method).

Только после этого — предложить точечные UI-правки (если нужны) отдельным mini-планом. Никаких массовых изменений UI без явного согласования.

### 6.2 E2E прогон

Playwright headless против preview URL с host-override на `gorbova.by`:

- открыть `https://gorbova.by/cb`;
- дождаться iframe SitePageBySlug;
- выбрать РР-тариф → заполнить `LeadRequestDialog` тестовым контактом → submit;
- перехватить network: должен быть вызов `public-rr-installment-initiate`, ответ содержит `payment_url` на `pay.rrllc.ru`, происходит redirect;
- закрыть, вернуться, выбрать legacy тариф №2 → доказать, что открывается прежний external_link (никакого вызова `public-rr-installment-initiate`);
- то же для legacy тарифа №3;
- повторный submit того же РР-тарифа тем же контактом → same order_id (idempotency в UI-контексте);
- скриншоты + HAR в `docs/audit/2026-07-10-sprint-b-runtime-proof/2_4_public_e2e_v2/`.

Использовать ТОЛЬКО test fixture, если удастся временно подменить binding `gorbova.by/cb` на test product; иначе — согласовать с пользователем, можно ли выполнить E2E на боевом оффере с последующим ручным cleanup одной строки orders_v2.

## 7. Финальный отчёт и DoD

Отчёт: `docs/audit/2026-07-10-sprint-b-runtime-proof/REPORT_v2.md`.

Обязательные разделы: §1 fix отчёта, §2 honeypot, §3 persistence hardening (с примерами лог-строк и негативным тестом на INSERT failure — mock через RLS violation), §4 fixture + cleanup script, §5 пять negative сценариев с артефактами, §6.1 discovery + §6.2 E2E с HAR/скриншотами, снапшот до/после по 6 таблицам (payments_v2, entitlements, access_grant_ledger, telegram_access_grants, domain_events, crm_activity_log) — diff = 0.

DoD Sprint B:

- Все 5 замечаний ревью закрыты артефактами.
- Public E2E выполнен именно на `gorbova.by/cb` с доказанной цепочкой iframe → postMessage → SitePageBySlug → LeadRequestDialog.
- Persistence-hardening покрыт негативным тестом.
- Никаких новых production-строк `orders_v2` вне test fixture.
- Отчёт корректно ссылается на реальные migration file names.

Sprint C открывается ТОЛЬКО после письменного PASS от ревьюера.

## Технические детали

- Изменяемые файлы (реализация):
  - `supabase/functions/public-rr-installment-initiate/index.ts` — honeypot + persistence checks.
  - Новая миграция `supabase/migrations/<ts>_rr_test_fixture.sql` — test product/tariff/offer.
  - `docs/audit/2026-07-10-sprint-b-runtime-proof/REPORT.md` — правка имени миграции.
  - Новые артефакты под `docs/audit/2026-07-10-sprint-b-runtime-proof/{2_5_negative_v2,2_4_public_e2e_v2,ui_wiring_discovery.md,cleanup_test_fixture.sql,REPORT_v2.md}`.
- UI-код React/DomainRouter/SitePages НЕ меняется на этом шаге — только discovery. Любые UI-правки — отдельным согласованным планом после §6.1.