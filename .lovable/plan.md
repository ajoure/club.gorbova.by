# да, согласен, с учетом правок:

&nbsp;

1. В patch2_import_ready_list.csv добавь ещё колонку mapped_flow_id, не только mapped_flow_status, чтобы файл был сразу пригоден как вход для execute без повторного lookup.
2. В patch2_skipped_rows.csv и patch2_manual_review_list.csv добавь явную колонку skip_reason / review_reason, чтобы потом не возвращаться к повторной классификации тех же строк.

&nbsp;

&nbsp;

План: PATCH 2 Execute — AS-IS аудит и артефакты готовности к импорту ЦБ 2.0

Язык: русский. Режим: read-only. Никаких записей, миграций, импортов, UI-изменений.

---

## Шаг 1: Source manifest + column mapping

Сгенерировать `batch_id` (формат: `PATCH2-DRY-{timestamp}`). Этот `batch_id` записывается во **все** txt/csv артефакты для сквозной трассировки.

Артефакты:

- `/mnt/documents/patch2_source_manifest.txt` — source_type, source_name, row_count, batch_id, dry_run_at
- `/mnt/documents/patch2_column_mapping.txt` — все 20 колонок CSV → target table.field → status

---

## Шаг 2: Скриптовый breakdown всех 1670 строк

Python-скрипт. Точные числа по категориям:


| Категория                 | Правило классификации                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `base_tariff_purchase`    | tariff ∈ {тариф 1/2/3, Бухгалтер, Главный бухгалтер, Бизнес-леди}, offer_type ≠ renewal/bonus_access, tariff ≠ продление/БОНУС/Бонусы |
| `module_child_purchase`   | module_only + у того же клиента есть base_tariff_purchase                                                                             |
| `module_only_standalone`  | module_only + нет parent base purchase                                                                                                |
| `renewal_skipped`         | offer_type = `renewal` ИЛИ tariff = `продление`                                                                                       |
| `bonus_skipped`           | offer_type = `bonus_access` ИЛИ tariff = `БОНУС` ИЛИ tariff = `Бонусы`                                                                |
| `no_flow_base_purchase`   | base_tariff_purchase AND flow пуст                                                                                                    |
| `no_flow_module_purchase` | module_only AND flow пуст                                                                                                             |
| `manual_review`           | не классифицированы ни в одну группу                                                                                                  |


`renewal_skipped` и `bonus_skipped` **полностью исключаются** из импорта.

Артефакт: `/mnt/documents/patch2_row_breakdown.txt` (с batch_id)

---

## Шаг 3: PHASE B — классификация беспоточных строк

Parent-child matching:

1. Match по `source_user_id` → есть ли base_tariff_purchase у того же клиента
2. Fallback по `email`
3. Fallback по `phone`
4. Нет связи → `module_only_standalone` или `manual_review`

**Отдельный выход по `no_flow_base_purchase**`:

- сколько строк рекомендовано нормализовать в **16 поток**
- сколько оставить с **flow = null**
- сколько отправить в **manual_review**

Flow 16 создаётся **условно** — только если данные подтвердят.

Артефакт: `/mnt/documents/patch2_phase_b_no_flow_analysis.txt` (с batch_id)

---

## Шаг 4: Модульный отчёт

Маппинг всех `module_topics` → `child_product_id` из `product_relations`.

В `patch2_module_linkage_report.txt` показать **все 8 модулей в едином списке** без исключений и без выделения special-case:

```text
module_name              │ child_product_id                       │ public_id
─────────────────────────┼────────────────────────────────────────┼───────────
Производство             │ 064dd768-...                           │ PRD-000005
Розничная торговля       │ abee24cd-...                           │ PRD-000015
Строительство            │ f833c846-...                           │ PRD-000018
Маркетплейсы             │ d7effaf4-...                           │ PRD-000016
Общепит                  │ 9187db54-...                           │ PRD-000011
ПВТ                      │ 99f1f156-...                           │ PRD-000012
Учет у ИП                │ ea98d043-...                           │ PRD-000017
Грузо- и пассажироперевозки │ 64d9f812-...                        │ PRD-000022
```

`Грузо- и пассажироперевозки` = обычный модуль ЦБ 2.0. Никакого отдельного замечания. В маппинге и импорте обрабатывается 1:1 как остальные модули.

Классификация каждой модульной строки: `module_child_purchase` или `module_only_standalone`.

Артефакты (с batch_id):

- `/mnt/documents/patch2_module_linkage_report.txt`
- `/mnt/documents/patch2_module_only_rows.csv` — с колонкой `historical_purchase_type`

---

## Шаг 5: Списки строк

`**/mnt/documents/patch2_import_ready_list.csv**` — только строки к импорту:

- `base_tariff_purchase`
- `module_child_purchase`
- `module_only_standalone`

`renewal_skipped` и `bonus_skipped` **не попадают**.

Обязательные колонки:

```text
source_order_id, source_order_number, source_user_id, email, product,
mapped_tariff_name, mapped_tariff_id, flow, mapped_flow_status,
historical_purchase_type, module_list_raw, module_list_mapped,
recommended_access_days, batch_id
```

`**/mnt/documents/patch2_skipped_rows.csv**` — renewal + bonus (с batch_id)

`**/mnt/documents/patch2_manual_review_list.csv**` — не классифицированные (с batch_id)

---

## Шаг 6: Schema proof

`**/mnt/documents/patch2_schema_proof.txt**` — зафиксировать:

- `order_status enum`: допустимое значение для historical import = `paid`
- `orders_v2.tariff_id`: nullable = YES
- `orders_v2.flow_id`: nullable = YES
- `orders_v2.order_number`: NOT NULL (safe-rule обязателен)
- `orders_v2.final_price`: NOT NULL
- `orders_v2.currency`: NOT NULL, default `BYN`

Этот файл — финальный proof, чтобы потом не возвращаться к schema-check.

---

## Итоговый verdict (во всех артефактах)

```text
ready_without_new_entities    = yes
required_before_execute       = only flow records + exact no-flow classification
                                + schema-proof already confirmed
```

**Execute PATCH 2 импортирует только `base_tariff_purchase` и модульные покупки. Renewal и bonus исключаются полностью. Новый продукт, тарифы и модули не требуются.**

---

## Полный список артефактов (10 файлов)

1. `/mnt/documents/patch2_source_manifest.txt`
2. `/mnt/documents/patch2_column_mapping.txt`
3. `/mnt/documents/patch2_row_breakdown.txt`
4. `/mnt/documents/patch2_phase_b_no_flow_analysis.txt`
5. `/mnt/documents/patch2_import_ready_list.csv`
6. `/mnt/documents/patch2_module_linkage_report.txt`
7. `/mnt/documents/patch2_module_only_rows.csv`
8. `/mnt/documents/patch2_manual_review_list.csv`
9. `/mnt/documents/patch2_skipped_rows.csv`
10. `/mnt/documents/patch2_schema_proof.txt`

Все файлы содержат `batch_id` для сквозной трассировки.