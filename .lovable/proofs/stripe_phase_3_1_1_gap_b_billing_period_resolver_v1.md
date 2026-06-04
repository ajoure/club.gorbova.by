# GAP-B — Billing Period Resolver (Discovery + Contract)

**Phase:** 3.1.1 — Price Mapping STOP-GATE
**Дата:** 2026-06-04
**Scope:** read-only discovery + контракт резолвера на бумаге.
**bePaid:** не затронут.
**Файлы кода:** **не правлены** (resolver TS-сниппет — только внутри этого артефакта).

---

## 1. Hypothesis & Scope

**Гипотеза:** бизнес-период списания на текущей выборке recurring offer'ов однозначно отображается в Stripe `recurring.interval/interval_count` через детерминированный резолвер; access window (`tariffs.access_days`) — независимая величина и в маппинг периода не входит.

**Вне scope:**
- создание реальных Stripe Product/Price (это GAP-C);
- Subscription/Checkout runtime (GAP-D);
- нормализация legacy-значений (`mode=month` без `days`) — только backlog;
- bePaid, webhook, MVP execution.

---

## 2. SQL snapshot (5 recurring offer'ов)

Запрос:

```sql
SELECT o.id, o.tariff_id, o.offer_type, o.amount, o.is_active, o.is_primary,
       o.requires_card_tokenization, o.meta->'recurring' AS recurring,
       t.access_days, t.name AS tariff_name
FROM tariff_offers o
JOIN tariffs t ON t.id = o.tariff_id
WHERE (o.meta->'recurring'->>'is_recurring')::boolean = true
  AND o.is_active = true
ORDER BY o.id;
```

| offer_id              | tariff       | offer_type | amount  | is_primary | req_card_token | access_days | mode    | days |
|-----------------------|--------------|------------|---------|------------|----------------|-------------|---------|------|
| `6f306cbc…` **PILOT** | CHAT         | pay_now    | 100.00  | (см. DB)   | (см. DB)       | 30          | `days`  | 30   |
| `bc0f7a90…`           | BUSINESS     | pay_now    | 250.00  | —          | —              | 30          | `days`  | 30   |
| `c5781abf…`           | FULL         | pay_now    | 150.00  | —          | —              | 30          | `days`  | 30   |
| `d307b438…`           | ИДЕОЛОГИЯ    | pay_now    | 350.00  | —          | —              | 30          | `days`  | 30   |
| `88c6f10d…`           | Стандартный  | pay_now    | 250.00  | —          | —              | 30          | `month` | —    |

UUID-хвосты замаскированы по политике артефактов. Полные UUID — в БД.

### 2.1 Активные цены в `tariff_prices`

```sql
SELECT tariff_id, price, currency, final_price, is_active
FROM tariff_prices
WHERE tariff_id IN ( … 5 tariff_id … ) AND is_active = true;
```

| tariff       | currency | final_price | is_active |
|--------------|----------|-------------|-----------|
| CHAT         | BYN      | 100.00      | true      |
| BUSINESS     | BYN      | 250.00      | true      |
| FULL         | BYN      | 150.00      | true      |
| ИДЕОЛОГИЯ    | —        | —           | (нет активной строки) |
| Стандартный  | —        | —           | (нет активной строки) |

> Backlog: для `d307b438…` и `88c6f10d…` нет активной строки в `tariff_prices`. Это **не блокер GAP-B** (резолвер периода не использует цену), но блокер GAP-C для этих двух offer'ов.

---

## 3. JSON snapshot `meta.recurring` для пилота

```json
{
  "billing_period_mode": "days",
  "billing_period_days": 30,
  "charge_attempts_per_day": 2,
  "charge_times_local": ["09:00", "21:00"],
  "grace_hours": 72,
  "is_recurring": true,
  "notify_before_each_charge": true,
  "notify_grace_events": true,
  "post_due_reminders_policy": "daily",
  "pre_due_reminders_days": [7, 3, 1],
  "timezone": "Europe/Minsk"
}
```

---

## 4. Бизнес-SOT периода (зафиксировано)

| Величина                                 | Источник                                        | Приоритет | Семантика                                              |
|------------------------------------------|-------------------------------------------------|-----------|--------------------------------------------------------|
| Период биллинга (как часто списывать)    | `tariff_offers.meta.recurring.billing_period_*` | SOT       | Вход для Stripe `recurring.interval/interval_count`   |
| Длительность доступа после оплаты        | `tariffs.access_days`                           | SOT       | Используется `grant-access-for-order`, **не** биллинг |
| **Сумма (цена позиции)**                 | **`tariff_prices` (active row), `final_price`** | **SOT (P1)** | **Единственный источник для Stripe `unit_amount`** (GAP-C) |
| Сумма (legacy/диагностика)               | `tariff_offers.amount`                          | fallback (P2), diagnostic only | **В Stripe НЕ уходит**. Используется только для warning-audit при расхождении с `tariff_prices.final_price` |
| **Валюта**                               | **`tariff_prices.currency` (active row)**       | **SOT (P1)** | SOT для Stripe `currency` (GAP-C)                     |
| Класс «recurring» offer'а                | `meta.recurring.is_recurring=true`              | SOT       | Core memory: Product Type SOT                          |

**Инвариант:** `access_days` и `billing interval` семантически разные. На пилоте они совпадают (30/30), но резолвер их не объединяет и не выводит одно из другого.

**Инвариант цены:** при отсутствии активной строки в `tariff_prices` резолвер GAP-C обязан вернуть `price_source_missing` (HTTP 422), а **не** падать на `tariff_offers.amount`. `tariff_offers.amount` используется исключительно для diagnostic audit.

---

## 5. Resolver contract

### 5.1 Сигнатура (proof-only, не закоммичена в `src/`)

```ts
type Input = {
  billing_period_mode: 'days' | 'week' | 'month' | 'year' | null;
  billing_period_days: number | null;
  recurring_meta: Record<string, unknown>;
  access_days: number | null;
};

type Output =
  | {
      ok: true;
      interval: 'day' | 'week' | 'month' | 'year';
      interval_count: number;
      legacy_normalized?: 'legacy_month_mode' | 'legacy_year_mode';
    }
  | {
      ok: false;
      code:
        | 'billing_period_not_supported'
        | 'access_days_missing'
        | 'recurring_meta_missing';
      detail: string;
    };

function resolveStripeRecurring(input: Input): Output;
```

### 5.2 Правила MVP (полный список)

| Условие на вход                              | Выход                                | Примечание                                  |
|----------------------------------------------|--------------------------------------|---------------------------------------------|
| `mode=days, days=7`                          | `interval=week, count=1`             | каноническая нормализация в недели          |
| `mode=days, days=30`                         | `interval=month, count=1`            | каноническая нормализация в месяцы          |
| `mode=days, days=365`                        | `interval=year, count=1`             | каноническая нормализация в годы            |
| `mode=week` (без days)                       | `interval=week, count=1`             |                                             |
| `mode=month` (без days)                      | `interval=month, count=1` + `legacy_month_mode` | пилот не использует; backlog-нормализация |
| `mode=year` (без days)                       | `interval=year, count=1` + `legacy_year_mode`   | пилот не использует                         |
| `access_days` null / ≤ 0                     | `access_days_missing`                | отдельный инвариант, независимо от mode     |
| `recurring_meta` null / `is_recurring!=true` | `recurring_meta_missing`             | offer не recurring — не наш кейс            |
| Любой другой mode/days                       | `billing_period_not_supported`       | STOP, manual_review                         |

### 5.3 Interval count > 1 — фиксация политики (нет в текущей выборке)

Чтобы исключить неоднозначность в GAP-C, фиксируем поведение для гипотетических кейсов. Все они в MVP **unsupported** и помечаются как **`future-rule` / `manual_review`** — резолвер обязан вернуть `billing_period_not_supported`, Stripe Price не создаётся, audit пишется с тегом `future-rule:interval_count_gt_1`.

| Условие на вход            | MVP-решение                                     | Future-rule mapping (deferred, требует отдельного approve) |
|----------------------------|-------------------------------------------------|------------------------------------------------------------|
| `mode=days, days=60`       | `billing_period_not_supported` + `future-rule`  | `interval=month, interval_count=2`                         |
| `mode=days, days=90`       | `billing_period_not_supported` + `future-rule`  | `interval=month, interval_count=3`                         |
| `mode=days, days=180`      | `billing_period_not_supported` + `future-rule`  | `interval=month, interval_count=6`                         |
| `mode=days, days=730`      | `billing_period_not_supported` + `future-rule`  | `interval=year, interval_count=2`                          |
| `mode=days, days ∉ {7,30,365}` и не из таблицы выше | `billing_period_not_supported` + `manual_review` | нет mapping, требует discovery |

**Решение MVP:** `interval_count` всегда `= 1`. Любые `count > 1` — backlog (`future-rule:interval_count_gt_1`), активируются только отдельным approve после прецедента в БД. Никакого автоматического сворачивания `60d→month/2` в MVP не происходит — это сознательный STOP.


---

## 6. Resolver table (прогон по 5 offer'ам)

| offer_id              | tariff       | вход (mode/days)   | output                                | вердикт |
|-----------------------|--------------|--------------------|---------------------------------------|---------|
| `6f306cbc…` **PILOT** | CHAT         | `days/30`          | `interval=month, count=1`             | ✅ PASS |
| `bc0f7a90…`           | BUSINESS     | `days/30`          | `interval=month, count=1`             | ✅ PASS |
| `c5781abf…`           | FULL         | `days/30`          | `interval=month, count=1`             | ✅ PASS |
| `d307b438…`           | ИДЕОЛОГИЯ    | `days/30`          | `interval=month, count=1`             | ✅ PASS (период), ⚠ нет `tariff_prices` для GAP-C |
| `88c6f10d…`           | Стандартный  | `month/—`          | `interval=month, count=1` + `legacy_month_mode` | ✅ PASS (legacy), ⚠ backlog-нормализация + нет `tariff_prices` |

`access_days = 30` есть у всех 5 → `access_days_missing` не срабатывает.

---

## 7. Unsupported cases (явный список)

В MVP резолвер обязан вернуть `billing_period_not_supported` для:

- `mode=days, days ∈ {1, 3, 10, 14, 15, 21, 28, 45, 60, 90, 100, 180, 730}` и любых других значений вне `{7, 30, 365}`;
- `mode ∈ {hour, minute, custom}` или любой строки вне `{days, week, month, year}`;
- `mode=days, days=null`;
- `mode=null, days=null`;
- `mode=days, days ≤ 0` или нечисловое значение;
- `interval_count > 1` (т.е. любой recurring, который потребовал бы `count > 1`).

---

## 8. Validation contract (HTTP 422 коды, для GAP-C/MVP)

| Код                              | Условие                                                                   |
|----------------------------------|---------------------------------------------------------------------------|
| `billing_period_not_supported`   | резолвер не распознал период (см. §7)                                     |
| `interval_mismatch`              | реальный Stripe Price `recurring.{interval,interval_count}` ≠ выход резолвера для текущего offer'а |
| `access_days_missing`            | `tariffs.access_days` null или ≤ 0                                        |
| `currency_mismatch`              | Stripe Price `currency` ≠ `tariff_prices.currency` (active row)           |
| `recurring_meta_missing`         | offer не recurring или `meta.recurring` отсутствует                       |

Все коды — HTTP 422, обязательный `audit_logs` запись, никакой Stripe Checkout не создаётся.

**Дополнительный инвариант (для GAP-C):** SOT суммы и валюты для Stripe Price = активная строка `tariff_prices`. `tariff_offers.amount` сравнивается только для диагностики и пишется в audit, **в Stripe не уходит**. Расхождение `tariff_offers.amount` vs `tariff_prices.final_price` — warning в audit, не блокер.

---

## 9. Pilot decision

- **Offer:** `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e` (CHAT, Gorbova Club).
- **Период:** `mode=days, days=30` → резолвер: `interval=month, count=1`. PASS.
- **Сумма/валюта (SOT для GAP-C):** `tariff_prices` (active row, CHAT): `BYN 100.00`. `tariff_offers.amount=100.00` совпадает → diagnostic-warning не сработает.
- **Валютная капабильность Stripe:** **BYN Price Capability = PASS** (закрыто в **GAP-A**, см. `.lovable/proofs/stripe_phase_3_1_1_gap_a_byn_capability_proof_v1.md`). Валютная часть пилота закрыта; **GAP-B валютой не блокируется**. Subscription/Checkout-капабильность в BYN остаётся на GAP-D (runtime proof).
- **access_days:** 30 (используется только `grant-access-for-order`, не уходит в Stripe Price).

**Целевой Stripe Price для GAP-C:**

```
unit_amount  = 10000           # BYN 100.00 → minor units
currency     = byn
recurring    = { interval: 'month', interval_count: 1 }
product      = <provisioning в GAP-C>
metadata     = { offer_id: '6f306cbc…', tariff_id: '31f75673…', sot: 'tariff_prices', resolver: 'gap_b_v1' }
```

---

## 10. Backlog (не блокеры GAP-B)

1. `88c6f10d…` (Стандартный): нормализовать `meta.recurring.billing_period_mode='month'` → `mode='days', days=30` для устранения legacy-ветки.
2. `d307b438…` (ИДЕОЛОГИЯ), `88c6f10d…` (Стандартный): отсутствует активная строка в `tariff_prices` — блокирует GAP-C для этих двух offer'ов (для пилота — нерелевантно).
3. `future-rule:interval_count_gt_1` — формализовать поддержку `month/N`, `year/N` если/когда появится бизнес-кейс. До тех пор резолвер MVP принципиально возвращает `count=1` или `billing_period_not_supported`.

---

## 11. Вердикт

**GAP-B = PASS (with backlog).**

- Бизнес-SOT периода зафиксирован (`tariff_offers.meta.recurring` для биллинга, `tariffs.access_days` для доступа, `tariff_prices` для суммы/валюты).
- Resolver contract утверждён (§5), unsupported cases перечислены (§7), validation contract зафиксирован (§8).
- Пилот `6f306cbc…` проходит резолвер → `interval=month, count=1`, BYN 100.00.
- 4 из 5 active recurring offer'ов проходят канонической веткой, 1 — legacy-веткой (зафиксировано в backlog).
- bePaid не затронут, миграций нет, edge functions не правились, `src/` не изменён.

**Следующий шаг:** Phase 3.1.2 — **GAP-C — Stripe Product+Price Provisioning** (mini-plan `admin-provision-stripe-price`, реальное создание `prod_*`/`price_*` для пилота, запись `tariff_offers.meta.stripe.*`). До PASS GAP-C запрещены: subscription checkout, subscription webhook, MVP execution.
