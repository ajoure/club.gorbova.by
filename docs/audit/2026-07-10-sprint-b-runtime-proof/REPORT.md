# Отчет о выполненной работе: Sprint B — public flow installment-initiate для РР без проведения платежа и выдачи доступов

Дата: 2026-07-10
Ответственный: инженер (Lovable)
Оффер runtime: `15ce91ec-5dc1-4abf-9fab-9c97dc1e6b74` (тариф «Бухгалтер», продукт «Ценный бухгалтер | 1 ступень 2.0», 1650 BYN, mode=test)

---

## 0. Разбор блокера: несовпадение `order_id` в предыдущем «reused=true»

Проверка обоих заявленных UUID:

```sql
SELECT id FROM public.orders_v2
WHERE id IN ('b4761274-246b-4b3f-9679-c2c05732494e',
             '1aa66c5e-64ea-48b8-bfb4-64b7f4e4cf27');
-- (0 rows)
```

Обе строки **отсутствуют** в `orders_v2`. В `provider_events` сохранились следы только по `b4761274-...` (пара `create_order_requested` + `create_order_succeeded` от 08:23:24) и один осиротевший `webhook_notification_received` для `1aa66c5e-...` от 08:22:15 (до момента создания настоящего заказа).

**Вывод:** forensically восстановить прошлый «proof» нельзя — записи были удалены между прошлой сессией и текущей. Кода RPC на момент прошлого отчёта тоже был некорректен (см. §2 ниже). Считаем прошлый отчёт «reused=true» ошибочным.

Итог блокера: **устранён отдельно и заново доказан ниже в §1**.

---

## 1. Sequential reuse — PASS

Контакт: `sprint-b-proof+seq@lovable.dev`, `+375291110001`, IP `203.0.113.10`.

| # | HTTP | order_id | payment_url | reused |
|---|------|----------|-------------|--------|
| 1 | 200  | `008196f7-4e6b-421d-8bf2-f15177efd200` | `https://pay.rrllc.ru/pay/45bec60161e70dc392479ce5ddb0d5b3` | false |
| 2 | 200  | `008196f7-4e6b-421d-8bf2-f15177efd200` | `https://pay.rrllc.ru/pay/45bec60161e70dc392479ce5ddb0d5b3` | **true** |

`order_id` и `payment_url` **идентичны**. В `orders_v2` строго 1 строка для этого контакта.

Сырьё: `docs/audit/2026-07-10-sprint-b-runtime-proof/2_1_sequential/{req1,req2}.json`.

---

## 2. Concurrency — БАГ найден и исправлен, ре-тест PASS

### 2a. Первый прогон (до фикса) — FAIL

Контакт: `sprint-b-proof+conc@lovable.dev`, `+375291110002`. 5 параллельных `POST` в одном сеансе.

Все 5 ответов вернули `reused=false` с **пятью разными** `order_id` и `payment_url`. В БД — 5 строк `orders_v2`.

**Причина:** в `rr_get_or_create_pending_order` условие reuse требовало `meta.rr.initiation_status = 'created'`. Этот статус выставляется edge-функцией **после** HTTP-вызова РР и `UPDATE orders_v2` — вне advisory-lock. Пять параллельных RPC внутри лока последовательно не находили reuse-кандидата (все предыдущие ещё имели `initiation_status='pending'`) и INSERT-или каждый свою строку.

### 2b. Фикс (миграция `20260710085555_...sql`)

`rr_get_or_create_pending_order` теперь принимает reuse для двух состояний:

1. `initiation_status='created'` + непустой `payment_url` (готовые заказы, до 30 мин).
2. `initiation_status='pending'` **и `created_at >= now() - interval '120 seconds'`** (in-flight заказы, чтобы устранить дубликаты при параллельных запросах).

Priority: сначала готовые, затем свежие pending. Edge-функция при `wasReused=true` без готового `payment_url` — polling до 15 сек (шаг 400 мс) с ранним выходом при `initiation_status='failed'` → `502 rr_create_order_failed_upstream`, либо `504 rr_reuse_wait_timeout` при истечении.

### 2c. Ре-тест после фикса — PASS

Контакт: `sprint-b-proof+conc2@lovable.dev`, `+375291110003`. 5 параллельных `POST`.

| # | HTTP | order_id | payment_url | reused |
|---|------|----------|-------------|--------|
| 1 | 200 | `64a4bb54-6e0b-4eda-a96a-9ad5b9e9d075` | `https://pay.rrllc.ru/pay/b0858fe4283f22877fb27e39a9dcb627` | false |
| 2 | 200 | `64a4bb54-...` | `…b0858fe4…` | **true** |
| 3 | 200 | `64a4bb54-...` | `…b0858fe4…` | **true** |
| 4 | 200 | `64a4bb54-...` | `…b0858fe4…` | **true** |
| 5 | 200 | `64a4bb54-...` | `…b0858fe4…` | **true** |

В БД:
- `orders_v2` для контакта: **1 строка**.
- `provider_events` по этому `related_order_id`: ровно `create_order_requested`×1 + `create_order_succeeded`×1 → **1 вызов РР** (correlation через related_order_id).

Сырьё: `2_2_concurrency_retest/req_1..5.json`.

---

## 3. Rate-limit — PASS

Контакт: `sprint-b-proof+rl@lovable.dev`, `+375291110004`, IP `203.0.113.13`. 6 последовательных `POST` в течение секунд.

| # | HTTP | body |
|---|------|------|
| 1 | 200 | `{order_id:"e840d765-…", reused:false}` |
| 2 | 200 | same order_id, `reused:true` |
| 3 | 200 | same, `reused:true` |
| 4 | 200 | same, `reused:true` |
| 5 | 200 | same, `reused:true` |
| 6 | **429** | `{"error":"rate_limited:contact"}` |

DB для контакта: 1 order, 1 `create_order_requested`, 1 `create_order_succeeded`. Rate-limit сработал на бакете `contact` (5 запросов/60 сек), новый order/provider_event/RR-call на 6-м **не создан**.

Сырьё: `2_3_ratelimit/req_1..6.json`.

---

## 4. Public E2E на живом сайте — **GAP выявлен**

Playwright прогон против `https://cb.gorbova.by` (Lovable-хостинг продукта `7101ed3c-...`):

- Ландинг открылся, показал секцию «Выберите тариф» с тремя карточками:
  - «Бухгалтер» — 1490 BYN (не 1650!), кнопка «Оплатить 1490 BYN» + «Рассрочка от 136 BYN/мес».
  - «Главный бухгалтер» — 2490 BYN.
  - «Бизнес-леди» — 2490 BYN.
- Клик по «Рассрочка от 136 BYN/мес» открывает диалог **«Предзапись на курс»** с требованием логина, **а не** `LeadRequestDialog` с формой имя/телефон/email.
- Ни одного POST в `public-rr-installment-initiate` за весь прогон **не зафиксировано**.

Причины GAP (архитектурные, не связанные с backend Sprint B):

1. **Ценовое расхождение.** В БД оффер «Бухгалтер» имеет `amount=1650`, а ландинг показывает 1490/1690. Значит фронтенд рендерит либо кэш, либо контент из site_pages blocks с зашитыми ценами, либо использует другой источник данных, отличный от `tariff_offers` этого продукта.
2. **Preregistration overlay.** Клик по любому тарифу открывает preregistration-диалог с требованием логина — публичный `LeadRequestDialog` + `startBankInstallment` в текущий UI **не подключены**.

**Проверка legacy-путей «Главный бухгалтер» и «Бизнес-леди»:** обе карточки на живом сайте ведут в тот же preregistration-диалог, поэтому legacy `external_link`-путь через `LeadRequestDialog` также не активен. Backend legacy-путь (edge не вызывается, `rr_runtime` отсутствует) при этом остаётся корректным — доказано отрицательным тестом §5.a.

**Вывод:** backend Sprint B готов, но подключение public UI требует отдельного шага (Sprint B UI-wiring) — публикация билда с текущим `UniversalPricingSection` + `LeadRequestDialog` на домен `cb.gorbova.by`, либо перенастройка соответствующей site_page. Это следует зафиксировать как отдельную задачу перед закрытием Sprint B полностью.

Скриншоты: `2_4_public_e2e/{01_tariffs.png, 02_before_click.png, 03_after_click.png}`.

---

## 5. Runtime negative proof — PASS

Все прогоны через `curl` на боевом endpoint. Сырьё в `2_5_negative/` и `2_5_webhook/`.

### 5.a `rr_runtime_disabled`
Оффер «Бизнес-леди» `4f64def7-...` (bank_installment, без `rr_runtime` в meta).
→ `HTTP 403 {"error":"rr_runtime_disabled"}`. Order **не создан**.

### 5.b `offer_not_found`
`00000000-0000-0000-0000-000000000000`.
→ `HTTP 404 {"error":"offer_not_found"}`. Order не создан.

### 5.c Honeypot
`{"website":"https://spammer.example", ...}`.
→ `HTTP 200 {"success":true,"skipped":"honeypot"}` (маскировка). Order не создан, provider_event не создан, RR не вызван.

### 5.d `email_invalid`
`{"email":"not-an-email", ...}`.
→ `HTTP 400 {"error":"email_invalid"}`.

### 5.e CORS preflight
`OPTIONS` c `Origin: https://gorbova.by` → `HTTP 200`, заголовки `access-control-allow-origin: *`, `-methods: GET, POST, OPTIONS`, `-headers: authorization, apikey, content-type, …`.

### 5.f Method not allowed
`GET` → `HTTP 405 {"error":"method_not_allowed"}`.

### 5.g Webhook: bad signature
POST с `sign="deadbeef_wrong"` → `HTTP 401 {"error":"invalid_signature"}`.
В `provider_events`: строка `webhook_bad_signature` со `processing_status='rejected'`, **`related_order_id = NULL`** (не связывается с несуществующим заказом).

### 5.h Webhook: unknown external_id + non-UUID
POST c произвольным UUID и non-UUID: подпись невалидна → `HTTP 401` до попадания в lookup. Отсутствие обращений к `orders_v2` доказано порядком проверок в коде (`§76-103 rr-webhook/index.ts`): verify signature FIRST.

### 5.i Webhook: method not allowed
`GET rr-webhook` → `HTTP 405 {"error":"method_not_allowed"}`.

---

## 6. No side effects — scoped snapshot

Test-order IDs:
```
008196f7-4e6b-421d-8bf2-f15177efd200 (sequential)
b55cd922, 02cef40c, f79099f0, d8c69937, b64d1230 (concurrency #1, до фикса)
64a4bb54-6e0b-4eda-a96a-9ad5b9e9d075 (concurrency #2, после фикса)
e840d765-0aa9-4d06-b4b3-06aa1c192196 (rate-limit)
```

| Метрика | Значение |
|---|---|
| `payments_v2` по test order IDs | **0** |
| `access_grant_ledger` по test order IDs | **0** |
| `domain_events (event_type LIKE 'order.%')` по test order IDs | **0** |
| `entitlements` для test emails | **0** |
| `telegram_access_grants` для test emails | **0** |

Сравнение общих счётчиков BEFORE/AFTER:

| Таблица | BEFORE | AFTER | Дельта | Комментарий |
|---|--:|--:|--:|---|
| `orders_v2` provider='rr' | 0 | 8 | +8 | наши test-заказы |
| `provider_events` provider='rr' | 5 | 24 | +19 | 1 seq + 5 conc#1 + 1 conc#2 + 1 rl = 8 orders × (created_req+succeeded=2)=16, +3 webhook_bad_signature. Всего 16+3=19. |
| `payments_v2` | 6276 | 6276 | 0 | RR flow не пишет |
| `entitlements` | 993 | 990 | −3 | посторонние процессы; test-заказы не участвуют |
| `access_grant_ledger` | 273736 | 273820 | +84 | посторонние процессы; scoped-фильтр по test order IDs = 0 |
| `telegram_access_grants` | 2089 | 2089 | 0 |  |
| `domain_events (order.%)` | 0 | 0 | 0 |  |

**Дельта по test-orders — строго 0** во всех бизнес-таблицах. Изменения в общих счётчиках — фоновая активность других flow.

### Grep-proof

```
$ rg -n "grant-access-for-order|payments_v2.*insert|telegram_access_grants.*insert|access_grant_ledger.*insert" \
    supabase/functions/public-rr-installment-initiate supabase/functions/rr-webhook
```
Совпадения — только в **комментариях-заголовках** («НЕ вызывает grant-access-for-order»). Ни одного реального вызова writer-функций.

---

## 7. DoD и статус спринта

| Пункт | Статус |
|---|---|
| Блокер order_id — объяснён (недоступные данные) + устранён кодом | ✅ |
| 2.1 Sequential idempotence, тот же order_id + payment_url | ✅ |
| 2.2 Concurrency: 1 order, 1 RR call, 4 reused | ✅ (после hotfix) |
| 2.3 Rate-limit: 6-й → HTTP 429 | ✅ |
| 2.4 Public E2E на живом сайте | ❌ **GAP** — UI не подключён |
| 2.5 Negative runtime proofs (7 сценариев) | ✅ |
| 2.6 No side effects по test order IDs | ✅ |
| Sprint C не начат | ✅ |

### Что осталось для полного закрытия Sprint B

1. **UI-wiring на `cb.gorbova.by`**: заменить preregistration overlay на `UniversalPricingSection` + `LeadRequestDialog` (или добавить bank_installment CTA в текущий блок) и опубликовать. После этого — повторный Playwright happy path и проверка legacy для «Главный бухгалтер»/«Бизнес-леди».
2. **createOrder failure runtime-proof**: сейчас доказан только кодом (`meta.rr.initiation_status='failed'`, не reusable). Runtime-инъекция ошибки требует изолированного preview-деплоя с override `RR_API_BASE` — вне scope этого прогона, чтобы не трогать production secrets.
3. **Cleanup pre-fix concurrency orders** (5 «grazing»-строк от прогона до фикса `sprint-b-proof+conc@lovable.dev`): оставлены как evidence, не удалены без разрешения (см. §11 согласованного плана).

---

## 8. Инвентарь изменений

- **Миграция**: `supabase/migrations/20260710085555_*` — правит `rr_get_or_create_pending_order` (reuse принимает in-flight pending, ORDER BY предпочитает готовые).
- **Edge**: `supabase/functions/public-rr-installment-initiate/index.ts` — при `wasReused=true` без готового `payment_url` polling до 15 сек, ранние выходы `504 rr_reuse_wait_timeout` / `502 rr_create_order_failed_upstream`.
- Другие функции и данные не менялись.

---

## 9. Отступления от согласованного плана

- **Единая среда (production offer).** Полное разделение сред не выполнено — тесты идут по production RR-офферу `15ce91ec-...` с mode=test у РР. Причина: инсерт в `products_v2` заблокирован RLS, а создание полного test-fixture-стека требует отдельной миграции продукта/тарифа. Влияние минимизировано: каждый прогон использует изолированный контакт → 1 order на прогон; общий production-impact — 8 pending заказов на 1 оффере (все mode=test, никаких платежей).
- **Force-error runtime proof (createOrder failure) не выполнен runtime-путём** — см. §7.2.
- **Public E2E** — см. §4.

Приложения: `2_1_sequential/`, `2_2_concurrency/`, `2_2_concurrency_retest/`, `2_3_ratelimit/`, `2_4_public_e2e/`, `2_5_negative/`, `2_5_webhook/`, `snap_before.txt`, `snap_after.txt` в `/tmp/browser/sprint_b/proof/` (артефакты прогона).
