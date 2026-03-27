# да, согласен, с учетом правок:

&nbsp;

1. **RLS роль проверить по фактическому enum проекта**
  &nbsp;
  - Ранее в проекте уже подтверждалось, что используется superadmin, а не super_admin.
  - В плане для ai_prompt_attachments нужно использовать ту же фактическую роль, что и в остальных таблицах/политиках проекта, без расхождения.
  &nbsp;
2. **Для file_type лучше сразу ограничить допустимые значения**
  &nbsp;
  - Даже если без enum, минимум нужен check/контроль на значения:
    &nbsp;
    - word
    - excel
    - text
    &nbsp;
  - Иначе потом легко появятся мусорные типы.
  &nbsp;
3. **deleteAttachment с partial failure лучше не делать “молча”**
  &nbsp;
  - Логировать — да, но ещё возвращать понятный результат в UI:
    &nbsp;
    - файл удалён из Storage / не удалён,
    - запись удалена / не удалена.
    &nbsp;
  - Иначе админ не поймёт, остался ли мусор.
  &nbsp;
4. **В PromptFormDialog секцию вложений делать только в edit-mode — правильно**
  &nbsp;
  - Подсказка “сначала сохраните промпт” обязательна.
  - Это хороший UX и не требует временных черновых prompt_id.
  &nbsp;
5. **TXT-путь в extractor — правильный минимальный фикс**
  &nbsp;
  - Это соответствует правилу: сначала расширяем существующий extractor, а не создаём новый.
  &nbsp;
6. **В edge function выборка по статусам ready и truncated — правильная**
  &nbsp;
  - Это чище, чем исключать empty/failed.
  - Оставить именно так.
  &nbsp;
7. **Metadata по knowledge base — хорошая правка**
  &nbsp;
  - knowledge_files_used
  - knowledge_total_chars
  - knowledge_truncated
    Это полезно и для proof, и для диагностики.
  &nbsp;
8. **Порядок сортировки в knowledge base зафиксирован правильно**
  &nbsp;
  - sort_order, потом created_at.
  - Это делает инъекцию детерминированной.
  &nbsp;
9. **DoD хороший, но нужен ещё один proof**
  &nbsp;
  - Проверить TXT отдельно:
    &nbsp;
    - загрузили .txt,
    - текст извлёкся,
    - AI отвечает по его содержимому.
    &nbsp;
  - Раз TXT добавляется именно в этом патче, это нужно подтвердить отдельно.
  &nbsp;
10. **Главный принцип соблюдён**

&nbsp;

&nbsp;

&nbsp;

- Используется существующий extractTextFromFile(),
- существующая gorbova-ai-chat,
- новые сущности только там, где реально необходимо:
  &nbsp;
  - таблица,
  - bucket,
  - thin CRUD hook,
  - UI секция.
  &nbsp;

 

План: Файлы-вложения к промптам (база знаний) — Phase 1

## Scope

**Форматы:** DOCX, XLSX, XLS, CSV, RTF, TXT. PDF — Phase 2.

## Изменения

### 1. `src/utils/fileExtractor.ts` — поддержка TXT

Сейчас `extractTextFromFile()` возвращает `null` для TXT-файлов (тип `"text"` не обрабатывается). Добавить ветку:

```typescript
if (fileType === "text") {
  return extractAsPlainText(file, "text");
}
```

Также добавить `"text"` в `getFileType` для `.txt` / `text/plain`.

### 2. Миграция БД — таблица + Storage bucket

**Таблица `ai_prompt_attachments`:**


| Поле              | Тип                                                 |
| ----------------- | --------------------------------------------------- |
| id                | uuid PK                                             |
| prompt_id         | uuid FK → ai_user_prompts ON DELETE CASCADE         |
| file_name         | text NOT NULL                                       |
| file_path         | text NOT NULL                                       |
| file_type         | text NOT NULL (word/excel/text)                     |
| file_size         | bigint NOT NULL                                     |
| extracted_text    | text                                                |
| extracted_chars   | int default 0                                       |
| extraction_status | text default 'ready' (ready/empty/failed/truncated) |
| sort_order        | int default 0                                       |
| created_at        | timestamptz default now()                           |


RLS: SELECT/INSERT/UPDATE/DELETE — только `has_role_v2(auth.uid(), 'admin') OR has_role_v2(auth.uid(), 'super_admin')`.

**Storage bucket `prompt-attachments**` — приватный. RLS аналогично.

### 3. `src/hooks/usePromptAttachments.ts` — thin CRUD хук

- `fetchAttachments(promptId)` — SELECT по prompt_id
- `uploadAttachment(promptId, file)`:
  1. `extractTextFromFile(file)` — существующий extractor
  2. Upload в Storage: `prompt-attachments/{promptId}/{uuid}_{filename}`
  3. INSERT в ai_prompt_attachments; текст > 100k → обрезка + status `truncated`; пустой текст → `empty`
- `deleteAttachment(id, filePath)`:
  1. Удалить файл из Storage
  2. Удалить запись из БД
  3. Partial failure — логировать, не бросать
- Никакой extraction-логики внутри хука

### 4. `src/components/ai-chat/PromptFormDialog.tsx` — секция «База знаний»

После поля «Текст промпта» (строка ~174):

- Заголовок «База знаний (файлы)»
- **Если prompt === null (создание):** подсказка «Сначала сохраните промпт, затем можно добавить файлы базы знаний»
- **Если prompt !== null (редактирование):**
  - Кнопка загрузки: accept `.docx,.xlsx,.xls,.csv,.rtf,.txt`
  - Список файлов: имя, тип, размер, extracted_chars
  - extraction_status: цветной индикатор + текстовый label (Готов / Пусто / Ошибка / Обрезан)
  - Кнопка удаления на каждом файле

### 5. `supabase/functions/gorbova-ai-chat/index.ts` — инжекция knowledge base

После загрузки `promptData` (строка 194), перед quality gate (строка 201):

```typescript
let knowledgeContext = '';
if (promptData) {
  const { data: attachments } = await serviceClient
    .from('ai_prompt_attachments')
    .select('extracted_text, file_name')
    .eq('prompt_id', promptData.id)
    .in('extraction_status', ['ready', 'truncated'])
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (attachments?.length) {
    const parts = [];
    let totalChars = 0;
    const KNOWLEDGE_LIMIT = 80000;

    for (const att of attachments) {
      if (!att.extracted_text) continue;
      if (totalChars + att.extracted_text.length > KNOWLEDGE_LIMIT) {
        metadata.knowledge_truncated = true;
        break;
      }
      parts.push(`--- Файл: ${att.file_name} ---\n${att.extracted_text}\n--- Конец файла ---`);
      totalChars += att.extracted_text.length;
    }

    metadata.knowledge_files_used = parts.length;
    metadata.knowledge_total_chars = totalChars;

    if (parts.length) {
      knowledgeContext = '\n\n--- БАЗА ЗНАНИЙ СЦЕНАРИЯ ---\n' + parts.join('\n\n') + '\n--- КОНЕЦ БАЗЫ ЗНАНИЙ ---';
    }
  }
}
```

**Порядок инжекции в system prompt (строка 256):**

1. `WEB_SYSTEM_PROMPT`
2. `knowledgeContext`
3. `--- ИНСТРУКЦИЯ СЦЕНАРИЯ ---` + `prompt_text`
4. `response_format`
5. `ANTI_HALLUCINATION_SUFFIX`
6. `PARTIAL_ANALYSIS_INSTRUCTION` (если applicable)

### 6. Что не меняется

- `useAiUserPrompts.ts`, `useAiChat.ts` — без изменений
- Telegram-бот, `ai_prompt_packages` — не затрагиваются
- Таблица `ai_user_prompts` — без изменений

## DoD

1. Админ загружает DOCX/XLSX/CSV/RTF/TXT в форме промпта — файл в Storage, текст извлечён
2. extraction_status и extracted_chars корректно отображаются (цвет + label)
3. При создании промпта (prompt === null) секция файлов показывает подсказку «сначала сохраните»
4. Edge function подгружает ai_prompt_attachments и инжектит в system prompt между базовым промптом и инструкцией сценария
5. AI отвечает по содержимому вложенного файла (proof: загрузили конкретный документ → задали вопрос по фрагменту → AI ответил по нему)
6. Удаление файла удаляет и запись из БД, и файл из Storage
7. Суммарный knowledge context ≤ 80k символов; metadata содержит knowledge_files_used и knowledge_total_chars
8. RLS: только admin/super_admin имеют доступ к ai_prompt_attachments