# Stage E.4 + E.4a — PASS (см. .lovable/proofs/docx_table_repeat_by_role_e4_row_expansion.md)

# да, согласен, с учетом правок:

1. План E.4 + E.4a можно выполнять.
  &nbsp;
  Финальный статус после выполнения:
  ```text
  Stage E.4 — PASS: DOCX row expansion + scalar custom DOCX support
  ```
  PASS возможен только если закрыты оба блока:
  - `{{tableRepeat:TR-XXXXXX}}` реально размножает строки DOCX;
  - `{{ln-XXXXXX.custom.<key>}}` реально подставляется в обычном DOCX.
2. Pre-flight payload audit обязателен до любых правок.
  &nbsp;
  Если strict не получает:
  ```text
  package_session_id
  package_template_item_id
  document_package_template_items.metadata.table_repeats
  данные для ln custom scalar
  bag/resolver для pf fields
  ```
  — не делать workaround внутри strict “вслепую”. Сначала минимальный payload patch в `ai-generate-document-package`, только для передачи недостающего контекста.
3. Допускаю минимальную правку `ai-generate-document-package` только если pre-flight докажет необходимость.
  &nbsp;
  Scope такой правки:
  ```text
  передать itemMetadata/table_repeats/preresolved_ln_custom_tokens в canonical-document-generate-strict
  ```
  Без изменения бизнес-логики оркестратора.
4. В E.4a обязательно закрыть реальную DOCX-подстановку:
  &nbsp;
  ```text
  {{ln-000015.custom.votes}}
  ```
  В proof показать обычный абзац DOCX:
  ```text
  Голосов: {{ln-000015.custom.votes}}
  ```
  И результат:
5. Для scalar custom multi-policy подтверждаю:
  - 1 active assignment → value;
  - 2+ active assignments → `ln_custom_multi_assignment_ambiguous`, value `""`;
  - key вне schema → `role_no_custom_field_def:<key>`;
  - пустое значение → `ln_custom_value_empty`;
  - modifier → `ln_custom_modifier_not_allowed`.
6. Для table-repeat business proof обязательно использовать реальный сценарий:
  &nbsp;
  ```text
  Список зарегистрированных лиц
  ```
  Mapping:
  ```text
  row_number
  role_person.full_name
  role_person.passport_number_full
  role_person.personal_number
  assignment_custom_field.votes
  assignment_custom_field.share_percent
  ```
  Ожидаемый результат:
7. Split marker across Word runs — обязательный PASS-критерий.
  &nbsp;
  Unit test и proof должны показать, что маркер, разрезанный на несколько `<w:t>/<w:r>`, находится и раскрывается.
8. V1-ограничения по таблицам принимаю:
  - без merged cells;
  - без nested tables;
  - без complex multi-paragraph cells.
  Для сложных случаев — structured warning:
  ```text
  tr_cell_complex_structure_unsupported
  ```
  Не silent no-op.
9. Fail-soft должен быть видимым.
  &nbsp;
  Все warning/error по expansion и scalar custom должны попадать в:
  ```text
  generation_report
  ```
  а не только в audit.
10. Audit не должен содержать values.

Не писать:

- ФИО;
- паспорт;
- адрес;
- custom values;
- значения ячеек;
- person snapshot;
- raw `metadata.custom`.

11. В proof обязательно добавить grep/check итогового `word/document.xml`:

```text
нет {{tableRepeat:
нет {{ln-000015.custom.
```

12. PDF-smoke обязателен:

```text
DOCX after содержит 3 строки
Gotenberg вернул ok
PDF generation status=ok
```

13. Не требовать byte-for-byte diff для обычного DOCX без marker.

Достаточно:

```text
table_repeat_expansion.applied=false
generation ok
no TR codes
ordinary tokens rendered
```

14. После выноса `table-repeat-cell-render.ts` обязательно сохранить E.3 dry-run parity.

Proof должен показать:

```text
dry-run preview values == expansion values в DOCX rows
```

для первых строк.

15. Не трогать в E.4:

```text
save_session_document_atomic
миграции
RLS / GRANT
SECURITY DEFINER
packagePlaceholderCatalog
UI TableRepeatsEditor / PackageDocumentCard
classifier / validator
package-tokens-dry-run external contract
```

Допустим только внутренний refactor shared renderer, если внешний контракт E.3 не меняется.

16. Все 22 unit-теста должны быть зелёные.
17. Proof должен быть один общий или два файла, но с явным разделением:

```text
E.4 — table-repeat row expansion
E.4a — scalar custom DOCX support
```

18. После выполнения дать отдельный отчёт. Никаких новых стадий до подтверждения PASS.
19. &nbsp;
20. План: Stage E.4 + E.4a — DOCX row expansion + реальная подстановка scalar custom tokens

PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.4 (+E.4a).

## Prerequisites (должны быть PASS)

- PATCH-DPIRA-METADATA-MERGE-V1 — PASS
- Stage E.1 — PASS (schema custom fields в `document_package_role_catalog.metadata.assignment_custom_fields[]`)
- Stage E.1a — PASS (values в `document_package_item_role_assignments.metadata.custom.<key>`, **scalar dry-run only**; реальная DOCX-подстановка `{{ln-XXXXXX.custom.<key>}}` отложена сюда, в E.4a)
- Stage E.2 — PASS (UI/config `document_package_template_items.metadata.table_repeats[]`)
- Stage E.3 — PASS (classifier `package_table_repeat`, item-level validator, structured dry-run)

Proof E.4 обязан явно сослаться на эти 5 пунктов и явно отметить, что E.1a-обещание про реальный DOCX закрывается именно здесь (E.4a).

## Scope

Стадия E.4 теперь состоит из ДВУХ обязательных блоков. PASS возможен только если оба закрыты proof'ом:

- **E.4 (main)** — реальное row expansion для `{{tableRepeat:TR-XXXXXX}}` в `word/document.xml`.
- **E.4a** — реальная DOCX-подстановка scalar `{{ln-XXXXXX.custom.<key>}}` в обычных абзацах (не только dry-run).

## НЕ-цель (общая)

- Не менять контракт `metadata.table_repeats[]`, `assignment_custom_fields[]`, classifier, validator, dry-run.
- Не трогать `save_session_document_atomic`, миграции, RLS/GRANT, SECURITY DEFINER, `packagePlaceholderCatalog`, `package-tokens-dry-run`, UI (`TableRepeatsEditor`, `PackageDocumentCard`).
- Не добавлять новые источники колонок (используется ровно набор E.1/E.2/E.3).
- Не поддерживать merged cells / nested tables / multi-paragraph cells (см. v1-ограничения ниже).
- Не трогать `order`-режим: TR-маркеры и `{{ln-…custom…}}` остаются `package_token_outside_package_context`.

## Pre-flight check (обязательный, до любых правок)

Перед реализацией прочитать фактический payload, который оркестратор `ai-generate-document-package` отдаёт в `canonical-document-generate-strict` (через `packageContext`). Проверить наличие:

1. `package_session_id`
2. `package_template_item_id`
3. `document_package_template_items.metadata` (или возможность загрузить её внутри strict по `package_template_item_id`)
4. данных для `preresolved_ln_custom_tokens` (значения `assignment.metadata.custom.<key>` per `ln-XXXXXX`)
5. bag/resolver для `package_field` (`pf-XXXXXX`) — `packageContext.preresolved_pf_fields`

**Решение по `ai-generate-document-package`:**

> `ai-generate-document-package` не трогаем, **если** canonical-document-generate-strict уже получает все 5 пунктов выше.  
> Если каких-то данных нет — допускается **минимальный add-only payload patch** в оркестраторе исключительно для передачи недостающего контекста в strict. Никаких других изменений в оркестраторе.

Если pre-flight выявит, что отсутствует и `itemMetadata.table_repeats`, и данные для `{{ln-XXXXXX.custom.<key>}}` — **STOP**: сначала отдельный короткий payload-patch (как самостоятельный proof-row), и только потом E.4/E.4a.

Pre-flight результат фиксируется в proof отдельной секцией "Pre-flight payload audit".

---

## E.4 (main) — DOCX row expansion для `{{tableRepeat:TR-XXXXXX}}`

### Точка вызова

В `supabase/functions/canonical-document-generate-strict/index.ts`, **после** загрузки `zip` и **до** `new Docxtemplater(zip, ...)` (район 1741):

```text
if (generationContext === 'package_session' && packageContext) {
  const trReport = await applyTableRepeatExpansion({
    zip, supabase,
    packageSessionId: packageContext.package_session_id,
    packageTemplateItemId: packageContext.package_template_item_id,
    itemMetadata, isSuperAdmin, preresolvedPfFields,
  });
  generationReport.table_repeat_expansion = trReport;
}
```

`order`-режим и `package_session` без TR-маркеров — no-op.

### Новый shared helper

`supabase/functions/_shared/docx-table-repeat-expand.ts`:

1. `documentXml = zip.file('word/document.xml').asText()`.
2. Если нет `{{tableRepeat:` — return `{ applied: false, markers: [] }` сразу.
3. Прочитать `metadata.table_repeats[]` через `readTableRepeats(itemMetadata)`.
4. Для каждого уникального `tr_id`:
  - Найти конфиг. Нет → `severity='error'`, `code='tr_id_not_found'`, marker → `''`, **report.markers[] += запись + warning попадает в generation report (не только audit)**.
  - Выгрузить assignments через единый helper `loadTableRepeatAssignments(session, item, role)` с `is_active=true`, ORDER **идентичным dry-run E.3** (`sort_order NULLS LAST, id`).
  - `validateTableRepeatConfig(cfg, { knownCustomKeysForRole })`. При `severity='error'` → marker `''`, `code='tr_config_invalid'`, **severity=error в generation report**.
5. Для каждой OCCURRENCE маркера:
  - **Нормализация split runs (обязательно).** Сшить соседние `<w:r><w:t>` внутри предполагаемой template row, чтобы маркер, разрезанный Word'ом на несколько runs, распознавался единым regex. Покрывается unit-тестом (см. ниже).
  - Найти ближайшую родительскую `<w:tr>...</w:tr>` индексным сканированием (top-level, не nested) — `<w:tr>` не вкладывается в `<w:tr>` напрямую, но внутри `<w:tc>` может быть nested table; брать ТОЛЬКО ближайшую внешнюю.
  - Не найдена → `code='tr_marker_not_inside_tr'`, marker `''`, severity=warn в report.
  - Сгенерировать N клонов template row. В каждом:
    - удалить маркер из всех его runs;
    - для каждого `column.cell_index` найти top-level `<w:tc>` по физическому индексу (**уточнение:** `cell_index` индексирует физические `<w:tc>`, а **НЕ** визуальные колонки с учётом `gridSpan`/merged cells; merged cells в v1 не поддерживаются — см. ограничения);
    - заменить контент ячейки одной `<w:r>` с `<w:rPr>` исходной первой ячейки и `<w:t xml:space="preserve">VALUE</w:t>`; `<w:pPr>` сохранить;
    - выход cell_index за число `<w:tc>` → ячейку пропустить, `cell_codes_summary['cell_index_out_of_range']++`, severity=warn.
  - Заменить оригинальный template row на конкатенацию клонов. 0 assignments → ноль клонов (row удаляется), `code='tr_role_has_no_assignments'`, severity=warn.
6. `zip.file('word/document.xml', newXml)`.

### Per-row рендер ячеек

- Вынести из `resolve-package-tokens.ts` ячейные функции (`renderRolePersonCell`, `readAssignmentCustomKey`, `readAssignmentMetadataPath`, `package_field`/`static_text`/`row_number`/`empty`) в `supabase/functions/_shared/table-repeat-cell-render.ts`.
- **Parity DoD:** dry-run E.3 переключается на этот же модуль; `dry-run.rows_preview[i].cells[j].value === expansion.rows[i].cells[j].value` для одинаковых входных данных (в пределах 200-char preview-cap). Покрывается отдельным тестом.
- В expansion лимит 200 символов **не применяется** (только preview).
- XML-escape значений обязателен.
- `assignment_metadata` ветка в expansion разрешена только при `isSuperAdmin === true`; иначе value `''` + `code='assignment_metadata_forbidden'`.
- `package_field` (`pf-XXXXXX`) — одно значение для всех строк; читается один раз из `packageContext.preresolved_pf_fields`.

### `assignment_custom_field` — schema check в expansion

Зеркало E.1a:

- key есть в `assignment_custom_fields` роли **и** в `assignment.metadata.custom[key]` есть значение → value, `code='ok'`.
- key есть в schema, значение пустое/отсутствует → value `''`, `code='ln_custom_value_empty'` (синоним `'ok_empty'` — в зависимости от обязательности; в v1 фиксируем `'ln_custom_value_empty'`).
- key **отсутствует** в schema роли → value `''`, `code='role_no_custom_field_def:<key>'`, severity=warn в generation report.

### Идемпотентность и fail-soft (исправлено)

- Expansion вызывается ровно один раз перед Docxtemplater.
- Ошибка по одному TR-id не обрушает рендер других TR.
- **Любая ошибка/warning expansion'а попадает не только в audit, но и в `generation_report.table_repeat_expansion**` (полный список markers/severity/code/cell_codes_summary). Если в результате не вышло раскрыть таблицу, документ ВИЗУАЛЬНО будет без таблицы — но потребитель API (UI/админка) должен видеть severity=warn|error в ответе и/или в `ai_generated_documents.meta.table_repeat_expansion`.
- HTTP 500 не отдаём; общая генерация продолжается.

### Audit (без значений)

`meta.table_repeat_expansion` пишет ТОЛЬКО:

```text
{
  applied, super_admin,
  markers: [{
    tr_id, role_catalog_id,
    rows_count, columns_count,
    source_types_count: { role_person: N, assignment_custom_field: N, ... },
    cell_codes_summary: { ok: N, ln_custom_value_empty: N, role_no_custom_field_def: N, ... },
    occurrence_count, ok_occurrences, failed_occurrences,
    severity?: 'warn'|'error', code?: '...'
  }]
}
```

**Категорически НЕ писать в audit:** ФИО, паспорт, адрес, custom values, значения ячеек, person snapshot, raw `metadata.custom.*`.

### v1-ограничения (явно)

> v1 поддерживает только простые таблицы:
>
> - без merged cells (`gridSpan`/`vMerge`);
> - без nested tables внутри template row;
> - без multi-paragraph ячеек.
>
> Для сложных ячеек — НЕ молчаливый no-op: писать `code='tr_cell_complex_structure_unsupported'`, severity=warn, в report и audit. v2 — отдельная стадия.

---

## E.4a — реальная DOCX-подстановка `{{ln-XXXXXX.custom.<key>}}`

Минимальный контракт (обычный абзац DOCX, не таблица):

1. `{{ln-000015.custom.votes}}` в обычном `<w:p>` реально подставляется при генерации DOCX (Docxtemplater render).
2. **1 active assignment** для роли `ln-000015` → подставляется значение `assignment.metadata.custom.votes`.
3. **2+ active assignments** для той же роли → controlled warning, **value=`''**` (НЕ конкатенация, НЕ первое значение); код `code='ln_custom_multi_assignment_ambiguous'`. Пишется в generation_report.
4. **key не объявлен** в `assignment_custom_fields` роли → value `''`, `code='role_no_custom_field_def:<key>'`, severity=warn.
5. **значение пустое** → value `''`, `code='ln_custom_value_empty'` (или `'ok_empty'`, выбираем `'ln_custom_value_empty'` для parity с E.4 main).
6. classifier и dry-run остаются без изменений (kind для этого токена уже зафиксирован в E.1a).

### Реализация E.4a

- Доукомплектовать `preresolved_ln_custom_tokens` в payload strict (если pre-flight показал, что их там нет — через минимальный add-only patch в `ai-generate-document-package`).
- В strict, в подготовке `resolved` (тот же bag, что и для `{{field:...}}` / `{{package.ul.…}}` / `{{ln-…}}`), добавить ключи формата `ln-XXXXXX.custom.<key>` (raw_inside, без `{{}}`) с уже подставленными значениями.
- Модификаторы в v1 запрещены: `{{ln-XXXXXX.custom.<key>|format=...}}` → `code='ln_custom_modifier_not_allowed'`, value `''`.
- Никаких изменений в Docxtemplater parser — текущий "raw key" parser уже работает (строки 1747-1753).

### Audit E.4a (без значений)

`meta.ln_custom_scalar_render`:

```text
{ tokens_count, codes_summary: { ok: N, ln_custom_value_empty: N, role_no_custom_field_def: N, ln_custom_multi_assignment_ambiguous: N } }
```

Не писать значения.

---

## Файлы

### Создать

- `supabase/functions/_shared/docx-table-repeat-expand.ts` — expansion core (E.4).
- `supabase/functions/_shared/table-repeat-cell-render.ts` — общий per-row cell renderer (E.4 + E.3 dry-run parity).
- `supabase/functions/_shared/ln-custom-scalar-prepare.ts` — подготовка `ln-XXXXXX.custom.<key>` ключей в `resolved` (E.4a).
- `.lovable/proofs/docx_table_repeat_by_role_e4_row_expansion.md`
- `.lovable/proofs/docx_ln_custom_scalar_docx_render_e4a.md` (или один общий — но обе секции явно разделены).

### Редактировать

- `supabase/functions/canonical-document-generate-strict/index.ts` — вызов `applyTableRepeatExpansion` + интеграция `ln-custom-scalar-prepare`; никаких изменений в Docxtemplater config.
- `supabase/functions/_shared/resolve-package-tokens.ts` — заменить inline cell-helpers импортом из `table-repeat-cell-render.ts`, контракт `resolveTableRepeatTokenCore` не меняется.
- `supabase/functions/ai-generate-document-package/index.ts` — **только если pre-flight показал отсутствие данных**; add-only payload patch, ничего другого.
- `.lovable/plan.md` — отметить E.4/E.4a.

### НЕ трогать

- `save_session_document_atomic`, миграции, RLS/GRANT, SECURITY DEFINER, `packagePlaceholderCatalog`, `package-tokens-dry-run`, classifier, validator, UI (`TableRepeatsEditor`, `PackageDocumentCard`).

---

## Тесты (`supabase/functions/canonical-document-generate-strict/__tests__/`)

`table-repeat-expand.test.ts`:

1. **split marker across `<w:t>` runs** — `{{tableRepeat:TR-...}}` физически разрезан Word'ом на 3 runs → нормализация склеивает, marker распознан. **Обязательный DoD.**
2. 0 assignments → row удаляется целиком; шапка таблицы остаётся.
3. 3 assignments × 6 columns → 3 строки, ячейки заполнены ожидаемо.
4. `cell_index_out_of_range` → строка остаётся, ячейка не тронута, audit code инкрементится.
5. marker вне `<w:tr>` → fail-soft, marker `''`, `code='tr_marker_not_inside_tr'` в generation report.
6. 2 разных TR-id в одном документе → оба раскрываются независимо.
7. Один TR-id в 2 разных таблицах → обе template-row раскрываются.
8. `assignment_metadata` без super_admin → `''` + `code='assignment_metadata_forbidden'`.
9. `assignment_metadata` с super_admin → значение есть.
10. `unknown TR id` → severity=error в report, marker `''`.
11. `tr_config_invalid` → severity=error в report, marker `''`.
12. `package_field` одинаков во всех строках.
13. `assignment_custom_field` различается per row.
14. **Schema check:** `assignment_custom_field` с key вне `assignment_custom_fields` → `code='role_no_custom_field_def:<key>'`.
15. Документ без TR-маркера → `applied=false`, никакого парсинга XML, generation ok.
16. **Cell-render parity:** dry-run E.3 и expansion E.4 для одинаковых входов дают одинаковые value (в пределах 200-char preview cap).
17. **Сложная ячейка** (`vMerge`/`gridSpan`/nested table в одной из target cells) → `code='tr_cell_complex_structure_unsupported'`, severity=warn.

`ln-custom-scalar-render.test.ts`:

18. 1 active assignment, key есть, значение есть → подставлено.
19. 2+ active assignments → `''` + `code='ln_custom_multi_assignment_ambiguous'`.
20. key вне schema роли → `''` + `code='role_no_custom_field_def:<key>'`.
21. значение пустое → `''` + `code='ln_custom_value_empty'`.
22. модификатор → `''` + `code='ln_custom_modifier_not_allowed'`.

---

## Proof (`.lovable/proofs/docx_table_repeat_by_role_e4_row_expansion.md` + E.4a)

Обязательные секции:

1. **Prerequisites** — ссылки на 5 PASS proof'ов.
2. **Pre-flight payload audit** — что фактически приходит в strict; нужен ли add-only patch.
3. **Что НЕ тронуто** — explicit list (save_session_document_atomic, миграции, RLS/GRANT, SECURITY DEFINER, packagePlaceholderCatalog, dry-run, classifier, validator, UI).
4. **v1-ограничения** — merged cells / nested / multi-paragraph: не поддержано, fail с structured warning.
5. **Business scenario "Список зарегистрированных лиц"**:
  - Mapping:
  1. row_number
  2. role_person.full_name
  3. role_person.passport_number_full
  4. role_person.personal_number
  5. assignment_custom_field.votes
  6. assignment_custom_field.share_percent
    `идаемый итог (значения для proof — синтетика, не реальные ПДн):`text
    тров — 20%
    анов — 30%
    дорчук — 50%
    `
6. **SQL assignments до генерации:**
  ```sql
   SELECT person_id, metadata->'custom'
   FROM document_package_item_role_assignments
   WHERE package_session_id = '<session_id>'
     AND package_template_item_id = '<item_id>'
     AND role_catalog_id = '<role_id>'
     AND is_active = true
   ORDER BY sort_order NULLS LAST, id;
  ```
7. **Excerpt `word/document.xml` до/после:**
  - до: одна `<w:tr>` с маркером;
  - после: три `<w:tr>` без маркера, со значениями;
  - значения в строках различаются;
  - явная grep-проверка: в финальном XML НЕТ строк `{{tableRepeat:` и `{{ln-000015.custom.`.
8. **Audit excerpt (без values):**
  ```text
   {
     "applied": true,
     "markers": [
       { "tr_id": "TR-000001", "rows_count": 3, "columns_count": 6,
         "cell_codes_summary": { "ok": 18 } }
     ]
   }
  ```
9. **Generation report excerpt** с severity/codes (для случая warnings).
10. **PDF smoke:** DOCX after содержит 3 строки; Gotenberg вернул 200; PDF generation status=ok.
11. **E.4a реальная DOCX-подстановка:** показать абзац `«Голосов: {{ln-000015.custom.votes}}»` → в реальном итоговом DOCX/PDF подставлено число; повторить для 2+ assignments / unknown key / empty value / modifier — с кодами в report.
12. **Cell-render parity proof:** dry-run preview values первых строк == expansion values в DOCX.
13. Для документа без маркера: достаточно зафиксировать `no table_repeat_expansion.applied`, `generation ok`, `no TR codes`, `ordinary tokens rendered` (byte-for-byte diff НЕ требуется).

---

## DoD

1. Все 5 prerequisites закрыты и явно упомянуты.
2. **Pre-flight payload audit** выполнен и зафиксирован в proof.
3. В `package_session` режиме `{{tableRepeat:TR-XXXXXX}}` реально размножает строки в `word/document.xml`, доходит до выгружаемого DOCX и PDF.
4. **E.4a:** `{{ln-XXXXXX.custom.<key>}}` в обычном абзаце реально подставлен в DOCX/PDF; все 5 контрактных пунктов (1 / 2+ / no schema / empty / modifier) покрыты.
5. **Split marker across `<w:t>` runs** — поддержано и покрыто unit-тестом.
6. Сложные ячейки (merged / nested / multi-paragraph) — out of scope, но с structured warning, а не silent no-op.
7. `cell_index` индексирует физические `<w:tc>` (документировано).
8. `assignment_custom_field` schema-check (`role_no_custom_field_def:<key>`) в expansion есть.
9. Все warnings/errors expansion и `ln-custom-scalar` доступны в **generation report**, не только в audit.
10. Audit не содержит ФИО, паспортов, адресов, custom values, значений ячеек, person snapshot.
11. `assignment_metadata` остаётся super_admin-only.
12. `order`-режим без изменений.
13. Все остальные токены (`{{field:...}}`, `{{package.*}}`, `{{ln-XXXXXX...}}` без `.custom`) продолжают рендериться как раньше.
14. **Cell-render parity:** dry-run E.3 и expansion E.4 используют единый `table-repeat-cell-render.ts`; parity покрыта тестом.
15. Все 22 unit-теста зелёные.
16. Proof содержит все 13 секций выше, включая бизнес-сценарий "Список зарегистрированных лиц", SQL, XML-excerpt до/после, grep-проверку отсутствия сырых токенов, PDF-smoke и E.4a-фрагмент.

## Финальный статус

> **Stage E.4 — PASS: DOCX row expansion + scalar custom DOCX support**

PASS возможен ТОЛЬКО если proof закрывает оба блока:

- table-repeat реально размножает строки в DOCX;
- `{{ln-XXXXXX.custom.<key>}}` реально подставляется в обычном DOCX.

После E.4 — отдельный отчёт + proof. Никаких новых стадий до подтверждения PASS.