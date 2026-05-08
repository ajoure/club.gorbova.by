# Sprint 11 · C5-D — DOCX Markup (разметчик поверх исходного DOCX)

**Дата:** 2026-05-08
**Статус:** Backend GREEN. UI implemented, **pending user visual test on real DOCX**.

---

## 0. Архитектурный сдвиг

**Было (C4-A, отменено):** TipTap WYSIWYG-редактор `TemplateVisualEditor` пересобирал DOCX из HTML/JSON.
Результат — потеря таблиц, стилей, реквизитов, выравнивания. Для актов недопустимо.

**Стало (C5-D):**

| Слой | Роль |
|---|---|
| **DOCX в storage** | Source of truth. Никто не пересобирает. |
| **mammoth.convertToHtml** | Read-only Word-like preview (таблицы, жирный, списки, заголовки). |
| **`<w:t>` в XML** | Единственная точка записи: `applyReplacementsToXml` меняет ровно выделенный фрагмент. |
| **`document_template_versions.markup_draft`** | Persistence UI-состояния (debounced 1.5s). |
| **`canonical-template-apply-markup`** | Создаёт новую версию. `activate=false` по умолчанию. |
| **`canonical-document-generate-strict`** | Подставляет данные в готовые `{{field:FLD-…}}`. |

`TemplateVisualEditor` помечен `⚠️ NOT FOR DOCX TEMPLATES` и в DOCX-flow не используется.

---

## 1. UI: `TemplateMarkupDialog`

### 1.1 Two-column layout

- **LEFT** — Word-like preview (`.docx-preview`). Scoped CSS:
  ```css
  .docx-preview table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  .docx-preview td, .docx-preview th { border: 1px solid hsl(var(--border)); padding: 6px 8px; vertical-align: top; word-break: break-word; }
  .docx-preview th { background: hsl(var(--muted)); font-weight: 700; }
  .docx-preview p { margin: 0 0 6px; }
  .docx-preview h1..h6 { font-weight: 700; line-height: 1.25; }
  .docx-preview ul, .docx-preview ol { margin: 4px 0 8px 24px; }
  ```
  Никакой подсветки `<mark>` поверх — preview остаётся чистым (не ломает таблицы). Подсветку можно вынести отдельным PATCH.

- **RIGHT** — журнал replacements (manual + опционально auto), per-row: FLD picker, format/case, occurrence-picker, Accept/Skip/Remove.

### 1.2 Auto-suggest по умолчанию **OFF**

При открытии dialog правая панель **пустая** (если нет сохранённого draft).
Кнопки в header правой панели:

- **«Найти автоматически»** (`Sparkles` icon) — явный запуск `buildAutoSuggestions(plainText)`. Дедуп по `(original_text, field_public_id)` чтобы не дублировать manual-разметки.
- **«Очистить»** (`Trash2`) — confirm + сброс `replacements = []` (autosave подтянет пустой draft).

### 1.3 Manual replacement (главный сценарий)

1. Пользователь выделяет текст нативным `window.getSelection()`.
2. Жмёт **«Разметить выделенное»** под preview.
3. Создаётся `Replacement { source: 'manual', original_text, occurrence_index, occurrences_total }`.
4. Если `occurrences_total > 1` и `occurrence_index == null` → ambiguity-warning + occurrence-picker (1, 2, 3…).
5. Выбор FLD-поля + format/case → ставит status `manually_added` + строит `{{field:FLD-…|format=…|case=…}}`.

### 1.4 Persistence (`markup_draft`)

- JSONB column `document_template_versions.markup_draft` (миграция `20260508200725_…`).
- Autosave debounced 1.5s после любого изменения `replacements` (включая пустой массив).
- На открытии dialog: первый приоритет — restore draft. Auto-suggest **не запускается**, если draft есть.
- `markup_draft` очищается на successful `apply`.

### 1.5 Apply

- **«Применить (создать версию)»** → `apply(false)` → `activate=false`. Версия создаётся, не активируется.
- **«Применить и активировать»** → `apply(true)` → активируется, только если `validation.status === 'valid'`.
- Обе кнопки дисейблятся, если `acceptedCount === 0` или есть ambiguous-replacements без `occurrence_index`.

---

## 2. Backend: `canonical-template-apply-markup`

### 2.1 Контракт

```ts
POST /functions/v1/canonical-template-apply-markup
{
  template_version_id: uuid,
  replacements: Array<{
    original_text: string,
    field_public_id: 'FLD-XXXXXX',
    placeholder: '{{field:FLD-XXXXXX|format=…|case=…}}',
    format?: FieldFormat,
    case_modifier?: FieldCase,
    status: 'accepted'|'changed'|'manually_added',
    occurrence_index?: number  // 0-based; обязателен при N>1
  }>,
  activate?: boolean   // default false
}
```

### 2.2 Гарантии XML-замен

- Качается оригинальный DOCX из storage → распаковывается `jszip`.
- Замены применяются **только** в `<w:t>` нодах XML-частей: `word/document.xml`, headers/footers/footnotes/endnotes.
- **Ambiguity guard:** если `original_text` встречается N>1 раз в документе и `occurrence_index` не задан →
  warning `ambiguous_replacement_multiple_matches`, замена **пропускается**, возвращается в `ambiguous[]`.
- `replacement_not_found` если фрагмент не найден ни в одной части → `missed[]`.
- Strict-validator после замен: legacy `{{document.*}}` / `{{ld-*}}` в результирующем DOCX → `validation.status='invalid'` + `critical`-warning. Активация заблокирована.

### 2.3 Activate-guard

- `activate=false` (default) → новая версия записывается, `is_current` остаётся у старой.
- `activate=true` + `validation.status='valid'` → новая версия становится `is_current=true`.
- `activate=true` + `validation.status≠'valid'` → версия записывается, **не активируется**, в ответе `activated=false`.

### 2.4 markup_draft cleanup

После successful apply на новой версии `markup_draft` старой версии очищается.

---

## 3. Файлы

| Файл | Изменение |
|---|---|
| `src/components/ai-documents/TemplateMarkupDialog.tsx` | Auto-suggest OFF by default, кнопки «Найти автоматически» / «Очистить», autosave даже для пустых replacements, manual-flow primary. |
| `src/components/ai-documents/TemplateVisualEditor.tsx` | Header-комментарий `⚠️ NOT FOR DOCX TEMPLATES`. |
| `src/index.css` | Scoped `.docx-preview` Word-like CSS (table borders, padding, типографика). |
| `supabase/functions/canonical-template-apply-markup/index.ts` | `occurrence_index`, ambiguity guard, `activate` flag, markup_draft cleanup. |
| `supabase/migrations/…_markup_draft.sql` | Колонка `document_template_versions.markup_draft jsonb`. |

---

## 4. DoD

- [x] DOCX = source of truth, mammoth — только preview.
- [x] XML replacement только внутри `<w:t>`.
- [x] `markup_draft` autosave (1.5s debounce), restore при открытии.
- [x] `occurrence_index` для устранения неоднозначности.
- [x] Ambiguity guard: N>1 без index → warning, не заменяется.
- [x] Manual replacement через нативное выделение.
- [x] Apply без autoactivate; activate — отдельная кнопка с validation-guard.
- [x] TipTap (`TemplateVisualEditor`) исключён из DOCX-flow.
- [x] Auto-suggest по умолчанию OFF — правая панель пустая, явный запуск кнопкой.
- [x] Email/Telegram/auto-generation/batch flags OFF (не трогали).
- [x] Legacy `generated_documents` untouched.
- [ ] **Pending user visual test:** загрузить реальный «Шаблон. Счёт-акт на услуги.docx», убедиться что preview показывает таблицу как таблицу, ручная разметка работает, скачанный DOCX после apply открывается в Word с сохранённой структурой.

---

## 5. Финальная формулировка

> **Backend C5-C green. C5-D UI DOCX markup implemented, pending user visual test on real DOCX.**

---

## C5-D-UX rework (2026-05-08, итерация 2)

Старый макет «слева документ + справа таблица замен» **отменён**: пользователь работал не с документом, а со списком, видел английские статусы (`changed`, `auto`, `draft autosaved`), не мог увидеть результат замены прямо в тексте.

### Что переделано

1. **Полно-экранный визуальный редактор разметки** (`max-w-[1400px] h-[92vh]`, документ занимает всю основную область).
2. **Inline chips** прямо в документе. После выбора FLD-поля выделенный фрагмент сразу превращается в:
   ```
   [Срок оплаты (рабочих дней) · FLD-000195]
   ```
   Сырой `{{field:FLD-…}}` пользователь не видит — только при apply backend подставляет его в XML.
3. **Старые `{{ld-…}}`, `{{document.…}}`, `{{cf:…}}` подсвечены** жёлтым `<mark.docx-legacy>`. Клик по подсветке открывает picker и заменяет legacy на chip.
4. **Правая панель замен** (Sheet) скрыта по умолчанию. Открывается кнопкой «Показать замены» — служит журналом, а не основным интерфейсом.
5. **Авторазметка** — только по кнопке. Результаты в отдельном Sheet «Предложения авторазметки» с `Принять / Выбрать другое / Пропустить`. После принятия suggestion сразу появляется chip в тексте.
6. **Picker `FieldPickerPopover`** единый для всех точек входа (выделение, legacy-клик, chip-клик, кнопка в Sheet). Скролл починен:
   - `PopoverContent`: `width: 440, maxHeight: min(520px, calc(100vh - 160px))`, `display: flex; flex-direction: column`;
   - `CommandList`: `overflow-y-auto overscroll-contain flex-1`, `maxHeight: 420`;
   - категории — только русские (`CATEGORY_LABELS_RU`).
7. **Полная русификация UI**:

| Было | Стало |
|---|---|
| DOCX source of truth | DOCX — исходный шаблон |
| Strict ID-first | Используются только поля FLD |
| draft autosaved | Черновик сохранён |
| changed | Изменено |
| auto | Авто |
| manually_added | Вручную |
| accepted | Принято |
| suggested | Предложено |
| skipped | Пропущено |
| occurrence / вхождений: N | Вхождение N |
| Apply / Activate | Применить / Применить и активировать |
| ambig: N | Неоднозначных: N |

   FLD-идентификаторы (`FLD-000195`) и шаблонный плейсхолдер `{{field:FLD-…}}` остаются как есть — это технические идентификаторы.
8. **Сохранность состояния**: `markup_draft` хранит `visual_label` дополнительно к старым полям; chips мгновенно восстанавливаются при reopen без повторного резолва registry. Любое изменение (вставка, удаление, смена формата, принятие suggestion) → debounced 1.5s sync.
9. **Backend не менялся** — `canonical-template-apply-markup` принимает тот же payload (`original_text + occurrence_index + field_public_id + format + case_modifier`). XML-замены точечно идут в `<w:t>`, таблицы/стили DOCX сохраняются.

### Технические детали

- Рендер chips/legacy: `renderInteractiveHtml(previewHtml, replacements)` — DOMParser + TreeWalker, работает по text-нодам, не ломает теги таблиц.
- Selection tracking: `document.addEventListener("selectionchange", …)` обновляет состояние `hasSelection` → кнопка «Вставить поле» становится активной.
- Picker открывается через `Popover` с virtual trigger у `pickerAnchor` (координаты выделения / chip / legacy bounding rect).
- Удаление chip: клик на `.docx-chip-remove` (если виден) или через Sheet «Замены».

### DoD

- [x] Диалог открывается на ~92vh, документ занимает основную область.
- [x] Старые `{{ld-…}}` подсвечены и кликабельны.
- [x] Выделение текста + «Вставить поле» → picker → chip в тексте.
- [x] Chips показывают русское название поля + мелкий FLD-ID + опциональный формат/падеж.
- [x] Picker скроллится (`max-h-[520px]`, `CommandList overflow-y-auto`).
- [x] Все статусы и подписи на русском.
- [x] Правая панель замен скрыта по умолчанию.
- [x] Авторазметка только по кнопке, результаты в Sheet.
- [x] Закрытие/открытие диалога не теряет chips (autosave + visual_label в draft).
- [x] Apply вызывает существующую edge function без изменений контракта.
- [x] TipTap (`TemplateVisualEditor`) в DOCX-flow не импортируется.
- [ ] Ручная проверка пользователем: скачанный после apply DOCX сохраняет таблицу счёт-акта.

### Runtime hotfix (2026-05-08)

- **Problem:** активная backend-версия вернула `400 no_accepted_replacements`, хотя UI отправлял ручные замены.
- **Diagnose:** network-proof показал payload с `status:"manually_added"`; для совместимости с уже задеплоенной apply-функцией UI-only статус нельзя отправлять через backend boundary.
- **Execute:** `TemplateMarkupDialog.buildPayload()` нормализует `manually_added → accepted` перед вызовом `canonical-template-apply-markup`.
- **DoD:** ручные chips остаются в UI как «Вручную», но backend получает accepted replacement и не должен возвращать `no_accepted_replacements` из-за статуса.
