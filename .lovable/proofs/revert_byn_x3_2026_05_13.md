# Execute report: REVERT-BYN-x3-2026-05-13

Откат разовой миграции 04.05.2026 (`pointA_rows[].income * 3`, `pointA_v2_rows[].monthly_income * 3`) в тренинге «Бухгалтерия как бизнес».

## Шаги

1. **Backup-of-backup** — создана таблица `lesson_progress_state_backup_byn_x3_revert_2026_05_13` (RLS: только `superadmin`, schema = id/user_id/lesson_id/state_json_before/backed_up_at). Снимок текущих `state_json` всех 63 затронутых пар `(user, lesson)` сделан до UPDATE.
2. **Row-level revert** — DO-блок прошёл по каждому элементу `pointA_rows` (V1, поле `income`) / `pointA_v2_rows` (V2, поле `monthly_income`). Заменено только там, где `current ≈ backup × 3` (tolerance 0.001). Остальные элементы не тронуты.
3. **Audit** — на каждый затронутый `(user_id, lesson_id)` записана строка в `audit_logs` с `action='lesson.revert_byn_x3_2026_05_13'`, `actor_type='system'`, `actor_label='revert_byn_x3_2026_05_13'`, `meta={lesson_id, rows_reverted, rows_kept, backup_table, revert_backup_table}`.

## Сводка по аудиту

| lesson | user-lessons | rows_reverted | rows_kept |
|---|---:|---:|---:|
| V1 `96c970e6…` (Тест: В какой роли) | 30 | 249 | 2 |
| V2 `6fb911a0…` (Шаг 2: Анализ портфеля) | 20 | 138 | 7 |
| **TOTAL** | **50** | **387** | **9** |

Полностью совпадает с dry-run (387 = 249 + 138). 13 user-lesson пар когорты C — без изменений (UPDATE не выполнялся, audit не пишется).

## Verify: Наталья Новикова (`8c3b6be5…`)

V2 урок `6fb911a0…` (после revert):

| client | monthly_income |
|---|---:|
| АвтоМэйджор | 700 |
| Билайтер | 1200 |
| Вентгарант | 1000 |
| ВМС | 500 |
| Вьюга | 600 |
| Делизия | 1500 |
| **Завод ЖБИ** | **1000** ← её ручная правка сохранена (edited_keep) |
| ИЗИ | 700 |
| Инглиш | 500 |
| ИП | 800 |
| ИП | 1200 |
| КолорТим | 1100 |
| Крепленд | 500 |
| Мичип | 1200 |
| Оберегстрой | 500 |
| ОЗАМ | 350 |
| Отекс | 800 |
| Спрингс | 4100 |
| ТехЦентр | 500 |
| ФинГлобал | 800 |

V1 урок `96c970e6…` — все 20 строк успешно вернулись на базу (350/500/800/700/1000/1500/1100/4100/3000/1200/600 …).

В Шаге 3 (`ExternalProductWorkshop`) импорт `monthly_income → current_price` теперь подтягивает базовые BYN-значения без ×3.

## Артефакты

- `lesson_progress_state_backup_byn_2026_05` — pre-migration snapshot (04.05.2026), 63 строки.
- `lesson_progress_state_backup_byn_x3_revert_2026_05_13` — pre-revert snapshot, 63 строки. Можно откатить операцию обратно `state_json := state_json_before`.
- `audit_logs WHERE action='lesson.revert_byn_x3_2026_05_13'` — 50 записей.

## STOP-guards (соблюдены)

Не тронуты: `payments_v2`, `orders_v2`, `allocate_document_number`, document scenarios, Contact Center, морфология, прочие RLS, никакого hard-delete, кода Шага 3 / `loadPortfolioFromPreviousLesson` (там нет арифметики).

## Тикет

ТКТ-26-26137 — закрыт, ссылка на этот proof.
