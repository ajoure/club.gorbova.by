# Companies Phase 10C — Blocker при попытке controlled import

**Дата:** 2026-07-20
**Статус:** STOP — production DB drift, задача остановлена без изменений данных.

## Что было сделано

1. **Discovery источника:** прочитан Google Sheet `1CeLOojDIEF_pVb0OJLOHuCwFIJcevNl0wt3T3MFsfg0`, лист «База для обзвона». 6 730 строк → после normalization в соответствии с `CompanySheetImportDialog.tsx` осталось 6 729 валидных rows (277 c UNP9, 43 callback, 15 подтверждённых LPR, 238 директоров).
2. **Preview batch:** через `crm_company_sheet_import_batch_start` создан preview batch `867d8eb2-6bbb-4720-95cf-b7a3e8477ac0`, статус `preview`, `total_rows=6729`, `approval_required=true`. Идентичность admin — Катерина Горбова (`ccce6483-…`, super_admin), assignee — Полина Асманта (`0f55e134-…`, resolved к единственному профилю).
3. **Bugfix RPC:** миграция `20260720145451-354107` — исправлена агрегатная функция `min(uuid)` (не поддерживается PG) → `(array_agg(user_id ORDER BY user_id))[1]` в `crm_company_sheet_import_batch_apply`. Права/логика не изменены. Без правки apply падал сразу.

## Обнаруженный blocker

После bugfix запущен `crm_company_sheet_import_batch_apply(_confirm=true, _max_rows=100)`. Каждая строка отклонена с ошибкой:

```
relation "public.company_external_ids" does not exist
```

Проверка `information_schema.tables` подтверждает отсутствие в production DB четырёх плановых Phase 5B/5C схемных объектов, которые уже присутствуют в репозитории `main` (PR #48):

| Migration file (в репо) | Строк | Статус в prod DB |
|---|---:|---|
| `20260720080000_crm_companies_phase5b_links.sql` | 345 | **Не применена** |
| `20260720140000_crm_company_external_ids.sql` | 118 | **Не применена** |
| `20260720160000_crm_company_external_reconciliation.sql` | 114 | **Не применена** |
| `20260720170000_crm_company_contact_person_registry.sql` | 228 | **Не применена** |

Без этих миграций отсутствуют таблицы `company_external_ids`, `company_contact_persons`, `company_contact_person_links`, `company_notes` и RPC `company_note_create`, на которые жёстко опирается `crm_company_sheet_import_batch_apply`. Импорт технически невозможен.

## Cleanup

Все побочные эффекты failed apply откачены:

- `company_import_ledger`: удалены 6 727 error-записей (осталось 0 строк).
- Batch `867d8eb2-…` переведён в `cancelled`, все счётчики (`cursor_position`, `applied_rows`, `error_rows`, …) обнулены.
- `public.companies` — 17 строк, без изменений (совпадает с baseline Phase 3C).
- Google Sheet не модифицирован (source используется только на чтение).

## Требуется отдельное решение

Импорт из Google Sheet возобновляется только после отдельного approval:

1. Применить 4 pending миграции Phase 5B–5C (~805 строк DDL/RLS/RPC) на production DB.
2. Убедиться, что таблицы, RLS и RPC (`company_note_create`, `company_external_ids`, `company_contact_person_links`, `company_contact_persons`) соответствуют контракту, который использует `crm_company_sheet_import_batch_apply`.
3. Только затем перезапустить controlled apply тем же способом (тем же bugfix, тем же mapping, идемпотентно за счёт `company_import_ledger.(source, source_key)`).

До этого запуска production данные не изменяются.
