# Cohort B — Задача 1 dry-run (3 × paid_without_payment)

Дата: 2026-05-03. Скоуп: только diagnose, ни одной мутации.

---

## Кейс 1.1 — `97e22bb3` ↔ платёж `c42ea072` (привязка)

### Текущее состояние

**Order `97e22bb3-9b9d-4bd1-a01a-e0eda7c0145c`** (`15-club-ТО-N8GLF6`):
- status=`paid`, final_price=250.00 BYN, paid_amount=250.00
- email=`bogy98@mail.ru`, user_id=`8d974225-b89c-4a97-9ce3-9b0c4041ea5d`
- product=`11c9f1b8` (Gorbova Club), tariff=`7c748940`
- created_at=2025-07-24 13:33:59+00
- meta: `source=admin_bulk_from_payments`, `deal_only=true`, `is_historical=true`,
  `payment_id=c42ea072-a927-4f84-9990-1ce0b4a09e3c`

**Payment `c42ea072-a927-4f84-9990-1ce0b4a09e3c`**:
- status=`succeeded`, amount=250.00 BYN
- **order_id = NULL** (orphan)
- user_id=NULL, profile_id=`066bbf20-61f6-4cf6-9493-25c1ba75bdc8`
- provider=`bepaid`, provider_payment_id=`6ab67f6c-…`
- paid_at=2025-07-24 13:33:59+00
- meta: `bepaid_description="Оплата по сделке 30880061 (Gorbova Club)"`,
  `materialized_from_queue=true`

### Match-проверки

| Проверка | Order | Payment | Совпадение |
| -------- | ----- | ------- | ---------- |
| amount | 250.00 | 250.00 | ✅ |
| currency | BYN | BYN | ✅ |
| дата | 2025-07-24 13:33:59 | 2025-07-24 13:33:59 | ✅ (до секунды) |
| meta.payment_id ↔ id | c42ea072 | c42ea072 | ✅ |

### Конкуренция за платёж

- `payments_v2` где order_id = `97e22bb3...` : **0** (других paymentов нет, конкуренции нет)
- `orders_v2` где `meta.payment_id = 'c42ea072...'` : **1** (ровно `97e22bb3`)

### Ожидаемая мутация

```sql
UPDATE payments_v2
SET order_id   = '97e22bb3-9b9d-4bd1-a01a-e0eda7c0145c',
    user_id    = '8d974225-b89c-4a97-9ce3-9b0c4041ea5d',
    updated_at = now(),
    meta       = meta || jsonb_build_object(
      'repair_2026_05', jsonb_build_object(
        'reason', 'historical_admin_bulk_link',
        'order_id', '97e22bb3-9b9d-4bd1-a01a-e0eda7c0145c',
        'previous_order_id', null,
        'previous_user_id', null,
        'audit_action', 'orders.repair_link_payment_2026_05'
      )
    )
WHERE id = 'c42ea072-a927-4f84-9990-1ce0b4a09e3c';
```
Ожидаемый rowcount = **1**.

### Вердикт 1.1: ✅ **OK**

Совпадение однозначное по сумме/валюте/дате/meta-ссылке, конкуренции нет.

---

## Кейс 1.2 — `c0af8ad4` (legacy дубль) → перепривязка sub `cd8791aa`

### Текущее состояние

**Order `c0af8ad4-fb04-4c13-bc6e-7721ca1e8da5`** (`ORD-26-MKDNM34Z`):
- status=`paid`, 250.00 BYN, email=`slmmls@mail.ru`, user=`a8b321b2-779b-42b8-a8d4-bde8ecba7dac`
- created_at=2026-01-14 06:42:58
- meta: `superseded_by_repair=true`, `repair_reason=bepaid_uid_collision_legacy_duplicate`,
  `legacy_order_id=f7749162-5cd4-4d68-93aa-d4ade9ce24bc`,
  `bepaid_subscription_id=sbs_2c7191865864fef9`,
  `gc_sync_status=success`
- payments_v2 для этого order: **0**

**Subscription `cd8791aa-7463-4d8d-b963-5a5904bf7170`**:
- status=`active`, auto_renew=true
- access_end_at=2026-05-10 20:59:59+00
- **order_id = `c0af8ad4`** ← ссылка на superseded дубль
- meta: `bepaid_subscription_id=sbs_4665c1ef51f08fb1` (⚠ ОТЛИЧАЕТСЯ от order),
  `extended_by_orders=[d27fb304-…]`,
  `last_renewal_order_id=58fb5747-0e7f-495b-a417-368d5aadb713`

### Поиск canonical order (строгий)

История user `a8b321b2` × product Club × tariff 7c748940 (chronological):

| created_at | order_id | order_number | status | paid_pmt | meta.bepaid_sub | superseded |
| ---------- | -------- | ------------ | ------ | -------- | --------------- | ---------- |
| 2025-10-13 | 5f928b61 | 6-club-МГ-R5IRAE | paid | 1 | — | — |
| 2025-11-12 | 98234189 | 5-club-МГ-R5H52T | paid | 1 | — | — |
| 2025-12-12 | 963041aa | 4-club-МГ-R4CKP3 | paid | 1 | — | — |
| **2026-01-12** | **`1ea274b1-9720-4258-baf4-d3e49cb754b5`** | **ORD-26-MKD2FTZC** | **paid** | **1** | **sbs_2c7191865864fef9** | — |
| 2026-01-14 | `c0af8ad4` (legacy dupe) | ORD-26-MKDNM34Z | paid | **0** | sbs_2c7191865864fef9 | **true** |
| 2026-02-11 | 58fb5747 | REN-MLHMFKRG | paid | 1 | — | — |
| 2026-03-11 | d27fb304 | SUB-LINK-MMLMRNMZ | paid | 1 | sbs_4665c1ef51f08fb1 | — |
| 2026-04-10 | 38759c95 | REBILL-d26c6a68-ea6 | paid | 1 | — | — |

### Critical match для canonical

- Только **1 кандидат** удовлетворяет всем условиям:
  - тот же `legacy_order_id=f7749162` ✅
  - тот же `meta.bepaid_subscription_id=sbs_2c7191865864fef9` ✅
  - имеет succeeded payment (eb26cbc4, 250 BYN, paid_at 2026-01-12) ✅
  - не помечен superseded ✅
  - paid_payments=1 ✅
- → **canonical = `1ea274b1-9720-4258-baf4-d3e49cb754b5`**
- subscriptions_v2 где order_id = `1ea274b1` : **0** (свободен, конфликта при relink нет)

### Ожидаемая мутация

```sql
UPDATE subscriptions_v2
SET order_id   = '1ea274b1-9720-4258-baf4-d3e49cb754b5',
    updated_at = now(),
    meta       = meta || jsonb_build_object(
      'repair_2026_05', jsonb_build_object(
        'reason', 'bepaid_uid_collision_relink_to_canonical',
        'previous_order_id', 'c0af8ad4-fb04-4c13-bc6e-7721ca1e8da5',
        'canonical_order_id', '1ea274b1-9720-4258-baf4-d3e49cb754b5',
        'audit_action', 'subscriptions.repair_relink_canonical_order_2026_05'
      )
    )
WHERE id = 'cd8791aa-7463-4d8d-b963-5a5904bf7170';
```
Ожидаемый rowcount = **1**. Order `c0af8ad4` НЕ удаляется в Задаче 1.

### Вердикт 1.2: ✅ **OK**

Canonical найден строго один (`1ea274b1`), все 5 критериев матча сходятся,
свободен от других подписок. STOP-условий нет.

⚠ Замечание (не блокирует): подписка `cd8791aa` сейчас работает по более новому
bepaid_sub `sbs_4665c1ef51f08fb1` (с March), но `order_id` всё ещё указывает
на исходный origin. Перепривязка восстанавливает правильный origin внутри
истории (1ea274b1 — первая успешная оплата той же подписочной линии).

---

## Кейс 1.3 — `02302928` (3DS не прошёл, paid → canceled)

### Текущее состояние

**Order `02302928-7d5d-4bc0-b2ab-c58029b491ac`** (`ORD-ADM-1769114549787`):
- status=`paid`, final_price=250.00 BYN, paid_amount=250.00
- email=NULL, user_id=`0d25c910-5c34-41fd-9ba7-267ad13e7e31` (anna_zaenchkovskaya)
- product=`11c9f1b8`, tariff=`7c748940`, created_at=2026-01-22 20:42:29
- meta:
  - `type=admin_manual_charge`
  - `previous_status=pending`
  - `requires_3ds=true`
  - `error="Карта требует 3D-Secure верификацию…"`
  - `repair_reason=3ds_redirect_reconciled_no_payment`
  - `superseded_by_repair=true`
  - `reconciled_by=orders.reconcile_from_payments`

### Сторонние ссылки

- payments_v2 где order_id = `02302928…` : **0**
- access_grant_ledger где order_id = `02302928…` : **0**
- subscriptions_v2 где order_id = `02302928…` : **0**

### Подтверждающий контекст

Через 20 минут после `02302928` тот же user успешно оплачивает заново через
order `832f0803` (`ORD-26-MKPXU4YT`, 2026-01-22 21:02:24, paid_payments=1),
который и стал основой для подписки `51e1635d` (later superseded `cedd1d7f`).
Текущая активная sub user-а живёт на `79f28cbb` до 2026-05-21.

→ `02302928` — провалившийся 3DS-charge, ошибочно поднятый reconcile-engine
в `paid`. Никакой бизнес-логики на нём нет.

### Ожидаемая мутация

```sql
UPDATE orders_v2
SET status      = 'canceled',
    paid_amount = 0,
    updated_at  = now(),
    meta        = meta || jsonb_build_object(
      'repair_2026_05', jsonb_build_object(
        'reason', '3ds_failed_no_payment_reverted',
        'previous_status', 'paid',
        'previous_paid_amount', 250.00,
        'audit_action', 'orders.repair_status_correction_2026_05'
      )
    )
WHERE id = '02302928-7d5d-4bc0-b2ab-c58029b491ac';
```
Ожидаемый rowcount = **1**.

### Вердикт 1.3: ✅ **OK**

Никаких ledger / sub / payment ссылок нет, доступ не зависит от этого order.
Безопасное status correction.

---

## Сводный итог dry-run

| Кейс | Order | Действие | rowcount | Вердикт |
| ---- | ----- | -------- | -------- | ------- |
| 1.1 | 97e22bb3 | UPDATE payments_v2 SET order_id+user_id | 1 | ✅ OK |
| 1.2 | c0af8ad4 | UPDATE subscriptions_v2 SET order_id (relink to 1ea274b1) | 1 | ✅ OK |
| 1.3 | 02302928 | UPDATE orders_v2 SET status='canceled', paid=0 | 1 | ✅ OK |

**Все 3 кейса прошли STOP-проверки. Готов к Execute по отдельному approve.**

Гарантии при Execute (если будет approve):
- Каждая мутация отдельной транзакцией (не batch).
- Перед UPDATE — `SELECT ... FOR UPDATE` целевой строки.
- В каждой транзакции — `INSERT INTO audit_logs(...)` с before/after snapshot.
- После UPDATE — verify rowcount=1, иначе ROLLBACK.
- После всех 3 — пересчёт Cohort B (новая разбивка 42/18/0 по подгруппам).

Cohort B пересчёт после Задачи 1 (НЕ использовать старые числа для Задачи 2)
будет выполнен отдельным dry-run.
