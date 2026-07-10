## да, согласен, с учетом правок:

## **1. Исправить rate-limit proof**

Текущая проверка не сработает:

```txt
6 запросов с разными контактами с одного IP → 6-й должен вернуть 429
```

Для IP-bucket установлен лимит `20/60 сек`, а contact/offer-contact buckets при разных контактах не превышаются. Поэтому шестой запрос не обязан возвращать `429`.

Использовать один из корректных сценариев:

```txt
A. IP-limit:
21 запрос с 21 разным тестовым контактом с одного IP;
ожидаемо 21-й → HTTP 429.

B. Contact-limit:
6 запросов с одним контактом;
ожидаемо 6-й → HTTP 429.
```

Вариант B допустим, только если rate-limit выполняется **до reuse-return**. В отчете показать фактический порядок.

## **2. Load-тесты не проводить на боевом публичном оффере**

Concurrency из пяти запросов и rate-limit из 21 запроса не должны создавать десятки `orders_v2` и заявок РР на production-оффере.

Разделить среды:

```txt
Живой gorbova.by/cb:
- один happy path;
- один sequential reuse;
- проверка двух legacy-тарифов.

Preview/dev с отдельным test-only offer:
- concurrency;
- rate-limit;
- createOrder failure;
- inactive/runtime-disabled cases.
```

Test-only offer должен быть:

```txt
is_active=false для публичного сайта;
доступен edge-тесту только через отдельный безопасный test guard;
mode=test;
помечен meta.test_fixture=true.
```

Нельзя временно отключать или портить рабочий оффер тарифа «Бухгалтер» ради негативных тестов.

## **3. Не подменять production environment для проверки ошибки РР**

Не менять `RR_API_BASE` или production secrets.

Допустимые варианты:

```txt
- отдельный dev/preview deployment;
- изолированный test integration instance;
- backend-only fault injection, доступный только service_role/admin,
  только mode=test и только test_fixture offer.
```

Запрещен публично управляемый параметр вроде `force_error=true`.

Если безопасного изолированного механизма нет, этот кейс подтвердить unit/integration-тестом адаптера и не изменять production-конфигурацию.



## **4. Сначала установить точную причину разных**

`order_id`

До любых миграций:

```txt
- восстановить полный второй UUID;
- показать оба сырых HTTP-ответа;
- показать обе строки orders_v2;
- показать нормализованные identity fields;
- показать provider_events;
- определить: опечатка отчета или реальный баг.
```

Не выполнять новую миграцию RPC «на всякий случай».

Если это опечатка — исправить отчет и повторить proof.  
Если баг подтвержден — только тогда patch RPC.



## **5. Не добавлять неоднозначное поле**

`resolved_from_order_id`

Для reused-response достаточно:

```json
{
  "order_id": "...",
  "payment_url": "...",
  "reused": true
}
```

В `provider_events` допустимо:

```txt
reused=true
resolved_order_id=<тот же order_id>
```

Но нельзя создавать впечатление, что запрос сначала создал один заказ, а затем был «перенаправлен» на другой.

Кроме того, reuse-запрос не должен создавать второй комплект:

```txt
create_order_requested
create_order_succeeded
```

Для него лучше отдельное техническое событие:

```txt
create_order_reused
```

либо вообще только структурированный audit-log.

## **6. Concurrency DoD уточнить**

Для пяти параллельных запросов ожидается:

```txt
- delta orders_v2 = 1;
- вызов rrCreateOrder = 1;
- create_order_requested = 1;
- create_order_succeeded = 1;
- все 5 ответов содержат один order_id;
- все 5 ответов содержат один payment_url;
- ровно один ответ reused=false;
- четыре ответа reused=true.
```

Proof «один вызов РР» должен основываться не только на `console.log`, а на устойчивом техническом событии или correlation proof без PII.

## **7. Не выполнять широкое удаление rate-limit buckets**

Запрещено:

```sql
DELETE FROM rr_public_rate_limits
WHERE bucket_key LIKE 'rr_initiate:%';
```

Это удалит реальные rate-limit buckets пользователей.

Для тестов использовать уникальный marker/hash и удалять только конкретные тестовые ключи:

```sql
DELETE FROM rr_public_rate_limits
WHERE bucket_key = ANY(:exact_test_bucket_keys);
```

Либо дождаться естественного истечения окна.

## **8. Negative proof не должен менять рабочие офферы**

Исправить сценарии:

```txt
rr_runtime_disabled:
использовать один из двух legacy bank_installment-офферов без runtime.

missing offer:
случайный UUID.

inactive offer:
использовать заранее созданный test fixture в preview/dev,
не переключать is_active рабочего оффера.

foreign provider order:
использовать изолированную test fixture,
не посылать webhook на реальный bePaid-order.
```

## **9. Исправить формулировку по legacy-тарифам**

Не:

```txt
два других оффера «Бухгалтера»
```

А:

```txt
bank_installment-офферы двух остальных тарифов продукта:
- «Главный бухгалтер»;
- «Бизнес-леди».
```

## **10. Public E2E проводить через фактический iframe/postMessage flow**

На `gorbova.by/cb` кнопки находятся в sandbox iframe. Proof должен учитывать реальную цепочку:

```txt
iframe action
→ postMessage lovable:site-action
→ SitePageBySlug
→ LeadRequestDialog
→ startBankInstallment
→ public-rr-installment-initiate
→ redirect pay.rrllc.ru
```

Для наблюдения сети использовать:

```txt
page.on('request')
page.on('response')
page.on('popup')
```

`page.route()` не нужен, если запрос нельзя модифицировать или блокировать.

## **11. Защитить живой proof от повторной заявки**

Для production happy path использовать отдельный явно тестовый контакт и один проход.

После теста:

- не удалять order без отдельного разрешения;
- отметить его в `meta` как runtime proof, если такой add-only marker предусмотрен;
- не переводить заявку в финальный статус;
- не нажимать кнопки авторизации РР;
- сохранить `order_id` в отчете для дальнейшего Sprint C или контролируемой очистки.

Нельзя массово удалять `orders_v2` или `provider_events`.

## **12. Snapshot side effects уточнить**

Проверять отсутствие новых строк, связанных именно с тестовыми RR-order IDs, а не требовать абсолютной неизменности живых таблиц.

```txt
payments_v2 по test order IDs = 0
entitlements по test order IDs = 0
access_grant_ledger по test order IDs = 0
domain_events по test order IDs = 0
CRM success activity по test order IDs = 0
```

Для `telegram_access_grants`, если нет `order_id`, нужен proof отсутствия вызова writer-функции плюс snapshot по пользователю/контакту теста.

Название `crm_activity_log` использовать только после подтверждения, что такая таблица реально существует. Иначе указать фактический SoT CRM-аудита из discovery.

## **13. Уточнить expected response для honeypot**

Возврат `HTTP 200` допустим как антибот-маскировка, но DoD должен требовать:

```txt
- order не создан;
- provider_event не создан;
- РР не вызван;
- response не раскрывает причину блокировки.
```

## **14. Итоговый порядок**

```txt
1. Разобрать расхождение order_id.
2. Исправить только подтвержденный баг.
3. Sequential reuse proof.
4. Concurrency и rate-limit в preview/dev на test fixture.
5. Negative tests в preview/dev.
6. Один public happy path на gorbova.by/cb.
7. Проверить legacy flow «Главного бухгалтера» и «Бизнес-леди».
8. Снять scoped no-side-effects proof.
9. Сформировать итоговый отчет.
```

После этих правок план можно выполнять. Sprint C не начинать, пока не доказаны одинаковый `order_id` при reuse, один вызов РР при concurrency и полный публичный путь через `gorbova.by/cb`.

&nbsp;

План: Закрытие Sprint B — устранение блокера идемпотентности и полный runtime E2E proof

### 0. Diagnose (блокер идемпотентности)

Первым делом — SQL-разбор двух order_id из предыдущего отчета:

```sql
SELECT id, user_id, provider, status,
       meta->'rr'->>'payment_url'    AS payment_url,
       meta->'rr'->>'initiation_status' AS init_status,
       meta->>'flow'                 AS flow,
       (meta->'contact'->>'email_norm') AS email_norm,
       (meta->'contact'->>'phone_norm') AS phone_norm,
       tariff_offer_id, amount, currency, created_at
FROM public.orders_v2
WHERE id IN ('b4761274-246b-4b3f-9679-c2c05732494e',
             '1aa66c5e-...') -- восстановить полный UUID
ORDER BY created_at;

SELECT id, related_order_id, provider, event_type, processing_status,
       payload->'reused' AS reused_flag, created_at
FROM public.provider_events
WHERE related_order_id IN (...)
ORDER BY created_at;
```

Возможные причины и фиксы:

- **A. Ошибка в отчете (опечатка UUID)** — задокументировать, приложить сырые ответы.
- **B. Баг возврата `order_id**` в `rr_get_or_create_pending_order`: RPC возвращает id вставленной строки при race до advisory lock, а не строки, выигравшей lock. Фикс — внутри SECURITY DEFINER функции:
  1. `pg_advisory_xact_lock(hashtext(bucket_key))` первым шагом;
  2. под локом делать `SELECT ... FOR UPDATE` по `(offer_id, email_norm/phone_norm, status='pending', provider='rr', created_at >= now()-interval '30 min', meta->'rr'->>'payment_url' IS NOT NULL)`;
  3. если найден — вернуть его id + `reused=true`;
  4. только затем `INSERT` и возврат нового id + `reused=false`.
- **C. Несогласованность ключа reuse** (адрес/телефон нормализованы по-разному между reuse-lookup и insert) — унифицировать нормализацию до вызова RPC.

DoD: два одинаковых submit возвращают идентичные `order_id` и `payment_url`; в БД ровно одна строка `orders_v2` за окно.

### 1. Backend patch (при подтвержденном баге)

- Поправить `rr_get_or_create_pending_order` (миграция) — детерминированный порядок: lock → select-for-update → insert.
- В `public-rr-installment-initiate/index.ts` — единая нормализация email/phone до RPC; в ответе всегда `{ order_id, payment_url, reused }` из значения RPC, без пересборки.
- Добавить в `provider_events.payload` явное поле `reused: boolean` и `resolved_from_order_id` для аудита.

### 2. Runtime proof скрипты (Playwright + Deno) — вся серия

Скрипты кладу под `/tmp/browser/sprint_b/` + JSON-отчеты в `docs/audit/2026-07-10-sprint-b-runtime-proof/`.

**2.1 Идемпотентность (single client, sequential)**
Два подряд submit одинаковой формы → сравнить `order_id`, `payment_url`, `reused`; SQL: `count(*) FROM orders_v2 WHERE ...` = 1.

**2.2 Concurrency (parallel)**
`Promise.all` из 5 одинаковых invoke → ровно 1 новая строка `orders_v2`, ровно 1 `create_order_requested` c `succeeded` в `provider_events`, все 5 ответов с идентичным `order_id`/`payment_url`, один `created` + четыре `reused`. Проверить, что в РР ушел ровно один `createOrder` (по логам edge-функции: `rr_adapter_call` event).

**2.3 Rate-limit (durable)**
6 запросов с разными контактами (чтобы обойти reuse) с одного IP за <60с → 6-й ответ HTTP 429, `count(orders_v2 delta)=5`, `count(provider_events где event=create_order_requested delta)=5`, `rr_public_rate_limits.hits >= 6`.

**2.4 Public E2E на [https://gorbova.by/cb](https://gorbova.by/cb)**
Playwright:

- открыть страницу, дождаться карточек;
- клик по тарифу «Ценный бухгалтер | 1 ступень 2.0» (offer `15ce91ec-...`) → LeadRequestDialog → заполнить → submit;
- перехватить network: должен уйти `POST .../functions/v1/public-rr-installment-initiate`, ответ содержит `payment_url` с `pay.rrllc.ru`;
- убедиться в редиректе (или открытии) на `pay.rrllc.ru`, скриншот;
- вернуться, повторить для двух других офферов «Бухгалтера» — не должно быть вызова `public-rr-installment-initiate`, должен открыться legacy `external_link`.

**2.5 Negative runtime**
Через `supabase--curl_edge_functions` последовательные кейсы, каждый со снапшотом ответа + SQL:

- `rr_runtime_disabled` — временно снять флаг на тестовом оффере (или использовать другой bank_installment без флага) → 4xx, no order;
- inactive offer (`is_active=false`) → 4xx, no order;
- missing offer (случайный UUID) → 4xx;
- honeypot заполнен → 200/фейковый, но `no order`, `no provider_event succeeded`;
- createOrder failure — временно подменить `RR_API_BASE` на невалидный endpoint через отдельный тест-инстанс ИЛИ mock: order пишется с `meta.rr.initiation_status='failed'`, повторный submit не переиспользует;
- webhook: bad signature → 401 + `webhook_bad_signature` без `related_order_id`; duplicate → 200 `{duplicate:true}`; unknown external_id → 200 `{ignored:...}`; foreign provider order (`provider='bepaid'`) → 200 `{ignored:'not_rr_flow'}`;
- CORS preflight `OPTIONS` → 204 c `Access-Control-Allow-*`.

**2.6 Snapshot до/после (side-effects proof)**
Обертка вокруг всех тестов:

```sql
-- snapshot before
SELECT count(*) FROM payments_v2;
SELECT count(*) FROM entitlements;
SELECT count(*) FROM access_grant_ledger;
SELECT count(*) FROM telegram_access_grants;
SELECT count(*) FROM domain_events WHERE event_type LIKE 'order.%';
SELECT count(*) FROM crm_activity_log WHERE created_at >= :t0;
-- run all runtime tests
-- snapshot after → diff должен быть ровно 0 по всем 6 счетчикам
```

Отдельно — grep-proof по коду: `rg -n "telegram_access_grants|grant-access-for-order|payments_v2.*insert" supabase/functions/public-rr-installment-initiate supabase/functions/rr-webhook` → пусто.

### 3. Итоговый отчет

`docs/audit/2026-07-10-sprint-b-runtime-proof/REPORT.md` с разделами 2.1–2.6, для каждого:

- команда/скрипт,
- сырой ответ (HTTP + JSON),
- SQL before/after,
- вердикт PASS/FAIL,
- ссылки на скриншоты (для 2.4).

Заголовок: «Отчет о выполненной работе: Sprint B — public flow installment-initiate для РР без проведения платежа и выдачи доступов».

### DoD Sprint B

- Блокер order_id объяснен (опечатка) ИЛИ исправлен миграцией + повторный тест PASS.
- 2.1 идемпотентность PASS с идентичными order_id/payment_url.
- 2.2 concurrency PASS: 1 order, 1 createOrder, N-1 reused.
- 2.3 rate-limit PASS: 429 на 6-м.
- 2.4 public E2E PASS на gorbova.by/cb + два legacy оффера PASS.
- 2.5 все негативные кейсы PASS.
- 2.6 diff по 6 таблицам = 0.
- Sprint C не начат.

### Технические детали

- Все runtime-тесты используют реальный edge endpoint `public-rr-installment-initiate` через `supabase.functions.invoke` или прямой `POST` c anon key; auth не требуется (`verify_jwt=false`).
- Для concurrency используем один HTTP-клиент с `Promise.all`, чтобы обойти клиентский дедуп.
- Rate-limit тестируется с разными контактами, но одним IP; для восстановления — `DELETE FROM rr_public_rate_limits WHERE bucket_key LIKE 'rr_initiate:%'` после теста.
- Для createOrder failure — если нет sandbox-режима у РР, использовать env-переменную `RR_API_BASE_OVERRIDE` на несуществующий хост в отдельном dev-деплое функции; production не трогаем.
- Playwright скрипт для 2.4 использует `page.route('**/public-rr-installment-initiate', ...)` только для наблюдения (без перехвата ответа), чтобы гарантированно поймать call.