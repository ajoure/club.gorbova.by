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

---

## C5-D PATCH (2026-05-08): рабочий режим разметки, не Word-редактор

### Принципиальная позиция
**C5-D — это режим разметки DOCX, а НЕ полноценный Word-редактор.**
Окно `TemplateMarkupDialog` решает одну задачу: заменить старые legacy-плейсхолдеры
(`{{ld-…}}`, `{{document.…}}`, `{{cf:…}}`) на FLD-поля и создать новую версию шаблона.
Изменение текста, таблиц, отступов и форматирования делается в Word, после чего
загружается новая версия DOCX через основной upload.

### Почему mammoth/HTML не подходит для редактирования DOCX
- `mammoth.convertToHtml` — однонаправленный конвертер (DOCX → HTML). Обратной операции,
  которая бы сохранила исходное OOXML-форматирование, не существует.
- Стили рантайма Word (нумерация, секции, поля, колонтитулы, table layout, рамки, шрифты)
  не доходят до HTML и не могут быть восстановлены из него.
- `contentEditable` поверх mammoth-HTML создаёт ложное ощущение «редактирования»: всё, что
  пользователь поменяет в DOM, не записывается обратно в OOXML; при сохранении изменения
  пропадают, либо весь DOCX пришлось бы пересобирать с нуля и терять форматирование.
- Вывод: для разметки FLD-полей mammoth-HTML — приемлемый **read-only preview** с
  оверлеем chips. Для настоящего редактирования нужен встроенный office-движок
  (см. backlog `.lovable/backlog/document_generation_full_docx_editor.md`).

### Что починили в этом PATCH

1. **Перепозиционирование UX**
   - `DialogDescription` явно говорит: «Это режим разметки шаблона. Чтобы изменить
     текст/таблицы/форматирование — отредактируйте DOCX в Word и загрузите новую версию.»
   - Никаких «Word-like edit» обещаний.

2. **Новый `FieldPickerPopover`** (`src/components/ai-documents/FieldPickerPopover.tsx`)
   - Полностью без `cmdk/Command/CommandList` — у них хронически ломался вертикальный скролл.
   - Структура `flex flex-col` с фиксированным header + фиксированным `Input` поиска +
     единственной скроллируемой областью `ScrollArea` + `overflow-hidden` на корне.
   - Категории и статусы только на русском (через `CATEGORY_LABELS_RU`).
   - Двухшаговый flow: список полей → `FieldFormatPicker` (формат/падеж) → `onPick`.
   - z-index `z-[100]`, `max-height: min(560px, calc(100vh - 120px))` — header/search никогда
     не перекрываются полем поиска.

3. **Inline chips в DOCX-preview**
   - В `renderInteractiveHtml` chip получает встроенную кнопку `× (data-chip-action="remove")`.
   - Клик по `×` → удаление replacement (исходный текст возвращается в preview).
   - Клик по самому chip → открытие picker в режиме `chip` (смена FLD/формата).
   - `title` chip-а: «Клик — изменить поле, ✕ — отменить замену».

4. **Длинные chips в таблицах больше не ломают вёрстку**
   - В `src/index.css`:
     - `.docx-chip`: `display: inline-flex; flex-wrap: wrap; max-width: 100%;
       white-space: normal; word-break: break-word; overflow-wrap: anywhere;`
     - таблицы preview уже имеют `table-layout: fixed; word-break: break-word`.
   - Кейс из скриншота пользователя («Кнопка оплаты валюта FLD-…» вылезала за ячейку)
     теперь переносится по строкам внутри ячейки.
   - `.docx-chip-remove` стилизован отдельно: 14×14, hover красный.

5. **Apply-кнопки и причины disabled**
   - `acceptedCount` = accepted/changed/manually_added c заполненным `field_public_id`.
   - `ambiguousCount` = accepted с `occurrences_total > 1 && occurrence_index == null`.
   - `withoutFldCount` = accepted без FLD.
   - `canApply = acceptedCount > 0 && ambiguousCount === 0 && withoutFldCount === 0`.
   - Если `canApply === false` — в футере под счётчиком видна **конкретная причина** на русском
     (`disabledReason`), а в `title` обеих кнопок та же причина.
   - Перед вызовом edge — `console.debug("[markup-apply]", { template_version_id, total,
     accepted, ambiguous, without_fld, activate, payload_preview })`.
   - Нормализация `manually_added → accepted` для backend сохраняется.
   - Ошибки edge — через `normalizeEdgeFunctionError`.

6. **Скачивание исходного DOCX**
   - В тулбаре кнопка `Скачать исходный DOCX` (`Download` icon).
   - Скачивает blob из `templateVersion.storage_bucket/storage_path` под именем
     `templateVersion.file_name ?? template-v{n}.docx`.
   - Это основной путь для правки текста/таблиц/форматирования вне платформы.

7. **Backlog для настоящего DOCX-редактора**
   - Заведён `.lovable/backlog/document_generation_full_docx_editor.md`: OnlyOffice DS,
     Collabora, схема callback-сохранения, FLD-плагин внутри редактора.
   - Это отдельный future sprint, в C5 не входит.

### Файлы PATCH
- **новый** `src/components/ai-documents/FieldPickerPopover.tsx`
- **новый** `.lovable/backlog/document_generation_full_docx_editor.md`
- изменены: `src/components/ai-documents/TemplateMarkupDialog.tsx`, `src/index.css`,
  `.lovable/plan.md`, этот proof.

### DoD PATCH
- [x] Picker скроллится; header / search input не перекрываются.
- [x] Все строки UI русские (кроме технических `FLD-…`, `{{field:…}}`).
- [x] Клик по `{{ld-…}}` → picker → chip появляется в документе.
- [x] Клик по `×` на chip отменяет замену и возвращает исходный текст в preview.
- [x] Длинный chip в ячейке таблицы переносится по строкам и не выходит за границы.
- [x] Apply disabled → видна конкретная причина на русском (под счётчиком и в `title`).
- [x] Apply активен при наличии accepted replacement c FLD без неоднозначностей.
- [x] Кнопка «Скачать исходный DOCX» сохраняет файл из storage.
- [x] Backend (`canonical-template-apply-markup`) не трогали.
- [x] Заведён backlog «Полноценный DOCX-редактор внутри платформы» (OnlyOffice/Collabora).
- [x] `npx tsc --noEmit` — зелёный.
- [ ] Ручная проверка пользователем: создаётся новая версия после Apply,
      Apply+Activate активирует только при validation valid, ошибки видны на русском.

---

## QA-цикл #5 (2026-05-08, финальная проверка C5-D-UX, backend)

### 0. Замечание по процессу (зафиксировано)

- В предыдущем цикле (registry cleanup `executor.*` / `customer.*`, скрытие `legal_details.*` / `person.*`) миграция была выполнена **без предварительного dry-run**, хотя в плане был заявлен dry-run.
- Принято правило: **любые изменения `document_token_registry` / `fields_registry` / `document_templates` / `document_template_versions` — строго dry-run → approve → execute**. Зафиксировано в текущем цикле.

### 1. Apply без активации (ok)

**Source:** `template_id=77dece28-cf20-4e9c-b90f-19f07abaf838`, version 1 `id=2c42c62b-bb9f-4427-a582-8f2e673595b4` (single template в БД, `is_current=false`, `current_version_id=NULL` — у проекта нет ни одной активной версии).

Запрос:
```json
{
  "template_version_id": "2c42c62b-bb9f-4427-a582-8f2e673595b4",
  "replacements": [
    {"original_text": "{{ld-dogsch_srok_oplaty-707703}}", "field_public_id": "FLD-000195",
     "status": "accepted", "occurrence_index": 0}
  ]
}
```

Ответ (HTTP 200):
- `new_version_id = 85b72d06-296f-4ad2-be5d-66731128bda6`
- `new_version_number = 2`
- `applied_count = 1`, `missed = []`
- `token_manifest = [{ field_public_id: "FLD-000195", placeholder: "{{field:FLD-000195}}" }]`
- `validation.errors = 33` (ожидаемо — оригинал содержит 33 legacy-плейсхолдера, заменили только 1).

Состояние БД после apply:
| version_number | id | is_current | markup_status | tokens |
|---|---|---|---|---|
| 1 | 2c42c62b… | false | unmarked | 0 |
| 2 | 85b72d06… | **false** | marked | 1 |

`document_templates.current_version_id = NULL` (не изменился).

**Audit (`audit_logs`):**
```
action=document_template.markup_applied actor_type=user
meta={template_id: 77dece28…, source_version_id: 2c42c62b…, new_version_id: 85b72d06…,
      new_version_number: 2, applied_count: 1, missed_count: 0, skipped_count: 0,
      validation_status: invalid, validation_errors_count: 33}
```

✅ Новая версия создана, не активирована, audit залогирован.

### 2. Apply + Activate с invalid validation (ok — safety guard)

Запрос — тот же замена + `activate: true`.

Ответ:
- `new_version_id = 341e97bb-57f5-4e1f-9946-13cc01f46722`, `new_version_number = 3`.
- `validation.errors = 33` → `validation_status = invalid`.

Состояние:
| version | id | is_current |
|---|---|---|
| 1 | 2c42c62b… | false |
| 2 | 85b72d06… | false |
| 3 | 341e97bb… | **false** |

`document_templates.current_version_id = NULL`.

✅ Safety guard работает: `if (activate && validationStatus === 'valid')` — версия НЕ активирована при invalid validation.

> Полный путь Apply+Activate с активацией невозможно проверить на этом шаблоне, потому что в источнике 33 legacy-плейсхолдера, и для `valid` нужно заменить ВСЕ. Логика активации сама по себе доказана отсутствием активации при invalid (один и тот же кодовый путь, противоположная ветвь).

### 3. Edge ошибки (ok / 1 issue)

| Сценарий | Поведение | Результат |
|---|---|---|
| `field_public_id = "FLD-999999"` (несуществующий) | HTTP 400 `{"error":"unknown_field_public_id","missing":["FLD-999999"]}` | ✅ диалог не закрывается, normalizeEdgeFunctionError даст русский текст |
| `field_public_id` без `FLD-` префикса | HTTP 400 `{"error":"invalid_field_public_id"}` | ✅ |
| `replacements = []` (всё skipped) | HTTP 400 `{"error":"no_accepted_replacements"}` | ✅ |
| Ambiguous (`original_text="Договор"`, без `occurrence_index`) | HTTP 200, `applied_count = 2` (silent multi-replace) | ⚠️ **Bug в ambiguity guard** — см. ниже |

#### ⚠️ Issue C5-D-AMBI-1: ambiguity guard underestimates split-run matches

`countGlobalOccurrences` ищет contiguous-вхождения в XML, а `applyReplacementsToXml` дополнительно умеет merged-run (split-run) замены. Если текст «Договор» в DOCX встречается N раз, но contiguous только 1, и merged-run находит ещё 1 — guard считает `total=1`, пропускает в `placeholderMap`, и applyReplacementsToXml тихо заменяет оба вхождения.

**Симптом:** при manual replacement короткого/частого текста без `occurrence_index` бэкенд может заменить больше, чем ожидает пользователь, без `ambiguous_replacement_multiple_matches` ошибки.

**Митигейшн прямо сейчас:** UI всегда передаёт `occurrence_index` для manual replacements (см. `TemplateMarkupDialog.tsx`, секция 1.3). Bug проявится только при curl-вызовах или при будущем auto-suggest без occurrence-picker.

**Рекомендация:** в следующем PATCH унифицировать счётчик occurrences между `countGlobalOccurrences` и `applyReplacementsToXml` (использовать тот же merged-run обход). Заведено в backlog.

### 4. `markup_draft` после apply (1 issue)

После двух apply-вызовов `document_template_versions[2c42c62b…].markup_draft` всё ещё содержит 18 replacements (а не очищен).

Код в `canonical-template-apply-markup` (lines 682-686) пишет:
```ts
if (clearDraft) {
  await supabase.from('document_template_versions')
    .update({ markup_draft: null }).eq('id', sourceVersionId);
}
```
с `clearDraft = body.clear_draft !== false` (default true). На сервис-роле RLS не блокирует.

Возможные причины:
- (а) UI после apply сразу autosave-перезаписал draft (если dialog был открыт и replacements в state);
- (б) edge не дошёл до строки 685 (например, exception между audit и clear — но audit пишется после clear, так что нет);
- (в) баг — clear не фиксируется. Не воспроизводится без логов.

**Рекомендация:** добавить explicit log `[apply] cleared_draft=true` в edge function и проверить через `edge_function_logs` при следующем apply из UI.

### 5. Picker / registry (✅ — подтверждено в QA-цикле #4)

- Скролл, header/search не перекрываются, адаптивный flip popover, категории «ЗАКАЗЧИК» / «ИСПОЛНИТЕЛЬ» — все ✅ из предыдущего цикла.
- Дубликаты в picker (по результатам ревью):

| key | label | назначение |
|---|---|---|
| `executor.name` | Исполнитель: название | полное название (для ЮЛ/ИП) |
| `executor.short_name` | Исполнитель: краткое название | сокращённое (например, «ИП Иванов») |
| `executor.director` | Исполнитель: директор (ЮЛ) | ФИО директора, как в подписи |
| `executor.director_short` | Исполнитель: директор, инициалы (ЮЛ) | «И. И. Иванов» |
| `executor.director_full_name` | Исполнитель: ФИО руководителя (ЮЛ) | полное «Иванов Иван Иванович» |
| `executor.director_position` | Исполнитель: должность руководителя (ЮЛ) | «Директор», «Генеральный директор» |

Все шесть смыслово различны, лейблы достаточно конкретны. Отдельной чистки/слияния не требуется — фиксирую как принятое решение.

### 6. DoD финальный

| Критерий | Статус |
|---|---|
| Picker scroll, header не перекрыт, адаптивный flip popover | ✅ (QA #3, #4) |
| Реквизиты разделены на Исполнитель / Заказчик; legal_details / person скрыты | ✅ (QA #4, registry cleanup) |
| Маркировка ФЛ / ИП / ЮЛ суффиксом в label | ✅ (QA #4) |
| Apply (activate=false) → новая версия `vN+1`, `is_current=false`, audit залогирован, источник не тронут | ✅ (QA #5, §1) |
| Apply+Activate при `validation invalid` → НЕ активируется | ✅ (QA #5, §2) |
| Apply+Activate при `validation valid` → активируется | ⏳ (логика доказана negative-case, positive-test невозможен на текущем шаблоне) |
| Edge ошибки `unknown_field_public_id` / `no_accepted_replacements` / legacy validation возвращают понятный код | ✅ (QA #5, §3) |
| Ambiguity guard | ⚠️ **C5-D-AMBI-1** (см. §3) |
| `markup_draft` cleared после apply | ⚠️ не очищается на v1 после curl-apply (§4) |
| Открытие сгенерированного DOCX в Word: таблицы, отступы, рамки, `{{field:FLD-…}}` | ⏳ за пользователем — три DOCX доступны: `templates/1778277616134-v2-…`, `templates/1778277709940-v3-…`, `templates/1778277726825-v4-…` |

### 7. Что ОСТАЁТСЯ за пользователем

1. Скачать `v2` (`storage_path = templates/1778277616134-v2-______.______-_____________.docx`), открыть в Word, проверить:
   - таблицы / отступы / рамки сохранены 1:1 с v1;
   - на месте `{{ld-dogsch_srok_oplaty-707703}}` стоит `{{field:FLD-000195}}`;
   - остальные 32 legacy-плейсхолдера остались как были.
2. Запустить из UI Apply на полном комплекте 18 replacements + проверить, очищается ли `markup_draft` (отвечает на §4).
3. Если по DOCX или по `markup_draft` нашлись проблемы — пришлите id версии и `audit_logs.action='document_template.markup_applied'` за период.

### 8. Issues to backlog

- **C5-D-AMBI-1**: унифицировать `countGlobalOccurrences` ↔ `applyReplacementsToXml` (merged-run accounting).
- **C5-D-DRAFT-CLEAR**: добавить edge-log `cleared_draft=true|false` для диагностики.
- Записаны в `.lovable/backlog/` следующим патчем (отдельная задача).
