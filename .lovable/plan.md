# да, согласен, с учетом правок:

1. **Заголовок отчета исправить на обязательный формат:**

```txt
Отчет о выполненной работе: backend core-интеграция Ресурс Развития без product wiring
```

Не `Отчет о выполнении`.

2. `rr-notification` **ограничить только test-ledger сценариями.**  
Чтобы публичный endpoint нельзя было случайно использовать как production webhook:

```txt
rr-notification в этом этапе:
- принимает только external_id с префиксом rr_test_;
- обновляет только существующую запись в rr_test_ledger;
- если external_id не найден в rr_test_ledger — не создает платеж, заказ или новую business-запись;
- максимум пишет redacted security log;
- не эмитит domain_events.
```

3. **В** `rr-test-create-order` **явно запретить любые реальные данные клиента.**

```txt
Для test createOrder использовать только фиктивные данные:
- external_id = rr_test_<uuid>;
- amount_minor = 990000;
- currency = RUB;
- meta.test = true;
- buyer/client_info не передавать, если API позволяет;
- если API требует buyer fields — использовать synthetic test data без реальных ФИО, телефонов, email клиентов.
```

4. `rr_test_ledger.raw_last` **хранить только redacted payload.**  
Не просто “редактированные ответы”, а строго:

```txt
raw_last хранит только redacted JSON:
- ключи;
- статусы;
- request_id;
- commission;
- payment_url допустим только если это test URL;
- без secret/signature/token/auth headers;
- без PII;
- без полных raw request headers.
```

5. **Добавить CHECK/guard для test-ledger.**

```sql
external_id LIKE 'rr_test_%'
currency = 'RUB'
```

И лучше добавить CHECK по статусам:

```txt
created | pending | paid | canceled | failed | expired
```

6. **Не называть** `paid` **в UI как реальную оплату.**  
В admin UI для `rr_test_ledger` показывать:

```txt
Тестовый статус: paid / authorized
```

а не «Оплачено» без пояснения. Иначе админ может спутать с реальной оплатой.

7. `rr-http.ts` **не должен логировать полный URL, если query может содержать чувствительные данные.**  
Формулировка:

```txt
Логировать только host + pathname + method + status + duration.
Query string полностью отбрасывать.
```

8. `rr-notification` **с невалидной подписью:**  
В план добавить, что при `401` не должно быть обновления `rr_test_ledger`. Только redacted security log.
9. **Idempotency уточнить.**  
Для webhook/notification:

```txt
idempotency_key = provider:rr + external_id + status_raw + sign_hash_short
```

При повторе того же notification — не создавать дублирующих логических обновлений, только фиксировать duplicate/ignored в техническом логе.

10. **В DoD добавить проверку отсутствия** `domain_events`**.**

```txt
SQL-проверка: за время тестов не появились новые domain_events, связанные с rr_test_*.
```

11. **В DoD пункт 6 уточнить: “без изменений строк” должен считаться по контрольному snapshot до/после.**

```txt
Перед тестом снять counts/max(updated_at) по payments_v2, orders_v2, provider_events, payment_provider_settings, acquiring_connections, domain_events.
После теста подтвердить, что они не изменились.
```

12. `integration_sync_logs` **допустимы только как технический лог.**  
В отчете отдельно показать:

```txt
integration_sync_logs содержит rr_order / rr_notification только с redacted payload_meta.
```

13. **Следующий этап не должен называться “product wiring”, если core не прошел test e2e.**  
Зафиксировать:

```txt
Следующий этап возможен только после успешного test createOrder + getOrderStatus + валидного notification + проверки комиссии.
```

С этими правками план можно выполнять.

&nbsp;

План: backend core-интеграция Ресурс Развития без product wiring

## Цель

Технически включить работу с API РР (createOrder, getOrderStatus, notification/webhook, подпись, статусы, комиссия) в изолированном core-слое. Без влияния на продажи, продукты, публичную страницу оплаты и реальные заказы. Только test mode, только admin, только технические логи.

## Жёсткие запреты (в коде и в отчёте по этому этапу)

Следующее НЕ создаётся, НЕ редактируется, НЕ трогается:

- `PublicPayPage` и любые публичные страницы оплаты;
- `OfferAcquiringSettings` и любые настройки эквайринга офферов;
- кнопки/выбор РР на карточках продуктов, офферов, лендингах;
- автоматическое добавление РР в список доступных провайдеров продукта;
- любые записи в `payments_v2` / `orders_v2` в контексте реального заказа клиента;
- завершение реальных заказов (`orders_v2.status = paid` и т.п.);
- выдача доступов / entitlement flow;
- расширение `payment_provider_settings` для боевого выбора РР;
- изменение публичной статистики платежей (`rr` в общих отчётах о выручке);
- боевые креды РР — только `test_mode`.

Если в ходе реализации выяснится, что для core-функции нужно тронуть что-то из этого списка — работа останавливается, вопрос выносится отдельным планом.

## Разрешённый scope

Только backend-core + admin-only test action. Никакой пользовательской поверхности.

### 1. Adapter layer (изолированный)

Каталог: `supabase/functions/_shared/rr/`.

- `rr-adapter.ts` — реализация `RRPaymentProviderAdapter` строго по `docs/integrations/rr/adapter-contract.md`:
  - `createOrder({ amount_minor, currency: 'RUB', external_id, return_url, notification_url, meta })` → `{ rr_request_id, payment_url, raw }`;
  - `getOrderStatus(rr_request_id)` → `{ status_raw, status_internal, commission_minor?, paid_at?, raw }`;
  - `verifyNotificationSignature(payload, headers)` → `{ valid, external_id, status_raw, raw }`;
  - `mapStatus(status_raw)` → внутренний enum (`created | pending | paid | canceled | failed | expired`).
- `rr-config.ts` — безопасное чтение `integration_instances` + `config_secrets` через service-role. Ни один секрет не логируется, не возвращается в ответы, не попадает в `payload_meta`.
- `rr-http.ts` — тонкий HTTP-клиент к API РР (Basic Auth, timeouts, retry только на сетевых ошибках, без retry на 4xx). Логирует только метод, URL без query-секретов, статус, длительность.

Adapter не знает про `orders_v2`, `payments_v2`, продукты, офферы, клиентов. Он получает на вход суммы и id, возвращает данные РР. Точка.

### 2. Edge functions (test-only)

Все три функции — admin-only (JWT + RBAC `has_role(auth.uid(), 'admin')`), `verify_jwt` по умолчанию, CORS по стандартам проекта.

- `rr-test-create-order` — admin вызывает вручную из карточки интеграции. Принимает `{ amount_minor, currency: 'RUB' }` (по умолчанию 990000/RUB для соответствия минимуму РР). Генерирует свой `external_id` вида `rr_test_<uuid>`. Вызывает `adapter.createOrder`. Возвращает `{ rr_request_id, payment_url, external_id }`. Пишет запись в технический ledger (см. п.3). Ничего не пишет в `orders_v2`/`payments_v2`.
- `rr-test-get-status` — принимает `rr_request_id` или `external_id`, вызывает `adapter.getOrderStatus`, обновляет запись в ledger. Ничего не пишет в `orders_v2`/`payments_v2`.
- `rr-notification` — публичный endpoint (без JWT) для приёма notification от РР. Проверяет подпись через `adapter.verifyNotificationSignature`. При невалидной подписи — 401 + запись в `integration_sync_logs` с `result='error'`. При валидной — обновляет ledger, пишет `integration_sync_logs` `direction='inbound'`, `result='success'`. Никаких действий над `orders_v2`, `payments_v2`, entitlement, письмами клиенту. Idempotency по `external_id` + `status_raw`.

### 3. Технический ledger (изолированная таблица)

Миграция создаёт **новую** таблицу `rr_test_ledger` — отдельно от `payments_v2`/`orders_v2`, чтобы гарантированно не смешаться с реальными продажами:

```text
rr_test_ledger
  id uuid pk
  external_id text unique not null
  rr_request_id text
  amount_minor bigint
  currency text  -- RUB
  status_internal text  -- created|pending|paid|canceled|failed|expired
  status_raw text
  commission_minor bigint null
  payment_url text
  created_by uuid  -- admin who triggered
  created_at timestamptz default now()
  updated_at timestamptz default now()
  last_notification_at timestamptz null
  raw_last jsonb  -- редактированные ответы РР без секретов
```

Grants: `authenticated` — только SELECT через RLS (`has_role(auth.uid(),'admin')`); `service_role` — ALL. RLS ENABLE + политика admin-only на SELECT. Никаких INSERT/UPDATE от клиента — только через edge-функции service-role.

Таблица явно называется `rr_test_ledger` (а не `rr_payments`), чтобы её нельзя было спутать с production-платежами и случайно подключить к отчётам.

### 4. Admin UI (только внутри существующей карточки интеграции)

Файл: `src/components/integrations/rr/RRSettingsCard.tsx` — расширяется, новые страницы не создаются.

- Секция «Тестовое подключение» появляется только когда `credentialsReady && test mode`.
- Кнопки:
  - «Создать тестовую заявку 9 900 ₽» → `rr-test-create-order`, показывает `payment_url` и `external_id`, кнопка «Открыть в новой вкладке».
  - «Проверить статус» рядом с каждой записью → `rr-test-get-status`.
- Мини-таблица последних 20 записей `rr_test_ledger` (external_id, статус, сумма, комиссия, updated_at).
- Явная плашка сверху секции: «Тестовый режим. Заявки не связаны с реальными заказами и не влияют на продажи и статистику».

Никаких изменений в списке продуктов, офферах, `OfferAcquiringSettings`, публичных страницах.

### 5. Логи и безопасность

- Все запросы/ответы РР — через `integration_sync_logs` с `entity_type='rr_order'`/`rr_notification`. В `payload_meta` только: метод, endpoint (без query-секретов), status_raw, external_id, длительность. Никаких токенов, паролей, `secret_key`, полной подписи, персональных данных клиента.
- `config_secrets` читается только service-role внутри edge-функций. Никогда не возвращается в HTTP-ответах, не пишется в логи, не попадает во фронт.
- `rr-notification` — публичная, но обязательный signature check до любой записи в ledger.

## Definition of Done

1. Adapter реализован и покрыт unit-тестами на `mapStatus` и `verifyNotificationSignature` (positive + negative).
2. `rr-test-create-order` в test mode возвращает валидный `payment_url` РР (runtime proof — curl edge function + запись в `rr_test_ledger`).
3. `rr-test-get-status` возвращает статус по существующей тестовой заявке (runtime proof).
4. `rr-notification` принимает симулированный notification от РР, проверяет подпись, обновляет ledger (runtime proof — 200 при валидной подписи, 401 при подделанной).
5. В `rr_test_ledger` появляются записи с корректными статусами и (если РР вернул) commission_minor.
6. SQL-проверка: `payments_v2`, `orders_v2`, `provider_events`, `payment_provider_settings`, `acquiring_connections` — **без изменений строк** за время реализации.
7. Grep-проверка: `PublicPayPage`, `OfferAcquiringSettings`, продуктовые компоненты, публичная страница оплаты — **без diff**.
8. Секреты не появляются ни в `integration_sync_logs.payload_meta`, ни в ответах edge-функций, ни в консоли браузера.
9. bePaid и Stripe flows не затронуты — smoke check по существующим тестам/страницам.
10. Отчёт на русском, начинается с «Отчет о выполнении:», содержит runtime proof (curl + SQL), список изменённых файлов, явное подтверждение всех запретов из раздела «Жёсткие запреты».

## Открытые вопросы (не блокируют старт, но фиксируются в отчёте)

- Активация тестового режима у РР (host/аккаунт/флаг) — если поддержка РР ещё не ответила, `rr-test-create-order` реализуется, но e2e-proof помечается как pending до получения test-кред.
- Политика retry для webhook — фиксируется как «доверяем retry со стороны РР, наш handler идемпотентен по external_id».
- Поведение `createOrder` при повторном `external_id` — проверяется в рамках DoD п.2.

## Следующий этап (НЕ входит в этот план)

Product wiring: где показывать кнопку РР, для каких продуктов/офферов, условия (валюта, минимальная сумма), проведение реальных платежей в `payments_v2`, отражение комиссии в статистике, выдача доступов через entitlement flow. Согласуется отдельным планом только после стабильного core.