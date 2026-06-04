# Phase 3.1.1 — Price Mapping Validation STOP-GATE — Proof v1

Дата: 2026-06-04. Режим: read-only discovery. Никаких миграций/edge-изменений/Stripe-API-вызовов.

## Итог: **STOP-GATE = FAIL (BLOCKED)**

Phase 3.1 MVP остаётся заблокированным. Перечень gap-задач — в §10.

---

## 1. SOT решение (Шаг 1)

### 1.1 Grep-результат по коду
| Точка | Что хранит | Назначение |
|---|---|---|
| `tariff_offers.meta.stripe_profile` (profile-resolver.ts) | строка-код профиля (`stripe_standard_eur` и т.д.) | резолв `currency`, `payment_method_types`, `mode`, `locale` |
| `tariff_offers.meta.business_stream` (business-stream-resolver.ts) | строка | бизнес-направление |
| `tariff_offers.meta.recurring.*` | объект | `is_recurring`, `billing_period_mode`, `billing_period_days`, `timezone`, расписания, grace |
| `stripe-metadata.ts` — `product_id`, `tariff_id`, `offer_id` | **внутренние UUID нашей БД** | передаются Stripe как `metadata.*` для обратного резолва в webhook |
| `stripe-webhook` `mergeStripeMetaOnOrder` → `orders_v2.meta.stripe.{checkout_session_id, payment_intent_id, charge_id, customer_id, account_code, business_stream}` | snapshot Stripe-ID | per-order, не per-offer |
| `provider_subscriptions.provider_subscription_id` | `sub_*` (per account) | per-subscription |
| `contacts.meta.stripe.customer_id_by_account` (D2 — спроектировано) | `{<account_code>: cus_*}` | per-contact, per-account |
| `tariff_offers.meta.stripe.price_id` / `meta.stripe.product_id` | **НЕТ ни одной записи в БД (0/5), НЕТ ни одной точки чтения в коде** | **проектируемый SOT** |
| `bepaid_product_mappings` | bePaid-only | не относится к Stripe |
| `provider_product_mappings` | **таблица отсутствует** в schema | не относится |
| `tariff_prices` (legacy) | не используется в Stripe-флоу | не SOT для Stripe |
| `acquiring_connections` | per-account уровень (`provider`, `account_code`, `test_mode`, `status`) | НЕ хранит price/product mapping |

### 1.2 Канонический SOT (утверждён)
**Единственное место Stripe Price ↔ tariff_offer mapping:**
```
tariff_offers.meta.stripe = {
  product_id: "prod_*",            // Stripe Product per (offer, account_code)
  price_id:   "price_*",           // активный Stripe Price (recurring для subscription-офферов)
  price_id_history: [              // audit (append-only)
    { old_price_id, rotated_at, actor, reason }
  ]
}
```

**Альтернативные источники — отвергнуты:**
- `provider_product_mappings` — таблицы нет, плодить отдельную сущность для одного поля mapping избыточно.
- `tariff_prices` — legacy, без Stripe-семантики, не используется в новом фуллфилменте.
- `acquiring_connections.meta` — это per-account уровень, не per-offer.
- `provider_subscriptions.meta` — per-subscription, не master mapping.
- inline `stripe-metadata.product_id/tariff_id` — это **наши UUID**, а НЕ Stripe `prod_*`/`price_*`. Семантическое столкновение зафиксировано: имя поля одинаковое, namespace разный (`metadata.product_id` = our UUID; `meta.stripe.product_id` = `prod_*`). В коде MVP запретить пересечение явным naming (`stripe_product_id` в логах/audit).

**DoD §1.2:** ✅ ровно один SOT. Альтернативы отвергнуты с обоснованием.

---

## 2. Pilot tariff_offer выбор (Шаг 2)

### 2.1 Кандидаты (read-only выборка)
SQL: `is_active=true AND meta.recurring.is_recurring=true`. Всего: **5 офферов**, **0** имеют `meta.stripe`.

| offer_id | tariff_id | product | tariff | amount | currency-suffix (UI) | recurring config |
|---|---|---|---|---|---|---|
| `88c6f10d-…fe1c` | `c5981337-…fac13e` | Бухгалтерия как бизнес | Стандартный | 250.00 | BYN | `billing_period_mode=month` |
| `6f306cbc-…2e8e` | `31f75673-…cbf84` | Gorbova Club | CHAT | 100.00 | BYN/месяц | `mode=days, days=30` |
| `c5781abf-…ee77` | `b276d8a5-…22d6c` | Gorbova Club | FULL | 150.00 | BYN | `mode=days, days=30` |
| `d307b438-…ae1c` | `b018e9be-…19080` | Gorbova Club | ИДЕОЛОГИЯ | 350.00 | BYN | `mode=days, days=30` |
| `bc0f7a90-…0d534` | `7c748940-…622d3` | Gorbova Club | BUSINESS | 250.00 | BYN | `mode=days, days=30` |

### 2.2 Рекомендуемый пилот
`Gorbova Club / CHAT` — offer `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e`:
- минимальный amount (100), минимизирует риски на тесте;
- `billing_period_mode=days, billing_period_days=30` — чистый кейс mapping в Stripe (`recurring.interval=day, interval_count=30`);
- Gorbova Club — отдельный business_stream `club`, изолирован.

### 2.3 Pre-requisite gaps на пилоте
| Поле | Состояние | Действие (вне этого STOP-GATE) |
|---|---|---|
| `meta.stripe.product_id` | ❌ отсутствует | Шаг 3 (создать в Stripe) → записать в БД миграцией / админ-UI |
| `meta.stripe.price_id` | ❌ отсутствует | то же |
| `meta.stripe_profile` | ❌ отсутствует | выбрать профиль (Stripe Poland → `stripe_standard_eur` рекомендован; PLN/USD под вопросом валютной политики) |
| `meta.recurring.interval` | ❌ отсутствует (есть только `billing_period_mode/days`) | mapping-правило: `mode=days,days=30` → `interval=day, interval_count=30`; `mode=month` → `interval=month, interval_count=1`. Зафиксировать в MVP-резолвере. |
| `meta.recurring.interval_count` | ❌ отсутствует | то же |
| Валюта оффера | UI показывает BYN, Stripe Poland BYN **не поддерживает** | требуется явное бизнес-решение: пилотировать club в EUR/PLN/USD, либо отложить Stripe для club до решения мульти-валютности. См. `stripe_currency_support_v1.md`. |

**DoD §2:** ⚠️ pilot выбран, но recurring-конфигурация **НЕ полностью определена** (валюта + Stripe interval mapping отсутствуют). FAIL по DoD §2.

---

## 3. Stripe Dashboard Inventory (Шаг 3)

### 3.1 Состояние Stripe-аккаунта
`acquiring_connections`:
- `account_code='stripe_poland'`, `provider='stripe'`, `test_mode=true`, `status='active'`, `last_verified_at=2026-06-03`.
- Secret keys в Vault (через `readAcquiringSecret`), не в env. Стандартного `STRIPE_SECRET_KEY` в окружении агента **нет** (`compgen -e | grep -i stripe` → пусто). Это ожидаемо: ключи в Vault, не в env-секретах сэндбокса.

### 3.2 Inventory Stripe Products/Prices
**НЕ ВЫПОЛНЕНО.** Причина: ни один tariff_offer не содержит `meta.stripe.product_id`/`price_id` → retrieve по `prod_*`/`price_*` невозможен (нечего ретрайвить). Нужен предварительный шаг (см. §10 GAP-A): провижн Stripe Product + recurring Price вручную в Dashboard или через одноразовый admin-скрипт.

**DoD §3:** ❌ FAIL. Конкретный `price_*` не найден.

---

## 4. Validation Matrix (Шаг 4)

| Field | tariff_offer (источник) | Stripe Price (источник) | Match | Примечание |
|---|---|---|---|---|
| currency | `meta.stripe_profile` → `profile-resolver` | `price.currency` | ❌ N/A | `meta.stripe_profile` не задан + BYN не поддерживается Stripe Poland |
| amount | `amount * 100` (мин. единицы) | `price.unit_amount` | ❌ N/A | нет price |
| interval | `meta.recurring.interval` (mapping из `billing_period_mode`) | `price.recurring.interval` | ❌ N/A | mapping-правило не реализовано в коде |
| interval_count | `meta.recurring.interval_count` (mapping) | `price.recurring.interval_count` | ❌ N/A | то же |
| active | (n/a) | `price.active=true` | ❌ N/A | нет price |
| account_code | `acquiring_connections.account_code` | resolve по webhook signing secret | ✅ design-level | per-webhook secret routing уже спроектирован в D10 |
| livemode | — | `price.livemode=false` (test) | ❌ N/A | нет price |

**DoD §4:** ❌ матрица заполнена, **0/7 строк = ✅**. STOP-GATE FAIL.

---

## 5. Validation Contract (Шаг 5)

Спецификация runtime-резолвера `resolveStripePriceForOffer(offer, account_code)` для будущего MVP. Только документ, без кода.

```
INPUT:
  offer: tariff_offers row
  account_code: string

ALGORITHM:
  1. node = offer.meta?.stripe?.accounts?.[account_code] ?? offer.meta?.stripe
     // multi-account future-ready: сначала per-account namespace, fallback на legacy flat.
  2. if !node?.price_id || !node?.product_id
       → HTTP 422 { code: 'price_not_mapped', offer_id, account_code }
       audit: stripe.price_resolve.not_mapped
  3. stripe_price = await stripe.prices.retrieve(node.price_id)
     stripe.account_code resolved by Vault secret per account_code
  4. if !stripe_price.active
       → HTTP 422 { code: 'price_inactive', price_id }
       audit: stripe.price_resolve.inactive
  5. expected_currency = profile-resolver(offer).currency
     expected_unit_amount = round(offer.amount * 100)
     expected = mapRecurring(offer.meta.recurring)  // {interval, interval_count}
  6. mismatches[] = []
     if stripe_price.currency.toUpperCase() !== expected_currency → push 'currency'
     if stripe_price.unit_amount !== expected_unit_amount → push 'amount'
     if !stripe_price.recurring → push 'not_recurring'
     else:
       if stripe_price.recurring.interval !== expected.interval → push 'interval'
       if stripe_price.recurring.interval_count !== expected.interval_count → push 'interval_count'
     if mismatches.length > 0
       → HTTP 422 { code: 'price_mismatch', fields: mismatches, expected, actual }
       audit: stripe.price_resolve.mismatch (+ manual_review=true в orders_v2.meta)
       checkout НЕ создаётся.
  7. PASS → return { price_id, product_id, currency, unit_amount, recurring }

mapRecurring(r):
  if r.billing_period_mode === 'month' → { interval: 'month', interval_count: 1 }
  if r.billing_period_mode === 'days'  → { interval: 'day',   interval_count: r.billing_period_days }
  else → throw 'recurring_mapping_unsupported'  (HTTP 422, code='recurring_mapping_unsupported')
```

**Контракт обязательного audit:** каждое решение (`mapped`, `not_mapped`, `inactive`, `mismatch`, `recurring_mapping_unsupported`) пишет audit_log с `action='stripe.price_resolve.*'`, `actor='system'`, `meta={offer_id, account_code, expected, actual, mismatches}`.

**Контракт checkout:** при любом FAIL (не PASS) `stripe-create-subscription-checkout` возвращает HTTP 422 (не 500, не 200/fallback), checkout НЕ создаётся, `orders_v2` не помечается paid.

**DoD §5:** ✅ контракт задокументирован.

---

## 6. Price Rotation Strategy (Шаг 6)

### 6.1 Разрешено
- Создание нового Stripe Price (`prices.create` через Dashboard или admin-функцию).
- Атомарная замена pointer в `tariff_offers.meta.stripe.price_id` на новый `price_*`.
- Append предыдущего значения в `tariff_offers.meta.stripe.price_id_history[]` со snapshot:
  ```
  { old_price_id: "price_old_*", rotated_at: "ISO", actor: "<user_id|system>", reason: "<text>" }
  ```
- Архивирование старого Stripe Price (`prices.update price_*, active=false`) — обязательно сразу после ротации.

### 6.2 Запрещено
- Изменение существующего Stripe Price (Stripe API не позволяет менять amount/currency/recurring). Запрет — инвариант на стороне Stripe.
- Хранение нескольких **активных** Stripe Price для одного `(tariff_offer, account_code)` в SOT.
- Прямой INSERT/UPDATE `meta.stripe.price_id` мимо canonical-writer (будущая функция `admin-rotate-stripe-price`, спецификация — отдельный mini-plan, не в этом STOP-GATE).

### 6.3 Supersede flow
```
1. admin создаёт новый Price в Stripe (или через admin-rotate-stripe-price).
2. валидация: новая currency/interval/interval_count СОВПАДАЕТ с offer.meta (иначе manual_review).
3. атомарная транзакция в БД:
   - append history entry
   - UPDATE meta.stripe.price_id = new_price_id
   - audit_log: stripe.price.rotated
4. POST к Stripe: prices.update old_price_id, active=false.
5. существующие Subscriptions на старом Price продолжают работать до естественного канцеляра — Stripe не аффектится ротацией Price у уже созданных Subscription'ов (важная гарантия).
```

**DoD §6:** ✅ supersede зафиксирован.

---

## 7. Multi-account Readiness (Шаг 7)

Future-ready схема (только design, без реализации/миграции):
```
tariff_offers.meta.stripe = {
  // legacy single-account namespace (MVP пишет сюда):
  product_id: "prod_*",
  price_id: "price_*",
  price_id_history: [],

  // future multi-account namespace (MVP игнорирует, читает только legacy):
  accounts: {
    "stripe_poland": { product_id, price_id, price_id_history },
    "stripe_eu":     { product_id, price_id, price_id_history },
    "stripe_usa":    { product_id, price_id, price_id_history }
  }
}
```

**Резолвер (см. §5):** `accounts[account_code] ?? legacy flat`. На MVP `accounts` не пишется, не читается — only fallback на flat. Миграция legacy → `accounts.stripe_poland` — отдельный план, ПОСЛЕ появления второго аккаунта.

**DoD §7:** ✅ future-ready схема зафиксирована, реализация отложена.

---

## 8. Runtime Validation Proof (Шаг 8)

**НЕ ВЫПОЛНЕНО.** Причина — §3.2: нечего ретрайвить, ни одного `price_*` в нашей БД, ни одного провижна в Stripe Dashboard под пилот. Runtime-proof станет возможен после закрытия GAP-A (см. §10).

**DoD §8:** ❌ FAIL.

---

## 9. bePaid non-regression (доп. инвариант)

grep по этому proof / Шагам 1–8:
- ни одна модификация bePaid-кода не предусмотрена;
- `bepaid_product_mappings`, `bepaid_statement_rows`, bepaid webhook — НЕ упомянуты как зависимости;
- `subscription-conflict.ts checkPendingCheckoutConflict` (Phase 3.1.0-B) уже provider-agnostic, дополнительных правок не требует.

**DoD §9:** ✅ bePaid не затронут.

---

## 10. PASS/FAIL итог и Gap List

### Итоговый статус DoD
| DoD | Статус |
|---|---|
| §1 единственный SOT утверждён | ✅ |
| §2 pilot recurring полностью определён | ❌ FAIL (валюта + interval mapping) |
| §3 реальный `price_*` найден | ❌ FAIL (не провижнен) |
| §4 validation matrix 7/7 ✅ | ❌ FAIL (0/7) |
| §5 validation contract | ✅ |
| §6 price rotation strategy | ✅ |
| §7 multi-account future схема | ✅ |
| §8 runtime proof Stripe API | ❌ FAIL |
| §9 bePaid не затронут | ✅ |

**STOP-GATE = FAIL.** 4 из 9 DoD не пройдены.

### Gap List (каждый — отдельный mini-plan, не в этом STOP-GATE)

**GAP-A — Pilot Currency Decision (бизнес-решение).**
Stripe Poland не поддерживает BYN. Все 5 recurring-офферов сейчас в BYN. Решение требуется ДО провижна Price:
- (A1) пилотировать в EUR — оффер на Stripe в EUR, отдельный multi-currency UX на лендинге;
- (A2) пилотировать в PLN/USD — аналогично;
- (A3) отложить Stripe Subscription MVP до решения мульти-валютности БкБ/Club.
Влечёт: `meta.stripe_profile` set на пилотном оффере.

**GAP-B — Recurring Interval Mapping в SOT.**
Сейчас `meta.recurring` хранит `billing_period_mode`+`billing_period_days`. Для Stripe нужны `interval`+`interval_count`. Варианты:
- (B1) хранить вычисляемо (резолвер из §5 `mapRecurring`); миграция не нужна.
- (B2) дублировать `meta.recurring.interval`/`interval_count` рядом (snapshot); миграция БД не нужна, but требует backfill на пилоте.
Рекомендация: B1 (нет дублирования SOT).

**GAP-C — Stripe Product+Price provisioning workflow.**
Нет ни UI, ни admin-функции для создания Stripe Product/Price и записи в `meta.stripe`. Варианты:
- (C1) ручное создание в Stripe Dashboard + manual UPDATE через admin SQL — допустимо для одного пилота, не для прода.
- (C2) `admin-provision-stripe-price` edge function — спроектировать как mini-plan PHASE-3.1.1-C; вне этого STOP-GATE.

**GAP-D — Runtime Proof retrieve.**
Блокирован GAP-A/B/C. После провижна пилотного `price_*` — runtime call `prices.retrieve` + сохранение JSON snapshot в `.lovable/proofs/stripe_phase_3_1_1_price_mapping_v2.md`.

### Что РАЗБЛОКИРОВАНО
- ничего. Phase 3.1 MVP остаётся в статусе ⛔.
- разрешено приступить к **mini-plan для GAP-A** (бизнес-решение по валюте) — это разговорная задача, не код.

### Что ОСТАЁТСЯ ЗАБЛОКИРОВАНО (запрет до полного PASS)
- `stripe-create-subscription-checkout`;
- любые subscription webhooks (`customer.subscription.*`, `invoice.paid` recurring branch);
- `provider_subscriptions` wiring для Stripe;
- Stripe runtime subscription тесты;
- Phase 3.1 MVP Execution.

---

## 11. Артефакты

- Этот файл: `.lovable/proofs/stripe_phase_3_1_1_price_mapping_v1.md`.
- Обновление `.lovable/plan.md`: статус 5 → FAIL, перечень GAP A–D.
- Memory candidate: `mem://architecture/payments/stripe-price-mapping-sot-v1` — отдельным approve пользователя (по аналогии с pending-checkout-guard-v1).
