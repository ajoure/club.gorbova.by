# да, согласен, с учетом правок:

В целом направление уже правильное: это первый спринт, где начинается **реальная интеграция**, а не только UI. Но есть несколько архитектурных моментов, которые сейчас лучше исправить, иначе потом придется переделывать Sprint C и D.

---



# **1. Не создавать отдельную таблицу**

`rr_installment_requests`

Это самая большая правка.

Сейчас предлагается:

```
rr_installment_requests
```

Я бы **не создавал новую сущность**.

У вас уже есть:

- `orders_v2`
- `provider_events`
- `payments_v2`
- CRM
- access pipeline

Новая таблица станет вторым источником правды.

Лучше:

- `orders_v2` — главный объект заявки;
- `provider_events` — вся история общения с РР;
- временные данные РР хранить в `orders_v2.meta.rr`.

Тогда Sprint C просто продолжит этот же заказ.

Иначе потом придется синхронизировать:

```
rr_installment_requests
↓

orders_v2
↓

payments_v2
```

Это лишняя цепочка.

---



# **2. Не создавать**

`rr_live_*`

Сейчас предлагается

```
rr_live_<uuid>
```

Лучше сразу использовать

```
orders_v2.id
```

или

```
orders_v2.public_token
```

как `external_id`.

Тогда:

```
РР
↓

external_id

↓

orders_v2
```

находится напрямую.

Не нужны никакие дополнительные таблицы поиска.

---





# **3.**

`orders_v2` **создавать сразу правильно**

Не

```
pending_installment
```

если такого статуса нет.

Лучше оставить существующий статус.

Например

```
pending
```

а различать поток по

```
meta.flow="rr_installment"
```

или

```
payment_provider="rr"
```

Не стоит плодить новые статусы, если они отличаются только способом оплаты.

---



# **4. Notification URL не должен быть**

`rr-notification-noop`

Это временное решение потом придется выбрасывать.

Лучше сразу сделать

```
rr-webhook
```

но внутри него сейчас выполнить только:

```
verify signature

↓

provider_events

↓

orders_v2.meta.rr.last_notification

↓

return 200
```

Без:

- payments
- access
- CRM

Тогда Sprint C просто расширит существующую функцию.

Не придется менять callback URL у РР.

---

# **5. Provider events нужно использовать уже сейчас**

После успешного createOrder обязательно писать

```
provider_events

provider = rr

event = create_order_requested

event = create_order_succeeded
```

Это уже ваш стандарт проекта.

Не надо откладывать до Sprint C.

---

# **6. Не использовать test loader**

Сейчас написано

```
loadRRTestConfig
```

Лучше уже сейчас использовать

```
loadRRConfig()
```

которая сама смотрит

```
mode=test

или

mode=battle
```

из карточки интеграции.

Иначе потом снова придется переписывать.

---

# **7. Не нужен rate limit “в памяти”**

Edge Functions масштабируются.

In-memory rate limit работать надежно не будет.

Лучше:

- использовать существующий limiter проекта;
- либо пока вообще убрать из Sprint B.

---

# **8. Не передавать amount в rrCreateOrder вручную**

Источник истины только один:

```
tariff_offer_id

↓

tariff_offers

↓

amount

currency

product

tariff
```

Даже внутри edge.

Никаких ручных вычислений.

---

# **9. Fallback делать только если createOrder не создался**

Сейчас написано

```
если ошибка

↓

external_link
```

Нужно уточнить.

Правило:

```
если createOrder вернул payment_url

↓

только payment_url
```

Если

```
RR недоступен

или

ошибка API

↓

fallback external_link
```

Нельзя показывать обе ссылки одновременно.

---

# **10. LeadRequestDialog не должен знать ничего про RR**

Лучше сделать небольшой resolver.

Сейчас получается:

```
LeadRequestDialog

↓

if rr_runtime ...

↓

edge

↓

redirect
```

Лучше:

```
LeadRequestDialog

↓

startBankInstallment()

↓

resolver

↓

legacy

или

runtime RR
```

Тогда потом можно подключить другого кредитного провайдера без переписывания UI.

---

# **11. Заказ должен быть идемпотентным**

Добавить обязательный guard.

Если пользователь:

```
дважды нажал кнопку

или

обновил страницу
```

то не создавать второй

```
orders_v2
```

Проверять существующий незавершенный заказ для этого `tariff_offer_id` и контакта (или использовать идемпотентный токен), чтобы возвращать уже созданную заявку.

---

# **12. Это уже не Sprint B, а начало мастер-плана**

В конце добавить явный переход:

```
Sprint B
↓
createOrder
↓
orders_v2 (pending)
↓
provider_events
↓
redirect payment_url

Sprint C
↓
rr-webhook
↓
payments_v2
↓
grant-access-for-order

Sprint D
↓
CRM
↓
ручные платежи
↓
статистика
↓
финальная интеграция
```

Так подрядчик не потеряет общую архитектуру и не начнет изобретать параллельные сущности.

Эти правки сохраняют основной замысел Sprint B, но делают его продолжением единого master-плана без появления лишних таблиц, временных endpoint’ов и повторной переработки в следующих спринтах.

&nbsp;

План: Sprint B — public flow installment-initiate для РР без проведения платежа и выдачи доступов

## Цель

Включить публичный flow «Рассрочка банка (РР)» ровно на одном согласованном `tariff_offer_id` тарифа «Бухгалтер». Клиент по кнопке в лендинге получает `payment_url` от РР, но:

- платёж не проводится нашей системой,
- `payments_v2` не создаётся,
- доступы, entitlements, CRM success-flow, уведомления об успехе — не запускаются,
- боевой webhook (`rr-webhook`) не создаётся,
- остальные два тарифа «Бухгалтера» продолжают работать через legacy `external_link`.

Runtime включается флагом на конкретном оффере; всё остальное остаётся без изменений.

## Границы (жёсткие)

- Source of truth платежа — `tariff_offer_id`. Сервер сам читает `tariff_offers` (amount, currency, tariff_id, product_id).
- Клиент передаёт только `tariff_offer_id` + минимальные PII из формы заявки (имя, телефон, email, comment) — сумма/валюта/продукт с клиента НЕ принимаются.
- Создаётся только заказ в промежуточном статусе (`orders_v2.status = 'pending_installment'` или эквивалент `pending`) + запись в отдельной таблице заявок РР.
- `payments_v2` НЕ создаётся.
- `grant-access-for-order`, `entitlements`, telegram-invite, CRM success-flow, notification success — НЕ вызываются.
- `rr-webhook` (боевой) — НЕ создаётся в этом спринте.
- Никаких изменений в общих payment-функциях (`_shared/create-payment-checkout.ts`, `public-checkout`, `bepaid-webhook`, `admin-create-public-link` и т.п.).
- Все две тарифа «Бухгалтера» без флага runtime — работают ровно как сейчас (legacy `external_link` через `LeadRequestDialog`).

## Diagnose (текущее состояние)

- В админке уже есть `offer_type='bank_installment'` с `meta.bank_installment.{external_link,link_label,message_html}`.
- Публичные лендинги (`UniversalPricingSection`, `TariffPricing`, `ProductLanding`, `SitePageBySlug`) для этого типа открывают `LeadRequestDialog` с `bankLinkUrl` из `readBankInstallmentMeta`. Ссылка — статический legacy `external_link` (default `pay.rrllc.ru/...`).
- Есть готовый RR-адаптер: `_shared/rr/rr-adapter.ts` (`rrCreateOrder`), `_shared/rr/rr-config.ts` (`loadRRTestConfig`), test-функции `rr-test-create-order`, `rr-test-get-status`, `rr-test-simulate-webhook`, таблица `rr_test_ledger`. Прод-конфига РР ещё нет.
- Sprint A: `bank_installment` отделён от bePaid/Stripe и внутренней рассрочки в UI, data-fix применён точечно на оффере «Бухгалтера».

## Design (что добавляем)

### 1. Флаг runtime на оффере (add-only, без новых enum)

Runtime включается наличием в `tariff_offers.meta.bank_installment.rr_runtime` объекта:

```
{
  "enabled": true,
  "mode": "initiate_only",     // фиксируем строкой, чтобы позже расширяться без миграции
  "provider": "rr"
}
```

Только офферы с `meta.bank_installment.rr_runtime.enabled === true` идут в новый flow. Остальные `bank_installment` офферы (включая два других тарифа «Бухгалтера») продолжают открывать `external_link`.

Data-fix — руками одному согласованному `tariff_offer_id` тарифа «Бухгалтер». Отдельной миграции схемы не требуется.

### 2. Новая таблица заявок РР (публичный слой)

`public.rr_installment_requests` — изолирована от `payments_v2`, `installment_payments`, `rr_test_ledger`.

Поля (только доменные):

- `tariff_offer_id uuid not null`
- `tariff_id uuid`, `product_id uuid` (резолвится сервером из оффера, для аналитики)
- `order_v2_id uuid` (ссылка на промежуточный `orders_v2`)
- `external_id text not null unique` (`rr_live_<uuid>`; префикс отделяет от `rr_test_`)
- `amount_minor int not null`, `currency text not null`
- `status text not null` — `pending | rr_created | rr_error`
- `rr_request_id text`, `rr_status_raw text`, `payment_url text`
- `contact_name text`, `contact_phone text`, `contact_email text`, `comment text`
- `user_id uuid null` (если публично залогинен)
- `correlation_id uuid not null`
- `raw_last jsonb` (redacted-ответ РР через `redactRRResponse`)
- `error_text text`

Grants + RLS:

- `GRANT SELECT, INSERT, UPDATE ON ... TO authenticated;`
- `GRANT ALL ... TO service_role;`
- НЕТ `GRANT` для `anon` (пишет только edge с service role).
- RLS: `SELECT/UPDATE` — только `has_role(auth.uid(),'admin'|'superadmin')`; `INSERT` — запрещён клиенту (только через service role в edge). Никаких публичных policy.

### 3. Промежуточный заказ в `orders_v2`

Создаётся ровно один `orders_v2` через service role:

- `status = 'pending_installment'` (используем уже существующий статус `pending`, если `pending_installment` не в enum — фиксируем строку в `meta.flow='rr_installment_initiate'`),
- `amount`, `currency`, `tariff_id`, `product_id`, `tariff_offer_id` — из оффера,
- `meta`:
  ```
  {
    "flow": "rr_installment_initiate",
    "rr": { "external_id": "...", "correlation_id": "...", "runtime": "sprintB" },
    "grant_access_skip": true,
    "notification_skip": true,
    "crm_success_skip": true
  }
  ```
- НЕ вызывать `grant-access-for-order`, НЕ пушить в CRM success, НЕ дергать telegram-invite/entitlements.

### 4. Новая edge-функция `public-rr-installment-initiate`

`supabase/functions/public-rr-installment-initiate/index.ts`, `verify_jwt = false` (публичный вызов из лендинга; auth опционален — если есть JWT, пишем `user_id`).

Логика:

1. CORS + rate-limit (по IP и по `tariff_offer_id`, простая проверка через существующие механики или временная in-memory защита — минимально: 1 запрос / 10 сек с IP).
2. Валидация тела (zod): `tariff_offer_id (uuid)`, `contact_name (1..255)`, `contact_phone`, `contact_email (email)`, `comment (opt, <=2000)`, `honeypot (opt)`.
3. Резолв оффера через service role:
  - `tariff_offers` join `tariffs`, `products_v2`;
  - guard: `offer_type='bank_installment'` AND `meta->bank_installment->rr_runtime->>'enabled' = 'true'` AND `meta->bank_installment->rr_runtime->>'mode' = 'initiate_only'` AND `is_active`;
  - guard: тариф/продукт активны;
  - иначе → `403 rr_runtime_disabled`.
4. Загрузка конфига РР: сейчас используем `loadRRTestConfig` (mode=`test`), т.к. `initiate_only` подразумевает test-эндпоинт РР без списаний. Если в дальнейшем понадобится прод, добавим loader отдельно — вне Sprint B.
5. Создать `orders_v2` (промежуточный).
6. Вставить `rr_installment_requests` (`status='pending'`).
7. Вызвать `rrCreateOrder({ externalId: 'rr_live_<uuid>' , amountMinor, currency, notificationUrl: <публичный URL функции-заглушки rr-notification-noop, чтобы РР не звонил в чувствительные функции>, correlationId })`.
8. По ответу РР:
  - ok → `rr_installment_requests.status='rr_created'`, `payment_url`, `raw_last`; `orders_v2.meta.rr.payment_url=...`; ответ `{ payment_url }`.
  - !ok → `status='rr_error'`, `error_text`, `orders_v2.meta.rr.error=...`; ответ `502 rr_error`.
9. Аудит-лог через существующий механизм (`audit_logs` или структурированный `console.log` по стандарту edge-functions).

Явно НЕ делаем: не пишем в `payments_v2`, не пишем в `installment_payments`, не трогаем `rr_test_ledger` (это test-функции), не вызываем `grant-access-for-order`.

### 5. Notification URL (заглушка)

`supabase/functions/rr-notification-noop/index.ts`, `verify_jwt=false`:

- принимает POST от РР,
- НЕ обновляет `orders_v2`, НЕ выдаёт доступы,
- пишет полученный payload (redacted) в `rr_installment_requests.raw_last` по `external_id` (для диагностики),
- возвращает `200 ok`.

Это временный приёмник до боевого `rr-webhook` (Sprint C).

### 6. Клиент (UI)

Публичные точки: `UniversalPricingSection`, `TariffPricing`, `ProductLanding`, `SitePageBySlug`.

Изменение: в `LeadRequestDialog` для `bank_installment` при наличии `offer.meta.bank_installment.rr_runtime.enabled === true` вместо открытия `bankLinkUrl` — вызывать edge `public-rr-installment-initiate` с формы (имя/телефон/email/комментарий) и:

- на success — `window.location.href = payment_url` (или показать кнопку «Перейти к оплате»),
- на error — тост «Не удалось инициировать заявку, попробуйте ещё раз или воспользуйтесь резервной ссылкой», плюс fallback-кнопка на legacy `external_link` (если он есть у оффера).

Для офферов без `rr_runtime.enabled` — поведение НЕ меняется (legacy `external_link` через `readBankInstallmentMeta`).

Feature-detection делается локально в компоненте — новых глобальных фич-флагов не вводим.

## Dry run

1. В preview открыть лендинг тарифа «Бухгалтер» → у согласованного оффера кнопка ведёт в диалог заявки.
2. Заполнить форму → edge вернёт `payment_url` от РР test-эндпоинта.
3. Проверить в БД: появился `orders_v2` в `pending_installment` с `meta.flow='rr_installment_initiate'`, появилась запись в `rr_installment_requests` (`status='rr_created'`), в `payments_v2` — ничего, `installment_payments` — ничего, `entitlements`/`telegram_access_grants` — ничего.
4. У остальных двух тарифов «Бухгалтера» — старый flow с `external_link` работает как раньше.
5. `rr-notification-noop` при внешнем POST-е обновляет `raw_last` и не трогает заказ.

## Execute (порядок реализации в build mode)

1. Миграция: таблица `rr_installment_requests` + GRANTs + RLS (только admin/superadmin читают; INSERT только через service role).
2. Edge: `public-rr-installment-initiate` + `rr-notification-noop` (в `supabase/functions/*`, автодеплой).
3. UI: доработка `LeadRequestDialog` (или тонкий адаптер вокруг него) — детект `rr_runtime.enabled` и вызов edge.
4. Data-fix (после подтверждения admin): в согласованном `tariff_offer_id` тарифа «Бухгалтер» проставить `meta.bank_installment.rr_runtime = { enabled:true, mode:'initiate_only', provider:'rr' }`.

## Verify (DoD)

- Регрессия UI Sprint A: `OfferRowCompact` не показывает фиктивную разбивку — не сломано.
- `SELECT count(*) FROM payments_v2 WHERE order_id IN (SELECT id FROM orders_v2 WHERE meta->>'flow'='rr_installment_initiate');` → 0.
- `SELECT count(*) FROM installment_payments WHERE order_id IN (...);` → 0.
- `SELECT count(*) FROM entitlements WHERE order_id IN (...);` → 0.
- `SELECT count(*) FROM telegram_access_grants WHERE order_id IN (...);` → 0.
- В `rr_installment_requests` появляются записи только для одного включённого оффера; у двух других офферов «Бухгалтера» — 0 записей и работает legacy `external_link`.
- `public-checkout`, `_shared/create-payment-checkout.ts`, `bepaid-webhook`, `admin-create-public-link` — diff пустой.
- `rr-notification-noop` не изменяет `orders_v2.status` и не выдаёт доступов.
- Пароль preview-admin используется только для ручной проверки; никаких секретов в коде.

## Что НЕ делаем в Sprint B

- Не создаём `rr-webhook` (боевой обработчик успеха).
- Не переводим `orders_v2` в `paid` по инициации.
- Не выдаём доступы, не шлём notifications, не пушим CRM success.
- Не меняем существующие payment-функции и `_shared/create-payment-checkout.ts`.
- Не меняем поведение офферов без флага runtime.
- Не расширяем enum'ы (`offer_type`, `payment_method`, `payment_plan_type`).
- Не трогаем `rr_test_ledger` и test-функции РР.