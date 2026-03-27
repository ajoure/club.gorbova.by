# да, согласен, с учетом правок:

&nbsp;

1. **Shared type UnsupportedFileInfo**
  &nbsp;
  - решение правильное;
  - зафиксируй, что shared type используется только во frontend-части (src/types/files.ts), а в edge function остаётся отдельный inline type, без попытки импортировать из src/.
  &nbsp;
2. **PATCH 3 по unsupported .doc**
  &nbsp;
  - логика верная;
  - в extractAllFilesContent используй один и тот же helper для получения расширения, чтобы extension не вычислялся по-разному в разных ветках;
  - unsupported_reason оставь machine-readable (binary_doc_not_supported), а человекочитаемый текст формируй только в edge function.
  &nbsp;
3. **Порядок в edge function**
  &nbsp;
  - отдельно зафиксируй финальный порядок:
    &nbsp;
    1. auth / body / guards
    2. load prompt
    3. detect unsupported_files
    4. unsupported-block only if all files unsupported and no usable text/images
    5. regular quality gate
    6. build system prompt / multimodal request
    &nbsp;
  - это важно, чтобы .doc не падал в generic gate.
  &nbsp;
4. **hasUsableText**
  &nbsp;
  - текущая правка правильная;
  - лучше не дублировать regex отдельно, а вынести helper вида stripNonContentMarkers(text) и использовать его и для unsupported-check, и для quality-related checks, если это можно сделать без лишнего рефакторинга.
  &nbsp;
5. **PATCH 4 по .txt**
  &nbsp;
  - план корректный;
  - добавь явную проверку, что .txt не ломает существующий prepareFilesPayload и не уходит в images[];
  - текстовые файлы должны попадать только в fileContents.
  &nbsp;
6. **FileDropZone**
  &nbsp;
  - помимо ACCEPTED_TYPES, ACCEPT_STRING, resolveFileType, getFileIcon — проверь все UI-подсказки и compact/full режимы, чтобы список форматов был одинаковый;
  - не оставляй расхождение между реально допустимыми типами и текстом в интерфейсе.
  &nbsp;
7. **Mixed-case .doc + screenshot**
  &nbsp;
  - план хороший;
  - явно зафиксируй, что в этом кейсе:
    &nbsp;
    - unsupported_files_count = 1
    - unsupported_all_files = false
    - images_present = true
    - blocked response не срабатывает.
    &nbsp;
  &nbsp;
8. **Blocked message fallback**
  &nbsp;
  - порядок unsupported_reason → code → type → default корректный;
  - отдельно подчеркни, что unsupported-ветка имеет приоритет только в режиме allFilesUnsupported, а не в любом mixed-case.
  &nbsp;
9. **DoD дополни proof для .txt**
  &nbsp;
  - кроме “проходит frontend/backend filters” добавь:
    &nbsp;
    - .txt реально виден в compact uploader,
    - после отправки его содержимое попадает в fileContents.
    &nbsp;
  &nbsp;
10. **Dry-run / STOP-guard**

&nbsp;

&nbsp;

&nbsp;

- корректно;
- ещё один guard:
  &nbsp;
  - если после добавления "text" появляется хотя бы один type error/exhaustive-check break в UI, не обходить через as any, а закрыть все switch/case явно.
  &nbsp;

&nbsp;

&nbsp;

После этих правок план можно выполнять.

&nbsp;

План: PATCH 3 + PATCH 4 — unsupported `.doc`, поддержка `.txt`, unified pipeline

## Проблема

1. Бинарный `.doc` проходит в mammoth, mammoth не может его прочитать, возвращает пустой текст → quality gate блокирует с generic/бухгалтерским сообщением вместо честного отказа.
2. `.txt` файлы не проходят через frontend accept list и backend allowed lists, хотя `getFileType` уже возвращает `"text"`.
3. `extractAllFilesContent` не обрабатывает `type === "text"`.
4. Нет structured сигнала об unsupported файлах — edge function полагается только на строковый анализ `fileContents`.

## Диагностика (фактическое состояние)


| Компонент                       | `.doc`                            | `.txt`                  |
| ------------------------------- | --------------------------------- | ----------------------- |
| `FileDropZone` `ACCEPT_STRING`  | ✅ `.doc` есть                     | ❌ нет `.txt`            |
| `FileDropZone` `ACCEPTED_TYPES` | ✅ `application/msword: "word"`    | ❌ нет `text/plain`      |
| `resolveFileType`               | ✅ `ext === "doc" → "word"`        | ❌ нет `ext === "txt"`   |
| `UploadedFile["type"]` union    | ❌ нет `"text"`                    | ❌ нет `"text"`          |
| `getFileIcon`                   | word case                         | ❌ нет text case         |
| `getFileType` (fileExtractor)   | ✅ `"word"`                        | ✅ `"text"`              |
| `extractFromWord`               | ❌ mammoth fails на binary `.doc`  | —                       |
| `extractAllFilesContent` ветка  | ✅ `type === "word"`               | ❌ нет `type === "text"` |
| Edge fn `ALLOWED_EXTENSIONS`    | ✅ `.doc`                          | ❌ нет `.txt`            |
| Edge fn `ALLOWED_MIME_PREFIXES` | ✅ `application/msword`            | ❌ нет `text/plain`      |
| Edge fn `assessExtractQuality`  | маркеры `[PARSE_EMPTY]` удаляются | —                       |
| Edge fn `RequestBody`           | нет `unsupported_files`           | —                       |


## Предлагаемое решение

### Shared type: `UnsupportedFileInfo`

Создать `src/types/files.ts`:

```ts
export interface UnsupportedFileInfo {
  name: string;
  reason: string;
  extension?: string;
}
```

Импортировать в `fileExtractor.ts`, `AiPageContent.tsx`, `useAiChat.ts`. В edge function — inline copy (Deno не имеет доступа к `src/`).

### PATCH 3: `.doc` unsupported flow

**3.1 `src/utils/fileExtractor.ts**`

- Расширить `ExtractedContent`:
  ```ts
  export interface ExtractedContent {
    text: string;
    type: "image" | "pdf" | "word" | "excel" | "text";
    filename: string;
    unsupported?: boolean;
    unsupported_reason?: string;
  }
  ```
- В `extractFromWord` — STOP-guard для `.doc`:
  ```ts
  if (ext === "doc") {
    return { text: "", type: "word", filename: file.name,
      unsupported: true, unsupported_reason: "binary_doc_not_supported" };
  }
  ```
- В `extractAllFilesContent`:
  - Расширить return type: добавить `unsupportedFiles?: UnsupportedFileInfo[]`
  - В ветке `word/excel` после `extractTextFromFile`:
    - если `extracted.unsupported` → push в `unsupportedFiles[]` + `textParts.push("[UNSUPPORTED_FORMAT: ...]")` (вспомогательный след, не source of truth)
    - если `extracted.text.trim()` → обычный `--- Содержимое файла ---`
    - иначе → `[PARSE_EMPTY: ...]`

**3.2 `src/components/ai-chat/AiPageContent.tsx**`

- В `prepareFilesPayload` деструктурировать `unsupportedFiles` из `extractAllFilesContent` и включить в return.
- Расширить тип `fileOpts` в `handleSendMessage` и `handleScenarioSubmit`.

**3.3 `src/hooks/useAiChat.ts**`

- Расширить `options` в `sendMessage`:
  ```ts
  unsupportedFiles?: UnsupportedFileInfo[];
  ```
- Пробросить в body:
  ```ts
  unsupported_files: options?.unsupportedFiles,
  ```

**3.4 `supabase/functions/gorbova-ai-chat/index.ts**`

- Inline type:
  ```ts
  interface UnsupportedFileInfo { name: string; reason: string; extension?: string; }
  ```
- Расширить `RequestBody`:
  ```ts
  unsupported_files?: UnsupportedFileInfo[];
  ```
- **Новый блок ПЕРЕД quality gate** (после загрузки промпта, перед строкой 201):
  `hasUsableText` считать через очищенный текст без служебных маркеров:
  ```ts
  const markerPattern = /\[(PARSE_EMPTY|UNSUPPORTED_FORMAT|Изображение|PDF документ)[^\]]*\]/g;
  const cleanedForCheck = (processedFileContents || '').replace(markerPattern, '').trim();
  const hasUsableText = cleanedForCheck.length > 0;
  ```
  Условие `allFilesUnsupported`:
  ```ts
  const unsupportedFiles = body.unsupported_files;
  const allFilesUnsupported =
    Array.isArray(fileNames) && fileNames.length > 0
    && Array.isArray(unsupportedFiles) && unsupportedFiles.length === fileNames.length
    && !hasImages
    && !hasUsableText;
  ```
  Если `allFilesUnsupported`:
  ```ts
  const blockedByUnsupportedReason: Record<string, string> = {
    binary_doc_not_supported: 'Формат .doc не поддерживается для извлечения текста. Пересохраните файл в .docx, PDF или загрузите изображение/скриншот документа.',
  };
  const firstReason = unsupportedFiles![0].reason;
  const blockedContent = blockedByUnsupportedReason[firstReason]
    ?? 'Формат файла не поддерживается. Загрузите файл в другом формате (PDF, .docx, изображение).';
  // return blocked response
  ```
  Если есть `unsupportedFiles` но запрос НЕ блокируется (mixed case) → записать в metadata:
  ```ts
  metadata.unsupported_files_count = unsupportedFiles.length;
  metadata.unsupported_reasons = unsupportedFiles.map(f => f.reason);
  metadata.unsupported_file_names = unsupportedFiles.map(f => f.name);
  metadata.unsupported_all_files = false;
  ```
  Если `allFilesUnsupported` → в metadata:
  ```ts
  metadata.unsupported_all_files = true;
  ```
- **Приоритет blocked message** (единый порядок fallback):
  1. `unsupported_reason` (если `allFilesUnsupported`)
  2. `promptData?.code` → `blockedByCode`
  3. `promptData?.type` → `blockedByType`
  4. `defaultBlockedMsg`

### PATCH 4: Полная поддержка `.txt`

**4.1 `src/components/mns/FileDropZone.tsx**`

- Расширить union `UploadedFile["type"]`: добавить `"text"`:
  ```ts
  type: "image" | "pdf" | "word" | "excel" | "text" | "other";
  ```
- `ACCEPTED_TYPES`: добавить `"text/plain": "text"`
- `ACCEPT_STRING`: добавить `,.txt` в конец
- `resolveFileType`: добавить `if (ext === "txt") return "text";`
- `getFileIcon`: добавить `case "text": return <FileText className="h-4 w-4 text-gray-500" />;`
- UI подсказки (строки 187 и 206): добавить `TXT` в список форматов:
  - compact: `до {maxSizeMB} МБ • PDF, JPG, PNG, Word, Excel, RTF, CSV, TXT`
  - full: `PDF, JPG, PNG, Word, Excel, RTF, CSV, TXT • до {maxSizeMB} МБ`

**4.2 `src/utils/fileExtractor.ts` — `extractAllFilesContent**`

Добавить ветку `type === "text"` по той же схеме, что `word/excel`:

```ts
} else if (type === "text") {
  const extracted = await extractTextFromFile(file);
  if (extracted?.unsupported) {
    unsupportedFiles.push({ name: file.name, reason: extracted.unsupported_reason!, extension: ext });
    textParts.push(`[UNSUPPORTED_FORMAT: ${file.name}]`);
  } else if (extracted?.text?.trim()) {
    textParts.push(`--- Содержимое файла: ${file.name} ---\n${extracted.text}\n--- Конец файла ---`);
  } else {
    textParts.push(`[PARSE_EMPTY: ${file.name}]`);
  }
}
```

**4.3 `supabase/functions/gorbova-ai-chat/index.ts**`

- `ALLOWED_EXTENSIONS`: добавить `'.txt'`
- `ALLOWED_MIME_PREFIXES`: добавить `'text/plain'` (именно `text/plain`, не общий `text/`)

**4.4 Проверка paste flow**: `handlePaste` в `FileDropZone` вызывает `addFiles` → `processDroppedFile` → `resolveFileType`. После добавления `"text/plain"` в `ACCEPTED_TYPES` и `"txt"` в `resolveFileType` — paste flow работает без дополнительных изменений.

## Изменяемые файлы

1. `src/types/files.ts` — **новый**, shared type `UnsupportedFileInfo`
2. `src/utils/fileExtractor.ts` — расширить `ExtractedContent`, STOP-guard `.doc`, ветка `"text"`, return `unsupportedFiles`
3. `src/components/mns/FileDropZone.tsx` — расширить `UploadedFile["type"]`, добавить `.txt`/`text/plain`, обновить UI тексты
4. `src/components/ai-chat/AiPageContent.tsx` — пробросить `unsupportedFiles` из `prepareFilesPayload` в `sendMessage`
5. `src/hooks/useAiChat.ts` — пробросить `unsupportedFiles` в body fetch
6. `supabase/functions/gorbova-ai-chat/index.ts` — unsupported-блок до quality gate, `.txt` в allowed lists, metadata расширение

## Что НЕ меняем

- `PromptRunFlow.tsx` — источник истины `activeScenario.id`
- `ChatScenarioLauncher.tsx`
- `mns-response-generator` — используем только как референс
- БД, RLS, другие edge functions
- Существующий vision pipeline

## Dry-run

- Перед каждым патчем проверить, что `UploadedFile["type"]` union включает `"text"` и все switch/case покрывают его.
- Убедиться, что `assessExtractQuality` в edge function вызывается ПОСЛЕ unsupported-блока (чтобы unsupported `.doc` не попадал в generic quality gate).
- Проверить, что `hasUsableText` считается через cleaned text без маркеров.

## STOP-guards

- Если mammoth начнёт поддерживать `.doc` в будущем — пересмотреть STOP-guard (но сейчас — честный unsupported).
- Не расширять `ALLOWED_MIME_PREFIXES` до общего `text/` — только `text/plain`.
- Не пытаться читать бинарный `.doc` как plain text.

## DoD

1. `.doc` → blocked response: «Формат .doc не поддерживается…» без упоминания бухгалтерских показателей
2. `.docx` → текст извлекается, анализ работает
3. `pdf` → `images[]` в payload, edge function формирует multimodal request с `image_url`; `fileContents` не основной источник
4. `jpg/png/webp` → аналогично, vision path
5. `.txt` → проходит frontend accept (FileDropZone) И backend allowed lists, извлекается по text path
6. Mixed `.docx` + screenshot → оба источника в одном request
7. Mixed `.doc` + screenshot:
  - `.doc` в `unsupported_files` (count=1)
  - screenshot по vision path (`images_present=true`)
  - запрос НЕ блокируется
  - ответ строится по изображению
8. `unsupported_files` реально уходит в network body (structured payload)
9. `.txt` реально проходит оба фильтра: frontend accept и backend allowed lists
10. Blocked message fallback: `unsupported_reason` → `code` → `type` → `default`
11. В metadata при unsupported: `unsupported_files_count`, `unsupported_reasons`, `unsupported_file_names`, `unsupported_all_files`
12. Нет регрессий в `PromptRunFlow` и existing scenario flow
13. STOP-guard: бинарный `.doc` не читается как plain text и не подаётся в mammoth

## Риски

- `UploadedFile["type"]` union расширяется — нужно проверить все места, где используется этот тип (switch/case, if-else, тернарные операторы). Если где-то есть exhaustive check — добавить `"text"`.
- `processDroppedFile` возвращает `null` для `"other"` — после добавления `"text"` в union, `.txt` файлы пройдут через `resolveFileType` как `"text"` (не `"other"`), поэтому не будут отфильтрованы.