# да, согласен, с учетом правок:

&nbsp;

1. **Главное не забыто**
  Базовые пункты из исходного плана сохранены:
  &nbsp;
  - фикс Invalid key через safe storage filename;
  - сохранение оригинального имени в file_name;
  - перестройка PromptFormDialog на Card-секции;
  - PromptAttachmentsSection без изменений;
  - без правок edge function / БД / extractor / других диалогов.
  &nbsp;
2. **Нужно явно зафиксировать proof по загрузке**
  В DoD уже есть результат, но в плане лучше прямо потребовать:
  &nbsp;
  - proof успешной загрузки .rtf с длинным кириллическим именем;
  - proof file_path в Storage в ASCII-only виде;
  - proof строки в ai_prompt_attachments с оригинальным file_name.
  &nbsp;
3. **Нужно явно проверить не только upload, но и повторное открытие**
  У тебя это есть в DoD пунктом про reload диалога, это правильно.
  Стоит уточнить: после закрытия/открытия PromptFormDialog вложение должно подтягиваться из БД, а не держаться только в локальном state.
4. **Нужно явно сохранить текущую логику ext**
  В helper уже сохраняется расширение, это хорошо.
  Но стоит добавить правило:
  &nbsp;
  - если extension пустой или после очистки стал пустым, файл всё равно должен грузиться без ext, а не падать.
  &nbsp;
5. **По Card-дизайну план полный**
  Разделение на:
  &nbsp;
  - Основные параметры
  - Текст промпта
  - База знаний
  - Настройки запуска и отображения
  - Формат ответа
    выглядит правильно и лучше исходного общего блока.
  &nbsp;
6. **Нужно не забыть визуальную совместимость секции файлов**
  В плане стоит явно потребовать:
  &nbsp;
  - PromptAttachmentsSection не ломает ширину диалога;
  - длинные имена файлов внутри секции режутся через truncate, без overflow.
  &nbsp;
7. **Удаление лучше уточнить как 2-step proof**
  В DoD есть “Storage + БД”, это верно.
  Но лучше прямо потребовать:
  &nbsp;
  - после удаления запись исчезла из списка;
  - после refresh не возвращается;
  - файла больше нет в bucket.
  &nbsp;
8. **Scope выдержан правильно**
  Важно, что он не утащил в патч лишнее:
  &nbsp;
  - не трогает другие диалоги;
  - не трогает edge function;
  - не трогает таблицы/RLS без необходимости.
    Это соответствует начальному плану.
  &nbsp;

&nbsp;

&nbsp;

Итог:

из начального плана критично ничего не потеряно. План хороший. Я бы только добавил явные **proof-требования по upload / reload / delete** и guard для случая **пустого extension**.

&nbsp;

План: Фикс загрузки файлов + Card-дизайн PromptFormDialog

## 1. `src/hooks/usePromptAttachments.ts` — ASCII-only Storage path

**Root cause:** строка 86 — `const storagePath = \`{promptId}/{fileId}_{file.name}` — кириллица и спецсимволы в ключе Storage.

**Фикс:** вынести helper-функцию и использовать только ASCII в ключе:

```typescript
function buildSafeStorageFileName(fileName: string): string {
  const ext = fileName.includes(".")
    ? `.${fileName.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "")}`
    : "";
  return `${Date.now()}_${crypto.randomUUID()}${ext}`;
}
```

Строка 86 станет:

```typescript
const storagePath = `${promptId}/${buildSafeStorageFileName(file.name)}`;
```

Оригинальное имя файла сохраняется в `file_name` в БД (строка 106) — без изменений.

## 2. `src/components/ai-chat/PromptFormDialog.tsx` — Card-секции

Переструктурировать форму по паттерну EntityRecordSheet (Card → CardHeader → CardContent):

- **Card «Основные параметры»** — slug, тип, название, описание
- **Card «Текст промпта»** — textarea prompt_text
- **Card «База знаний (файлы)»** — PromptAttachmentsSection (уже есть)
- **Card «Настройки запуска и отображения»** — категория, иконка, подсказка для ввода, launcher title/description/order, sort_order, переключатели active/visible
- **Card «Формат ответа»** (отдельная под-секция) — response_format JSON textarea

Каждая секция: белый фон, `CardHeader` с иконкой и заголовком `text-sm text-muted-foreground`, `CardContent` с полями через `Separator`.

## 3. `src/components/ai-chat/PromptAttachmentsSection.tsx` — без изменений

Компонент уже корректный. Обёртка Card будет в PromptFormDialog.

## Что не меняется

- Таблица `ai_prompt_attachments`, RLS, Storage bucket — не трогаем
- Edge function — не трогаем
- `fileExtractor.ts` — не трогаем
- Другие диалоги проекта — отдельный будущий UI-pass

## DoD

1. Файл с кириллическим длинным именем `.rtf` загружается без toast-ошибки
2. В Storage путь ASCII-only (`{promptId}/{timestamp}_{uuid}.rtf`)
3. В БД `file_name` содержит оригинальное имя
4. После reload диалога вложение остаётся в списке
5. Удаление файла работает корректно (Storage + БД)
6. PromptFormDialog использует Card-секции как в EntityRecordSheet