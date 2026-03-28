# да, согласен, с учетом правок:

&nbsp;

1. В **4A** не фиксируй даты потоков руками в тексте как окончательные, даже если они уже посчитаны. Пиши так:
  &nbsp;
  - 18 поток и 19 поток создаются **строго по датам из patch3_flow_dry_run.txt**
  - в execute использовать именно dry-run proof как source of truth
    Это защитит от расхождения между планом и фактическими датами.
  &nbsp;
2. В **4A** явно зафиксируй, что создаются **только 2 flow records**:
  &nbsp;
  - potok-18
  - potok-19
    **17 поток не создаётся**, **16 поток не создаётся** — это уже утверждено пользователем и не должно оставаться как опция.
  &nbsp;
3. В **4B** уточни окончательное правило для 172 no_flow_base_purchase до cut-off:
  &nbsp;
  - они **импортируются с flow_id = null**
  - не пытаться присваивать им 16 поток
  - не выносить их снова на решение
  &nbsp;
4. В **4B** уточни правило для **99 no_flow_base_purchase после cut-off**:
  &nbsp;
  - если created_at попадает в интервал 18 потока → flow_id = flow18
  - если created_at попадает в интервал 19 потока → flow_id = flow19
  - если не попадает никуда → manual_review_after_flow_match
  - **не оставлять эти строки автоматически с flow_id = null**
  &nbsp;
5. В плане добавь отдельный **unmatched profile bucket**:
  &nbsp;
  - если не найден match по external_id_gc
  - и не найден fallback по email
    → строку **не импортировать**, а класть в отдельный артефакт
    /mnt/documents/patch4_unmatched_profiles.csv
    Сейчас в плане есть STOP по match rate < 50%, но нет явного выходного bucket для unmatched строк.
  &nbsp;
6. В **4C** дедупликацию зафиксируй не только по order_number, но и по первичному historical ключу:
  &nbsp;
  - primary dedupe: meta.gc_deal_id = source_order_id
  - secondary dedupe: order_number = GC-{source_order_number} / fallback GCID-{source_order_id}
    Если найден existing gc_deal_id, строку skip как duplicate historical import.
  &nbsp;
7. В **4C** для order_number добавь точный safe-rule:
  &nbsp;
  - если source_order_number заполнен → GC-{source_order_number}
  - если пустой → GCID-{source_order_id}
  - если GC-{source_order_number} уже занят, но gc_deal_id другой → fallback GCID-{source_order_id}
    Так исключается коллизия только на номере.
  &nbsp;
8. В **4C** зафиксируй base_price = final_price = historical amount из CSV. Это важно, потому что base_price у тебя в диагностике фигурирует как обязательное поле, а дальше в контракте это должно быть явно написано как правило, не подразумеваться.
9. В purchase_snapshot добавь ещё 2 обязательных поля для трассировки:
  &nbsp;
  - batch_id
  - flow_assignment_mode = from_csv | inferred_by_date | no_flow
    Это потом сильно упростит аудит строк:
  - был поток в исходнике
  - был присвоен по дате
  - остался пустым осознанно
  &nbsp;
10. Для модульных строк уточни в snapshot:

&nbsp;

&nbsp;

&nbsp;

- historical_purchase_type = module_child_purchase | module_only_standalone
- display_purchase_name строить **из модулей**, а не из общего названия продукта
  Пример: ЦБ 2.0: Учет у ИП / ЦБ 2.0: Маркетплейсы, Строительство

&nbsp;

&nbsp;

&nbsp;

11. Для alias Перевозки добавь, что это **единственный разрешённый alias** в PATCH 4.
  То есть не вводить общий fuzzy matching модулей. Только:

&nbsp;

&nbsp;

&nbsp;

- Перевозки → Грузо- и пассажироперевозки

&nbsp;

&nbsp;

&nbsp;

12. В **4D** добавь ещё один обязательный артефакт:

&nbsp;

&nbsp;

&nbsp;

- /mnt/documents/patch4_unmatched_profiles.csv
  с колонками минимум:
- source_order_id
- source_user_id
- email
- customer_name
- match_attempt
- reason

&nbsp;

&nbsp;

&nbsp;

13. В patch4_import_batch_report.txt добавь ещё 3 счётчика:

&nbsp;

&nbsp;

&nbsp;

- imported_with_flow_from_csv
- imported_with_flow_inferred_by_date
- imported_with_flow_null
  Тогда будет прозрачный итог по спорным беспоточным строкам.

&nbsp;

&nbsp;

&nbsp;

14. В patch4_sample_orders_proof.txt лучше требовать не 3, а **4 примера**:

&nbsp;

&nbsp;

&nbsp;

- обычная тарифная покупка с исходным flow
- no_flow_base_purchase, назначенная в 18 по дате
- no_flow_base_purchase, назначенная в 19 по дате
- модульная покупка с alias Перевозки

&nbsp;

&nbsp;

&nbsp;

15. В STOP-guards добавь ещё один:

&nbsp;

&nbsp;

&nbsp;

- если после пересборки dataset количество строк к импорту + skipped + manual_review + unmatched **не сходится обратно в 1670**, STOP и выдать reconciliation report
  Это важно для полноты и чтобы не потерять строки.

&nbsp;

&nbsp;

&nbsp;

16. В финальном статусе PATCH 4 зафиксируй, что execute идёт по уже согласованным пользовательским решениям:

&nbsp;

&nbsp;

&nbsp;

- 17 не создаём
- 16 не создаём
- Бизнес-леди Сотрудник skip
- пустой тариф без модулей skip
- bonus skip
- renewal skip
- 99 after cut-off распределяем по 18/19 по датам
- 172 before cut-off оставляем flow_id = null

&nbsp;

&nbsp;

В остальном план уже можно принимать как финальный execute-план для PATCH 4.

&nbsp;

План: PATCH 4 — Execute historical import ЦБ 2.0

Язык: русский. Режим: execute (INSERT-only, add-only).

---

## Проблема

495 строк из PATCH 2 + до 99 строк из PATCH 3B (no_flow_base_purchase после cut-off) ожидают импорта в `orders_v2`. Все пользовательские решения приняты. Необходимо создать flow records, пересобрать финальный dataset и выполнить импорт.

## Диагностика

- `flows` count: **0 записей** ✓
- `orders_v2` с `reconcile_source = 'getcourse_historical'`: **0 записей** ✓
- `profiles` с `external_id_gc`: **8149 записей** (для matching)
- orders_v2 schema: `order_number NOT NULL`, `final_price NOT NULL`, `base_price NOT NULL`, `currency NOT NULL default 'BYN'`, `status NOT NULL default 'draft'`, `deal_date nullable timestamptz`
- `purchase_snapshot`: JSONB nullable
- Дедупликация: 0 заказов с `GC-` / `GCID-` prefix → нет конфликтов

## Предлагаемое решение

### Порядок выполнения: 4A → 4B → 4C → 4D

---

### 4A — Создать flow records (18 поток + 19 поток)

Только 2 потока. 16 и 17 не создаются.

```text
potok-18:
  product_id  = 7101ed3c-7839-4a74-ad95-aa0660369b22
  code        = potok-18
  name        = 18 поток
  start_date  = 2024-07-25
  end_date    = 2025-03-25
  is_active   = false
  is_default  = false
  meta        = {"source": "patch4_historical_import_setup"}

potok-19:
  product_id  = 7101ed3c-7839-4a74-ad95-aa0660369b22
  code        = potok-19
  name        = 19 поток
  start_date  = 2025-06-13
  end_date    = 2025-07-21
  is_active   = false
  is_default  = false
  meta        = {"source": "patch4_historical_import_setup"}
```

INSERT через insert tool. STOP если `flows` не пуста.

---

### 4B — Пересобрать финальный import dataset

Python-скрипт. Входы: `/tmp/deals.csv` + артефакты PATCH 2/3. Выходы — 3 файла:

**Финальные правила классификации:**


| Категория                                                     | Действие                                                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `base_tariff_purchase` (с потоком 18/19)                      | import                                                                                                                                      |
| `base_tariff_purchase` (без потока, до cut-off = 172 строки)  | import, `flow_id = null`                                                                                                                    |
| `base_tariff_purchase` (без потока, после cut-off = 99 строк) | если `created_at` внутри 18 → `flow_id = flow_18_uuid`; если внутри 19 → `flow_id = flow_19_uuid`; иначе → `manual_review_after_flow_match` |
| `module_child_purchase`                                       | import                                                                                                                                      |
| `module_only_standalone`                                      | import                                                                                                                                      |
| `renewal_skipped`                                             | skip                                                                                                                                        |
| `bonus_skipped`                                               | skip                                                                                                                                        |
| `Бизнес-леди Сотрудник` (2 строки)                            | skip                                                                                                                                        |
| Пустой тариф без модулей (7 строк)                            | skip                                                                                                                                        |


**Alias rule (в скрипте как каноническое правило):**

```text
"Перевозки" → "Грузо- и пассажироперевозки"
child_product_id = 64d9f812-617c-41a8-b3dc-bb113156d6f3
public_id = PRD-000022
```

**Profile matching:** `source_user_id` → `profiles.external_id_gc` → `profile_id`. Fallback: email → `profiles.email`.

**Выходные файлы:**

- `/mnt/documents/patch4_import_ready_final.csv` — строки к импорту
- `/mnt/documents/patch4_skipped_rows_final.csv` — skip (с `skip_reason`)
- `/mnt/documents/patch4_manual_review_after_flow_match.csv` — не попали ни в 18 ни в 19

---

### 4C — Выполнить import в orders_v2

**Import contract для orders_v2:**

```text
order_number       = GC-{source_order_number}, fallback GCID-{source_order_id}
product_id         = 7101ed3c-7839-4a74-ad95-aa0660369b22
tariff_id          = mapped tariff UUID | null
flow_id            = mapped 18/19 UUID | null
offer_id           = null
profile_id         = matched profile UUID
user_id            = profiles.user_id (from matched profile)
customer_email     = email из CSV
customer_phone     = phone из CSV
base_price         = amount из CSV
final_price        = amount из CSV
currency           = currency из CSV (fallback 'BYN')
status             = 'paid'
deal_date          = created_at из CSV
provider           = payment_system из CSV | 'getcourse'
reconcile_source   = 'getcourse_historical'
meta               = {gc_deal_id, gc_order_number, gc_user_id, batch_id, import_source: 'patch4'}
purchase_snapshot  = см. ниже
```

**Import contract для purchase_snapshot:**

```text
product_id, product_public_id, product_name, product_code
tariff_id, tariff_public_id, tariff_name, tariff_code
offer_id = null
price = amount из CSV
currency = currency из CSV
access_days = recommended_access_days
is_trial = false
trial_days = null
reconcile_source = 'getcourse_historical'
snapshot_created_at = now()

Extra (historical-specific):
  historical_purchase_type    = base_tariff | module_child_purchase | module_only_standalone
  display_purchase_name       = обязателен (tariff name + product name)
  module_list_raw             = массив raw module names из CSV (для модульных строк)
  module_list_mapped          = массив UUID child_product_id (для модульных строк)
  current_platform_price_byn  = reference price (если доступен)
  historical_access_start_at  = paid_at если заполнен, иначе created_at
  historical_access_end_at    = start + access_days для base_tariff, null для module rows
```

**Дедупликация при INSERT:** проверка `order_number` уникальности. Если `GC-{number}` уже существует → skip строку.

Импорт через batch INSERT (по 50 строк) через insert tool.

---

### 4D — Собрать proof-артефакты

**6 обязательных артефактов:**

1. `/mnt/documents/patch4_created_flows_proof.txt` — id, product_id, code, name, start_date, end_date, is_active, is_default, meta для обоих flow records
2. `/mnt/documents/patch4_import_executed_rows.csv` — все импортированные строки с `orders_v2.id`
3. `/mnt/documents/patch4_skipped_rows_final.csv` — все skip с `skip_reason`
4. `/mnt/documents/patch4_manual_review_after_flow_match.csv` — строки не попавшие в 18/19
5. `/mnt/documents/patch4_import_batch_report.txt` — итоговые числа
6. `/mnt/documents/patch4_sample_orders_proof.txt` — proof по 3 типам строк

**patch4_import_batch_report.txt:**

```text
flow_records_created
rows_imported
skipped_renewal
skipped_bonus
skipped_biznes_ledi_sotrudnik
skipped_empty_tariff
manual_review_after_flow_match
```

**patch4_sample_orders_proof.txt — минимум 3 примера:**

1. Обычная тарифная покупка с потоком (18 или 19)
2. Тарифная покупка без исходного потока, назначенная в 18/19 по дате
3. Модульная покупка с alias Перевозки

Каждый пример: полный `orders_v2` record + `purchase_snapshot` содержимое.

---

## Add-only правило

Импорт создает **только**:

- `orders_v2` записи с `purchase_snapshot`
- `flows` записи (2 штуки)

**НЕ создает:** subscriptions_v2, entitlements, доступы. Не меняет существующие данные.

## Изменяемые компоненты

- `flows` table: INSERT 2 записи
- `orders_v2` table: INSERT ~495+ записей

## Что НЕ будет изменено

- Edge functions, UI, миграции, subscriptions_v2, entitlements — не трогаем
- Существующие данные — не модифицируем

## STOP-guards

- Если `flows` не пуста перед 4A → STOP
- Если `orders_v2` уже содержит `reconcile_source = 'getcourse_historical'` → STOP
- Если profile_id match rate < 50% → STOP и показать отчёт
- Если duplicate `order_number` detected → skip строку, не STOP
- Если rowcount import > 600 → STOP (ожидаемо ~495 + до 85 из 99)

## DoD

1. 2 flow records созданы (potok-18, potok-19) с полным proof
2. Финальный import dataset пересобран с учётом всех решений
3. orders_v2 записи созданы со статусом `paid`, `reconcile_source = 'getcourse_historical'`
4. purchase_snapshot заполнен для каждой записи
5. 6 proof-артефактов созданы
6. Итоговые числа зафиксированы в batch report

## Риски и зависимости

- Profile matching зависит от `external_id_gc` в profiles (8149 записей). При отсутствии match → fallback по email
- 99 строк no_flow_base_purchase: часть может попасть в manual_review_after_flow_match если created_at вне диапазонов 18/19
- Alias `Перевозки` касается ровно 2 строк — риск минимален

## SYSTEM ACTOR proof

Все INSERT выполняются через insert tool. `meta.import_source = 'patch4'`. `reconcile_source = 'getcourse_historical'`. `batch_id` во всех артефактах.