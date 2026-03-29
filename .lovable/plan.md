# Да, согласен, с учетом правок:

1. В proof_full_join.csv добавить колонки: current_bucket, already_imported, ready_after_profile_appeared, can_auto_import_now.

2. review_safe_import.csv формировать только из строк:

   - review_flag = yes

   - только tariff_mismatch

   - без duplicate_client

   - с найденным profile match.

3. Перед follow-up импортом заново прогнать profile matching по всем 33 review-строкам.

4. Все follow-up batch’и делать идемпотентно:

   - order_number = MIG-CB2S-ROW-{source_row}

   - existing order/subscription повторно не создавать

   - entitlement только через lookup/update.

5. Row 107 оформить отдельным mini-batch файлом row107_ready_after_profile.csv и импортировать отдельным шагом с тем же контрактом, что и review_safe_import.

6. review_duplicate_proof.csv расширить полями:

   source_row, order_number_planned, email, customer_name, mapped_tariff_name, mapped_flow_name, amount, review_reason, already_imported_same_email_same_flow_same_tariff.

7. unmatched_no_profile.csv формировать только после повторного matching; в финале там должны остаться только rows 2, 14, 87.

8. batch_report.txt вести тремя снимками:

   - state_before_followup

   - state_after_review_safe_import

   - state_after_row107_import

   с отдельными счетчиками imported_orders_total, review_remaining, unmatched_remaining, skipped_employee, duplicates_prevented.

9. Явно зафиксировать: существующие 78 orders не пересоздаются и не меняются; выполняется только delta-import.

10. STOP-guards:

   - если у строки есть mapped_flow_name, но нет flow_id → batch stop

   - если row 107 уже импортирован → пропустить как duplicate

&nbsp;

План: Proof-артефакты + поэтапный импорт review/unmatched — ЦБ 2 ступень

## Текущее состояние


| Метрика                 | Значение |
| ----------------------- | -------- |
| Всего строк CSV         | 116      |
| orders_v2 импортировано | 78       |
| subscriptions_v2        | 63       |
| orders без user_id      | 15       |
| review                  | 33       |
| employee                | 1        |
| unmatched               | 4        |
| duplicates              | 0        |


Reconciliation: `116 = 78 + 33 + 1 + 4 + 0` ✓

---

## Каноническое правило (фиксируется)

> **Источник истины для тарифа = поле «Состав заказа».**
> Отдельная колонка «Тариф» — только диагностическая.
> Все строки с tariff_mismatch без duplicate_client импортируются автоматически по `mapped_tariff_name`.

---

## Порядок выполнения

### Шаг 1: Пересобрать proof-артефакты

Скрипт читает CSV + БД, генерирует 5 файлов в `/mnt/documents/cb2s_import/`:

1. `**batch_report.txt**` — текущее состояние:
  - 78 orders (63 с user_id, 15 без)
  - 63 subscriptions
  - 0 новых entitlements (63 уже существовали)
  - reconciliation `116 = 78 + 33 + 1 + 4 + 0`
2. `**proof_full_join.csv**` — все 116 строк с классификацией и order_id (если создан)
3. `**review_safe_import.csv**` — строки review без duplicate_client (только tariff_mismatch), готовые к импорту
4. `**review_duplicate_proof.csv**` — 8 строк (4 клиента), grouped by client:
  `source_row, email, customer_name, mapped_tariff_name, mapped_flow_name, amount, order_composition_raw, review_reason`
5. `**unmatched_no_profile.csv**` — 3 строки (rows 2, 14, 87) без профиля

Row 107 (`bogy98@mail.ru`) выделяется отдельно как `ready-after-profile-appeared`.

### Шаг 2: Импорт review_safe_import

- Берутся все review-строки без `duplicate_client` (ожидается ~25 строк)
- Тариф = `mapped_tariff_name` (из «Состав заказа»)
- Dry-run → execute
- Создаются: orders + subscriptions (+ entitlements где есть user_id)
- Reconciliation обновляется: `116 = (78 + N_safe) + (33 - N_safe) + 1 + 4 + 0`

### Шаг 3: Импорт row 107

- Профиль появился: `profile_id=066bbf20`, `user_id=8d974225`
- Mini-batch: 1 order + 1 subscription + 1 entitlement (если нет существующего)
- Row 107 уходит из unmatched → executed
- Reconciliation: `116 = (78 + N_safe + 1) + (33 - N_safe) + 1 + 3 + 0`

### Шаг 4: Proof по 8 duplicate-строкам

- Сформирован на Шаге 1 как `review_duplicate_proof.csv`
- Предоставляется пользователю для решения по каждому из 4 клиентов
- Никакого автоматического импорта без подтверждения

### Шаг 5: Решение по 3 unmatched без профиля

- Файл `unmatched_no_profile.csv` (rows 2, 14, 87)
- Профили автоматически не создаются
- Ждём отдельного подтверждения

---

## Артефакты (DoD)


| Файл                         | Содержание                                                        |
| ---------------------------- | ----------------------------------------------------------------- |
| `batch_report.txt`           | Обновляется поэтапно (before → after row 107 → after review_safe) |
| `proof_full_join.csv`        | Все 116 строк с финальной классификацией                          |
| `review_safe_import.csv`     | Строки tariff_mismatch без duplicate                              |
| `review_duplicate_proof.csv` | 8 строк, 4 клиента, grouped by client                             |
| `unmatched_no_profile.csv`   | 3 строки без профиля                                              |


Все файлы → `/mnt/documents/cb2s_import/`

---

## Изменяемые компоненты

Только exec-скрипты. Никаких изменений в кодовой базе, миграциях или edge functions.

## Риски

- Review_safe_import: если какая-то строка имеет пустой `flow_id` при заполненном `mapped_flow_name` — STOP-guard сработает, строка не импортируется
- Row 107: entitlement может уже существовать — проверяется перед вставкой
- Duplicate proof: решение принимается только человеком после просмотра фактов