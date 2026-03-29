

# План: Финальный proof-блок + артефакты ЦБ 2 ступень

## Данные из БД (verified)

### Счетчики

| Метрика | Значение |
|---|---|
| orders_v2 (MIG-CB2S-*) | **103** (78 initial + 24 review_safe + 1 row107) |
| subscriptions_v2 (cb2s_*) | **81** (63 initial + 17 review_safe + 1 row107) |
| review_remaining | **9** (8 duplicate + 1 row28 без профиля) |
| unmatched_remaining | **3** (rows 2, 14, 87) |

Reconciliation: `116 = 103 + 8(dup) + 1(row28) + 1(employee) + 3(unmatched) = 116` ✓

### Row 107 — proof

| Поле | Значение |
|---|---|
| order_id | `df202eb8-82a3-4a58-9751-1247530fb192` |
| order_number | `MIG-CB2S-ROW-107` |
| subscription_id | `ba62c25c-9cb0-40c6-b57b-4dd48442dc72` |
| profile_id | `066bbf20-61f6-4cf6-9493-25c1ba75bdc8` |
| user_id | `8d974225-b89c-4a97-9ce3-9b0c4041ea5d` |
| entitlement для CB2S (87a8870f) | **НЕ СУЩЕСТВУЕТ** |

**Важно**: У пользователя row 107 есть entitlements для двух других продуктов, но **нет entitlement для ЦБ 2 ступень** (product_id `87a8870f`). Это требует отдельного действия — вставки entitlement.

---

## Проблема с артефактами

Исходный CSV (`ЦБ_2_ступень_normalized-2.csv`) отсутствует в текущей файловой системе проекта. Без него невозможно восстановить:
- email, customer_name, amount, order_composition_raw для duplicate/unmatched строк
- полный proof_full_join.csv со всеми 116 строками

**Необходимо**: пользователь должен повторно загрузить CSV, либо мы восстановим данные из meta-полей orders_v2 (но там нет amount и customer_name).

---

## Что будет выполнено

### 1. Вставить entitlement для row 107
Entitlement для CB2S продукта не был создан. Нужно создать:
- `user_id = 8d974225-b89c-4a97-9ce3-9b0c4041ea5d`
- `product_id = 87a8870f-d426-419a-9f15-faa76c3f2be3`
- `status = active`

### 2. Сгенерировать артефакты (из данных БД + CSV, если доступен)

| Файл | Источник данных |
|---|---|
| `batch_report.txt` | БД: orders_v2, subscriptions_v2, entitlements, audit_logs |
| `proof_full_join.csv` | CSV + БД join (нужен CSV) |
| `review_duplicate_proof.csv` | CSV (нужен CSV для amount, customer_name) |
| `unmatched_no_profile.csv` | CSV (нужен CSV) |
| `row107_ready_after_profile.csv` | БД — данные есть |

### 3. Показать таблицы в отчете

**8 duplicate-строк**: source_row, email, customer_name, mapped_tariff_name, mapped_flow_name, amount_byn, already_imported — требуется CSV.

**3 unmatched строки (rows 2, 14, 87)**: аналогично требуется CSV.

---

## Вопрос к пользователю

Для полной генерации артефактов нужен файл `ЦБ_2_ступень_normalized-2.csv`. Варианты:

1. **Загрузить CSV повторно** — полная генерация всех артефактов
2. **Собрать частичные артефакты из БД** — batch_report.txt + row107 proof + то что есть в meta; duplicate/unmatched таблицы будут неполными (без amount, customer_name)

---

## Строго не выполняется автоматически

- 8 duplicate-строк — ждём решения
- 3 unmatched (rows 2, 14, 87) — ждём решения
- Row 28 без профиля — ждём решения

