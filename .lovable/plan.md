# Да, согласен, с учетом правок:

1. **Не активировать новую версию автоматически после apply-markup.**  
Apply-markup должен:
  - создать новую DOCX-версию;
  - сохранить `token_manifest`;
  - выполнить strict validation;
  - если `validation_status='valid'` — показать кнопку **«Сделать текущей»** / **«Активировать версию»**.
  Автоактивация допустима только если пользователь явно нажал отдельную кнопку **«Применить и активировать»**. Иначе рискованно.
2. **Нужна защита от одинакового текста в документе.**  
Нельзя заменять просто все совпадения `original_text`, если одинаковая фраза встречается несколько раз.  
В `replacement` добавить:
  &nbsp;
  ```json
  {
    "original_text": "250 BYN",
    "occurrence_index": 2,
    "field_public_id": "FLD-000191",
    "placeholder": "{{field:FLD-000191|format=words}}"
  }
  ```
  Если `occurrence_index` не задан и найдено больше одного совпадения — вернуть warning:
  ```text
  ambiguous_replacement_multiple_matches
  ```
  и не применять замену автоматически.
3. **Использовать существующий ZIP-инструмент, не тащить новый без необходимости.**  
Если уже используется `PizZip` в `canonical-template-apply-markup`, оставить его.  
`jszip` подключать только если текущий `PizZip` реально не покрывает задачу. Не плодить зависимости.
4. **Preview через Mammoth — только для отображения, не для сохранения.**  
Зафиксировать жёстко:
5. **Manual replacement должен работать через выделение текста в preview.**  
Добавить UX:
  - пользователь выделяет текст в preview;
  - нажимает «Разметить выделенное»;
  - система создаёт manual replacement с `original_text`;
  - если найдено несколько совпадений — просит выбрать конкретное occurrence.
6. **Autosave draft обязателен.**  
Добавить миграцию:
  &nbsp;
  ```sql
  ALTER TABLE document_template_versions
  ADD COLUMN IF NOT EXISTS markup_draft jsonb;
  ```
  Draft хранит:
  - replacements;
  - statuses;
  - выбранные FLD;
  - format;
  - case_modifier;
  - occurrence_index;
  - last_saved_at.
7. **Переключение вкладок не должно размонтировать state.**  
`TemplateMarkupDialog` должен держать единый `markupState` на уровне dialog, а не внутри вкладок.  
Вкладки только отображают одно и то же состояние разными способами.
8. **TipTap убрать из DOCX-flow полностью.**  
Не просто «не использовать как canonical», а:
  - не показывать вкладку TipTap для DOCX;
  - не предлагать редактировать DOCX через TipTap;
  - оставить файл только как future/non-DOCX, с явным комментарием:
9. **Backend apply-markup должен сохранять исходный DOCX максимально неизменным.**  
Правило:
10. **Proof C5-C нужно переименовать по смыслу.**  
Текущий результат — это только:
  &nbsp;
  ```text
  C5-C backend smoke: GREEN
  ```
  А UI:
11. **В C5-D proof добавить обязательный реальный DOCX-чек.**  
DoD должен включать не только grep, но и визуальную проверку:
  - таблица осталась таблицей;
  - шрифты/жирный/подчёркивание не исчезли;
  - ширины колонок не разрушены;
  - итоговый DOCX открывается в Word/LibreOffice;
  - клиентский акт выглядит как исходный шаблон.
12. **Не писать “полный green”, пока пользователь сам не проверит UI.**  
После backend-проверок писать только:

```text
Backend green. UI validation pending user test.
```

Итоговое решение правильное: **не строим Word-редактор**, строим **DOCX-разметчик**, который работает поверх исходного файла и сохраняет его внешний вид.

&nbsp;

План: C5-D — DOCX Markup (разметчик поверх исходного DOCX)

## Контекст

Текущий `TemplateVisualEditor` (TipTap) для DOCX-актов — blocker. `mammoth.extractRawText` теряет таблицы/стили/шрифты, переключение вкладок сбрасывает выбор, разметка пересобирает документ из HTML вместо правки исходного XML.

Решение: DOCX = source of truth. UI = разметчик, не редактор.

---

## Архитектура

```text
┌──────────────────────────────────────────────────────────┐
│ TemplateMarkupDialog (state: markupState — общий)        │
│ ┌──────────────────────┬─────────────────────────────┐  │
│ │ Word-like Preview    │ Replacements panel           │  │
│ │ (mammoth HTML)       │  - auto suggestions          │  │
│ │ + подсветка          │  - manual add (find + FLD)   │  │
│ │   replacements       │  - format/case picker        │  │
│ └──────────────────────┴─────────────────────────────┘  │
│  [Сохранить draft]  [Применить разметку]                 │
└──────────────────────────────────────────────────────────┘
                         ↓
   apply-markup edge fn: правит word/document.xml + headers/footers,
   заменяет original_text → {{field:FLD-...|format=...|case=...}},
   сохраняет новый .docx в storage, обновляет token_manifest.
```

`editor_html` / `editor_json` / TipTap — больше **не** canonical source для DOCX-шаблонов. Оставляем код, но не используем в DOCX-flow (помечаем как deprecated для актов).

---

## Изменения

### 1. БД (migration)

```sql
ALTER TABLE document_template_versions
  ADD COLUMN IF NOT EXISTS markup_draft jsonb;
```

Структура `markup_draft`:

```json
{
  "version": 1,
  "updated_at": "...",
  "replacements": [
    {
      "id": "uuid",
      "source": "auto" | "manual",
      "original_text": "...",
      "field_public_id": "FLD-XXXXXX",
      "placeholder": "{{field:FLD-XXXXXX|format=words|case=genitive}}",
      "format": "as_is" | "words" | "text",
      "case_modifier": null | "genitive" | ...,
      "status": "suggested" | "accepted" | "changed" | "skipped" | "manually_added",
      "location": { "part": "word/document.xml", "paragraph_index": 12, "run_index": 3 }
    }
  ]
}
```

### 2. Frontend

`**TemplateMarkupDialog.tsx**` — переработать:

- единый `markupState` (replacements + html preview + raw text), хранится в Dialog-уровне;
- убрать вкладки «Визуальный редактор» / «Авто-разметка», заменить на 2-колоночный layout: Preview слева, Replacements справа;
- автозагрузка `markup_draft` при открытии; toast «Восстановить черновик?» если есть;
- autosave draft (debounced 1.5s) в `markup_draft` через update;
- кнопка «Применить разметку» вызывает `canonical-template-apply-markup`.

**Новые компоненты:**

- `DocxPreviewPane.tsx` — рендерит HTML через `mammoth.convertToHtml` + sanitize, оборачивает совпадения `original_text` в `<mark data-replacement-id="...">` с цветовой подсветкой по статусу.
- `ReplacementsPanel.tsx` — список replacements (auto+manual), per-row: FLD picker, format select, case select, status badge, кнопки Accept/Skip/Remove. Кнопка «Добавить вручную» → ввод find-text + picker.
- `useDocxMarkupState.ts` — state management + autosave + load/reset draft.

**Удалить из DOCX-flow:**

- `TemplateVisualEditor` больше не открывается из `TemplateMarkupDialog`. Файл оставляем (для будущих non-DOCX), помечаем JSDoc-ом «not for DOCX templates».

### 3. Backend — `canonical-template-apply-markup`

Принимает `replacements[]` с `original_text` + `placeholder`. Логика:

1. Скачать DOCX из storage по `storage_path`.
2. Распаковать ZIP (использовать `jszip` через esm.sh в Deno).
3. Для каждой XML-части (`word/document.xml`, `word/header*.xml`, `word/footer*.xml`, `word/footnotes.xml`, `word/endnotes.xml`) — выполнить безопасную замену `original_text` → `placeholder` в текстовых нодах `<w:t>`. Учитывать split runs: если фрагмент разбит между `<w:r>`, склеить смежные runs одного `<w:rPr>` перед заменой.
4. Если фрагмент не найден — вернуть warning `replacement_not_found` для этой записи, не падать.
5. Strict-validator: после замены — отказать, если в документе остались legacy `{{document.*|executor.*|customer.*|deal.*|cf.*}}`.
6. Запаковать обратно, загрузить новую версию в storage, инкрементировать `version_number`, сохранить `token_manifest`, активировать новую версию.

### 4. Proof

Обновить `.lovable/proofs/document_generation_sprint11_c5c_smoke_real_act.md`:

- переименовать секции: **C5-C backend smoke: GREEN**, **C5-D UI DOCX markup: PENDING/IN-PROGRESS**.

Создать `.lovable/proofs/document_generation_sprint11_c5d_docx_markup.md` с:

- архитектурным описанием;
- списком файлов;
- чек-листом DoD;
- инструкцией для UI-проверки (загрузить реальный акт, разметить, applied, generate).

---

## Технические детали

- `mammoth@1.x` уже в проекте (`useCorporateTemplateEditor`).
- В Deno edge fn — `jszip` через `https://esm.sh/jszip@3.10.1`.
- XML парсинг — простой regex по `<w:t[^>]*>([^<]+)</w:t>` достаточно для MVP замены; для split-runs делаем pre-merge соседних `<w:r>` с идентичным `<w:rPr>`.
- Подсветка в preview: после `convertToHtml` пробегаем DOM-парсером и оборачиваем text-nodes, содержащие `original_text`, в `<mark>` с data-id.
- Autosave: `useDebouncedCallback` 1500ms, не блокирует UI.

---

## DoD

- `markup_draft` колонка добавлена.
- Preview рендерит таблицы/стили/жирный/списки (mammoth HTML).
- Auto + manual replacements в едином state, переключение/добавление не теряет данные.
- Autosave draft работает; восстановление при повторном открытии.
- `apply-markup` правит исходный DOCX XML, не пересобирает из HTML.
- Generated DOCX сохраняет таблицы и форматирование, не содержит `{{...}}`.
- Legacy `{{document.*}}` блокируются.
- TipTap-редактор не используется как canonical для DOCX.
- Email/Telegram/auto-gen/batch — OFF.
- Два proof-файла: C5-C (backend GREEN) + C5-D (UI markup).

---

## Что НЕ делаем сейчас

- Полноценный WYSIWYG Word-редактор.
- Inline-edit DOCX-структуры (правка таблиц/стилей в браузере).
- Замены в нескольких run-spans с разным форматированием (только pre-merge с идентичным `<w:rPr>`; иначе → warning «split-run, разметить вручную в Word»).

После approve — приступаю к C5-D-1 → C5-D-9 в одном проходе.