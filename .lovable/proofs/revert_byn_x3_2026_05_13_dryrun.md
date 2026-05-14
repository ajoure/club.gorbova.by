# Dry-run: REVERT-BYN-x3-2026-05-13

Тренинг «Бухгалтерия как бизнес» — откат разовой миграции 04.05.2026 (`pointA_rows[].income * 3`, `pointA_v2_rows[].monthly_income * 3`).

## Покрытие backup

`lesson_progress_state_backup_byn_2026_05` = **63 строки**, точное совпадение с текущим `lesson_progress_state` по `(user_id, lesson_id)`:

| lesson_id | backup | current |
|---|---|---|
| `96c970e6…` (V1, «Тест: В какой роли») | 33 | 33 |
| `6fb911a0…` (V2, «Шаг 2: Анализ портфеля») | 30 | 30 |

## Классификация на уровне строк

Метод: для каждой строки в текущем `state_json` ищем ту же `_id` в backup, сравниваем `income` / `monthly_income`:

- `revert` — `current ≈ backup × 3` (tolerance 0.001) → **откатываем**
- `already_ok` — `current = backup` → no-op
- `edited_keep` — пользователь явно изменил значение (не ×3) → **оставляем**
- `no_backup_row` — строка добавлена пользователем после миграции → **оставляем**
- `no_value` — числового значения нет в одной из сторон → пропускаем

| lesson | revert | already_ok | edited_keep | no_backup_row | no_value |
|---|---:|---:|---:|---:|---:|
| V1 `96c970e6…` | 249 | 0 | 0 | 0 | 5 |
| V2 `6fb911a0…` | 138 | 66 | 45 | 6 | 5 |
| **TOTAL** | **387** | **66** | **45** | **6** | **10** |

## Когорты по `(user_id, lesson_id)`

| cohort | lesson | users | rows_to_revert | rows_kept_edited | rows_new | rows_already_ok |
|---|---|---:|---:|---:|---:|---:|
| **A pure_revert** | V1 `96c970e6…` | 30 | 249 | 0 | 0 | 0 |
| **A pure_revert** | V2 `6fb911a0…` | 18 | 103 | 0 | 0 | 0 |
| **B mixed** | V2 `6fb911a0…` | 2 | 35 | 2 | 0 | 3 |
| **C no_revert** | V1 `96c970e6…` | 3 | 0 | 0 | 0 | 0 |
| **C no_revert** | V2 `6fb911a0…` | 10 | 0 | 43 | 6 | 63 |

Итого: **48 user-lesson** в A, **2** в B, **13** в C. По cohort B (per план, вариант **(a)**) откатываем только строки с `current ≈ backup × 3`, остальные не трогаем.

## Спот-проверка: Наталья Новикова (`8c3b6be5…`)

V2 урок (Шаг 2) — 20 строк:

| client | before | after_revert | class |
|---|---:|---:|---|
| АвтоМэйджор | 2100 | 700 | revert |
| Билайтер | 3600 | 1200 | revert |
| Вентгарант | 3000 | 1000 | revert |
| ВМС | 1500 | 500 | revert |
| Вьюга | 1800 | 600 | revert |
| Делизия | 4500 | 1500 | revert |
| **Завод ЖБИ** | **1000** | (3000) | **edited_keep — НЕ трогаем** |
| ИЗИ | 2100 | 700 | revert |
| Инглиш | 1500 | 500 | revert |
| ИП | 2400 | 800 | revert |
| ИП | 3600 | 1200 | revert |
| КолорТим | 3300 | 1100 | revert |
| Крепленд | 1500 | 500 | revert |
| Мичип | 3600 | 1200 | revert |
| Оберегстрой | 1500 | 500 | revert |
| ОЗАМ | 1050 | 350 | revert |
| Отекс | 2400 | 800 | revert |
| Спрингс | 12300 | 4100 | revert |
| ТехЦентр | 1500 | 500 | revert |
| ФинГлобал | 2400 | 800 | revert |

V1 урок («В какой роли») — 20 строк, все `revert` (АМ 2100→700, СБ 12300→4100 и т.д.).

После execute Шаг 3 (импорт `monthly_income` в `current_price`) у Натальи покажет: ВМС=500, Спрингс=4100 и т.д. — без ×3. Строка «Завод ЖБИ» остаётся = 1000 (её ручная правка).

## План execute

1. Создать backup-of-backup `lesson_progress_state_backup_byn_x3_revert_2026_05_13` (RLS superadmin, та же схема) с текущими `state_json` всех 50 строк до отката.
2. UPDATE по каждой строке через `jsonb_array_elements` + `jsonb_agg`:
   - если `_id` есть в backup и `current ≈ backup × 3` → заменить `income` / `monthly_income` на backup-значение,
   - иначе оставить элемент как есть.
3. `updated_at = now()` на каждый затронутый row в `lesson_progress_state`.
4. Аудит: `audit_logs.action = 'lesson.revert_byn_x3_2026_05_13'`, по одному на затронутого `(user_id, lesson_id)` с meta `{lesson_id, rows_reverted, rows_kept, backup_table, revert_backup_table}`.

## STOP-guards

Не трогаем: `payments_v2`, `orders_v2`, `allocate_document_number`, document scenarios, Contact Center, морфологию, RLS прочих таблиц, hard-delete, код Шага 3 / `loadPortfolioFromPreviousLesson` (там нет арифметики).

**Жду подтверждения для execute.**
