# да, согласен, с учетом правок:

1. **Добавить обязательную проверку существующих Stripe test keys до Runtime (A0)**

Сейчас по предыдущим фазам есть косвенные признаки, что Stripe работает, но план содержит условный сценарий `PENDING-BY-STRIPE-KEYS`.

Нужно явно проверить в Discovery:

```text
A0. Stripe Readiness Check
```

Подтвердить:

- существует активный Stripe account (`stripe_poland`);
- checkout уже создавался успешно в последних фазах;
- portal создавался успешно;
- test-mode ключи фактически работают.

Если это подтверждается — сценарий `PENDING-BY-STRIPE-KEYS` исключается заранее.

2. **G55 и G56 не могут зависеть только от webhook нового платежа**

У нас уже есть подтвержденные Stripe-платежи и подписки.

Добавить:

```text
Если новые тестовые оплаты не выполняются,
G55/G56 могут закрываться историческими runtime-доказательствами
из последних успешных Stripe транзакций.
```

Иначе фаза может искусственно зависнуть.

3. **В Currency Matrix не требовать оплаты во всех валютах**

Проверять:

```text
создание checkout session
```

а не полный платеж.

Иначе получится лишний тестовый мусор.

PASS:

```text
Session created
currency mapped correctly
provider=stripe
```

4. **Cross-provider добавить проверку payment_links**

Кроме webhook и provider_events проверить:

```text
payment_links
```

До и после тестов:

- Stripe links создаются только как Stripe.
- bePaid links создаются только как bePaid.
- Нет смешивания provider/account_code.

5. **UX Inventory дополнить режимом Test/Live**

Проверить не только:

- provider;
- account_code;
- currency;

но и:

```text
test_mode / live_mode visibility
```

Это критично перед будущим боевым запуском.

6. **Добавить итоговый блок готовности к бою**

В конец proof:

```text
Stripe Public Links Readiness
```

Статусы:

```text
Checkout Links
Subscription Links
Portal
Routing
Orders
Subscriptions
Access
CRM
bePaid Isolation
```

И отдельный итог:

```text
READY FOR LIVE
или
NOT READY FOR LIVE
```

Это главный результат фазы 4.

После этих правок план можно запускать.

&nbsp;

План: Phase 4 — Public Payment Links (Stripe)

## Цель

Подтвердить полный цикл публичных ссылок оплаты через Stripe (one-time + subscription) без регрессии bePaid. Фаза **inventory + runtime audit**, без кода/миграций/рефакторинга.

## Жёсткие границы (повтор контракта)

Не трогать: `bepaid-webhook`, `subscription-charge`, `direct-charge`, `payment-methods-webhook`, `grant-access-for-order`, `subscriptions-reconcile`, telegram-access lifecycle, Phase 3.5-B runtime.
Запрещено: миграции «на всякий случай», рефакторинг payment-системы, новые providers, новые write-paths.
Stripe должен переиспользовать существующую архитектуру (`admin-create-public-link` writer, `public-checkout` resolver, `stripe-create-checkout` / `stripe-create-subscription-checkout`, `stripe-webhook`).

## Этап A. Discovery Public Links (read-only)

### A1. Карта создания публичных ссылок

Зафиксировать путь:

```text
Admin UI (CreatePublicLinkDialog, AdminPaymentsHub → Ссылки)
   ↓
admin-create-public-link  (canonical writer → payment_links)
   ↓ (клиент открывает /pay/:token)
public-checkout (resolver: provider routing)
   ↓
stripe-create-checkout | stripe-create-subscription-checkout | bePaid path
   ↓
Provider Checkout URL
```

Подтвердить: writer один (`admin-create-public-link`), `payment_links` — единственная таблица ссылок, `payment_links_enriched_v` — единственный read.

### A2. Матрица типов ссылок


| Тип                      | Stripe | bePaid             | Writer                           |
| ------------------------ | ------ | ------------------ | -------------------------------- |
| Public one-time product  | ?      | ✅                  | `admin-create-public-link`       |
| Public one-time tariff   | ?      | ✅                  | `admin-create-public-link`       |
| Public subscription      | ?      | ✅                  | `admin-create-public-link`       |
| Trial                    | ?      | ✅ (через подписку) | `admin-create-public-link`       |
| Installment (finite sub) | ?      | ✅                  | `public-create-installment-link` |
| Admin direct checkout    | n/a    | ✅                  | `admin-create-payment-link`      |


Заполнить «?» по факту inventory (чтение кода `admin-create-public-link`, `public-checkout`, `stripe-create-*`).

### A3. Provider Routing

Зафиксировать SOT выбора провайдера:

- `payment_links.provider` (если задан явно при создании);
- иначе — fallback (продукт/тариф/account_code → `acquiring_connections`);
- финальный routing в `public-checkout`.

DoD: одна точка принятия решения, документирована.

### A4. Checkout URL Contract

- Stripe → `https://checkout.stripe.com/...` (Session.url).
- bePaid → существующий путь (без изменений).
- Публичные ссылки `payment_links.public_url` остаются `club.gorbova.by/pay/:token` (контракт `buildPublicPayUrl`).

## Этап B. Runtime Audit (test mode, без кода)

Все тесты — через UI админки + `/pay/:token`, провайдер Stripe = `stripe_poland` test-режим (уже подключён в Phase 2).

### B1. One-time Product Link

Создать публичную ссылку на one-time продукт с `provider=stripe`. Проверить:

- запись в `payment_links` (provider=stripe, account_code, currency);
- `/pay/:token` открывается;
- `public-checkout` создаёт Stripe Checkout Session (mode=payment);
- `provider_events` пишет `checkout.session.created`.

### B2. Subscription Product Link

Аналогично, recurring-тариф. Проверить:

- Stripe Session mode=subscription;
- pre-created `subscriptions_v2` (pending, duplicate guard);
- linkage `provider_subscriptions` / `meta.tracking_id`.

### B3. Currency Matrix

Test-cards для EUR / PLN / USD / BYN. Несспортированные валюты документировать (см. `stripe_currency_support_v1.md`).

### B4. Portal Compatibility

Подписка из B2 → Customer Portal (`stripe-create-customer-portal-session`):

- открывается;
- customer корректно связан;
- видна созданная подписка.

## Этап C. Data Integrity

Для каждой test-ссылки проверить сквозную цепочку через `supabase--read_query`:

```text
payment_links → provider_events → orders_v2 → subscriptions_v2 → entitlements → telegram_access → crm (deals)
```

Зафиксировать отсутствие разрывов. SOT — существующие view/таблицы, без новых.

## Этап D. Cross-Provider Safety

- Параллельно создать bePaid public link и Stripe public link → независимые `provider_events`, разные write-paths.
- `bepaid-webhook` не получает Stripe-события и наоборот.
- Подсчёт `payment_links` по provider до/после не пересекается.
- Никаких записей в bePaid edge-функции (denylist verifier — повтор Phase 2 grep).

## Этап E. Admin UX Inventory (без реализации)

В `CreatePublicLinkDialog` и таблице «Ссылки» зафиксировать, видно ли оператору:

- активный provider (badge);
- account_code;
- валюту;
- тип ссылки (one-time / subscription / installment);
- mode (test/live).

Список UX-gap → backlog `.lovable/backlog/stripe_public_links_admin_ux_v1.md` (создаётся только если найдены gap'ы, без реализации).

## Runtime Gates


| Gate | Условие PASS                                            |
| ---- | ------------------------------------------------------- |
| G51  | One-Time Stripe link: URL + Session created             |
| G52  | Subscription Stripe link: pending sub + Session created |
| G53  | `/pay/:token` открывает Stripe Checkout                 |
| G54  | Provider routing выбирает корректный provider           |
| G55  | `orders_v2` материализуется (webhook)                   |
| G56  | `subscriptions_v2` материализуется (webhook)            |
| G57  | Customer Portal открывается для подписки из public link |
| G58  | bePaid links / webhook / DB не затронуты                |


## Артефакты (только два файла)

1. `.lovable/discovery/stripe_public_links_inventory_v1.md` — карта A1–A4 + матрица типов + provider routing + URL contract.
2. `.lovable/proofs/stripe_phase_4_public_links_v1.md` — gate-by-gate PASS/FAIL с SQL-evidence + denylist grep + cross-provider counters.

## Definition of Done

- Карта Public Links построена.
- G51–G58 имеют статус (PASS / FAIL / PENDING-BY-STRIPE-TIME при отсутствии test-ключей).
- Routing подтверждён единственной точкой решения.
- One-time + Subscription runtime подтверждены.
- Portal подтверждён.
- bePaid не затронут (denylist + counters).
- Итог: `Public Payment Links: PASS` либо `FAIL` + единственная точка отказа + минимальный PATCH для следующей фазы.

## Что НЕ делаем в Phase 4

- Никаких правок `admin-create-public-link`, `public-checkout`, `stripe-*`, `bepaid-*`, `grant-access-for-order`.
- Никаких миграций и новых RPC.
- Никаких новых UI-компонентов и hooks.
- Не закрываем Phase 3.5-B Runtime (остаётся `PENDING-BY-STRIPE-TIME`).
- Не реализуем UX-gap'ы — только фиксируем в backlog.

## Open question (одно)

Если в Phase 2 super_admin ещё не ввёл реальные test-ключи Stripe через UI — runtime B1–B4 уйдёт в `PENDING-BY-STRIPE-KEYS`, и Phase 4 закроется как **Discovery PASS + Runtime PENDING** (аналогично 3.5-B). Подтвердить такой сценарий допустимым перед стартом, либо сначала ввести ключи.