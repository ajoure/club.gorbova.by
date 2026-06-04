# да, согласен, с учетом правок:

```text
План Infinite Subscription MVP можно принять как основу, но перед execute нужны правки.

1. Price Mapping Validation — правильно вынесен как STOP-GATE.
   Добавить туда обязательную проверку:
   - Stripe Product/Price должны быть test-mode;
   - Price должен быть active=true;
   - Price должен быть recurring;
   - Price lookup должен идти через Stripe API, а не только по сохранённому price_id.

2. Нельзя использовать `invoice.payment_succeeded` в одном месте и `invoice.paid` в другом.
   Выбрать один канон: `invoice.paid`.
   Весь план привести к единому имени.

3. `checkout.session.completed` для subscription не должен активировать доступ.
   Это правильно указано.
   Но добавить:
   - он может быть использован только для связывания `checkout_session_id`, `customer_id`, `subscription_id`;
   - активация только через `invoice.paid`.

4. Pre-create pending subscription:
   Добавить cleanup/TTL правило:
   - если Stripe Checkout не завершён;
   - если subscription не получена;
   - если invoice.paid не пришёл.
   
   Например:
   `pending > 24h → expired/manual_review`.

5. `provider_subscriptions.provider_subscription_id` может быть неизвестен до Stripe Checkout.
   Поэтому:
   - pre-create provider_subscriptions с временным `provider_subscription_id='pending:{order_id}'` или null, если схема позволяет;
   - после `customer.subscription.created` обновить на `sub_*`.
   Нужно указать фактическое допустимое значение по текущей схеме.

6. `provider_subscriptions.state`
   Уточнить маппинг:
   - pending
   - active
   - past_due
   - canceled
   - incomplete
   - unpaid
   
   Если state enum/constraint не поддерживает Stripe-статусы — STOP и отдельный mini-plan.

7. `subscriptions_v2.status`
   Уточнить, можно ли использовать `pending`.
   В discovery enum был:
   `active, trial, past_due, canceled, expired, superseded, expired_reentry`.
   
   `pending` там нет.
   Поэтому текущий пункт:
   `pre-create subscriptions_v2(status=pending)`
   невозможен без schema change.
   
   Нужно изменить стратегию:
   - либо использовать допустимый статус, например `past_due`/`trial` нельзя семантически;
   - либо pre-create только provider_subscriptions pending и orders_v2 pending;
   - либо отдельный schema mini-plan добавить `pending`.
   
   Это блокер. Нельзя approve execute, пока не решено.

8. `subscriptions_v2` создавать из webhook запрещено — согласен.
   Но если `pending` невозможен, нужен альтернативный pre-create status contract.

9. Для `invoice.paid`:
   Не создавать новую подписку.
   Только:
   - найти pre-created subscription;
   - создать order/payment;
   - вызвать grant-access-for-order;
   - активировать найденную subscription.
   
   Если pre-created subscription не найдена → manual_review.

10. Duplicate guard:
   В G3 не только “bePaid active blocks Stripe”.
   Проверить:
   - Stripe active blocks bePaid;
   - Stripe active on account A blocks Stripe on account B;
   - canceled/superseded не блокирует.

11. Test Clock:
   Перед runtime proof добавить discovery:
   - поддерживается ли Test Clock для Checkout Subscriptions в данном аккаунте;
   - можно ли создать Customer с test_clock;
   - совместимо ли это с Checkout Session.
   
   Если нет — использовать короткий recurring interval или manual invoice test strategy.

12. bePaid smoke:
   Не требовать реальный bePaid recurring renewal, если это рискованно/долго.
   Достаточно:
   - read-only freeze;
   - органический recent bePaid recurring check;
   - либо безопасный existing test hook.
   
   Нельзя ради Stripe MVP запускать потенциально рискованный bePaid renewal.

13. Frontend:
   PaymentDialog branch нельзя добавлять до backend MVP green.
   Сначала backend edge + direct admin/test call.
   Потом отдельный UI mini-patch.

14. Memory update не делать в DoD автоматически.
   Только после approve итогового runtime proof.

15. Добавить обязательный раздел:
   “No schema-change decision”
   Если без нового статуса `pending` нельзя корректно pre-create, нужно остановиться и оформить schema mini-plan.

Итог:

План хороший, но есть один критический блокер:

`subscriptions_v2.status=pending` невозможен по текущему enum.

Перед approve execute нужно сначала закрыть sub-discovery:

`Subscription Pending State Strategy`

В нём выбрать один вариант:

A. Добавить `pending` в enum отдельной миграцией.
B. Pre-create без subscriptions_v2, только provider_subscriptions/orders_v2, а subscriptions_v2 создавать после invoice.paid — но это противоречит Discovery.
C. Использовать существующий статус с meta.pending=true — рискованно и нужно доказать безопасность.

Я бы рекомендовал вариант A: add-only расширить enum `subscription_status` значением `pending`, но только отдельным mini-plan + dry-run + proof.

Phase 3.1 — Infinite Subscription MVP
```

Цель: запустить **один** рекуррентный Stripe-тариф в test mode по каноническому write-path, утверждённому в Discovery v1.1. До прохождения Runtime Proof — никаких следующих шагов из роадмапа §23.

## Жёсткий scope (что входит и что НЕ входит)


| Входит                                                                                                      | НЕ входит (явный запрет)                                                   |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Infinite Subscription (бесконечная рекуррентная)                                                            | Subscription Schedule                                                      |
| Pre-create `subscriptions_v2` + `provider_subscriptions` (canonical write-path)                             | Finite installments через Stripe                                           |
| Stripe Checkout `mode=subscription` (один пилотный тариф)                                                   | Pause/Resume Stripe-подписки                                               |
| Webhook handlers: `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed` | Изменения `nightly-access-reconcile`                                       |
| Расширение `subscription-conflict.ts` на provider-agnostic detection                                        | Customer Portal implementation (handlers — да, UI — нет)                   |
| Расширение `provider-linked-extend-priority` на Stripe lookup                                               | Stripe live mode                                                           |
| Один пилотный recurring `tariff_offer` с `meta.recurring.is_recurring=true`                                 | Любые изменения bePaid edge-функций                                        |
| Runtime Proof (Test Clock + реальная test-card)                                                             | Phase 3.2+ (Customer Portal Actions, Dunning runtime, Reconcile, Schedule) |


## STOP-GATE: Price Mapping Validation (обязательный sub-discovery ДО кода)

Это первый блок исполнения MVP. Без зафиксированного решения по mapping — код не пишется.

Что нужно подтвердить и записать в `.lovable/proofs/stripe_phase_3_1_price_mapping_v1.md`:

1. **Где хранится Stripe `price_id` (`price_*`)?**
  Кандидаты:
  - `tariff_offers.meta.stripe.price_id` (add-only через meta, без миграции) — **предлагаемый канон**;
  - отдельная таблица `provider_price_mappings` — отклонить как преждевременную нормализацию;
  - `tariff_offers.meta.stripe.account_code → price_id` словарь — потребуется при multi-account, но в MVP один account.
2. **SOT по цене:**
  - **Stripe Price** — внешняя истина суммы/валюты/интервала;
  - `**tariff_offers.amount` / `currency**` — бизнес-SOT для UI/CRM/документов;
  - `**tariff_offers.meta.stripe.price_id**` — связка, не SOT суммы.
  - **Правило:** при расхождении (Stripe Price amount ≠ `tariff_offers.amount`) — `manual_review`, не продаём.
3. **Кто создаёт Stripe Price?**
  - В MVP — **вручную в Stripe Dashboard** для пилотного тарифа. Автосоздание Product/Price из админки = backlog (Phase 5).
  - В meta также сохраняем `meta.stripe.product_id` (`prod_*`) для traceability.
4. **Валидация на create-checkout:**
  - `price.currency` == `tariff_offer.currency` (case-insensitive);
  - `price.unit_amount` == `tariff_offer.amount` * 100 (toleranceless);
  - `price.recurring.interval` ↔ `tariff_offer.meta.recurring.*` (мапа интервалов);
  - при mismatch → 422 `price_mismatch`, не создаём подписку.
5. **Идемпотентность mapping:** один `tariff_offer.id` ↔ один активный `price_id`. Смена цены = новый `price_id` + supersede старого через `meta.stripe.price_id_history[]`.

**Gate:** approve этого sub-discovery → переход к §1 ниже.

## 1. Затронутые файлы (add-only, без новых колонок в БД)

### Новые edge-функции

- `supabase/functions/stripe-create-subscription-checkout/index.ts` — pre-create + Stripe Checkout `mode=subscription`.

### Существующие edge-функции (add-only расширения)

- `supabase/functions/stripe-webhook/index.ts` — добавить handlers `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`. Существующая one-time ветка не трогается.
- `supabase/functions/_shared/subscription-conflict.ts` — расширить detection на `provider='stripe'` (provider-agnostic по `subscriptions_v2.status`).
- `supabase/functions/_shared/provider-linked-extend-priority` (или ближайший по имени) — добавить Stripe lookup через `provider_subscriptions(provider='stripe')`.
- `supabase/functions/grant-access-for-order/index.ts` — НЕ модифицируется по логике; используется как есть.

### Frontend

- Кнопка checkout на пилотном тарифе — реюз существующего `PaymentDialog` flow с новым `provider='stripe'` branch для recurring (минимальный diff, см. §3).

### Миграций нет

- Все Stripe-данные → `subscriptions_v2.meta.stripe.*`, `provider_subscriptions.meta.stripe.*`, `tariff_offers.meta.stripe.*`, `orders_v2.meta.stripe.*`. Schema contract `subscriptions-v2-schema-contract` соблюдён.

## 2. Канонический поток (фиксация из Discovery)

```
[user clicks pay on pilot recurring tariff]
    ↓
stripe-create-subscription-checkout:
    - subscription-conflict check (provider-agnostic)
    - validate price mapping (§STOP-GATE p.4)
    - pre-create subscriptions_v2(status=pending)
    - pre-create provider_subscriptions(provider=stripe, state=pending,
        tracking_id='stripe_sub:pending:order:<order_id>')
    - stripe.checkout.sessions.create(mode=subscription, price, metadata)
    - return session.url
    ↓
[Stripe Checkout UI → user pays test card 4242…]
    ↓
stripe-webhook receives:
    1. customer.subscription.created → update provider_subscriptions.provider_subscription_id = sub_*
    2. invoice.paid → CANONICAL WRITE PATH (§19 Discovery):
        - create orders_v2 (idem by invoice.id)
        - create payments_v2 (idem by ch_*)
        - call grant-access-for-order(order_id)
        - update subscriptions_v2: pending → active, meta.stripe.current_period_*
        - update tracking_id → 'stripe_sub:{sub_id}:order:{first_order_id}'
        - emit domain_event 'subscription.activated'
    3. customer.subscription.updated → sync state mirror only
    4. invoice.payment_failed → subscriptions_v2.status = past_due (grace, без revoke)
    5. customer.subscription.deleted → subscriptions_v2.status = canceled (доступ до access_end_at)
```

## 3. Frontend (минимальный diff)

- `resolveProductRenewability` уже SOT (см. Product Type SOT). Для пилотного тарифа `meta.recurring.is_recurring=true` уже работает.
- В `PaymentDialog` / `createPaymentCheckout` добавить branch: если `acquiring_provider='stripe'` И `recurring=true` → вызвать `stripe-create-subscription-checkout` вместо bePaid.
- UI-полей не добавляем. Saved-card picker — defer (Saved Card UI Policy).

## 4. Runtime Proof (обязательный, как Stage C)

Документ: `.lovable/proofs/stripe_phase_3_1_subscription_mvp_runtime_v1.md`. Формат — 10-пунктовый прогон, аналогично Stage C.

### Acceptance gates (PASS обязателен по всем)


| #   | Проверка                                                                                                     | Метод                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| G1  | Price mapping validation работает (mismatch → 422)                                                           | unit + curl с подменённым `meta.stripe.price_id`                                            |
| G2  | Pre-create subv2+ps идёт ДО Stripe API call                                                                  | trace: при искусственном fail `subscriptions.create` запись остаётся pending, TTL её чистит |
| G3  | Duplicate guard: вторая попытка купить тот же продукт (bePaid active) блокируется                            | provider-agnostic conflict                                                                  |
| G4  | `customer.subscription.created` → ps.provider_subscription_id обновлён                                       | webhook log + DB row                                                                        |
| G5  | `invoice.paid` (первый) → orders_v2 создан 1 раз, payments_v2 создан, grant-access-for-order вызван          | DB + audit                                                                                  |
| G6  | Идемпотентность: повторная доставка `invoice.paid` (`stripe-list-events` replay) НЕ создаёт второй orders_v2 | `meta.stripe.invoice_id` unique check                                                       |
| G7  | Renewal (Test Clock advance period) → новый orders_v2, extend через GREATEST, tariff_id match                | Test Clock + DB                                                                             |
| G8  | `invoice.payment_failed` → status past_due, доступ НЕ отозван                                                | webhook + UI + DB                                                                           |
| G9  | `customer.subscription.deleted` → status canceled, access сохраняется до access_end_at                       | webhook + DB                                                                                |
| G10 | bePaid контур не затронут (smoke: один bePaid-recurring renewal проходит как раньше)                         | bePaid webhook log + DB                                                                     |


### Двойной прогон оплаты (CR-5 mitigation)

- Pass A: реальная test-card 4242… без Test Clock — первый `invoice.paid`.
- Pass B: Test Clock advance → renewal цикла.
- Оба = PASS-условие.

## 5. STOP-GATE'ы после MVP

После зелёного Runtime Proof — НЕ начинаем следующее без отдельного approve:

- ❌ Customer Portal Actions integration
- ❌ Dunning runtime (полный прогон §20 матрицы)
- ❌ Stripe-ветка `subscriptions-reconcile`
- ❌ Subscription Schedule
- ❌ Live mode

Каждый — отдельный план Phase 3.2 / 3.3 / 3.4 / 4 / 5.

## 6. Definition of Done

- `stripe_phase_3_1_price_mapping_v1.md` approve'нут.
- `stripe-create-subscription-checkout` развёрнута, ENV/secrets подтянуты.
- `stripe-webhook` расширен add-only handlers'ами.
- `subscription-conflict.ts` provider-agnostic.
- `provider-linked-extend-priority` поддерживает Stripe lookup.
- Один пилотный recurring `tariff_offer` сконфигурирован (meta.stripe.price_id, meta.recurring).
- Runtime Proof 10/10 PASS (включая bePaid smoke).
- Memory обновлена: новая запись `stripe-subscription-canonical-write-path` со ссылкой на Discovery v1.1 §17–19.
- Master Sprint Alignment в proof: Phase 3.1 = Done, далее перечислены deferred Phase 3.2+.

## 7. Риски и их mitigation (из Discovery §22)


| Risk                                          | Где закрывается в MVP                                       |
| --------------------------------------------- | ----------------------------------------------------------- |
| CR-1 двойное продление webhook+reconcile      | G6 идемпотентность; reconcile в MVP не трогаем              |
| CR-2 bePaid↔Stripe конфликт                   | §1 расширение subscription-conflict, G3                     |
| CR-3 потеря связки sub↔order                  | manual_review HTTP 200 при lookup miss, не пишем orders     |
| CR-4 неправильный extend по другому tariff_id | extend-tariff-match-required уже работает, проверяется в G7 |
| CR-5 Test Clock vs реальная карта             | двойной прогон Pass A + Pass B                              |


## 8. Что прямо запрещено в этом плане

- Любые UPDATE в bePaid edge-функциях / RPC.
- Создание `subscriptions_v2` из webhook'а как первичной записи.
- Прямой UPDATE `entitlements` / `access_grant_ledger` минуя `grant-access-for-order`.
- Использование `checkout.session.completed` как триггера активации для подписочного режима (только `invoice.paid`).
- Любое автосоздание Stripe Product/Price из админки — backlog Phase 5.
- Включение live mode на любом этапе MVP.

---

После approve этого плана: первым шагом — sub-discovery Price Mapping Validation (STOP-GATE). Код не пишется до её закрытия.