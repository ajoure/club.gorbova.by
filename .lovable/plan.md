# да, согласен, с учетом правок:

&nbsp;

1. **PATCH 2 правильный: вынести общий helper из FileDropZone**
  &nbsp;
  - Это лучший вариант, чем держать отдельную ручную обработку в AI.tsx.
  - Оставить единый SoT через:
    &nbsp;
    - resolveFileType
    - processDroppedFile
    &nbsp;
  &nbsp;
2. **PATCH 2 нужно довести до полного удаления дублирования**
  &nbsp;
  - В AI.tsx после фикса не должно остаться:
    &nbsp;
    - локального ACCEPTED_MIME
    - отдельной size-validation
    - отдельной preview-логики
    &nbsp;
  - Только вызов общего helper.
  &nbsp;
3. **PATCH 1 по расположению скрепки — правильный**
  &nbsp;
  - Вертикальный блок:
    &nbsp;
    - Анализ
    - Скрепка
    &nbsp;
  - лучше для UX и не зажимает textarea.
  &nbsp;
4. **PATCH 3 по RTF — ок**
  &nbsp;
  - RTF как plain text fallback допустим.
  - Главное, чтобы он:
    &nbsp;
    - принимался в picker,
    - попадал в список,
    - проходил extraction pipeline,
    - не ломал отправку.
    &nbsp;
  &nbsp;
5. **PATCH 4 по CSV — ок**
  &nbsp;
  - Для .csv plain text read — правильный и достаточный путь.
  - Не нужно тащить его через SheetJS.
  &nbsp;
6. **Нужно синхронно обновить оба места определения типа файла**
  &nbsp;
  - После патча .rtf / .csv должны быть добавлены и в:
    &nbsp;
    - FileDropZone
    - fileExtractor.ts
    &nbsp;
  - Без расхождений между upload и extraction.
  &nbsp;
7. **PATCH 5 действительно закрывается PATCH 2**
  &nbsp;
  - После drop валидные файлы должны сразу появляться в chatFiles, а uploader должен открываться автоматически.
  - Это и есть нужный UX-result.
  &nbsp;
8. **DoD стоит усилить**
  &nbsp;
  - Проверить отдельно:
    &nbsp;
    - .rtf file-only отправляется без текста;
    - .csv file-only отправляется без текста;
    - после drag & drop файл сразу виден в compact-списке;
    - в AI.tsx больше нет дублирующей file-validation логики.
    &nbsp;
  &nbsp;
9. **Единый extraction pipeline — обязательный gate**
  &nbsp;
  - И обычный чат, и scenario mode должны использовать один и тот же pipeline подготовки файлов.
  - Это ключевой критерий закрытия патча.
  &nbsp;

&nbsp;

&nbsp;

План: 5 патчей для загрузки файлов в чат AI

## PATCH 1: Перенести скрепку под кнопку «Анализ»

**Файл: `src/pages/AI.tsx` (строки 605-642)**

Текущая структура: `[Анализ] [Скрепка] [Textarea] [Send]` — всё в одном ряду.

Новая структура:

```text
[Анализ  ] [Textarea] [Send]
[Скрепка ]
```

Обернуть `ChatScenarioLauncher` и кнопку `Paperclip` в `<div className="flex flex-col gap-1 shrink-0">`, убрав скрепку из основного ряда с textarea.

---

## PATCH 2: Убрать дублирующую file-validation из AI.tsx

**Файл: `src/components/mns/FileDropZone.tsx**`

Вынести `getFileType` и `processFile` как экспортируемые утилиты:

- `export function resolveFileType(file: File): UploadedFile["type"]` — текущая логика из внутреннего `getFileType` + новые типы (RTF, CSV)
- `export async function processDroppedFile(file: File, maxSizeMB: number): Promise<UploadedFile | null>` — текущая логика из `processFile`

Внутри `FileDropZone` переключить на вызов этих же экспортированных функций (единый SoT).

**Файл: `src/pages/AI.tsx` (строки 394-441)**

Заменить `handleChatDrop` — убрать дублированный `ACCEPTED_MIME`, `MAX_SIZE`, ручную обработку. Вместо этого:

```tsx
const handleChatDrop = useCallback(async (e: React.DragEvent) => {
  if (!e.dataTransfer.types.includes('Files')) return;
  e.preventDefault();
  e.stopPropagation();
  setIsDragOverChat(false);
  const droppedFiles = Array.from(e.dataTransfer.files);
  if (droppedFiles.length === 0) return;
  setShowUploader(true);
  const remaining = 5 - chatFiles.length;
  if (remaining <= 0) return;
  const processed = await Promise.all(
    droppedFiles.slice(0, remaining).map(f => processDroppedFile(f, 20))
  );
  const valid = processed.filter((f): f is UploadedFile => f !== null);
  if (valid.length > 0) setChatFiles(prev => [...prev, ...valid]);
}, [chatFiles.length]);
```

Вся валидация MIME, размера, preview — через общий `processDroppedFile`. Дублирования нет.

---

## PATCH 3: Добавить поддержку RTF

`**src/components/mns/FileDropZone.tsx`:**

- В `ACCEPTED_TYPES` добавить: `"application/rtf": "word"`, `"text/rtf": "word"`
- В `resolveFileType` fallback по расширению: `.rtf` → `"word"`
- В `accept` атрибуты добавить `.rtf`
- Обновить подпись: `PDF, JPG, PNG, Word, Excel, RTF, CSV`

`**src/utils/fileExtractor.ts`:**

- В `getFileType` добавить MIME `application/rtf`, `text/rtf` → `"word"`, fallback `.rtf` → `"word"`
- В `extractTextFromFile`: перед вызовом `extractFromWord` проверить расширение `.rtf` — для RTF использовать `file.text()` как plain text fallback (mammoth не поддерживает RTF)

---

## PATCH 4: Добавить поддержку CSV

`**src/components/mns/FileDropZone.tsx`:**

- В `ACCEPTED_TYPES` добавить: `"text/csv": "excel"`
- В `resolveFileType` fallback: `.csv` → `"excel"`
- В `accept` атрибуты добавить `.csv`

`**src/utils/fileExtractor.ts`:**

- В `getFileType` добавить `"text/csv"` → `"excel"`, fallback `.csv` → `"excel"`
- В `extractTextFromFile`: перед `extractFromExcel` проверить расширение `.csv` — читать через `file.text()` и вернуть как есть (plain text), без SheetJS

---

## PATCH 5: Drag & drop UX — файлы сразу видны

Уже решается в PATCH 2: после вызова `processDroppedFile` валидные файлы сразу попадают в `chatFiles`, `showUploader` ставится в `true`, compact-список немедленно отображается.

---

## Что не затрагивается

Edge function, useAiChat, PromptRunFlow, база данных, автоскролл.

## DoD

1. Скрепка под кнопкой «Анализ», не в одном ряду с textarea
2. Дублирующей file-validation в AI.tsx нет — единый SoT через `processDroppedFile`
3. `.rtf` принимается, виден в списке, текст извлекается (plain text fallback)
4. `.csv` принимается, виден в списке, текст извлекается (plain text read)
5. Drag & drop добавляет файлы сразу в compact-список
6. File-only message (без текста) уходит корректно
7. Длинные имена не ломают layout (truncate + min-w-0)
8. После отправки chatFiles очищается, uploader скрывается
9. Единый extraction pipeline для chat и scenario mode