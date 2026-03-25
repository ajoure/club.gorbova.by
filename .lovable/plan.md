# да, согласен, с учетом правок:

&nbsp;

1. В PATCH 4 лучше делать не просто UPDATE prompt_text, а обновлять весь набор текстовых полей сценария:
  &nbsp;
  - title
  - description
  - prompt_text
  - type
  - input_hint
  - launcher_title
  - launcher_description
    Но по-прежнему не трогать:
  - sort_order
  - launcher_order
  - is_active
  - is_archived
  - is_visible_in_chat
  &nbsp;
2. В PATCH 2 после перевода на extractAllFilesContent нужно явно проверить, что в scenario path больше не осталось file.text() вообще — это отдельный proof.
3. В PATCH 3 кроме metadata.partial_analysis_mode = true нужно сохранить старые anti-hallucination гарантии:
  &nbsp;
  - low не блокирует,
  - но анализ только по реально извлеченным данным,
  - для остальных показателей строго: «Не рассчитывается: данные отсутствуют».
  &nbsp;
4. В DoD обязательно добавить proof на двух реальных файлах:
  &nbsp;
  - Баланс 5П 092016.xlsx
  - Баланс 2011.XLS
    и подтвердить:
  - нет false blocked response,
  - есть extraction summary,
  - есть partial/full analysis,
  - нет выдуманных цифр.
  &nbsp;
5. Финальный ожидаемый результат зафиксировать явно:
  &nbsp;
  - пустой Excel → safe blocked response;
  - частично читаемый Excel → extraction summary + partial analysis;
  - нормальный Excel → обычный анализ.
  &nbsp;

&nbsp;

&nbsp;

P1 Patch: Real Excel parsing + soft quality gate + unified extraction

## What changes and why

The root cause of false "insufficient data" blocks is twofold: (1) `handleScenarioSubmit` reads Excel via `file.text()` producing binary garbage, and (2) the quality gate blocks on `quality === "low"`. SheetJS (`xlsx` v0.18.5) is already installed but unused.

---

## PATCH 1 — SheetJS Excel parser in `fileExtractor.ts`

**Lines 1, 32, 66-106**

- Add `import * as XLSX from "xlsx"` at top
- Export `getFileType` (add `export` keyword to line 32)
- Replace `extractFromExcel` body with SheetJS:
  - `XLSX.read(new Uint8Array(arrayBuffer), { type: "array" })`
  - Iterate `workbook.SheetNames`, convert each via `XLSX.utils.sheet_to_csv(sheet)`
  - Normalize: trim lines, drop lines that are only commas/whitespace, skip empty sheets
  - Prefix each sheet with `--- Лист: SheetName ---`
  - Handles both `.xls` and `.xlsx`

## PATCH 2 — Unify `handleScenarioSubmit` via `extractAllFilesContent`

`**src/pages/AI.tsx` lines 256-288**

Replace the entire `handleScenarioSubmit` body:

1. Import `extractAllFilesContent` and `getFileType` from `@/utils/fileExtractor`
2. Build adapter: `files.map(file => ({ file, type: getFileType(file), preview: type === "image" ? await fileToBase64(file) : undefined }))`
3. Call `extractAllFilesContent(fileEntries)` → `{ textContent, images }`
4. Pass to `aiChat.sendMessage` with `fileContents: textContent || undefined`, `images` with mimeType

This completely removes `file.text()` from scenario path. Single extraction pipeline for all file types.

## PATCH 3 — Soften quality gate in edge function

`**supabase/functions/gorbova-ai-chat/index.ts**`

**Line 206**: Change from `quality === 'empty' || quality === 'low'` to `quality === 'empty'` only.

After the block check (around line 250), when `quality === "low"` and scenario is file_analysis/document_review, add:

- `metadata.partial_analysis_mode = true`
- Append partial-analysis instruction to `systemPrompt`:

```
ВАЖНО: Из документа удалось извлечь ограниченный объём данных.
Построй ответ по структуре:
1. Что удалось извлечь из документа
2. Чего не хватает для полного анализа
3. Анализ по имеющимся данным (только реально извлечённые показатели)
4. Ограничения выводов
5. Что загрузить для более точного анализа
НЕ выдумывай отсутствующие данные. Для показателей без данных пиши: «Не рассчитывается: данные отсутствуют».
```

Update `ANTI_HALLUCINATION_SUFFIX` (lines 28-33) — add partial analysis support:

```
--- ОБЯЗАТЕЛЬНЫЕ ОГРАНИЧЕНИЯ ---
- Если в содержимом файлов нет явных числовых данных — НЕ рассчитывай коэффициенты, НЕ подставляй примерные значения, НЕ реконструируй данные по структуре формы.
- Нельзя делать выводы о значениях только потому, что документ «похож на баланс».
- Если данные извлечены частично — анализируй ТОЛЬКО извлечённые показатели, для остальных укажи: «Данные для расчёта отсутствуют».
- В начале ответа кратко перечисли, какие данные обнаружены в документе.
```

## PATCH 4 — Update `balance_analysis` seed prompt

SQL insert tool — `UPDATE ai_user_prompts SET prompt_text = '...' WHERE code = 'balance_analysis'`

New `prompt_text` requires structured response: extraction summary → missing data → partial analysis → limitations → recommendations. Includes rule: if core indicators absent, mark as "данные отсутствуют" instead of refusing entirely.

Do NOT touch `sort_order`, `launcher_order`, `is_active`, `is_archived`, `is_visible_in_chat`.

---

## Files


| File                                          | Change                                                   |
| --------------------------------------------- | -------------------------------------------------------- |
| `src/utils/fileExtractor.ts`                  | SheetJS parser, export `getFileType`                     |
| `src/pages/AI.tsx`                            | Unify via `extractAllFilesContent`, remove `file.text()` |
| `supabase/functions/gorbova-ai-chat/index.ts` | `low` → partial analysis, update suffix                  |
| DB update (insert tool)                       | Update `balance_analysis` prompt_text                    |


## DoD

1. Empty `.xlsx` → safe blocked response (quality=empty)
2. Valid `.xlsx` → SheetJS extracts structured CSV, full analysis
3. Valid `.xls` → same via SheetJS
4. `quality === "low"` → partial analysis with `partial_analysis_mode: true`
5. No `file.text()` in scenario path
6. Image-only upload → not blocked