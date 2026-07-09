## да, согласен, с учетом правок:

1. **Исправить противоречие в п.4.**  
В начале указано: «никакого кода интеграции, миграций, edge functions в этом шаге не создаётся», но далее допускается временная edge function `rr-discovery-probe`.
  &nbsp;
  Правильно зафиксировать так:

```txt
В этом шаге не создаются production edge functions, миграции и payment-flow код.
Допускается только временная superadmin-only discovery edge function rr-discovery-probe, если без неё невозможно проверить test API РР. Она не является частью production-интеграции и должна быть удалена в этом же PR.
```

2. **Probe-функцию не создавать автоматически.**  
Сначала изучить документацию. Создавать `rr-discovery-probe` только если:
  - документации недостаточно;
  - есть сохранённые test credentials;
  - невозможно подтвердить stop-guards без runtime-вызова.
3. **Добавить запрет на запись runtime probe в** `integration_logs`**, если там нет безопасной redaction-гарантии.**  
Формулировка:

```txt
Если текущий механизм integration_logs не гарантирует redaction raw API responses, ответы РР не писать в integration_logs. Вместо этого приложить локальный redacted summary в discovery.md: только названия полей, типы, статусы, request_id, без PII, токенов, подписей и секретов.
```

4. **В stop-guards добавить отдельный пункт по персональным данным.**

```txt
7. API РР не требует передачи лишних персональных данных сверх минимально необходимых для заявки и уже имеющихся в order/contact — да/нет.
```

Если РР требует паспортные данные, адрес, место работы или иные sensitive данные на нашей стороне — это отдельный legal/security scope, не включать в v1 без доп. согласования.

5. **В adapter-contract не фиксировать** `payment_provider_settings` **как обязательную новую таблицу.**  
У нас уже есть карточка интеграции через `integration_instances/config/config_secrets`. Поэтому формулировка должна быть:

```txt
Настройки provider rr переиспользуют существующую карточку integration_instances provider='rr'. Новую payment_provider_settings не создавать, если discovery не докажет необходимость отдельной payment-domain settings table.
```

6. **Гейт PublicPayPage уточнить по источникам настроек.**

```txt
RUB && amount >= 990000 minor units && allow_rr на offer/product/payment link && integration_instances(provider='rr') exists && credentials configured && not disabled.
```

7. **В DoD добавить machine-check по отсутствию production-кода.**

```txt
Подтвердить, что в этом шаге не изменены payments_v2, orders_v2, provider_events, PublicPayPage, OfferAcquiringSettings и не созданы production edge functions rr-create-checkout/rr-webhook/rr-sync-status.
```

8. **Отчет должен быть на русском и с точным заголовком:**

```txt
Отчет о выполненной работе: Discovery API Ресурс Развития и контракт backend-адаптера rr
```

С этими правками план можно выполнять.

&nbsp;

План: Discovery API «Ресурс Развития» и контракт backend-адаптера `rr`

Цель — собрать проверяемые факты об API РР и зафиксировать контракт адаптера **до** написания `rr-create-checkout` / `rr-webhook`. Никакого кода интеграции, миграций, edge functions в этом шаге не создаётся. Итог — документ `docs/integrations/rr/discovery.md` + `docs/integrations/rr/adapter-contract.md`, ссылки на первоисточники, и решение go/no-go по каждому stop-guard.

### 1. Источники (обязательно проверить и зафиксировать URL + дату снятия)

- Публичная документация: `https://partner.rrllc.ru/public-api-v20/docs/` — все разделы (auth, orders, statuses, webhook, cancellation, commission).
- Публичный сайт РР — модель работы для клиента (для sanity-check UX-предпосылок 9 900 ₽ / RUB / рассрочка).
- При наличии — test-креды в `integration_instances.config_secrets` (провайдер `rr`, `mode=test`). Реальные вызовы делаем ТОЛЬКО в test-режиме и ТОЛЬКО из edge function `rr-discovery-probe` (см. п.4), никогда с фронта, никогда с боевыми ключами.

### 2. Что зафиксировать в `docs/integrations/rr/discovery.md`

Для каждого пункта — цитата/скрин из доков + вывод «использовать / не подходит / нужно уточнение у РР».

**2.1 Авторизация**

- Схема: login + password + secret_key + подпись + timestamp.
- Алгоритм подписи: конкретная формула (какие поля, какой порядок, какой hash, где передаётся — header/body).
- TTL/rewind timestamp.
- Раздельные endpoint/host для test и battle.

**2.2 Создание заявки / платёжной ссылки**

- Endpoint(-ы): create request → get payment page/URL.
- Обязательные поля: сумма (единицы!), валюта, описание, external_id/merchant_order_id, return_url, notification_url, покупатель (какие поля минимум).
- Минимальная сумма (подтвердить порог 9 900 RUB).
- Валюта: только RUB?
- Возвращаемые поля: `rr_request_id`, `payment_url`, срок жизни ссылки.
- Идемпотентность: поддерживается ли header/поле; какой ключ РР считает уникальным.

**2.3 Статусы**

- Полный список статусов с описанием.
- Явно выделить: какие статусы = **финальная оплата/фондирование** (единственные, по которым завершаем заказ), какие промежуточные, какие терминальные-неуспешные.
- Есть ли отдельный статус «одобрено но не оплачено» vs «профинансировано».

**2.4 Webhook / callback**

- URL регистрируется на стороне РР или передаётся в каждом запросе?
- Метод, content-type, retry-политика РР.
- Подпись webhook: алгоритм, поле, где секрет.
- Стабильный external id в payload (для idempotency в `provider_events`).
- Список событий, которые РР шлёт.

**2.5 Статус-запрос (pull)**

- Endpoint для polling статуса по `rr_request_id`.
- Rate limit.

**2.6 Отмена / возврат**

- Endpoint отмены, при каких статусах допустим.
- Возврат — есть ли API или только через кабинет.

**2.7 Комиссия**

- В каком ответе приходит комиссия (create/status/webhook/statement).
- Единицы, знак, налоговый учёт.
- Достаточно ли для записи в `payments_v2` (поле для комиссии).

**2.8 Ошибки**

- Формат ошибок, коды, human-message.
- Ретраибельные vs терминальные.

### 3. Stop-guards (go/no-go)

Для каждого — явный вывод в документе. Если хоть один = **NO** → останавливаемся и возвращаем отчёт, backend не начинаем.

1. Есть подпись webhook — да/нет.
2. Однозначно определён «финальный оплачено/профинансировано» статус — да/нет.
3. Есть стабильный external id для idempotency в `provider_events` — да/нет.
4. Не требуется iframe с sensitive-данными на нашем фронте (только redirect на РР) — да/нет.
5. Можно протестировать полный flow на test-кредах без реальных денег — да/нет.
6. Есть API комиссии ИЛИ явно фиксируем «комиссия не сохраняется, только статус» — да/нет.

### 4. Живая проверка на test-кредах (опционально, только если п.1.credentials есть)

Одноразовая edge function `rr-discovery-probe` (создаётся временно, удаляется после discovery):

- Superadmin-only auth guard.
- Только методы: auth-ping, create test request на 9 900 RUB с фиктивным `external_id=discovery-<uuid>`, get status, cancel.
- НИЧЕГО не пишет в `payments_v2` / `orders_v2` / `provider_events`.
- Логирует ответы РР в `integration_logs` **с redaction**: только структура (ключи, типы, статусы), никаких PII, никаких токенов/подписей.
- Результат прикладывается к discovery.md как «runtime evidence: &nbsp;, &nbsp;».

Если после discovery решение go — probe-функция удаляется в этом же PR.

### 5. Контракт backend-адаптера `docs/integrations/rr/adapter-contract.md`

На основе discovery зафиксировать (без кода):

- Интерфейс `RRPaymentProviderAdapter` (методы: `createCheckout`, `handleWebhookEvent`, `fetchStatus`, `cancel`, `mapStatus`).
- Маппинг статусов РР → внутренние `payments_v2.status` / `orders_v2.status`.
- Ключ идемпотентности webhook → `provider_events.external_id`.
- Формула комиссии → `payments_v2.provider_fee_minor` (или «not stored»).
- Список необходимых миграций (add-only): `payments_v2.provider` расширить `'rr'`, `orders_v2.provider` при наличии, `payment_provider_settings` row для `rr` с `allow_rr`, `rr_min_amount_minor=990000`, `rr_currency='RUB'`.
- Список edge functions следующего шага: `rr-create-checkout`, `rr-webhook`, опционально `rr-sync-status` (cron).
- Гейт на `PublicPayPage`: RUB && amount ≥ 9 900 ₽ && `allow_rr` && instance `rr` exists.
- Что НЕ поддерживаем в v1: подписки/recurring, валюты кроме RUB, ручной расчёт комиссии, выдача доступов из webhook (только через canonical entitlement flow после финального статуса).

### 6. Definition of Done

- Файлы `docs/integrations/rr/discovery.md` и `docs/integrations/rr/adapter-contract.md` созданы, каждый пункт п.2 закрыт цитатой/ссылкой и датой.
- По каждому stop-guard из п.3 — явный вердикт.
- Если запускалась probe — приложены redacted-логи и функция удалена.
- Отчёт начинается строкой: **«Отчет о выполненной работе: Discovery API Ресурс Развития и контракт backend-адаптера rr»**, содержит: список изменённых файлов, вердикт go/no-go, список открытых вопросов к РР (если есть), явный next-step (либо «backend implementation по контракту», либо «блок: нужен ответ от РР по …»).

### 7. Что НЕ делаем в этом шаге

- Не создаём `rr-create-checkout`, `rr-webhook`, `rr-sync-status` (кроме одноразовой probe при необходимости).
- Не меняем схему БД (`payments_v2`, `provider_events`, `payment_provider_settings`, `orders_v2`).
- Не трогаем `PublicPayPage`, `OfferAcquiringSettings`.
- Не сохраняем ничего в `payments_v2` / `orders_v2` даже во время probe.