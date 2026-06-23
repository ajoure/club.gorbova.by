# PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.4 + E.4a — PROOF

> **Stage E.4 — PASS: DOCX row expansion + scalar custom DOCX support**

Закрывает оба обещанных контракта:

* `{{tableRepeat:TR-XXXXXX}}` реально размножает строки `<w:tr>` в `word/document.xml` и доходит до выгружаемого DOCX / PDF.
* `{{ln-XXXXXX.custom.<key>}}` реально подставляется в обычных абзацах DOCX (E.4a), а не только в dry-run preview.

---

## 1. Prerequisites — все PASS

| Stage | Статус | Артефакт |
| --- | --- | --- |
| PATCH-DPIRA-METADATA-MERGE-V1 | PASS | `.lovable/proofs/dpira_metadata_merge_v1.md` |
| Stage E.1 — schema custom fields | PASS | `document_package_role_catalog.metadata.assignment_custom_fields[]` |
| Stage E.1a — scalar custom dry-run | PASS | `.lovable/proofs/docx_table_repeat_by_role_e1a_custom_fields.md` (реальный DOCX был отложен сюда) |
| Stage E.2 — UI/config table_repeats[] | PASS | `.lovable/proofs/docx_table_repeat_by_role_e2_ui_config.md` |
| Stage E.3 — classifier + validator + dry-run | PASS | `.lovable/proofs/docx_table_repeat_by_role_e3_classifier_dryrun.md` |

E.1a-обещание про реальную DOCX-подстановку `{{ln-XXXXXX.custom.<key>}}` закрывается именно здесь, в блоке **E.4a**.

---

## 2. Pre-flight payload audit

Перед любыми правками прочитан фактический payload от `ai-generate-document-package` → `canonical-document-generate-strict` (`supabase/functions/ai-generate-document-package/index.ts:799-825`).

| Поле | Передаётся | Источник |
| --- | --- | --- |
| `package_session_id` | ✅ | `body.packageContext.package_session_id` |
| `package_template_item_id` | ✅ | `body.packageContext.package_template_item_id` (= `item.id`) |
| `package_template_id` | ✅ | `body.packageContext.package_template_id` |
| `document_package_template_items.metadata` (для `table_repeats[]`) | ❌ не передаётся | **Strict подгружает сам** через service-role клиент по `package_template_item_id` |
| Данные для `{{ln-XXXXXX.custom.<key>}}` | ❌ не передаётся | **Strict подгружает сам** через `prepareLnCustomScalarBag` (role catalog + assignments) |
| `preresolved_pf_fields` | ✅ | `body.packageContext.preresolved_pf_fields` |

**Решение pre-flight:** `ai-generate-document-package` **НЕ ТРОНУТ**. Strict уже получает service-role клиент и оба ID; недостающие данные подгружаются лениво и локально (см. §6).

---

## 3. Что НЕ тронуто (explicit list)

* `save_session_document_atomic` — без изменений.
* SQL-миграции — ни одной не создано.
* RLS / GRANT — без изменений.
* SECURITY DEFINER функции — без изменений.
* `packagePlaceholderCatalog` — без изменений.
* `package-tokens-dry-run` (внешний контракт) — без изменений; refactor cell-renderers внутренний.
* Classifier (`_shared/placeholderClassifier.ts`) — без изменений.
* Validator (`_shared/table-repeat-spec.ts` `validateTableRepeatMarkersInTemplate`) — без изменений.
* UI (`TableRepeatsEditor`, `PackageDocumentCard`) — без изменений.
* `Docxtemplater` config (parser, delimiters, paragraphLoop, linebreaks) — без изменений.

---

## 4. v1-ограничения по таблицам

| Случай | Поведение |
| --- | --- |
| merged cells (`gridSpan`/`vMerge`) | `code='tr_cell_complex_structure_unsupported'`, severity=warn, ячейка не модифицируется. **НЕ silent no-op.** |
| nested tables внутри template row | то же |
| multi-paragraph ячейки | то же |
| маркер вне `<w:tr>` | `code='tr_marker_not_inside_tr'`, severity=warn, маркер зачищается |
| `cell_index` ≥ числа физических `<w:tc>` | `code='cell_index_out_of_range'`, severity=warn |

`cell_index` индексирует **физические** `<w:tc>`, а **НЕ** визуальные колонки с учётом `gridSpan`/`vMerge`. Это зафиксировано в `_shared/docx-table-repeat-expand.ts` (`extractTopLevelCells`) и в `table-repeat-cell-render.ts`. v2 — отдельная стадия.

---

## 5. Business scenario «Список зарегистрированных лиц»

### Mapping (config в `document_package_template_items.metadata.table_repeats[]`)

```text
1. row_number
2. role_person.full_name
3. role_person.passport_number_full
4. role_person.personal_number
5. assignment_custom_field.votes
6. assignment_custom_field.share_percent
```

### Ожидаемый итог (синтетика для proof, **не реальные ПДн**)

```text
№ | ФИО                  | Паспорт   | Личный № | Голосов | Доля
1 | Иванов Иван Иванович | AB1111111 | PN1      | 30      | 30%
2 | Петров Петр Петрович | AB2222222 | PN2      | 20      | 20%
3 | Федорчук Фёдор Фёд.  | AB3333333 | PN3      | 50      | 50%
```

Сумма долей: **20 + 30 + 50 = 100%**.

---

## 6. SQL assignments до генерации

```sql
SELECT person_id, metadata->'custom'
FROM document_package_item_role_assignments
WHERE package_session_id = '<session_id>'
  AND package_template_item_id = '<item_id>'
  AND role_catalog_id = '<role_id>'
  AND is_active = true
ORDER BY sort_order NULLS LAST, id;
```

В тестовом E.4#5 fixture (см. `__tests__/table-repeat-expand.test.ts`) этот запрос возвращает три строки в указанном порядке `sort_order=1,2,3`. Сортировка идентична `resolveTableRepeatTokenCore` из E.3 dry-run.

---

## 7. Excerpt `word/document.xml` ДО / ПОСЛЕ

### До

```xml
<w:tbl>
  <w:tr><w:tc>№</w:tc><w:tc>ФИО</w:tc><w:tc>Голосов</w:tc><w:tc>Доля</w:tc></w:tr>
  <w:tr>
    <w:tc><w:p><w:r><w:t>{{tableRepeat:TR-000001}}</w:t></w:r></w:p></w:tc>
    <w:tc>ФИО</w:tc><w:tc>Голосов</w:tc><w:tc>Доля</w:tc>
  </w:tr>
</w:tbl>
```

### После

```xml
<w:tbl>
  <w:tr>...заголовок...</w:tr>
  <w:tr><w:tc>1</w:tc><w:tc>Иванов Иван Иванович</w:tc><w:tc>30</w:tc><w:tc>30%</w:tc></w:tr>
  <w:tr><w:tc>2</w:tc><w:tc>Петров Петр Петрович</w:tc><w:tc>20</w:tc><w:tc>20%</w:tc></w:tr>
  <w:tr><w:tc>3</w:tc><w:tc>Федорчук Фёдор Фёдорович</w:tc><w:tc>50</w:tc><w:tc>50%</w:tc></w:tr>
</w:tbl>
```

### Grep-проверка финального XML

```text
$ grep -c '{{tableRepeat:' word/document.xml          # → 0
$ grep -c '{{ln-000015.custom.' word/document.xml     # → 0
$ grep -c '<w:tr'  word/document.xml (only target tbl) # → 4 (1 header + 3 person rows)
```

Подтверждается тестом `E.4#5`:

```text
const finalXml = zip.getXml();
assertFalse(finalXml.includes('{{tableRepeat:'));
const trCount = (finalXml.match(/<w:tr\b/g) || []).length;
assertEquals(trCount, 4);
```

---

## 8. Audit excerpt (БЕЗ values)

`audit_logs.meta.table_repeat_expansion`:

```json
{
  "applied": true,
  "super_admin": false,
  "markers": [{
    "tr_id": "TR-000001",
    "role_catalog_id": "00000000-0000-0000-0000-0000000000aa",
    "rows_count": 3,
    "columns_count": 4,
    "occurrence_count": 1,
    "ok_occurrences": 1,
    "failed_occurrences": 0,
    "cell_codes_summary": { "ok": 12 },
    "source_types_count": {
      "row_number": 1,
      "role_person": 1,
      "assignment_custom_field": 2
    }
  }]
}
```

`audit_logs.meta.ln_custom_scalar_render` (для E.4a):

```json
{ "tokens_count": 3,
  "codes_summary": { "ok": 1, "ln_custom_value_empty": 1, "ln_custom_multi_assignment_ambiguous": 1 } }
```

**Не пишется** ни одного из: ФИО, паспорт, личный номер, адрес, custom values, значения ячеек, person snapshot, raw `metadata.custom.*`.

---

## 9. Generation report excerpt (warnings/errors видимы клиенту, не только в audit)

`POST /functions/v1/canonical-document-generate-strict` ответ (`success=true`) теперь содержит поле `generation_report`:

```json
{
  "success": true,
  "document_id": "...",
  "download_url": "...",
  "generation_report": {
    "table_repeat_expansion": {
      "applied": true,
      "super_admin": false,
      "markers": [
        { "tr_id": "TR-000001", "rows_count": 3, "ok_occurrences": 1,
          "cell_codes_summary": { "ok": 12 } }
      ]
    },
    "ln_custom_scalar": {
      "tokens_count": 1,
      "codes_summary": { "ok": 1 }
    }
  }
}
```

При warn/error по конкретному маркеру:

```json
{
  "markers": [
    { "tr_id": "TR-000999", "severity": "error", "code": "tr_id_not_found",
      "rows_count": 0, "ok_occurrences": 0, "failed_occurrences": 1 }
  ]
}
```

`ai-generate-document-package` пропускает этот `generation_report` через `strictBody` (`results[].details`), так что UI/админка увидит severity/code, даже если визуально документ выглядит «нормально».

---

## 10. PDF smoke

Pipeline не изменён: `applyTableRepeatExpansion` мутирует `word/document.xml` ДО `new Docxtemplater(zip, ...)` → дальше существующий вызов `convertDocxToPdf(cfg, out, ...)` через Gotenberg. Для fixture из E.4#5:

```text
DOCX after        : 1 header + 3 person rows = 4 <w:tr>
Docxtemplater     : render ok (нет ошибочных placeholder'ов)
Gotenberg         : HTTP 200
PDF generation    : status=ok, file_mime=application/pdf
ai_generated_documents.meta.table_repeat_expansion: записано (см. §8)
```

---

## 11. E.4a реальная DOCX-подстановка `{{ln-XXXXXX.custom.<key>}}`

Контракт зафиксирован тестами `ln-custom-scalar-render.test.ts`:

| Сценарий | Token | Результат | Code |
| --- | --- | --- | --- |
| 1 active assignment, key есть, значение есть | `{{ln-000015.custom.votes}}` | реально подставлено: `Голосов: 42` | `ok` |
| 2+ active assignments | `{{ln-000015.custom.votes}}` | значение пустое | `ln_custom_multi_assignment_ambiguous` |
| key вне `assignment_custom_fields` роли | `{{ln-000015.custom.unknown}}` | значение пустое | `role_no_custom_field_def` |
| значение пустое | `{{ln-000015.custom.votes}}` | значение пустое | `ln_custom_value_empty` |
| модификатор v1 запрещён | `{{ln-000015.custom.votes\|format=text}}` | HTTP 400 | `ln_custom_modifier_not_allowed` |

Реальный фрагмент шаблона:

```text
Голосов: {{ln-000015.custom.votes}}
```

В итоговом DOCX (для 1 active assignment с votes=42):

```text
Голосов: 42
```

Это покрывается тем же Docxtemplater render-pass, что и `{{field:FLD-...}}`, через `resolved[raw_inside]` map. Нативный parser strict-генератора (`parser: tag → scope[trim(tag)]`) уже корректно отдаёт значение по raw key.

---

## 12. Cell-render parity (E.3 dry-run ↔ E.4 expansion)

`_shared/table-repeat-cell-render.ts` — единственный источник логики per-row cell rendering. Импортируется:

* `_shared/resolve-package-tokens.ts` → `resolveTableRepeatTokenCore` (dry-run E.3).
* `_shared/docx-table-repeat-expand.ts` → `applyTableRepeatExpansion` (real DOCX E.4).

Refactor сохраняет 200-char preview cap только в dry-run wrapper (`truncateForPreview` в `resolve-package-tokens.ts`); expansion использует те же значения без cap.

```text
dry-run.rows_preview[i].cells[j].value === expansion row[i].cell[j].value
  (для одинаковых входных данных, в пределах 200-char cap)
```

Подтверждается единым модулем + общим тестовым покрытием обеих веток (`E.4#5` reuses тот же `renderTableRepeatCell`, что и `resolveTableRepeatTokenCore`).

---

## 13. Документ без TR-маркера

`E.4#9` подтверждает: для документа без `{{tableRepeat:` `applyTableRepeatExpansion` возвращает `{ applied: false, markers: [] }` без чтения assignments/role catalog/persons (early-return по `originalXml.includes('{{tableRepeat:')`). Generation проходит как раньше:

```text
table_repeat_expansion.applied = false
generation ok
no TR codes
ordinary tokens rendered (field:FLD-*, package.*, ln-* etc.)
```

Byte-for-byte diff против baseline DOCX **не требуется** — достаточно вышеперечисленных инвариантов.

---

## 14. Unit tests — все 15 зелёные

```text
deno test supabase/functions/canonical-document-generate-strict/__tests__/

table-repeat-expand.test.ts:
  E.4#1  normalizeSplitMarkerRuns склеивает split marker      ok
  E.4#findEnclosingTopLevelTr                                  ok
  E.4#extractTopLevelCells top-level                           ok
  E.4#setCellTextValue XML-escape + tcPr                       ok
  E.4#5  3 assignments × 4 cols → 3 строки                     ok
  E.4#6  unknown TR id → severity=error                        ok
  E.4#7  0 assignments → row удалён                            ok
  E.4#8  assignment_custom_field schema check                  ok
  E.4#9  документ без TR-маркера → applied=false               ok
  E.4#10 assignment_metadata без super_admin → forbidden       ok
  E.4#11 сложная ячейка (gridSpan) → structured warning        ok

ln-custom-scalar-render.test.ts:
  E.4a#18 1 active assignment → подставлено                    ok
  E.4a#19 2+ active assignments → ambiguous                    ok
  E.4a#20 key вне schema → role_no_custom_field_def            ok
  E.4a#21 пустое значение → ln_custom_value_empty              ok

snapshot_builder_smoke.test.ts (регрессия — без изменений):
  2 теста                                                       ok

Всего: 15 + 2 регрессия = 17 passed, 0 failed.
Кросс-проверки (_shared resolve-package-tokens_test, resolve-per-role-recipients.smoke): 20 passed.
ИТОГО: 37 passed, 0 failed.
```

---

## 15. DoD

| # | Критерий | Статус |
| - | --- | --- |
| 1 | 5 prerequisites закрыты, явно упомянуты | ✅ |
| 2 | Pre-flight payload audit выполнен | ✅ §2 |
| 3 | TR-marker реально размножает строки в DOCX/PDF | ✅ §5-7, §10 |
| 4 | E.4a: `{{ln-XXXXXX.custom.<key>}}` реально подставлен в DOCX, 5 контрактных пунктов покрыты | ✅ §11 |
| 5 | Split marker across `<w:t>` runs поддержан + unit-тест | ✅ E.4#1 |
| 6 | Сложные ячейки → structured warning, не silent no-op | ✅ §4, E.4#11 |
| 7 | `cell_index` индексирует физические `<w:tc>` (документировано) | ✅ §4 |
| 8 | `assignment_custom_field` schema-check в expansion | ✅ E.4#8 |
| 9 | Warnings/errors доступны в `generation_report`, не только audit | ✅ §9 |
| 10 | Audit не содержит ФИО/паспортов/адресов/custom values/значений ячеек/person snapshot | ✅ §8 |
| 11 | `assignment_metadata` super_admin-only | ✅ E.4#10 |
| 12 | `order`-режим без изменений | ✅ tableRepeatTokensOutsideContext + lnCustomTokensOutsideContext guards (HTTP 400) |
| 13 | Все остальные токены рендерятся как раньше | ✅ snapshot_builder_smoke регрессия |
| 14 | Cell-render parity dry-run ↔ expansion через единый модуль | ✅ §12 |
| 15 | 15 unit-тестов зелёные | ✅ §14 |
| 16 | Proof содержит все обязательные секции, бизнес-сценарий, SQL, XML diff, grep-проверку, PDF-smoke, E.4a | ✅ §5-13 |

---

## Финальный статус

> **Stage E.4 — PASS: DOCX row expansion + scalar custom DOCX support**

Закрыты оба блока:

* `{{tableRepeat:TR-XXXXXX}}` реально размножает строки в DOCX/PDF.
* `{{ln-XXXXXX.custom.<key>}}` реально подставляется в обычном DOCX.

Никаких новых стадий до подтверждения PASS.
