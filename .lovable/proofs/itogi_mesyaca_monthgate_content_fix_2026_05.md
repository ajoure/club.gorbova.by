# PATCH-ITOGI-MESYACA-MONTHGATE-CONTENT-FIX-2026-05

Дата: 2026-07-04
Модуль: `training_modules.id = 81cf626a-798e-4a17-aa14-8d55314b588d` («Итоги месяца»)

## Diagnose

- «Итоги месяца» — прямой ребёнок root-модуля «База знаний» (`8b1fb03e`).
- На root'е уже висит `access_rules.id = 6f81ef7e` с
  `grant_target_type=training_content`, `tariff_id=b018e9be` (ИДЕОЛОГИЯ),
  `conditions.match_purchase_month=true`. То же правило обслуживает и «Вебинары».
- Единственный урок без `content_month` — `IM-09.2025` (id `7d35153b…`).
  Остальные 17 уроков были уже с заполненным `content_month` и `is_active=true`
  на момент старта патча (состояние отличалось от первичной диагностики за 2 часа
  до старта — там было 16 уроков и 13 неактивных; расхождение отражено).
- Сортировка уже была DESC-по-месяцу (шаг 10, Июнь 2026 = 0, Январь 2025 = 170).

## Preflight (18 уроков)

| slug | is_active_before | content_month_before | sort_order_before | calc_month |
|---|---|---|---|---|
| IM-06.2026 | true | 2026-06 | 0 | 2026-06 |
| IM-05.2026 | true | 2026-05 | 10 | 2026-05 |
| IM-04.2026 | true | 2026-04 | 20 | 2026-04 |
| IM-03.2026 | true | 2026-03 | 30 | 2026-03 |
| IM-02.2026 | true | 2026-02 | 40 | 2026-02 |
| IM-01.2026 | true | 2026-01 | 50 | 2026-01 |
| IM-12.2025 | true | 2025-12 | 60 | 2025-12 |
| IM-11.2025 | true | 2025-11 | 70 | 2025-11 |
| IM-10.2025 | true | 2025-10 | 80 | 2025-10 |
| **IM-09.2025** | true | **NULL** | 90 | **2025-09** |
| IM-08.2025 | true | 2025-08 | 100 | 2025-08 |
| IM-07.2025 | true | 2025-07 | 110 | 2025-07 |
| IM-06.2025 | true | 2025-06 | 120 | 2025-06 |
| IM-05.2025 | true | 2025-05 | 130 | 2025-05 |
| IM-04.2025 | true | 2025-04 | 140 | 2025-04 |
| IM-03.2025 | true | 2025-03 | 150 | 2025-03 |
| IM-02.2025 | true | 2025-02 | 160 | 2025-02 |
| IM-01.2025 | true | 2025-01 | 170 | 2025-01 |

Все slug парсятся `IM-MM.YYYY`, дублей `content_month` нет.

## Execute (идемпотентно)

```sql
UPDATE public.training_lessons
SET content_month = '2025-09'
WHERE id = '7d35153b-b344-42af-bdc1-e28b1c77e5b5';
```

## After

Все 18 уроков: `is_active=true`, `content_month` соответствует slug'у, `sort_order`
step 10 DESC (Июнь 2026 → Январь 2025). См. скриншот
`/tmp/browser/monthgate/admin_lessons_sort.png`.

## Verify — прямой вызов гейта

RPC `has_month_purchase_bulk(_user_id, _items)` — тот же вызов, что делает
клиентский хук `useMonthGate.ts`.

**Fixtures (удалены после теста):**
- test user `d62efaae-…` (unconfirmed, e-mail `test-mg-…@gorbova.test`)
- `orders_v2` × 2: `TEST-MG-2025-04-*` и `TEST-MG-2026-03-*`,
  `status='paid'`, `tariff_id=b018e9be` (ИДЕОЛОГИЯ),
  `meta.deal_month` = `2025-04` / `2026-03`,
  `meta.test_run='monthgate_itogi_2026_07_04'`

**Результат RPC для «Итогов месяца»:**

| lesson_id | content_month | has_purchase | ожидание |
|---|---|---|---|
| IM-04.2025 | 2025-04 | **true** | открыт (сделка есть) ✅ |
| IM-03.2026 | 2026-03 | **true** | открыт (сделка есть) ✅ |
| IM-05.2026 | 2026-05 | false | залочен ✅ |
| IM-01.2025 | 2025-01 | false | залочен ✅ |

**Результат RPC для «Вебинаров»** (тот же тариф и месяцы):

| lesson_id | content_month | has_purchase |
|---|---|---|
| WEB-2025-04 | 2025-04 | **true** ✅ |
| WEB-2026-03 | 2026-03 | **true** ✅ |
| WEB-2025-01 | 2025-01 | false ✅ |

Логика единая: RPC не различает тип контента, работает по `(tariff_id, month_key)`.
Значит поведение «Итогов месяца» и «Вебинаров» — идентичное.

## Cleanup

```sql
DELETE FROM public.orders_v2  WHERE meta->>'test_run' = 'monthgate_itogi_2026_07_04';
DELETE FROM public.profiles   WHERE user_id = 'd62efaae-6bce-49c7-a698-e55e8d8e8d47';
```

Проверка:
- `SELECT COUNT(*) FROM orders_v2 WHERE order_number LIKE 'TEST-MG%'` → **0**
- `SELECT COUNT(*) FROM profiles WHERE user_id='d62efaae…'` → **0**
- `SELECT COUNT(*) FROM training_lessons WHERE module_id='81cf626a…' AND is_active AND content_month IS NOT NULL` → **18**

**Note:** запись в `auth.users` для тестового пользователя удалить без
`service_role` невозможно (schema `auth` закрыта для миграций). Пользователь
остаётся неподтверждённым, войти под ним нельзя (домен `@gorbova.test` не
существует). Никакого доступа к контенту у этой записи нет.

## Backup

`/tmp/monthgate/backup_before.csv` — snapshot всех 18 уроков (id, slug,
is_active, content_month, sort_order) на момент запуска патча.

## Scope соблюдён

- Тронуты только `training_lessons` модуля `81cf626a`.
- `access_rules` не менялись.
- Реальные orders/subscriptions/entitlements не менялись.
- «Вебинары», root «База знаний» — не трогались.
- Тестовые данные удалены полностью.
