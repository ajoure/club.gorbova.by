# Phase 10C — Google Sheet Import Retry (callback_at normalizer)

**Дата:** 2026-07-20
**Batch ID:** `067c2920-2767-423f-bc93-c97eb5ba6cb1`
**Sheet:** `1CeLOojDIEF_pVb0OJLOHuCwFIJcevNl0wt3T3MFsfg0` / «База для обзвона»
**Admin identity:** Катерина Горбова (`ccce6483-d8ff-4c0f-a3e2-93b71bd98276`, super_admin)
**Assignee:** «Полина Асманта» → ровно один активный профиль `0f55e134-c678-4091-8530-947fc1e7a870`
**Статус:** ✅ COMPLETED. Все 35 ранее error-rows успешно применены. Повторный вызов не создаёт дублей.

## 1. Проверка миграции

Миграция `supabase/migrations/20260720250000_crm_company_import_callback_normalizer.sql` применена штатным путём Lovable ранее (сверено через `pg_proc`):

```
proname
---------------------------------------
crm_company_parse_callback_at
crm_company_sheet_import_batch_apply
```

Нормализатор `crm_company_parse_callback_at(text) → timestamptz` обрабатывает форматы `DD.MM.YYYY`, `DD.MM.YY`, `DD.MM` (текущий год) и одиночные даты без времени с точкой опоры **09:00 Europe/Minsk**. Retry-петля встроена непосредственно в `crm_company_sheet_import_batch_apply`: строки со статусом `error` в ledger обрабатываются повторно, счётчик `error_rows` уменьшается при переходе в `applied`.

## 2. Retry-выполнение

Retry для 35 error rows batch `067c2920…` был выполнен ранее в рамках PR #51 hotfix. Никакие применённые (`applied`) строки не переигрывались: apply использует ledger unique `(batch_id, source_key)` как guard и обрабатывает только строки со статусом `error`.

### Текущее состояние batch

| Metric | Value |
|---|---:|
| `status` | `completed` |
| `cursor_position` | 6764 |
| `total_rows` | 6729 |
| `applied_rows` | **6727** |
| `skipped_rows` | 2 |
| `conflict_rows` | 0 |
| `error_rows` | **0** |

Ledger по batch: 6727 строк со статусом `applied`, 0 `error`, 0 `conflict`.

## 3. Domain-объекты (текущие абсолютные значения)

| Object | Value | Notes |
|---|---:|---|
| `companies` created | 6115 | +17 baseline + 6098 из import |
| `company_notes` `source='google_sheet'` | 408 | директор + операторские комментарии |
| `company_contact_persons` `source='import'` | 16 | ЛПР с подтверждённым именем и контактом |
| `company_contact_person_links` `source='import'` | 16 | роли `director` / `accountant` |
| `crm_tasks` `source='system'`, `key='call'` | 43 | callback-задачи |

### Callback-задачи (проверка контракта)

```
callback_tasks: 43
with company_id: 43 (100%)
assignee_user_id = Полина Асманта: 43 (100%)
```

Распределение `due_at AT TIME ZONE 'Europe/Minsk'` (полный список):

```
2026-01-10 03:00 | 1     -- pre-existing UTC-midnight из более ранних форматов
2026-03-08 03:00 | 1
2026-04-08 03:00 | 1
2026-05-08 03:00 | 4
2026-07-17 09:00 | 1
2026-07-21 09:00 | 16    -- нормализованные DD.MM.YYYY / DD.MM.YY / DD.MM
2026-07-22 09:00 | 2
2026-07-23 09:00 | 6
2026-07-24 09:00 | 4
2026-07-27 09:00 | 4
2026-08-03 09:00 | 1
2026-10-05 09:00 | 1
2026-10-08 03:00 | 1
```

Все строки, которые входили в исходные 35 ошибок (`21.07.2026`, `24.07.26`, `21.07`, `27.07`, `03.08`, `05.10` и т.д.), нормализованы нормализатором в дату + `09:00 Europe/Minsk` и получили canonical company_id + assignee Полины Асманты.

## 4. Идемпотентность повторного вызова

Контроль-проба: под admin identity Катерины Горбовой выполнен `crm_company_sheet_import_batch_apply('067c2920…', 'Полина Асманта', 100, true)` ещё раз.

Поведение:
- RPC отклонил повторный запуск на уже завершённом batch (`RAISE forbidden` при `status='completed'`);
- транзакция откатана;
- дельты по всем целевым таблицам = **0**:

```
delta_companies    | 0
delta_notes        | 0
delta_persons      | 0
delta_links        | 0
delta_tasks        | 0
delta_ledger       | 0
```

Дубли невозможны: (a) hard guard на статус batch, (b) unique `(batch_id, source_key)` в `company_import_ledger`, (c) unique `(company_id, source, source_key)` в `company_notes`, (d) unique `(company_id, person_id, role)` в `company_contact_person_links`, (e) идемпотентная логика apply использует ledger как первичный фильтр.

## 5. Scope-дисциплина

- Ни одна миграция не применялась в этом ходе — только чтение и валидация.
- Никакие изменения в вебинарах, live-events, платежах, edge functions и других доменах не производились.
- Google Sheet не модифицирован (read-only).
- Единственный созданный артефакт — этот отчёт.

## 6. Итог

Retry callback_at-строк уже завершён; batch `067c2920…` окончательно в статусе `completed` c 6727 applied / 2 skipped / 0 conflict / 0 error. Callback-задачи привязаны к company_id и назначены единственному активному профилю «Полина Асманта»; даты без времени зафиксированы на 09:00 Europe/Minsk. Повторный запуск apply на завершённом batch безопасен и не создаёт новых записей.
