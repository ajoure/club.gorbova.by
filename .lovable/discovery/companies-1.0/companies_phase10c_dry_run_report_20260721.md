# Companies Phase 10C/10E — Dry-run отчёт импорта «База для обзвона»

**Дата:** 2026-07-21
**Статус:** ✅ DRY-RUN / PREVIEW ONLY — CRM данные не изменены.
**Scope:** только CRM Companies. Webinars / live-events / payments не затронуты.
Публикация production не выполнялась.

## 1. Источник

- Spreadsheet ID: `1CeLOojDIEF_pVb0OJLOHuCwFIJcevNl0wt3T3MFsfg0`
- Вкладка: `База для обзвона`
- Заголовок: строка 3, данные `A4:W6732`
- Извлечено: **6 729 data rows** (read-only, через `gviz/tq?out=csv`, тот же
  канал, что и `company-sheet-fetch`).

Sheet не модифицирован.

## 2. Preview batch (persisted, без записей в CRM)

RPC `crm_company_sheet_import_batch_start` вызван из-под identity Катерины
Горбовой (`ccce6483-d3b0-48ca-8e8b-96a835d98276`, `super_admin`) через
`request.jwt.claims.sub`. RPC — SECURITY DEFINER, `writes=false`,
`approval_required=true`, никаких записей в `companies`, `company_notes`,
`crm_tasks`.

| Поле | Значение |
|---|---|
| **batch_id** | `a481d147-91c7-4aa3-818c-7de02c3971f1` |
| status | `preview` |
| total_rows | 6729 |
| cursor_position | 0 |
| applied_rows | 0 |
| error_rows | 0 |
| source | `google_sheet` |
| source_reference | `1CeLOojDIEF_pVb0OJLOHuCwFIJcevNl0wt3T3MFsfg0:База для обзвона` |
| writes | `false` |
| approval_required | `true` |

Verification (последние 10 минут):
- `companies` — 6 150 (без изменений с прошлого импорта).
- `company_notes` создано за окно — **0**.
- `crm_tasks` создано за окно — **0**.

## 3. Нормализация входа (парити с `CompanySheetImportDialog.tsx`)

Пайплайн повторяет `parseCompanyRows` + `parseLprContacts`:

- **Название**: `full_name` из колонки B; canonical display-name будет очищен от
  кавычек и ОПФ триггером `crm_company_import_name_normalization_trg`
  (миграция `20260721100000`), эта нормализация выполняется на INSERT в
  `companies` и не затрагивается на preview.
- **Телефоны**: список из C, split по `,;/` и переносам; для BY нормализация в
  `+375XXXXXXXXX` (маски `+375…`, `80…`, 9-значные локальные). Первый валидный
  → `phone`, остальные — в `phones[]`.
- **Email**: список из D, lower-case, split по разделителям; первый → `email`.
- **ОПФ (E)**: `ИП / И.П. / индивидуальный предприниматель` →
  `company_kind='entrepreneur'`, иначе `legal_entity`.
- **УНП (G)**: очистка от нецифр, обрезка до 9 символов; не 9 цифр — `unp=NULL`.
- **Руководитель (H/I/J)**: `director_name`, `director_position`, `acts_on_basis`
  сохраняются в canonical-реквизиты **и** отдельной note в feed. НЕ создаётся
  запись в `profiles`, НЕ создаётся контакт компании.
- **Комментарий (K)**: одна заметка в `company_notes` с
  `source='google_sheet:База для обзвона'`, ключ идемпотентности `row:<N>`.
- **ЛПР (L)**: `parseLprContacts` извлекает `full_name`, `phone`, `email`,
  `job_title`, роль `director|accountant`. Только записи с валидным контактом
  (телефон или email) идут в `company_contact_persons` + `..._links`.
  Категория «Контакты ЛПР» без структуры остаётся текстом в feed-note.
- **callback (N)**: парсер принимает `DD.MM.YYYY[ HH:MM]`, `DD.MM.YY`, `DD.MM`
  (текущий год), ISO. Время по умолчанию — 09:00 `Europe/Minsk` (UTC+3).
- **amoCRM ID (W)**: провайдер `amocrm` в `company_external_ids`.

## 4. Totals по нормализованному входу

| Метрика | Значение |
|---|---:|
| Строк с названием | 6 729 |
| Строк с телефоном | 6 728 |
| Строк с email | 6 168 |
| Строк с УНП (9 цифр) | 277 |
| Строк с невалидным непустым УНП | 1 |
| Строк с комментарием оператора | 169 |
| Строк с датой callback | 43 |
| Callback нормализован в ISO+Minsk | 43 |
| Callback не удалось нормализовать | 0 |
| Строк с директором (H) | 238 |
| Строк с структурированным ЛПР | 15 |
| Строк с amoCRM ID | 6 729 |
| Строк без amoCRM ID | 0 |
| Телефоны с добавленным `+375` префиксом | 2 578 |

## 5. Reconciliation preview (безопасное сопоставление, без записей)

Ключи: `by:<unp>` в `companies.unp_normalized` и `amocrm:<id>` в
`company_external_ids`.

| Классификация | Строк |
|---|---:|
| **existing** (уже есть canonical по UNP или amoCRM) | **6 138** |
| **create** (новая компания, дублей не найдено) | **591** |
| **link_candidate** (несоответствие UNP↔amocrm→другая компания) | 0 |
| **conflict** | 0 |
| **skip** (без имени/телефона/email) | 0 |

Дополнительно:
- Совпадений по UNP — 277 строк.
- Совпадений по amoCRM ID — 6 133 строки.

### Дубли UNP в самом source

Два UNP встречаются в источнике более одного раза:

| UNP | source rows |
|---|---|
| `192194581` | `row:5410`, `row:5867` |
| `192383209` | `row:6609`, `row:6610` |

Плановое поведение apply: обе строки не merge-ятся автоматически; при попытке
создать вторую компанию с тем же UNP RPC вернёт `conflict`, canonical company
остаётся первой applied. Ledger сохраняет `source_key='row:<N>'` для обеих.

## 6. Assignee resolution

`ILIKE '%Полина%'` в `profiles` — 28 совпадений. Точное `full_name='Полина
Асманта'` — **ровно 1**:

- `9644d8ed-b7ef-4ca5-b3b0-78970d9fc5f3` — `Полина Асманта`.

Условие плана «assignee разрешён ровно в один профиль» выполнено. Callback-
задачи будут создаваться только на этот `assigned_to`. Если apply запускается
c batch, где `callback_at` присутствует, а assignee расходится — RPC
останавливается до записи задач (Phase 10E stop-guard).

## 7. Stop-guards соблюдены

1. `crm_company_sheet_import_batch_start` — единственная точка записи для
   preview, status=`preview`, `writes=false`, `approval_required=true`.
2. Никаких вызовов `crm_company_sheet_import_batch_apply` в этом отчёте.
3. `companies` / `company_notes` / `crm_tasks` — 0 новых записей за окно
   выполнения.
4. Названия компаний в canonical слое очищаются триггером на INSERT
   (кавычки, `ООО/ЗАО/ИП/…`); при preview этот триггер не срабатывает.
5. Дубли UNP внутри source не merge-ятся молча.
6. Руководитель (H) не создаётся как `profiles`-контакт.
7. `callback_at` = ISO+`Europe/Minsk` (UTC+3, без DST).
8. amoCRM ID пишется в `company_external_ids`, а не в `companies.metadata`.

## 8. Что требуется для перехода к apply

Отдельное подтверждение пользователя. После approval:

```
SELECT crm_company_sheet_import_batch_apply(
  _batch_id      => 'a481d147-91c7-4aa3-818c-7de02c3971f1',
  _assignee_name => 'Полина Асманта',
  _max_rows      => 100,
  _confirm       => true
);
```

Итеративно до `status='completed'`. Идемпотентность за счёт
`company_import_ledger(source, source_key)`; повторный запуск того же
batch безопасен.

## 9. Артефакты

- Нормализованный batch (в памяти): `/tmp/co/rows_clean.json` (6 729 объектов).
- Preview batch persisted в `company_import_batches` под ID выше.
- Никакие файлы репозитория не изменялись, кроме этого отчёта.
