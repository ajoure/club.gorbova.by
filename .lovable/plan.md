## да, согласен, с учетом правок:

&nbsp;

1. Не перезаписывать артефакты **in-place**. Сохранить add-only принцип:
  &nbsp;
  - 11_remediation_candidates_dry_run_v2.csv
  - 13_final_report_[v2.md](http://v2.md)
  - при необходимости 14_audit_validation_sanity_checks.csv
    Старые файлы v1 оставить как baseline discovery.
  &nbsp;
2. 09_parent_child_basis_matrix.csv пересобирать не обязательно, если в самом CSV данные уже корректны. Исправление нужно делать в markdown-рендере отчета:
  &nbsp;
  - экранировать | в 13_final_report_[v2.md](http://v2.md)
  - отдельно явно написать, что проблема была не в CSV, а в отображении markdown-таблицы.
  &nbsp;
3. В sanity-check блок добавить не 4, а 6 проверок:
  &nbsp;
  - sum(entitlement classification buckets) = 515
  - sum(subscription classification buckets) = 405
  - count(null_product_but_resolvable) = 10
  - count(remediation rows with SET product_id) = 10
  - count(invalid_wrong_end_date) = 9
  - count(remediation rows with SET expires_at) = 9
  &nbsp;
4. Example section по Любови Пилецкой строить строго по:
  &nbsp;
  - user_id = 012e765c-0151-4310-91eb-63866847af72
  - дополнительно вывести profile_id, email, все entitlements, subscriptions, paid orders
  - отдельно показать, в какие именно CSV она попадает и по каким строкам/ID.
  &nbsp;
5. В 11_remediation_candidates_dry_run_v2.csv явно добавить колонку:
  &nbsp;
  - remediation_bucket
    чтобы было видно, что строка относится к null_product_id или invalid_wrong_end_date, а не только proposed_action.
  &nbsp;
6. В финальном отчете отдельным блоком зафиксировать root cause по каждой из 3 несостыковок:
  &nbsp;
  - bug фильтра remediation
  - bug example lookup по email вместо user_id
  - bug markdown escaping для | в названиях продуктов
  &nbsp;
7. Явно написать в отчете, что **аудит v1 не отменяется**, а **уточняется audit validation v2**, чтобы не потерять baseline и историю вывода.
8. STOP-guard дополнить:
  &nbsp;
  - не менять классификацию v1 задним числом без отдельного mapping v1 -> v2
  - если какая-то строка меняет bucket, это должно быть отдельно перечислено в diff-секции отчета.
  &nbsp;
9. DoD уточнить:
  &nbsp;
  - 11_remediation_candidates_dry_run_v2.csv = **19 строк**
  - SET product_id = **10**
  - SET expires_at = **9**
  - все sanity-check = **PASS**
  - Любовь Пилецкая найдена детерминированно по user_id
  - v1 артефакты сохранены без изменений
  &nbsp;

&nbsp;

&nbsp;

План: PATCH-AUDIT-VALIDATION — Исправление внутренних несостыковок аудита v1

### Контекст

Аудит v1 принят как baseline discovery. Обнаружены 3 внутренние несостыковки, которые делают remediation CSV и example-блок ненадёжными. Нужно пересобрать артефакты без изменения данных в БД.

### Три проблемы и их root cause

**1. null_product_id = 10, но SET product_id = 0 в remediation**

- В `08_null_or_orphan_accesses.csv` все 10 записей содержат `resolved_product_id_by_code`, `resolved_confidence=high`, `recommended_fix=SET product_id = '...'`
- В `11_remediation_candidates_dry_run.csv` ни одна из этих 10 записей не включена — там только 9 строк с `invalid_wrong_end_date`
- **Root cause**: в Python-скрипте фильтр remediation candidates собирал только `classification_status = 'invalid_wrong_end_date'`, а `null_product_id` не попал в условие выборки

**2. Любовь Пилецкая "не найдена"**

- Её user_id = `012e765c-0151-4310-91eb-63866847af72`, email = `luba021290@mail.ru`
- Она присутствует в `11_remediation_candidates_dry_run.csv` (строка 2) и в `08_null_or_orphan_accesses.csv` (строка 2)
- **Root cause**: example section искал по `ILIKE '%пилец%'` или `'%pilets%'` в email, а её email — `luba021290@mail.ru`. Поиск должен идти по `user_id` или `profile_id`, а не по email

**3. Parent/child matrix — сломанные markdown-строки**

- Названия продуктов содержат `|` (pipe), что ломает markdown-таблицу
- Строка `Ценный бухгалтер | 2 ступень | | 1 | 0 |` парсится неверно
- **Root cause**: при генерации MD pipe в product_name не экранировался

### Что будет сделано

Один Python-скрипт (SELECT-only), который:

1. **Пересобирает `11_remediation_candidates_dry_run.csv**` — добавляет 10 строк null_product_id с `proposed_action = SET product_id = '<resolved_id>'`, `basis_confidence = high`, `safe_to_auto_fix = true`. Итого: 9 (wrong_end_date) + 10 (null_product_id) = 19 строк.
2. **Перестраивает example section** в `13_final_report.md` — ищет Пилецкую по `user_id = '012e765c-0151-4310-91eb-63866847af72'`, выводит все её entitlements, subscriptions, orders.
3. **Перегенерирует `09_parent_child_basis_matrix.csv**` — без изменений в данных, но `13_final_report.md` экранирует pipe в product_name при рендере markdown-таблицы (замена `|` на `\|` внутри ячеек).
4. **Добавляет sanity-check блок** в конец `13_final_report.md`:
  - `sum(classification_buckets) = 515` — проверка
  - `sum(subscription_buckets) = 405` — проверка
  - `count(null_product_but_resolvable)` = `count(remediation rows with SET product_id)` — проверка
  - `count(missing_entitlement in report)` = `count(rows in 12_subscription_classification.csv with missing_entitlement)` — проверка
  - Каждая проверка: PASS / FAIL с фактическими числами

### Файлы, которые будут перегенерированы


| Файл                                    | Изменение                                         |
| --------------------------------------- | ------------------------------------------------- |
| `11_remediation_candidates_dry_run.csv` | +10 строк null_product_id (было 9, станет 19)     |
| `13_final_report.md`                    | Исправлен example section + matrix + sanity-check |
| `09_parent_child_basis_matrix.csv`      | Без изменений (CSV не ломается pipe)              |


CSV `09` не нужно пересобирать — в CSV формате pipe не мешает, проблема только в MD-рендере.

### STOP-guards

- Никаких UPDATE/INSERT/DELETE
- Не менять данные в БД
- Не запускать remediation execute
- Категории `illegal_bonus_access`, `bonus_access_without_parent_trace`, `unknown_needs_manual_review` вне auto-fix
- Версионирование: файлы перезаписываются in-place (это v2 тех же артефактов)

### DoD

1. `11_remediation_candidates_dry_run.csv` содержит 19 строк (9 wrong_end_date + 10 null_product_id)
2. Example section по Пилецкой найден по user_id и показывает реальные данные
3. Parent/child matrix в MD корректно отображается
4. Sanity-check блок: все 4 проверки = PASS
5. Никакие данные в БД не изменены