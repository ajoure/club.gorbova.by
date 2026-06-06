# да, согласен, с учетом правок:

1. **A4 linkage разрешаю**

Да, можно точечно править:

```text
stripe-create-checkout
stripe-create-subscription-checkout
```

только для проброса:

```text
payment_link_id
```

в Stripe Session metadata.

Но:

```text
stripe-webhook не трогать
```

Если webhook уже читает `metadata.payment_link_id` — отлично.  
Если не читает — фиксируем backlog:

```text
stripe_public_link_id_metadata_bridge
```

и не расширяем scope 4.1.

2. **Installment + Stripe**

Да, подтверждаю:

```text
Stripe installment в Phase 4.1 запрещён.
```

Поведение:

- backend: HTTP 400;
- UI: понятная подсказка «Рассрочка через Stripe пока не поддерживается»;
- future backlog.

3. **UI термины**

Да, бренды не переводим:

```text
bePaid
Stripe
```

UI на русском:

```text
Провайдер
Счёт
Тестовый режим
Боевой режим
Создать ссылку
Рассрочка через Stripe пока не поддерживается
```

4. **Добавить обязательный bePaid smoke до и после**

Перед изменениями и после runtime:

- открыть существующую bePaid public link;
- убедиться, что она ведёт в старый bePaid checkout;
- создать новую bePaid public link без поля `provider`;
- убедиться, что она создаётся как `provider='bepaid'`.

Это критичный DoD.

5. **Не делать fallback:true для Stripe ошибок**

Фраза:

```text
При ошибке Stripe: HTTP 200 + fallback:true
```

опасна.

Для Stripe public links лучше:

```text
Stripe error → понятная controlled error response
```

без создания bePaid fallback и без скрытого переключения провайдера.

Никакого автоматического fallback Stripe → bePaid.

6. **Provider routing должен быть строгим**

Если `payment_links.provider='stripe'`, то только Stripe.

Если Stripe checkout не создался — FAIL с ошибкой, а не попытка провести через bePaid.

7. **Runtime G4.1-F**

Если `payment_link_id` linkage не попадёт в `orders_v2`, но оплата, order, access проходят — ставить:

```text
G4.1-F = PARTIAL
```

и backlog.

Не блокировать весь Phase 4.1, если бизнес-сценарий оплаты и доступа работает.

После этих правок Phase 4.1 можно запускать.

План: Phase 4.1 — Add Stripe Provider Routing to Public Links

## Контекст

Phase 4 Discovery зафиксировал единственную точку отказа: `admin-create-public-link` + `_shared/create-payment-checkout.ts` не поддерживают Stripe для публичных ссылок. Все 113 `payment_links` сейчас `provider='bepaid'`. Колонки `provider/account_code/profile_code/business_stream` в `payment_links` уже существуют, CHECK уже допускает `'stripe'`. Stripe direct admin checkout уже работает (5 orders, 5 subs, 21 session).

## Цель

Добавить provider-aware routing в публичные ссылки. Add-only. bePaid остаётся default и не ломается. Никаких миграций, никаких изменений webhooks / grant-access / Telegram / Phase 3.5-B.

## Жёсткие границы (NOT TOUCHED)

- `bepaid-webhook`, `stripe-webhook` — без изменений.
- `grant-access-for-order`, `subscriptions-reconcile`, `telegram-access*` — без изменений.
- `subscription-charge`, `direct-charge`, `payment-methods-webhook` — без изменений.
- Phase 3.5-B Runtime остаётся `PENDING-BY-STRIPE-TIME`.
- Никаких миграций (все колонки есть).
- Никаких новых providers / write-paths.
- Старые bePaid public links (113 шт.) должны работать байт-в-байт как раньше.
- Installment offers через Stripe запрещены в этом patch (Stripe finite-sub вне scope).
- GitHub / CI / infra не трогаем.

## A. Backend изменения (additive)

### A1. `supabase/functions/admin-create-public-link/index.ts`

```text
Input (новые опциональные поля):
  provider?: 'bepaid' | 'stripe'        // default 'bepaid'
  account_code?: string                  // required if provider='stripe'

Валидация:
  - provider не в {'bepaid','stripe'} → 400
  - provider='stripe' && !account_code → 400
  - provider='stripe' && installment_offer=true → 400 (out of scope)
  - account_code должен существовать в acquiring_connections
    WHERE provider='stripe' AND status='active'
  - currency должна быть в acquiring_connections.supported_currencies
    выбранного account_code (для Stripe)

Запись:
  payment_links.provider       = <provider>
  payment_links.account_code   = <account_code> | NULL
  (profile_code, business_stream — наследуются из acquiring_connections, если есть; иначе NULL)

Audit `payment_link.created` обогатить:
  provider, account_code, account_test_mode
```

Контракт обратной совместимости: вызов без `provider` ведёт себя ровно как сейчас (bepaid).

### A2. `supabase/functions/public-checkout/index.ts`

```text
1. SELECT payment_links по token (уже делается).
2. Прочитать link.provider.
3. if (provider === 'stripe'):
     → delegate в новую ветку Stripe (см. A3);
   else:
     → существующий путь bePaid без изменений.
4. Контракт ответа (redirect_url) сохраняется.
```

Default-ветка остаётся текущей. Никаких изменений для bePaid-токенов.

### A3. `supabase/functions/_shared/create-payment-checkout.ts`

Добавить Stripe branch (без изменения существующих bePaid helpers):

```text
if (provider === 'stripe'):
  payment_type === 'subscription' (или offer.is_recurring)
    → invoke('stripe-create-subscription-checkout', {
        payment_link_id, account_code, user_id, product_id, tariff_id, offer_id, currency, ...
      })
  else (one-time):
    → invoke('stripe-create-checkout', { ...same... })

  Возврат: { redirect_url: session.url }
  При ошибке Stripe: HTTP 200 + fallback:true (стандарт payment-error-handling).
```

Stripe-ветка ни в одной строке не вызывает bePaid helpers (defence in depth, denylist verifier останется зелёным).

Существующие `stripe-create-checkout` и `stripe-create-subscription-checkout` уже умеют материализовать заказы/подписки через `stripe-webhook`; их API не меняем, только пробрасываем `payment_link_id` в metadata (если поддерживается — проверить и при необходимости добавить).

### A4. (опц.) `stripe-create-checkout` / `stripe-create-subscription-checkout`

Минимальный additive: принять `payment_link_id?: string` и положить в Stripe Session `metadata.payment_link_id`. `stripe-webhook` затем при материализации `orders_v2` запишет `payment_link_id` (как это делает bePaid). Если webhook уже читает metadata.payment_link_id — изменений 0. Если нет — точечно добавить чтение в `stripe-webhook`? **НЕТ** — webhook трогать запрещено. Тогда: записываем `payment_link_id` в `provider_events.meta` через одноразовый upsert после создания session НЕ в webhook, а в самом `stripe-create-checkout` (через таблицу `payment_links.meta.last_session_id` ↔ обратный линк). Финальное решение по этому подпункту фиксируем после короткого read-only probe в A4-Discovery (см. ниже).

## B. UI изменения (русский)

### B1. `CreatePublicLinkDialog`

Добавить:

- Селектор «Провайдер»: `bePaid` (default) | `Stripe`.
- При выборе Stripe:
  - селектор «Счёт» (account_code из активных Stripe `acquiring_connections`);
  - бейдж «Тестовый режим» / «Боевой режим» по `test_mode`;
  - валидация currency против `supported_currencies` выбранного счёта;
  - тултип: «Рассрочка через Stripe пока не поддерживается» при попытке выбрать installment.
- Кнопка «Создать ссылку» передаёт `provider` + `account_code` в `admin-create-public-link`.

### B2. Таблица «Ссылки» (`AdminPaymentsHub` → Links tab)

Добавить колонку **«Провайдер»** с бейджем (bePaid / Stripe + Test/Live). Источник: `payment_links_enriched_v.provider`, `account_code`. UI на русском.

Остальное (фильтры, действия) — без изменений.

## C. A4-Discovery (read-only, до начала кода)

Прочитать:

- `stripe-create-checkout/index.ts` — принимает ли он `payment_link_id` и кладёт ли в `session.metadata`;
- `stripe-create-subscription-checkout/index.ts` — то же;
- `stripe-webhook/index.ts` — читает ли он `metadata.payment_link_id` при материализации `orders_v2`.

Результат фиксируется в discovery-артефакте. Если bridge уже есть — A4 = no-op. Если нет — план A4 ограничивается **только** правкой `stripe-create-*` функций (writers), webhook не трогаем; связка `payment_link_id ↔ order` восстанавливается на этапе webhook через metadata, которую он уже читает (если читает) или через `provider_events.meta` (read-only join на этапе reconcile UI — без правок webhook).

## D. Runtime Proof (gates Phase 4.1)


| Gate   | Условие PASS                                                                                                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G4.1-A | bePaid public link (существующая) → `/pay/:token` → bePaid checkout. Не изменилось.                                                                                                                                                              |
| G4.1-B | Новая bePaid public link создаётся без поля `provider` в payload (backward-compat).                                                                                                                                                              |
| G4.1-C | Новая Stripe one-time public link создаётся, `payment_links.provider='stripe'`, `account_code` записан.                                                                                                                                          |
| G4.1-D | `/pay/:token` по Stripe-ссылке возвращает `redirect_url` начинающийся с `checkout.stripe.com`.                                                                                                                                                   |
| G4.1-E | Новая Stripe subscription public link → Stripe Subscription Checkout (mode=subscription), pre-created `subscriptions_v2 pending` или эквивалент существующего контракта `stripe-create-subscription-checkout`.                                   |
| G4.1-F | После тестовой Stripe-оплаты webhook материализует `orders_v2 paid` + `entitlements` (через существующий `grant-access-for-order`). Если `payment_link_id` linkage не работает — фиксируется как known gap → backlog, доступ всё равно выдаётся. |
| G4.1-G | Cross-provider counters: `payment_links.provider='bepaid'` count не уменьшился; bePaid edge functions не получили Stripe-вызовов (denylist verifier).                                                                                            |
| G4.1-H | UI: селектор провайдера виден, термины на русском, installment+Stripe заблокировано тултипом.                                                                                                                                                    |


## E. Артефакты

- `.lovable/proofs/stripe_phase_4_1_provider_routing_v1.md` — discovery A4 + runtime gates G4.1-A..H + counters до/после.
- Обновление `.lovable/plan.md` со статусом Phase 4.1.
- Если A4 выявит linkage gap — `.lovable/backlog/stripe_public_link_id_metadata_bridge.md` (read-only задача, без правки webhook).

## F. DoD Phase 4.1

1. `admin-create-public-link` принимает `provider` + `account_code`, валидирует, пишет в `payment_links`. Backward-compat подтверждён.
2. `public-checkout` маршрутизирует по `link.provider`. bePaid ветка не тронута.
3. `_shared/create-payment-checkout.ts` имеет Stripe branch; 0 вызовов bePaid helpers внутри Stripe ветки.
4. `CreatePublicLinkDialog` поддерживает выбор провайдера на русском; таблица «Ссылки» показывает провайдера.
5. Runtime gates G4.1-A..H = PASS (или G4.1-F = PARTIAL + backlog с указанной причиной).
6. bePaid non-regression: создание + оплата существующей bePaid ссылки → без изменений.
7. Phase 3.5-B Runtime, webhooks, grant-access, telegram, miграции — не тронуты.
8. Proof артефакт создан и зафиксирован.

## Открытые вопросы (нужны ответы до Execute)

1. **A4 linkage:** разрешить ли в рамках 4.1 точечную правку `stripe-create-checkout` / `stripe-create-subscription-checkout` для проброса `payment_link_id` в `Session.metadata`? (Webhook всё равно не трогаем.) Без этого Stripe public link и order будут связываться только через `provider_events` join, без `orders_v2.payment_link_id`.
2. **Installment+Stripe:** подтверждаешь, что блокируем 400 + UI tooltip и выносим в отдельный будущий patch?
3. **UI термины:** ОК использовать ярлыки «bePaid» / «Stripe» как имена провайдеров (бренды, не переводим), но «Тестовый режим» / «Боевой режим», «Счёт», «Провайдер» — на русском?