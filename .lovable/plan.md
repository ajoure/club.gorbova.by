# да, согласен, с учетом правок:

```text
Принять этот план как C5-D-UX rework и реализовать без изменения backend-контракта.

Главный приоритет:
не правая таблица replacements, а визуальная разметка прямо в DOCX-preview.

Обязательные правки к реализации:

1. Inline chips в документе
- После выбора FLD-поля выделенный текст должен сразу заменяться в preview на человекочитаемый chip.
- Chip должен показывать русское название поля + мелкий FLD-ID.
- Сырой `{{field:FLD-...}}` пользователь в документе видеть не должен.
- Сырой placeholder используется только при сохранении/применении в DOCX XML.

2. Старые placeholders кликабельны
- Все старые `{{ld-...}}`, `{{document...}}`, `{{executor...}}`, `{{customer...}}`, `{{deal...}}`, `{{cf...}}` в preview должны быть подсвечены.
- Клик по старому placeholder открывает picker.
- После выбора поля старый placeholder превращается в chip.

3. Правая панель замен скрыта
- Replacements panel не показывать по умолчанию.
- Добавить кнопку «Показать замены».
- Панель нужна только как служебный журнал, не как основной рабочий интерфейс.

4. Auto-suggest скрыт
- Авторазметка не должна запускаться при открытии окна.
- Только кнопка «Авторазметка».
- Результаты авторазметки показывать в Sheet/Drawer справа.
- После принятия предложения chip должен появиться прямо в документе.

5. Picker плейсхолдеров
- Вынести в отдельный `FieldPickerPopover`.
- Использовать один и тот же picker для:
  - выделенного текста;
  - клика по legacy placeholder;
  - редактирования существующего chip;
  - auto-suggest.
- Починить скролл окончательно:
  - `PopoverContent`: `max-h-[min(520px,calc(100vh-160px))] w-[420px] p-0 flex flex-col`;
  - `CommandList`: `flex-1 overflow-y-auto overscroll-contain max-h-[420px]`;
  - при необходимости использовать `ScrollArea`.

6. Полная русификация
- В TemplateMarkupDialog, FieldPickerPopover, ReplacementRow, toast и статусах не должно быть английских слов.
- Заменить:
  - `changed` → `Изменено`
  - `auto` → `Авто`
  - `manual/manually_added` → `Вручную`
  - `accepted` → `Принято`
  - `suggested` → `Предложено`
  - `skipped` → `Пропущено`
  - `draft autosaved` → `Черновик сохранён`
  - `DOCX source of truth` → `DOCX — исходный шаблон`
  - `Strict ID-first` → `Используются только поля FLD`
- Технические `FLD-...` и `{{field:...}}` не переводить.

7. Draft без потерь
- Все chips, выбранные поля, format/case, occurrence_index и visual_label сохранять в `markup_draft`.
- Переключение авторазметки, скрытие панели, закрытие/открытие окна не должно сбрасывать chips.

8. Apply
- Backend не менять.
- Использовать существующий контракт `canonical-template-apply-markup`.
- На apply отправлять `original_text + occurrence_index + field_public_id + format + case_modifier`.
- Backend продолжает менять только XML исходного DOCX, не пересобирает документ из HTML.

9. Proof
Обновить `.lovable/proofs/document_generation_sprint11_c5d_docx_markup.md`:
- показать, что DOCX-preview занимает основную область;
- правая панель скрыта;
- legacy placeholder кликается и заменяется на chip;
- picker скроллится;
- весь UI на русском;
- draft сохраняется;
- auto-suggest скрыт по умолчанию;
- apply создаёт DOCX с сохранённой таблицей;
- TipTap не используется в DOCX-flow.

DoD:
- Диалог открывается на ~92vh.
- Документ занимает основную область.
- Старые placeholders подсвечены и кликабельны.
- Выделение текста → picker → chip в тексте.
- Chip показывает русское название поля + FLD-ID.
- Picker нормально скроллится.
- Весь UI на русском.
- Правая панель скрыта по умолчанию.
- Auto-suggest только по кнопке.
- Закрытие/открытие не теряет chips.
- Apply использует существующую edge-функцию.
- Скачанный DOCX сохраняет таблицу и форматирование.
```

Backend не трогать. Сейчас проблема именно в UX-разметке DOCX.

&nbsp;

План: PATCH C5-D-UX — Визуальный редактор разметки DOCX

## Цель

Превратить окно «Разметка шаблона» из «две панели: документ + таблица замен» в **визуальный редактор разметки**, где пользователь работает прямо с документом: выделяет фрагмент → выбирает поле → в тексте появляется человекочитаемый chip. Backend (`canonical-template-apply-markup`, `markup_draft`, схема) НЕ трогаем — он уже принят как зелёный.

## Объём (только UI / фронтенд)

Все изменения локализованы в:

- `src/components/ai-documents/TemplateMarkupDialog.tsx` (главный рефактор)
- `src/components/ai-documents/FieldFormatPicker.tsx` (русификация + скролл)
- `src/index.css` (стили `.docx-preview` + chip-слой)
- `src/utils/templateAutoSuggest.ts` (без изменений логики; используется только из drawer)
- `.lovable/proofs/document_generation_sprint11_c5d_docx_markup.md` (обновление proof)

Backend, edge functions, миграции, типы — **не трогаются**.

---

## 1. Новая раскладка диалога (UX-1)

Dialog становится почти full-screen (`max-w-[1400px] h-[92vh]`).

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Разметка шаблона: Шаблон. Счёт-акт на услуги                    [×] │
│ DOCX — исходный шаблон. Выделите текст в документе и вставьте поле. │
├─────────────────────────────────────────────────────────────────────┤
│ [Вставить поле] [Авторазметка] [Показать замены ▸] │  Черновик ✓    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ДОКУМЕНТ (Word-like preview, на всю ширину)                       │
│   ─ таблицы, границы, жирный, абзацы                                │
│   ─ старые {{ld-...}} подсвечены жёлтым (кликабельны)               │
│   ─ принятые/вставленные поля = chip [Срок оплаты · FLD-000195]     │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ [Очистить черновик]              [Закрыть] [Применить] [+Активир.]  │
└─────────────────────────────────────────────────────────────────────┘
```

Правая панель замен — **скрыта по умолчанию**, открывается как Sheet/Drawer справа по кнопке «Показать замены».

## 2. Inline chips прямо в документе (UX-1, UX-4)

Технически: поверх HTML от `mammoth.convertToHtml` накладываем **chip-overlay** через DOM-замены в строке HTML (без TipTap).

Алгоритм рендера preview:

1. `mammoth.convertToHtml({ arrayBuffer })` → `previewHtml`.
2. Извлекаем `plainText` (для подсчёта occurrence_index).
3. Для каждого `replacement` в `markupState.replacements` со статусом `accepted | manually_added | changed`:
  - находим N-е вхождение `original_text` в `previewHtml` (с учётом тегов — поиск в текстовых нодах через `DOMParser`);
  - заменяем на:
    ```html
    <span class="docx-chip" data-replacement-id="..." 
          data-fld="FLD-000195" data-status="accepted">
      <span class="docx-chip-label">Срок оплаты (рабочих дней)</span>
      <span class="docx-chip-fld">FLD-000195</span>
      <button class="docx-chip-remove" aria-label="Удалить">×</button>
    </span>
    ```
4. Все ещё **необработанные** legacy-плейсхолдеры (`{{ld-…}}`, `{{document.…}}`) подсвечиваем как `<mark class="docx-legacy">` — кликабельны (открывают picker для замены).

Chip-стили в `index.css` под scope `.docx-preview`:

- inline-block, нежёлто-зелёный фон, border, мелкий FLD вторично.
- При `data-status="suggested"` — пунктирная рамка (предложение).
- Hover → показывает кнопку удаления.

Клик на chip → открывает popover «Изменить поле / Удалить».
Клик на legacy `<mark>` → открывает picker, после выбора — превращается в chip.

## 3. Flow вставки поля (UX-1)

**Вариант A — выделение текста:**

1. Пользователь выделяет фрагмент в `.docx-preview`.
2. Над выделением появляется небольшой floating toolbar: `[Вставить поле]`.
3. Клик → открывается Picker (popover у выделения).
4. После выбора поля и формата/падежа → создаётся replacement со статусом `manually_added`, в документе появляется chip на месте выделения.

**Вариант B — кнопка «Вставить поле» в шапке:**

- Открывает picker без привязки к выделению (для случая, когда нужно вставить поле в курсор / в конец абзаца). MVP: требовать предварительного выделения, иначе toast «Сначала выделите текст в документе».

**Вариант C — клик по legacy `<mark>`:**

- Picker открывается с предзаполненным `original_text` = текст плейсхолдера.

## 4. Picker полей — финальный фикс скролла (UX-3)

`FieldFormatPicker` (или новый компактный `FieldPickerPopover`):

- `PopoverContent`: `max-h-[min(520px,calc(100vh-160px))] w-[420px] p-0 flex flex-col`.
- `CommandInput` фиксированный сверху.
- `CommandList`: `flex-1 overflow-y-auto overscroll-contain max-h-[420px]`.
- Категории — только русские (из `CATEGORY_LABELS_RU`).
- Поиск работает по `label`, `public_id`, `description`.
- После выбора поля — второй шаг: формат (как есть / прописью / текстом) + падеж (И/Р/Д/В/Т/П, скрывается если не применимо) + кнопка «Вставить».

## 5. Auto-suggest как опциональный Drawer (UX-5)

Кнопка «Авторазметка»:

- Запускает `buildAutoSuggestions(plainText, refs)`.
- Открывает Sheet справа со списком предложений.
- Каждое предложение в Sheet: `[Принять] [Выбрать другое] [Пропустить]`.
- При «Принять» → suggestion превращается в `accepted` replacement → chip сразу появляется в документе → элемент исчезает из Sheet.
- Параллельно: в самом тексте можно подсвечивать предложения как `<mark class="docx-suggestion">` (опционально, MVP — только Sheet).

Sheet НЕ открыт по умолчанию.

## 6. Полная русификация (UX-2)

Заменить все английские строки в `TemplateMarkupDialog.tsx` и связанных компонентах:


| Сейчас                  | Должно быть                  |
| ----------------------- | ---------------------------- |
| DOCX source of truth    | DOCX — исходный шаблон       |
| Strict ID-first         | Используются только поля FLD |
| draft autosaved         | Черновик сохранён            |
| changed                 | Изменено                     |
| auto                    | Авто                         |
| manual / manually_added | Вручную                      |
| accepted                | Принято                      |
| suggested               | Предложено                   |
| skipped                 | Пропущено                    |
| occurrence / вхождений  | Вхождение N из M             |
| replacement             | Замена                       |
| preview                 | Предпросмотр                 |
| apply                   | Применить                    |
| activate                | Активировать                 |
| Всего: N · принято: M   | Полей: N · принято: M        |


Все toast-сообщения — на русском (`Поле вставлено`, `Черновик сохранён`, `Не удалось применить разметку` и т.д.).

Технические FLD-идентификаторы (`FLD-000195`, `{{field:FLD-…}}`) — остаются как есть, это идентификаторы.

## 7. Сохранение состояния (UX-4, без потерь)

`markupState.replacements` остаётся single source of truth. Каждая правка (вставка chip, удаление, изменение формата, принятие suggestion) → обновляет state → debounced 1.5s autosave в `markup_draft` (как сейчас).

`Replacement` дополняется полем `visual_label` (то, что пишется внутри chip) — вычисляется из `field.label + format + case`. Хранится в draft, чтобы при reopen chips показывались мгновенно без повторного резолва registry.

## 8. Apply (UX-7, без изменений backend)

Кнопка «Применить» / «Применить и активировать»:

- собирает `replacements` со статусом `accepted | manually_added | changed`;
- отправляет в существующую edge `canonical-template-apply-markup` ровно тем же контрактом (`activate: false | true`);
- backend сам строит `{{field:FLD-…}}` из `field_public_id + format + case_modifier` и точечно правит XML;
- успех → toast «Создана версия vN» / «Версия активирована», `onApplied()`, закрыть диалог.

Никаких изменений в edge function. Никаких изменений в схеме.

## 9. Гарантия сохранности DOCX (UX-8)

В коде явно: HTML-preview используется ТОЛЬКО для отображения и подсчёта occurrence_index. На apply отправляются `original_text + occurrence_index + field_public_id` — backend меняет только `<w:t>` в исходном XML, таблицы/стили не пересобираются. Это уже так в C5-D backend, фронт ничего лишнего не делает.

В `TemplateVisualEditor.tsx` остаётся deprecation-баннер «NOT FOR DOCX TEMPLATES».

## 10. Proof (UX-6)

Обновить `.lovable/proofs/document_generation_sprint11_c5d_docx_markup.md`, добавить раздел `## C5-D UX rework`:

- скриншот-описание: Word-like preview с таблицей счёт-акта;
- chips отображаются как `[Срок оплаты (рабочих дней) · FLD-000195]`;
- picker скроллится (max-h 520, CommandList overflow-y-auto);
- весь UI на русском (таблица замен терминов);
- legacy `{{ld-…}}` подсвечен и заменяется через клик;
- draft сохраняется при каждом действии;
- auto-suggest скрыт по умолчанию, открывается через Drawer;
- скачанный после apply DOCX сохраняет таблицу (ручная проверка пользователем);
- в XML записан `{{field:FLD-…}}` (видно из логов edge функции);
- TipTap не используется в DOCX-flow (`TemplateVisualEditor` не импортируется).

---

## Технические заметки

- **Без новых зависимостей.** Используем существующие `mammoth`, shadcn `Popover`, `Sheet`, `Command`, `ScrollArea`.
- **DOM-замены** в `previewHtml` делаем через `DOMParser` + `TreeWalker` по текстовым нодам (надёжнее regex по HTML, не ломает теги таблиц).
- **Floating toolbar** над выделением: `window.getSelection()` + `getBoundingClientRect()` относительно контейнера preview, position absolute. MVP — без позиционирования: при наличии выделения показываем кнопку «Вставить поле» в шапке как «активную», клик → popover у `selection.focusNode`.
- **occurrence_index** считаем по `plainText` (textContent контейнера), сохраняя совместимость с backend ambiguity-guard.
- **Picker** — выносим в отдельный компонент `FieldPickerPopover` для переиспользования (шапка + клик по chip + клик по legacy).

## DoD

- Диалог открывается на ~92vh, документ занимает основную область.
- Правая панель замен скрыта; открывается через «Показать замены».
- Старые `{{ld-…}}` подсвечены, кликабельны, превращаются в chips.
- Выделение текста + «Вставить поле» → picker → chip в тексте.
- Chips показывают русское название поля + мелкий FLD.
- Picker скроллится при длинном списке полей.
- Все статусы и подписи на русском (английские термины только внутри FLD-ID и `{{field:…}}`).
- Переключение «Авторазметка» / закрытие-открытие не теряет chips.
- «Применить» вызывает существующую edge function без изменений контракта.
- Proof обновлён.

## Что НЕ делаем

- Не трогаем backend / edge functions / схему БД / типы.
- Не возвращаем TipTap в DOCX-flow.
- Не добавляем новые edge functions, миграции, секреты.
- Не меняем формат placeholders (`{{field:FLD-XXXXXX|format=…|case=…}}` остаётся каноном).