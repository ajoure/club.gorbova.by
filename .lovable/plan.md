# да, согласен, с учетом правок:

&nbsp;

1. **Blocked-response сохранять в БД в том же conversation_id, что и пользовательское сообщение**
  &nbsp;
  - Это нужно явно зафиксировать в реализации, чтобы safe-response не выпадал из истории диалога.
  &nbsp;
2. **Для parse_failed лучше использовать правило “нет ни одного файла с непустым извлеченным текстом”**
  &nbsp;
  - А не просто cleaned_text_length === 0, потому что image-only кейс может иметь 0 текста, но не быть ошибкой парсинга.
  &nbsp;
3. **В filled .xlsx DoD нужен proof именно на совпадение с извлеченными числами**
  &nbsp;
  - Не просто “analysis works”.
  - Нужно подтвердить, что assistant опирается только на реально извлеченные значения из файла.
  &nbsp;
4. **Grep-proof по ai_prompt_packages сделать обязательным артефактом закрытия**
  &nbsp;
  - Должно быть подтверждение, что в gorbova-ai-chat/index.ts больше нет ни query, ни чтения ai_prompt_packages.
  &nbsp;
5. **Seed update оставить add-only по admin-настройкам**
  &nbsp;
  - Как и указано: не перетирать sort_order, launcher_order, is_active, is_archived, is_visible_in_chat.
  - Это важно сохранить именно как обязательное правило миграции/апсерта.
  &nbsp;

&nbsp;

&nbsp;

P0 Patch: Anti-hallucination guards + context separation

## Overview

Prevent AI from fabricating financial data from empty/unreadable files. Remove Telegram bot context. Add server-side quality gate. Fix dangerous fallback strings in extractors. Handle blocked responses as normal chat messages saved to DB.

---

## 1. Edge Function rewrite (`supabase/functions/gorbova-ai-chat/index.ts`)

### P0-A: Remove `ai_prompt_packages` (lines 121-130)

Delete the DB query entirely. Replace with hardcoded web-specific system prompt:

```text
Ты — gorbova AI, профессиональный бизнес-ассистент для предпринимателей.
Отвечай на русском языке. Будь полезным, точным и структурированным.

КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:
- Запрещено выдумывать, оценивать приблизительно, достраивать или предполагать числовые показатели, если они не извлечены из документа явно.
- Нельзя делать выводы о значениях только потому, что документ «похож на баланс» или содержит типовую структуру формы.
- Если данных нет — писать, что данных нет.
- Если файл пустой или нечитабельный — сообщать о невозможности анализа.
- Никогда не использовать «типовые», «примерные» или «ориентировочные» значения.
- Если невозможно рассчитать коэффициент из-за отсутствия данных, указать: «Данные для расчёта отсутствуют».
```

### P0-B: Quality gate (after prompt load, before AI call)

Add `assessExtractQuality(text)` helper:

- Strip markers: `[PARSE_EMPTY: ...]`, `[Изображение: ...]`, `[PDF документ: ...]`, `[Не удалось извлечь...]`
- Count digits (`/\d/g`), separators (`|`, `\n`)
- Return `"empty"` if cleaned < 20 chars OR 0 digits; `"low"` if cleaned < 100 AND < 5 digits; else `"ok"`

Gate logic (runs after prompt loaded, before building AI messages):

- Only blocks if `promptData?.type` is `file_analysis` or `document_review`
- `quality === "empty" || "low"` AND `images.length === 0` → blocked response
- Images present → allow through (multimodal OCR)
- `mode === "chat"` (free upload) → always allow through

**Blocked response** — HTTP 200, saved to DB:

```json
{
  "content": "Файл не содержит распознаваемых данных для анализа. Проверьте, что файл заполнен и содержит бухгалтерские показатели, или загрузите файл в другом формате.",
  "conversation_id": "...",
  "blocked": true,
  "metadata": {
    "blocked": true,
    "extract_quality": "empty",
    "original_text_length": 42,
    "cleaned_text_length": 0,
    "extracted_text_length": 0,
    "parse_failed": true,
    "analysis_blocked_reason": "insufficient_data",
    "images_present": false
  }
}
```

Both user message and blocked assistant message are saved to `ai_chat_messages` before returning.

### P0-D: Anti-hallucination suffix after scenario `prompt_text`

Append after every scenario instruction:

```text
--- ОБЯЗАТЕЛЬНЫЕ ОГРАНИЧЕНИЯ ---
Если в содержимом файлов нет явных числовых данных — НЕ рассчитывай коэффициенты,
НЕ подставляй примерные значения, НЕ реконструируй данные по структуре формы.
Вместо этого ответь: «В загруженном документе не обнаружены данные, достаточные для расчёта показателей.»
```

### P0-E: Extended metadata (always written)

- `extract_quality: "ok" | "low" | "empty"` — quality after cleaning
- `original_text_length: number` — raw fileContents length
- `cleaned_text_length: number` — length after stripping markers
- `extracted_text_length: number` — same as cleaned (alias for clarity)
- `images_present: boolean`
- `parse_failed: boolean` — true if all files returned empty text
- `blocked: boolean` — true if quality gate blocked the call
- `analysis_blocked_reason: string | null`

### Execution order in the function

1. Auth
2. Parse body
3. File guards (MIME, extension, size, count)
4. Initialize metadata + startTime
5. Truncate fileContents
6. Load prompt by `prompt_id` → get `promptData.type`
7. `assessExtractQuality()` + gate (only for file_analysis/document_review without images)
8. Build system prompt (hardcoded, no `ai_prompt_packages`)
9. Inject scenario prompt_text + anti-hallucination suffix
10. Build AI messages + call model
11. Save to DB + return

---

## 2. File extraction fixes (`src/utils/fileExtractor.ts`)

### P0-C: Remove dangerous fallback strings

`**extractFromExcel**` — both fallback cases (lines 104-108, 111-115): return `text: ""` instead of placeholder strings.

`**extractFromWord**` — error catch (lines 67-71): return `text: ""` instead of `[Не удалось извлечь...]`.

`**extractAllFilesContent**` — when extracted text is empty after trim, push `[PARSE_EMPTY: filename]` marker:

```typescript
if (extracted && extracted.text && extracted.text.trim().length > 0) {
  textParts.push(`--- Содержимое файла: ... ---\n${extracted.text}\n--- Конец файла ---`);
} else {
  textParts.push(`[PARSE_EMPTY: ${file.name}]`);
}
```

**PDF fallback** (line 141): change to `[PARSE_EMPTY: ${file.name}]` when no base64 successfully read.

---

## 3. Frontend handling (`src/hooks/useAiChat.ts`)

**Blocked response rendering**: After `supabase.functions.invoke`, check `data?.blocked === true`:

- Skip error toast
- Add assistant message with `data.content` as normal chat message
- Store `data.metadata` on the message

**Extend `AiChatMetadata**`:

```typescript
extract_quality?: "ok" | "low" | "empty";
extracted_text_length?: number;
original_text_length?: number;
cleaned_text_length?: number;
parse_failed?: boolean;
blocked?: boolean;
analysis_blocked_reason?: string;
images_present?: boolean;
```

---

## 4. Seed update (P0-F)

Idempotent `ON CONFLICT (code) DO UPDATE` with full `prompt_text` replacement. Update fields: `title`, `description`, `prompt_text`, `type`, `input_hint`, `launcher_title`, `launcher_description`. Do not overwrite `sort_order`, `launcher_order`, `is_active`, `is_archived`, `is_visible_in_chat` — leave those to admin control.

The updated `prompt_text` must include:

```text
Если в загруженном файле нет явных числовых данных баланса (активы, пассивы, капитал, выручка),
НЕ выполняй расчёт коэффициентов. Ответь: «Данные для анализа не обнаружены в загруженном документе.»
```

---

## Files


| File                                          | Patches                           |
| --------------------------------------------- | --------------------------------- |
| `supabase/functions/gorbova-ai-chat/index.ts` | P0-A, P0-B, P0-D, P0-E            |
| `src/utils/fileExtractor.ts`                  | P0-C                              |
| `src/hooks/useAiChat.ts`                      | Blocked response + metadata types |
| Seed: `balance_analysis`                      | P0-F                              |


## DoD

1. Empty `.xlsx` → safe message, no fabricated numbers, saved to DB with `blocked: true`
2. Second empty `.xlsx` → same
3. Image-only upload → not blocked, multimodal processes it, `images_present: true`
4. Free chat with empty file → no block, no fabricated analysis
5. Filled `.xlsx` → analysis works with actually extracted numbers
6. No `ai_prompt_packages` query in edge function (grep proof)
7. Blocked response renders as normal assistant message, not error toast
8. `metadata` contains `extract_quality`, `parse_failed`, `blocked`, `analysis_blocked_reason`, `images_present`, `original_text_length`, `cleaned_text_length`