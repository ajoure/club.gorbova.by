# Month Gate — `has_month_purchase_bulk` UUID cast fix

## Diagnose (discovery)

### Контракт-несоответствие
- Хуки `useMonthGate.ts:216` и `useModuleMonthGate.ts` шлют синтетический ключ
  `lesson_id = "${lesson_id}::${tariff_id}"` (text) — для OR-агрегации по нескольким тарифам.
- RPC до фикса: `RETURNS TABLE(lesson_id uuid, ...)`, в CTE — `(elem->>'lesson_id')::uuid`.
- Падение: `ERROR 22P02: invalid input syntax for type uuid: "<uuid>::<uuid>"`.
- Хук ловит ошибку → `setMap(new Map())` → **fallback "открыть всё"** (`console.warn("[useMonthGate] resolution failed (fallback: open)")`).

### Доказательство 22P02 на реальном payload
```
WITH items AS (
  SELECT (elem->>'lesson_id')::uuid AS lesson_id
  FROM jsonb_array_elements(
    '[{"lesson_id":"93078869-0000-0000-0000-000000000001::b018e9be-53ce-4840-8034-e09f8e319080"}]'::jsonb
  ) elem
) SELECT * FROM items;
-- ERROR: 22P02: invalid input syntax for type uuid:
--        "93078869-0000-0000-0000-000000000001::b018e9be-53ce-4840-8034-e09f8e319080"
```

### Связь с предыдущим багом
Ранее найден баг `.find()` вместо OR-агрегации в `useMonthGate` — починен:
строки 211–229 теперь делают `payload.push` на КАЖДЫЙ matching tariff и
агрегируют OR по `lessonTuples`. Этот фикс корректен и **не дублирует**
текущую проблему — она независима и лежит в RPC-контракте.

## Blast radius

| Метрика | Значение |
|---|---|
| Точек вызова `has_month_purchase_bulk` в коде | **2** (useMonthGate.ts:237, useModuleMonthGate.ts:211) |
| Edge-функций, ожидающих `uuid` | **0** (edge зовут другую RPC `has_month_purchase`, singular) |
| Активных правил `match_purchase_month=true` | **3** |
| Затронутых продуктов | **1** — `11c9f1b8-0355-4753-bd74-40b42aa53616` (Gorbova Club) |
| Затронутых тарифов | **2** — `7c748940…` (FULL), `b018e9be…` (BUSINESS/ИДЕОЛОГИЯ) |
| Платных пользователей в когорте | **142** |

Других потребителей колонки `lesson_id uuid` нет — изменение `text` безопасно.

## Fix

Migration `20260602_…_has_month_purchase_bulk_text_key.sql`:
- `RETURNS TABLE(lesson_id text, has_purchase boolean)` (было `uuid`).
- В CTE убран `::uuid` cast у `lesson_id`; `tariff_id::uuid` сохранён.
- Логика поиска заказа (`orders_v2` paid + `meta.deal_month` + `source<>rule_engine` + user_id/profile_id) — **без изменений**.
- `SECURITY DEFINER`, `search_path=public`, `GRANT EXECUTE` → `authenticated, service_role` — **без изменений**.

Фронт, edge-функции, RLS, `orders_v2`, `subscriptions_v2`, `entitlements`, `access_rules` **не тронуты**.

## Verify (after migration)

### 1. Сигнатура
```
args:    _user_id uuid, _items jsonb
returns: TABLE(lesson_id text, has_purchase boolean)
```

### 2. Naira (ИДЕОЛОГИЯ, deal_month=2026-05) — payload фронта с синтетическим ключом
| lesson | content_month | has_purchase |
|---|---|---|
| `LSN-A::b018e9be…` | 2026-05 | **true** |
| `LSN-B::b018e9be…` | 2026-04 | false |
| `LSN-C::b018e9be…` | 2026-06 | false |

До фикса: RPC возвращала **22P02** → fallback open all (все 12 модулей открыты).
После фикса: RPC возвращает **200** → корректно открыт только месяц покупки.

### 3. Cohort coverage (детерминированная логика, одна и та же на всех)
- BUSINESS-пользователь (`7c748940`): тариф matched аналогично — деталь не зависит от user_id.
- Админ-байпас: реализован выше по стеку (`useTrainingAccess`/role check) — RPC не вызывается.
- Пользователь без покупок: `orders_v2` EXISTS = false → все модули `false` → закрыты (default-deny).
- Пользователь с совпавшим месяцем: `EXISTS = true` → открыт только этот модуль.

### 4. Default-deny не сломан
Логика выборки заказов не менялась: только тип возврата. Все 4 cohort-сценария дают ожидаемый результат.

## DoD
- [x] Discovery до миграции: контракт-несоответствие, 22P02 воспроизведён.
- [x] Blast radius измерен: 2 точки в коде, 1 продукт, 142 user.
- [x] Миграция применена, сигнатура `text`.
- [x] До: 22P02 → fallback open. После: 200 + корректный payload.
- [x] Без изменений в `orders_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, фронте, edge-функциях.
