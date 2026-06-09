Да, согласен, с учетом правок:

**Approve на Execute PATCH-SUB-PRICE-1 v2**

План принят. Выполняем как:

Payment Link Amount/Currency Override Parity для Stripe Subscriptions

Цель верная: Stripe-подписочные ссылки должны работать так же, как bePaid/e-clearing/Pay:

админ создал ссылку на конкретную сумму → именно эта сумма используется при оплате

Для Stripe отличие только в том, что дополнительно учитывается валюта и технически для subscription checkout нужен Stripe-compatible recurring line item.

&nbsp;

**Ключевой принцип**

Business SOT для payment link:

payment_links.amount

payment_links.currency

payment_links.payment_type

payment_links.provider

payment_links.offer_id / product_id / tariff_id

Если ссылка создана как:

Gorbova Club — CHAT

1.00 EUR

subscription

provider = stripe

то Stripe Checkout должен быть:

1.00 EUR / subscription

а не 100.00 BYN из базового offer.

&nbsp;

**Обязательная правка к формулировке inline price**

В proof и кодовых комментариях не писать:

inline price_data не оставляет orphan price

Корректная формулировка:

inline price_data не требует заранее сохранённого tariff_offers.meta.stripe.price_id и позволяет создать Checkout Session на сумму/валюту конкретной payment link.

Если используется существующий stripe_product_id, это снижает риск создания лишних Stripe Products, но inline Price всё равно может появляться на стороне Stripe. Это допустимо.

&nbsp;

**Что точно НЕ делать**

Не менять глобально:

tariff_offers.amount

tariff_offers.currency

tariff_offers.meta.stripe.price_id

tariff_offers.meta.stripe.price_snapshot

Не записывать 1.00 EUR как основную цену оффера.

Не менять bePaid/e-clearing/Pay.

Не создавать отдельную новую бизнес-модель custom prices.

&nbsp;

**Исправленный resolver**

**Для payment_link flow**

Если checkout создаётся из payment_link, то Stripe subscription branch должен брать:

amount = payment_links.amount

currency = payment_links.currency

payment_type = payment_links.payment_type

и создавать Stripe Checkout Session с recurring price_data.

**Для non-payment-link flow**

Если checkout создаётся не из payment link, тогда можно использовать старую логику:

tariff_offers.meta.stripe.price_id

Но старый test price в live connection всё равно должен быть зафиксирован как отдельный follow-up:

canonical live price for offer 6f306cbc / 100 BYN is missing or stale

&nbsp;

**Важная правка по условию override**

Не использовать только:

Boolean(payment_link_id)

как единственный критерий.

Лучше явно передавать/определять:

source = payment_link

amount/currency came from payment_links

Потому что payment link всегда имеет сумму, и именно она должна быть SOT для ссылки.

Итоговая логика:

IF source is payment_link:

    use payment_links.amount/currency

ELSE:

    use canonical offer price_id

&nbsp;

**Recurring period**

Периодичность брать из существующего SOT:

tariff_offers.meta.recurring

Если в проекте уже есть helper/resolver для recurring snapshot — использовать его, не писать новую логику с нуля.

Для billing_period_days = 30 использовать тот же mapping, который уже принят в системе.

Если текущая бизнес-модель — 30 дней, не менять её незаметно на календарный месяц, если это меняет смысл доступа/списания.

Если Stripe mapping не может быть построен безопасно — вернуть:

unsupported_recurring_period_for_inline_price

&nbsp;

**Реализация**

**1.**

**_shared/stripe-pre-create-subscription.ts**

Расширить контракт, но сделать его типобезопасным:

type SubscriptionPriceInput =

  | { price_id: string; inline_price?: never }

  | { price_id?: never; inline_price: InlinePriceInput };

Не использовать:

price_id: undefined as any

Для inline_price:

- не делать prices.retrieve;
- не делать drift-check saved price;
- в line_items[0] использовать price_data;
- metadata расширить inline snapshot.

Metadata:

inline_price = true

inline_amount_minor

inline_currency

inline_interval

inline_interval_count

payment_link_id

tariff_offer_id

product_id

tariff_id

account_code

provider = stripe

**2.**

**_shared/create-stripe-checkout.ts**

В subscription branch:

1. определить, что source = payment_link;
2. взять amount/currency из параметров, пришедших из payment_links;
3. построить recurring через существующий recurring resolver;
4. проверить currency/minor units;
5. вызвать stripePreCreateSubscription с inline_price;
6. не читать offer.meta.stripe.price_id для payment_link flow.

**3.**

**stripe-webhook/index.ts**

Read-only сверка:

- webhook должен искать pending subscription/order по metadata.subscription_v2_id;
- не должен зависеть от price_id;
- inline_price metadata должна пройти в subscriptions_v2.meta / provider_subscriptions.meta.

Если это уже так — код не менять, только зафиксировать в proof.

**4. Frontend error mapping**

Добавить человекочитаемые ошибки:

offer_not_recurring_for_subscription_link

unsupported_recurring_period_for_inline_price

currency_not_supported_by_stripe_account

inline_amount_invalid

&nbsp;

**Текущая ссылка для проверки**

Исправляем именно ссылку:

payment_link = 2c02396f…

product = Gorbova Club — CHAT

amount = 1.00

currency = EUR

payment_type = subscription

provider = stripe

account_code = stripe_poland

После фикса она должна открыть Stripe Checkout на:

1.00 EUR / 30 дней

без изменения базовой цены offer.

&nbsp;

**Verify**

**1. Before/after link**

До:

price_retrieve_failed

После:

Stripe Checkout opens successfully

**2. Stripe Checkout**

Проверить:

Gorbova Club — CHAT

1.00 EUR

subscription

**3. После оплаты**

Проверить SQL:

- orders_[v2.final](http://v2.final)_price = 1.00;
- orders_v2.currency = EUR;
- payments_v2.amount = 1.00;
- payments_v2.currency = EUR;
- subscriptions_v2 создана;
- provider_subscriptions создана;
- subscriptions_v2.meta.stripe.inline_price = true;
- price_id = null или отсутствует для inline flow;
- payment_link_id = 2c02396f…;
- entitlement/access выдан корректно.

**4. Offer unchanged**

Обязательно показать before/after:

SELECT id, amount, currency, meta

FROM tariff_offers

WHERE id = '6f306cbc...';

Ожидаемо:

amount/currency/meta.stripe.price_id не изменились

**5. Provider regression**

Проверить smoke:

- один bePaid payment link открывается как раньше;
- Stripe one-time link не сломан;
- e-clearing/Pay logic не менялась.

&nbsp;

**Proof**

Создать:

.lovable/proofs/stripe_subscription_payment_link_amount_override_[v1.md](http://v1.md)

Proof должен содержать:

1. Root cause:  
  

  - old price_id = test-mode;
  - live connection не могла retrieve test price;
  - payment_link amount/currency игнорировались.
2. Подтверждение parity с bePaid/e-clearing/Pay.
3. Before/after по ссылке 2c02396f….
4. Checkout Session payload с price_data.
5. SQL по order/payment/subscription/provider_subscription/entitlement.
6. Before/after tariff_offers без изменений.
7. Webhook lookup через subscription_v2_id.
8. bePaid/e-clearing/Pay untouched.

&nbsp;

**DoD**

PATCH-SUB-PRICE-1 v2 = PASS, если:

- price_retrieve_failed исчез;
- payment link 2c02396f… ведёт в Stripe Checkout;
- Checkout использует 1.00 EUR, а не 100 BYN;
- глобальная цена offer не изменилась;
- подписка создаётся;
- payment/order/subscription/access создаются с суммой ссылки;
- webhook корректно обрабатывает inline-price subscription;
- bePaid/e-clearing/Pay не затронуты;
- proof закрыт.

Начинай Execute.

&nbsp;

План: PATCH-SUB-PRICE-1 v2 — Payment Link Amount/Currency Override Parity для Stripe Subscriptions

## Цель

Сделать Stripe-подписочные ссылки такими же, как bePaid/e-clearing/Pay: **бизнес-источник суммы = `payment_links.amount/currency**`, а не глобальный `tariff_offers.meta.stripe.price_id`. Без отдельной модели «custom price», без изменения базовой цены оффера, без слома существующих провайдеров.

## Diagnose


| Слой                                             | Сейчас (bePaid)                                                    | Сейчас (Stripe one-time)                                                                | Сейчас (Stripe subscription)                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `public-checkout/index.ts`                       | передаёт `link.amount` + `link.currency` в `createPaymentCheckout` | то же                                                                                   | то же                                                                                                          |
| `_shared/create-payment-checkout.ts`             | использует переданный amount → bePaid                              | передаёт amount_major+currency → `createStripeCheckout`                                 | передаёт amount_major+currency → `createStripeCheckout`                                                        |
| `_shared/create-stripe-checkout.ts` one-time     | n/a                                                                | **уже использует amount/currency** (`amountMinor`, `currency.toLowerCase()`) → parity ✅ | —                                                                                                              |
| `_shared/create-stripe-checkout.ts` subscription | n/a                                                                | —                                                                                       | **игнорирует amount/currency**, тащит `offerMeta.stripe.price_id` → 💥                                         |
| `_shared/stripe-pre-create-subscription.ts`      | n/a                                                                | n/a                                                                                     | принимает только `price_id`; делает `prices/{id}` retrieve → `price_retrieve_failed` на test-price в live mode |


**Root cause `price_retrieve_failed`:** `offer 6f306cbc.meta.stripe.price_id = price_1Teeq26UYJj2vm0G…` — это **test-mode BYN 100.00**. Live `stripe_poland` физически не может его retrieve. И даже если бы мог — это была бы цена 100 BYN, а не 1 EUR из ссылки.

**Что НЕ делаем:** не правим `tariff_offers.amount`, `meta.stripe.price_id`, не создаём отдельную таблицу custom prices, не трогаем bePaid path.

## Design — единый Stripe amount/currency resolver

Priority (читается в `create-stripe-checkout.ts` subscription branch):

```text
1. Если payment_link передал amount+currency (caller передал params.amount + params.currency)
   AND payment_link.id присутствует
   → INLINE price_data (см. ниже). НЕ читаем offer.meta.stripe.price_id.

2. Иначе (site CTA / admin sandbox без custom amount)
   → existing path: offer.meta.stripe.price_id + drift-check.
```

Для INLINE-режима recurring-параметры (interval/interval_count) берём ТОЛЬКО из `tariff_offers.meta.recurring.{billing_period_mode, billing_period_days}` (SOT периодичности подписки). Это уже SOT-каноника (`recurring_snapshot_resolver_sot`). Маппинг:

- `billing_period_mode='days', billing_period_days=30` → `interval=month, interval_count=1` (≤31), либо `interval=day, interval_count=N` (>31 или некруглые).
- Только эти два случая в MVP; всё иное → ошибка `unsupported_recurring_period_for_inline_price`.

Stripe product для inline price:

- если есть `offer.meta.stripe.accounts[account_code].product_id` или `offer.meta.stripe.product_id` — реюзаем (`price_data[product] = prod_…`);
- иначе `price_data[product_data][name] = product.name` (Stripe создаёт product on-the-fly, привязан к account).

Currency validation (pre-flight, до Stripe call):

- whitelist по `acquiring_connections.meta.supported_currencies` если есть; иначе мягко допускаем (Stripe сам отдаст 400, мы маппим в `currency_not_supported_by_stripe_account`).

## Изменения по файлам

### 1. `supabase/functions/_shared/stripe-pre-create-subscription.ts`

Расширить `StripePreCreateSubscriptionParams` опциональным взаимоисключающим блоком:

```ts
inline_price?: {
  amount_major: number;
  currency: string;            // 3-letter, UPPER
  interval: 'day'|'week'|'month'|'year';
  interval_count: number;
  product_id?: string | null;  // prod_… (reuse)
  product_name?: string;       // для product_data[name] если product_id нет
};
```

Контракт: ровно один из `price_id | inline_price`. Если `inline_price`:

- Шаг 3 (price retrieve/drift-check) **скипается**.
- Шаг 4 Checkout Session: вместо `line_items[0][price]=price_id` отправляем
  ```
  line_items[0][price_data][currency]=eur
  line_items[0][price_data][unit_amount]=100         // minor units via stripe-minor-units.ts
  line_items[0][price_data][recurring][interval]=month
  line_items[0][price_data][recurring][interval_count]=1
  line_items[0][price_data][product]=prod_…          // OR product_data[name]=...
  ```
- Метаданные Session/subscription_data расширяются:
  - `price_id` → пустая строка ИЛИ ключ `inline_price=1`;
  - `inline_amount_minor`, `inline_currency`, `inline_interval`, `inline_interval_count` — в обоих metadata-блоках;
  - `payment_link_id` уже пробрасывается.
- В `subscriptions_v2.meta.stripe` и `provider_subscriptions.meta.stripe` пишем `inline_price` snapshot вместо `price_id`. `price_id` остаётся `null`.
- Audit `stripe.subscription_checkout.pre_create` получает `inline_price=true` + snapshot.

### 2. `supabase/functions/_shared/create-stripe-checkout.ts`

В subscription branch (≈стр. 386–518) добавить override-логику ПЕРЕД проверкой `price_id`:

```ts
const linkOverride = Boolean(payment_link_id);  // caller передал payment_link
if (linkOverride) {
  // 1. Resolve recurring from offer.meta.recurring
  const rec = (offerMeta.recurring ?? {}) as any;
  if (!rec.is_recurring) return error('offer_not_recurring_for_subscription_link');
  const periodMode = String(rec.billing_period_mode || 'days');
  const periodN = Number(rec.billing_period_days || 30);
  const recurring = mapRecurring(periodMode, periodN);  // helper
  if (!recurring) return error('unsupported_recurring_period_for_inline_price');

  // 2. Reuse Stripe product if present (avoid orphan products)
  const stripeProdId =
    (stripeOnOffer.accounts as any)?.[resolved_account_code]?.product_id
    ?? (stripeOnOffer.product_id as string | undefined)
    ?? null;

  // 3. Currency support pre-flight
  // (мягкая проверка — детально валидирует Stripe)

  // 4. Call helper with inline_price
  const preResult = await stripePreCreateSubscription({
    ...,
    price_id: undefined as any,
    stripe_product_id: stripeProdId,
    inline_price: {
      amount_major: amountMajor,
      currency: currency.toUpperCase(),
      interval: recurring.interval,
      interval_count: recurring.interval_count,
      product_id: stripeProdId,
      product_name: product.name,
    },
  });
  ...
}
// else: оставить существующий path (price_id + drift-check)
```

Existing offer-level `price_id` path остаётся как fallback для site-CTA / admin direct (без `payment_link_id`).

### 3. `supabase/functions/stripe-webhook/index.ts`

Точечная сверка (read-only, без логики write-path): проверить, что webhook на `checkout.session.completed` / `customer.subscription.created` / `invoice.paid` использует `metadata.subscription_v2_id` (а не `price_id`) для lookup. По текущему коду — да, lookup идёт через `metadata.subscription_v2_id` и `metadata.tariff_offer_id`. Изменений не требуется. Зафиксировать в proof.

### 4. UI — без изменений

`CreatePublicLinkDialog` уже умеет provider+currency+amount per Phase 4 backlog (или достаточно, чтобы создать такую ссылку вручную). UX-расширение — отдельный backlog (не в этом патче).

## Validation rules (новые ошибки)

- `offer_not_recurring_for_subscription_link` — ссылка subscription, а у оффера нет `recurring.is_recurring=true`.
- `unsupported_recurring_period_for_inline_price` — нестандартный период (например 45 дней / weeks с дробным count).
- `currency_not_supported_by_stripe_account` — маппинг Stripe `currency` 400 → понятный код для UI.
- `inline_amount_invalid` — amount <= 0 или конверсия в minor units упала.

`errorMessageMap` (frontend `normalizeEdgeFunctionError`) — добавить русские строки.

## Что НЕ делаем

- Не правим `tariff_offers.amount` / `meta.stripe.price_id` / `price_snapshot`.
- Не создаём новый Stripe `price_*` объект в Stripe заранее (inline price_data — встроенный механизм Stripe, не оставляет orphan price).
- Не трогаем bePaid / e-clearing / Pay код.
- Не меняем admin sandbox direct-checkout flow (`stripe-create-subscription-checkout`) — он не идёт через payment_link override; останется на classic `price_id`.
- Не меняем хранение/чтение entitlements/access_rules.

## Dry run

Под ссылку `2c02396f` (CHAT, 1.00 EUR, subscription, provider=stripe, account=stripe_poland; offer `6f306cbc` recurring 30 days):

- Resolver выбирает inline_price: `amount_major=1, currency=EUR, interval=month, interval_count=1, product=prod_UdwjYeet4QFbtW`.
- `subscriptions_v2(pending)` + `provider_subscriptions(pending)` создаются с `meta.stripe.inline_price` snapshot, `price_id=null`.
- Stripe Checkout Session создаётся успешно (нет retrieve test price).
- После оплаты webhook привязывает `subscription_v2_id` через metadata → `grant-access-for-order` стандартный путь.
- Глобальная цена offer (100 BYN) и его `price_id` НЕ затронуты.

## Execute (build mode)

1. Изменить `_shared/stripe-pre-create-subscription.ts` (доб. `inline_price`).
2. Изменить `_shared/create-stripe-checkout.ts` subscription branch (resolver).
3. Добавить helper `mapRecurringToStripeInterval()` рядом (или в `stripe-minor-units.ts` соседом).
4. Расширить `normalizeEdgeFunctionError` mapping (frontend) новыми кодами.
5. Создать proof `.lovable/proofs/stripe_subscription_payment_link_amount_override_v1.md`.

## Verify

1. Открыть live preview `/pay/<token>` для ссылки `2c02396f` → переход на Stripe Checkout без `price_retrieve_failed`.
2. Stripe Checkout показывает `1.00 EUR / month`, привязан к product CHAT.
3. После test-оплаты (или прерывания): через `supabase--read_query` подтвердить
  - `subscriptions_v2.meta.stripe.inline_price` есть, `price_id=null`;
  - `tariff_offers` не изменился;
  - bePaid links по другим продуктам открываются как раньше (smoke: 1 bePaid one-time link).
4. SQL guard: `select … from tariff_offers where id='6f306cbc…'` — до/после идентичен.
5. Edge logs `stripe-webhook` после оплаты: lookup по `subscription_v2_id` PASS.

## DoD

- Ссылка `2c02396f` открывает Stripe Checkout на 1.00 EUR / 30 дней.
- `tariff_offers.amount/meta.stripe.price_id` не изменён (snapshot до/после в proof).
- bePaid/e-clearing/Pay не затронуты (smoke на 1 bePaid link + кодовый diff = только Stripe-файлы).
- Proof `.lovable/proofs/stripe_subscription_payment_link_amount_override_v1.md` создан с before/after, payload Stripe Checkout, SQL snapshots, root cause `price_retrieve_failed`.
- Новые ошибки добавлены в `normalizeEdgeFunctionError`.
- Все изменения в read-only режиме для существующих данных (только новые `subscriptions_v2(pending)` строки при тесте).

## Технические детали (для review)

- Stripe inline price_data поддерживает `recurring` начиная с API 2019-09-09; наш Stripe API version 2024-… совместим.
- `price_data[product]` reuses existing Stripe Product → не создаёт orphan `prod_*` на каждый чекаут.
- Idempotency key `subv2:{subscription_v2_id}:create` остаётся неизменным — гарантия 1 Session на pending sub.
- Drift-check (active/livemode/recurring) для inline path не нужен: amount/currency/recurring задаём сами; mode определяется секретным ключом (live ↔ live).
- Rollback path в `stripe-pre-create-subscription.ts` не меняется.

Approve на Execute?