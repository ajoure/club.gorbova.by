# да, согласен

Дополнительно рекомендую добавить в GAP-B ещё 3 проверки, чтобы потом не возвращаться к этому этапу:

1. **Interval count > 1**
  - Явно проверить и зафиксировать поведение для будущих кейсов:
    - 60 дней → month/2
    - 90 дней → month/3
    - 180 дней → month/6
    - 730 дней → year/2
  - Даже если сейчас таких тарифов нет, зафиксировать как unsupported или future-rule, чтобы не появилось неоднозначностей в GAP-C.
2. **Источник цены**
  - В proof явно указать приоритет:
    - SOT цены для Stripe Mapping = активная запись `tariff_prices`;
    - `offer.amount` используется только как fallback/legacy-поле для диагностики.
  - Иначе позже может возникнуть конфликт между `tariff_offers.amount` и `tariff_prices.final_price`.
3. **BYN вывод**
  - В разделе Pilot Decision добавить ссылку на завершённый GAP-A:
    - BYN Price Capability = PASS.
    - Для пилота валютная часть считается закрытой.
    - В GAP-B валютные проверки не являются блокером.

После PASS GAP-B следующий шаг должен быть:

**Phase 3.1.2 — GAP-C Provisioning Strategy (Stripe Product + Price provisioning)**

И только после закрытия GAP-C можно переходить к реализации **Phase 3.1 Infinite Subscription MVP**.

&nbsp;

План: GAP-B — Billing Period Resolver (Discovery)

## 0. Жёсткие правила

- Только discovery + контракт резолвера на бумаге.
- Никаких реальных Stripe Price (`admin-provision-stripe-price` запрещён).
- Никаких миграций, edge functions, webhook-правок, UI-правок.
- bePaid не затрагивается.
- Любой код резолвера — только как proof-snippet внутри артефакта (TypeScript), без коммита в `src/` или `supabase/functions/`.
- STOP-GATE: пока GAP-B не = PASS, MVP Stripe Subscriptions остаётся заблокированным.

## 1. Предварительный snapshot (уже собран в Discovery)

Активные recurring offer'ы (`tariff_offers.meta.recurring.is_recurring = true`, `is_active = true`):


| offer_id            | tariff      | offer.amount | tariff_prices.currency / final_price | access_days | meta.recurring.billing_period_mode  | billing_period_days |
| ------------------- | ----------- | ------------ | ------------------------------------ | ----------- | ----------------------------------- | ------------------- |
| `6f306cbc…` (PILOT) | CHAT        | 100.00       | BYN / 100.00                         | 30          | `days`                              | 30                  |
| `bc0f7a90…`         | BUSINESS    | 250.00       | BYN / 250.00                         | 30          | `days`                              | 30                  |
| `c5781abf…`         | FULL        | 150.00       | BYN / 150.00                         | 30          | `days`                              | 30                  |
| `d307b438…`         | ИДЕОЛОГИЯ   | 350.00       | — (нет active row в tariff_prices)   | 30          | `days`                              | 30                  |
| `88c6f10d…`         | Стандартный | 250.00       | — (нет active row в tariff_prices)   | 30          | `month` (без `billing_period_days`) | —                   |


Наблюдения:

- 4 из 5 offer'ов используют каноничный `mode=days, days=30, access_days=30`.
- 1 offer (`88c6f10d…` Стандартный) использует устаревший `mode=month` без `billing_period_days` — кандидат на manual_review/нормализацию.
- 2 offer'а не имеют активной строки в `tariff_prices` — отдельный backlog (не блокер GAP-B, но фиксируется).
- Пилот `6f306cbc…` — `BYN 100.00`, `mode=days`, `days=30`, `access_days=30`.

## 2. Что сделать в GAP-B (read-only)

1. Расширить snapshot и сохранить как SQL+JSON в артефакте:
  - все 5 recurring offer'ов с `meta.recurring` целиком,
  - активная цена из `tariff_prices`,
  - флаги `is_active`, `is_primary`, `requires_card_tokenization`, `offer_type`.
2. Зафиксировать бизнес-SOT периода (по факту данных и Core-памяти):
  - SOT периода списания = `tariff_offers.meta.recurring` (`billing_period_mode` + `billing_period_days`).
  - `tariffs.access_days` = длительность доступа после оплаты, **не** интервал биллинга.
  - Эти величины могут совпадать (CHAT: 30/30), но семантически разные — резолвер их не объединяет.
3. Сформулировать **канонический resolver contract** (только в артефакте, без правки src):
  - Вход: `{ billing_period_mode, billing_period_days, recurring_meta, access_days }`.
  - Выход: `{ interval: 'day'|'week'|'month'|'year', interval_count: int }` либо `unsupported` с кодом.
  - Правила MVP:
    - `mode=days, days=7`  → `interval=week, count=1`
    - `mode=days, days=30` → `interval=month, count=1`
    - `mode=days, days=365` → `interval=year, count=1`
    - `mode=month` (без days) → `interval=month, count=1` (legacy-нормализация, помечается `legacy_month_mode`)
    - `mode=year` (без days) → `interval=year, count=1` (legacy)
    - `mode=week` → `interval=week, count=1`
    - всё остальное → STOP, код `billing_period_not_supported`, manual_review.
  - access_days в маппинг не входит, но проверяется отдельным инвариантом: `access_days` обязан существовать и быть положительным, иначе `access_days_missing`.
4. Validation contract (для будущих GAP-C/MVP, фиксируется в артефакте):
  - `422 billing_period_not_supported` — период не распознан резолвером.
  - `422 interval_mismatch` — реальный Stripe Price `recurring.interval/interval_count` не совпадает с выходом резолвера.
  - `422 access_days_missing` — `tariffs.access_days` null или ≤ 0.
  - `422 currency_mismatch` — валюта Price ≠ валюта `tariff_prices` (готовим заранее, актуально для GAP-C).
5. Прогнать резолвер по всем 5 offer'ам (на бумаге, таблицей):
  - 4 offer'а (CHAT, BUSINESS, FULL, ИДЕОЛОГИЯ) → `interval=month, count=1`, PASS.
  - 1 offer (Стандартный, `mode=month` без `days`) → PASS через legacy-ветку с пометкой `legacy_month_mode` (нужно фиксировать в backlog: нормализация в `mode=days, days=30`).
  - Зафиксировать unsupported cases отсутствующие в текущей выборке, но запрещённые правилами (например `mode=days, days=14`, `mode=days, days=45`).
6. Pilot decision:
  - Пилот = `6f306cbc…` (CHAT, BYN 100.00, `mode=days, days=30`) → резолвер возвращает `interval=month, count=1`. Это и есть целевой Stripe Price для GAP-C.

## 3. Артефакт (deliverable)

Создать только один файл:

`.lovable/proofs/stripe_phase_3_1_1_gap_b_billing_period_resolver_v1.md`

Структура:

1. Hypothesis & Scope.
2. SQL snapshot (5 offer'ов + tariff_prices, с замаскированными UUID-хвостами).
3. JSON snapshot `meta.recurring` для пилота.
4. Resolver contract (вход/выход, правила, TS-сигнатура как proof-snippet, **не подключается** к коду).
5. Resolver table по 5 offer'ам (PASS / legacy / manual_review).
6. Unsupported cases (явный список запрещённых дней/режимов).
7. Validation contract (4 кода 422).
8. Pilot decision (`6f306cbc…` → `month/1`, BYN, amount=100.00).
9. Backlog (не блокеры GAP-B):
  - `88c6f10d…` — нормализовать `mode=month` → `mode=days, days=30`.
  - `d307b438…`, `88c6f10d…` — отсутствует активная строка в `tariff_prices`.
10. Вердикт PASS/FAIL + ссылка на следующий шаг (GAP-C).

Обновить `.lovable/plan.md`: статус GAP-B = `verified_pass` (или `pass_with_backlog`) после прогона.

## 4. DoD

- Бизнес-SOT периода зафиксирован (`meta.recurring` + отдельно `access_days`).
- Resolver contract утверждён и оформлен в артефакте.
- Все 5 recurring offer'ов прогнаны через резолвер таблицей.
- Unsupported cases явно перечислены.
- Пилот `6f306cbc…` проходит резолвер → `month/1`.
- bePaid не затронут, миграций нет, edge functions не правились.
- GAP-B = PASS (или FAIL с конкретными gap-задачами).

## 5. Что НЕ делаем в этом шаге

- Не создаём `admin-provision-stripe-price`.
- Не делаем реальный `POST /v1/products` или `POST /v1/prices` для пилота.
- Не правим `tariff_offers.meta.stripe`.
- Не трогаем checkout / webhook / MVP.
- Не нормализуем `88c6f10d…` сейчас (только фиксируем в backlog).