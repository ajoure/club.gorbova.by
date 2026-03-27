# да, согласен, с учетом правок:

&nbsp;

1. **Не дублировать processFile-логику в AI.tsx**
  &nbsp;
  - Для drag & drop на GlassCard не писать отдельную третью обработку файлов.
  - Лучше передавать всё в FileDropZone через chatFiles/setChatFiles, а сам FileDropZone в compact-режиме уже должен оставаться единым SoT для:
    &nbsp;
    - валидации,
    - preview,
    - paste,
    - удаления,
    - лимитов.
    &nbsp;
  &nbsp;
2. **handleSendMessage должен использовать тот же extraction pipeline, что и scenario mode**
  &nbsp;
  - Это ключевое требование.
  - Логику извлечения не копировать “почти такую же”, а реально переиспользовать тот же кодовый путь, что и в handleScenarioSubmit.
  &nbsp;
3. **Для drag & drop на GlassCard нужен явный guard только на файловый drop**
  &nbsp;
  - Оставить проверку dataTransfer.types.includes('Files') как обязательную.
  - Иначе можно сломать обычный drag текста/выделения.
  &nbsp;
4. **Hover overlay при drag нужен мягкий и временный**
  &nbsp;
  - Не должен ломать layout и не должен перекрывать input настолько, чтобы мешать клику.
  - Лучше делать лёгкую визуальную подсветку контейнера, а не тяжелый полноэкранный слой.
  &nbsp;
5. **Paste ограничивать областью чата — правильно**
  &nbsp;
  - Не на всю страницу.
  - Если FileDropZone внутри GlassCard уже умеет paste, это лучший путь.
  &nbsp;
6. **Компактный uploader обязательно должен поддерживать длинные имена без overflow**
  &nbsp;
  - Для списка файлов:
    &nbsp;
    - truncate
    - max-w
    - min-w-0
    &nbsp;
  - Иначе снова появится баг с вылезанием текста.
  &nbsp;
7. **После отправки нужно очищать и состояние drag/paste**
  &nbsp;
  - Не только chatFiles и showUploader,
  - но и любой локальный drag-hover state, если он будет добавлен.
  &nbsp;
8. **Кнопка отправки и Enter должны работать по правилу “текст ИЛИ файлы”**
  &nbsp;
  - Это нужно сохранить как обязательный UX-gate.
  &nbsp;
9. **Автоскролл после отправки файлов — обязательный proof**
  &nbsp;
  - Так как userSentMessageRef уже используется, надо подтвердить, что он срабатывает и для file-only отправки.
  &nbsp;
10. **DoD дополнить**

&nbsp;

&nbsp;

&nbsp;

- Сообщение без текста, только с файлами, уходит корректно.
- После отправки файлов uploader закрывается и очищается.
- Free chat с файлами использует тот же extraction pipeline, что и scenario mode.
- Длинные имена файлов не ломают input-area.

&nbsp;

&nbsp;

План: Загрузка файлов в обычный чат AI

## Файлы для изменения

### 1. `src/components/mns/FileDropZone.tsx` — добавить `compact` prop

Новый опциональный prop `compact?: boolean`. В compact-режиме:

- Убрать большую drop-зону (иконка Upload, текст «Перетащите файлы»)
- Показать компактную строку: кнопка «Выбрать файлы» + подпись «до 20 МБ»
- Список файлов — компактный: имя с `truncate max-w-[200px] min-w-0`, размер, крестик
- Drag/drop/paste/processFile/лимиты — без изменений, FileDropZone остаётся единственным SoT

### 2. `src/pages/AI.tsx` — основные изменения

**Imports:** `FileDropZone`, `UploadedFile`, `Paperclip`

**State:**

```tsx
const [chatFiles, setChatFiles] = useState<UploadedFile[]>([]);
const [showUploader, setShowUploader] = useState(false);
const [isDragOverChat, setIsDragOverChat] = useState(false);
```

**handleSendMessage (строка 289):**

- Условие: `if (!inputValue.trim() && chatFiles.length === 0) return`
- Если `chatFiles.length > 0` → использовать **тот же extraction pipeline**, что в `handleScenarioSubmit` (строки 316-343): `getFileType` → `fileToBase64` → `extractAllFilesContent` → передать `fileContents`, `fileNames`, `images` в `aiChat.sendMessage`
- Не копировать логику, а вынести общую helper-функцию `prepareFilesForSend(files: UploadedFile[])` прямо в AI.tsx (или вызывать те же утилиты напрямую)
- После отправки: `setChatFiles([])`, `setShowUploader(false)`, `setIsDragOverChat(false)`
- `userSentMessageRef.current = true` — уже на месте, работает и для file-only

**Кнопка отправки (строка 505):**

- `disabled={!(inputValue.trim() || chatFiles.length > 0) || aiChat.isLoading}`

**Input area (строки 486-515):**

- Перед `<div className="flex gap-2">` — если `showUploader || chatFiles.length > 0`, рендерить `<FileDropZone compact maxSizeMB={20} maxFiles={5} files={chatFiles} onFilesChange={setChatFiles} />`
- В `<div className="flex gap-2">` добавить кнопку-скрепку перед `ChatScenarioLauncher`:
  ```
  Paperclip icon, variant="ghost", size="icon"
  Active state: text-primary bg-primary/10 когда showUploader === true
  onClick: toggle showUploader
  ```

**Drag & drop на GlassCard чата:**

- `onDragOver`: guard `e.dataTransfer.types.includes('Files')`, `setIsDragOverChat(true)`
- `onDragLeave`: `setIsDragOverChat(false)`
- `onDrop`: собрать `Array.from(e.dataTransfer.files)`, добавить в `chatFiles` через тот же `processFile` из FileDropZone (передаём через `setChatFiles` + `onFilesChange`). Альтернативно — просто показать uploader и передать файлы в него.
- Визуальный hover: лёгкий `ring-2 ring-primary/30` на GlassCard при `isDragOverChat`, убрать при leave/drop. Не overlay, не блокирует клики.

**Paste:** FileDropZone в compact-режиме внутри GlassCard уже обрабатывает paste. Дополнительной логики не нужно.

## Extraction pipeline — единый путь

Не копировать код из `handleScenarioSubmit`. Вынести общую функцию:

```tsx
async function prepareFilesPayload(uploadedFiles: UploadedFile[]) {
  const fileEntries = await Promise.all(
    uploadedFiles.map(async (uf) => ({
      file: uf.file,
      type: uf.type,
      preview: uf.type === "image" ? (uf.preview || await fileToBase64(uf.file)) : undefined,
    }))
  );
  return extractAllFilesContent(fileEntries);
}
```

Использовать и в `handleSendMessage`, и в `handleScenarioSubmit`.

## Что не затрагивается

- Edge function, useAiChat, PromptRunFlow, база данных, автоскролл

## DoD

1. Скрепка с active-state рядом с полем ввода
2. Compact uploader открывается/скрывается
3. Drag & drop на GlassCard с guard на Files
4. Отправка только с файлами (без текста) работает
5. Длинные имена не ломают layout (truncate + min-w-0)
6. После отправки chatFiles очищается, uploader скрывается
7. Автоскролл работает после file-only отправки
8. Единый extraction pipeline для chat и scenario mode