# Sprint 3M — system-FLD в имени файла + явный include_position в шаблоне

Date: 2026-05-31

## Scope

Закрываем два бага, видимых на скринах пользователя:

1. **«Должность не появилась в документе»** — в шаблоне `{{ln-000012|case=genitive}}` без `|include_position=true`. По решению из утверждённого плана (правка #1–#3): default `ln`-токена остаётся **только ФИО** (контракт Sprint 3J-Roles), `include_position=true` — **обязательный явный модификатор**. Это **не** код-баг, а исправление в DOCX-шаблоне.

2. **«Имя файла без даты»** — `{{field:FLD-000133}}` (system.today) используется только в `file_name_template`, не в теле DOCX, поэтому `ai-generate-document-package` не клал его в `preresolved_fields`, и в strict `docFields['FLD-000133']` был `undefined` → пустая строка в имени файла.

## Diff

### A. `ai-generate-document-package` (≈134–262)
- Селект `document_templates` теперь грузит `file_name_template`.
- В каждом item токены `file_name_template` приклеиваются к `flat` (DOCX-текст) до прохода `flat.matchAll(TOKEN_RE)`. Так FLD/package/ln, используемые **только** в имени файла, проходят тот же путь резолва preresolved bags, что и тело DOCX.
- Дедупликация по `seen` остаётся: повторы безопасны.
- Не трогали contract/UI/типы; legacy ветки `BILLING_ENTITY_TYPES` / `SYSTEM_FIELD_VALUE_IDS` работают как раньше.

### B. `canonical-document-generate-strict` (≈40, ≈1352–1373, ≈1487–1500)
- Импорт `buildSystemFieldValues, SYSTEM_FIELD_VALUE_IDS` из `_shared/system-field-values.ts`.
- Перед сборкой `_filenameTokenMapEarly` считаем `_fnSysVals = buildSystemFieldValues(new Date())` один раз. Используется и в early-map (для `dc:title` docprops), и в финальном `filenameTokenMap`.
- Backstop: если `applyFormat`/`baseValueByFld` дали пусто и `SYSTEM_FIELD_VALUE_IDS.has(fld)` — берём значение из `_fnSysVals[fld]`. Это страхует старые батчи, чужие пайплайны и случаи, когда оркестратор A не добежал.
- Sprint 3L-блок «enrich package/ln keys» сохранён без изменений: ключи `package.ul.FLD-000011`, `package.ul.FLD-000011|format=short`, `ln-000012`, `ln-000012|format=signature_short` остаются в map.

### C. Production DOCX-шаблон — **в этом sprint код-патч НЕ применяется**
Сервис-роль ключ для storage в текущем окружении недоступен; патч `.docx` через psql невозможен (бинарь в storage). Пользователю нужно один раз заменить в Word-шаблоне «Приказ об организации идеологической работы» токен:

```
{{ln-000012|case=genitive}}
```

на

```
{{ln-000012|include_position=true|case=genitive}}
```

и перезалить файл через админ-вкладку «Шаблоны документов». После replace в .docx появится «юрисконсульта Федорчука Сергея Валерьевича» (с учётом `metadata.position='юрисконсульт'` и опционального `metadata.position_gender`).

Backend для include_position уже готов (Sprint 3L, regression проверена в этом проходе).

## Verify

### Static
- `bunx tsc --noEmit` → 0 errors.
- `bunx vitest run` → 127 tests pass (те же 4 pre-existing fail в Deno-only файлах с https:-импортами; не из Sprint 3M).

### Runtime contract (ожидаемое поведение)

**Имя файла** (`Приказ об организации идеологической работы в {{package.ul.FLD-000011}} от {{field:FLD-000133}}`):
- было: `Приказ об организации идеологической работы в ЗАО «АЖУР инкам» от` (дата обрезалась);
- стало: `Приказ об организации идеологической работы в ЗАО «АЖУР инкам» от 31.05.2026`.

**Должность** (после правки DOCX-шаблона пользователем):
- `{{ln-000012|case=genitive}}` → `Федорчука Сергея Валерьевича` (без должности — Sprint 3J-Roles regression).
- `{{ln-000012|include_position=true|case=genitive}}` → `юрисконсульта Федорчука Сергея Валерьевича` (должность нормализуется в м.р., склоняется в тот же падеж; per-assignment override через `metadata.position_gender`).
- `{{ln-000012|include_position=true}}` (без `case`) → `юрисконсульт Иванов Иван Иванович`.
- Пустая `metadata.position` → только ФИО, даже если `include_position=true`.

### Sprint 3J-Roles regression
`{{ln-XXXXXX}}` по умолчанию → только ФИО (`formatPersonName(fn, {format:'full', case:null})`), join `; `. `include_position` остаётся opt-in.

## Non-goals (не тронуто)
- UI-контролы модификаторов в каталоге плейсхолдеров.
- Backend для billing/Gotenberg/миграций/RLS.
- Расширение модели данных (FLD, persons, roles).
- Контракт `ai_generated_documents.file_name`.
- `default_include_position` на уровне `document_package_role_catalog.metadata` (отдельный sprint, если понадобится).

## Files
- supabase/functions/ai-generate-document-package/index.ts
- supabase/functions/canonical-document-generate-strict/index.ts
- .lovable/proofs/sprint_3m_position_autoprepend_and_filename_sys_fld_2026_05.md
