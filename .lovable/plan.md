## да, согласен, с учетом правок:

1. **Добавить подсветку заменяемых мест прямо в документе**
  - Legacy `{{ld-…}}` / старые плейсхолдеры — жёлтая подсветка.
  - Уже выбранные replacement/chip — зелёный/голубой chip.
  - Ошибочные/неоднозначные replacement — красная/оранжевая подсветка.
  - Подсветка не должна ломать таблицы и переносы.
2. **Добавить валидацию прямо в документе**
  - Если replacement без FLD — показывать красную подсказку рядом/chip.
  - Если несколько одинаковых вхождений и не выбран occurrence — показывать предупреждение.
  - Если legacy placeholder не заменён — подсвечивать как «требует разметки».
  - Apply disabled должен иметь видимую причину на русском.
3. **Добавить diff перед Apply**
  - Перед применением показывать modal:
    - что будет заменено;
    - какой старый текст;
    - на какое FLD-поле;
    - format/case;
    - occurrence index, если есть.
  - Кнопки:
    - «Отмена»
    - «Создать версию»
    - «Создать и активировать»
  - Без подтверждения в modal apply не выполнять.
4. **Историю замен не делать отдельной большой функцией сейчас**
  - Пока достаточно:
    - текущий Sheet «Замены»;
    - `markup_draft`;
    - audit после apply.
  - Полную историю действий внутри редактора вынести в backlog, если понадобится.
5. **Кнопку “Скачать исходный DOCX” сделать обязательно**
  - Это критично, потому что правка текста/таблиц/форматирования выполняется в Word, а не в разметчике.
6. **Picker заменить на обычный controlled list без cmdk**
  - Если скролл снова ломается, полностью убрать `Command/CommandList`.
  - Использовать простой `input + filtered array + ScrollArea`.
  - Главный критерий: вертикальный скролл работает всегда.

Готовый текст для Lovable:

```text
Да, согласен с планом, с обязательными правками:

1. Добавить подсветку заменяемых мест прямо в документе:
- legacy-плейсхолдеры `{{ld-…}}`, `{{document.…}}`, `{{cf.…}}` — жёлтая подсветка;
- принятые replacement/chip — зелёный/голубой chip;
- replacement с ошибкой/неоднозначным occurrence — красная/оранжевая подсветка;
- подсветка не должна ломать таблицы, переносы и структуру DOCX-preview.

2. Добавить inline-валидацию прямо в документе:
- replacement без выбранного FLD → красная подсказка;
- несколько одинаковых вхождений без occurrence_index → предупреждение;
- незаменённый legacy placeholder → статус «требует разметки»;
- если Apply disabled — рядом должна быть конкретная причина на русском языке.

3. Добавить modal diff перед Apply:
Перед вызовом `canonical-template-apply-markup` показать подтверждение:
- старый текст;
- выбранное FLD-поле;
- человекочитаемое название поля;
- format/case;
- occurrence_index, если есть;
- количество замен.
Кнопки:
- «Отмена»;
- «Создать версию»;
- «Создать и активировать».
Без подтверждения в modal apply не выполнять.

4. Историю замен как отдельную большую функцию сейчас не делать.
Пока достаточно:
- текущего Sheet «Замены»;
- autosave в `markup_draft`;
- audit после apply.
Полную историю действий внутри редактора вынести в backlog.

5. Кнопку «Скачать исходный DOCX» сделать обязательно.
Это основной путь для изменения текста, таблиц, отступов и форматирования в Word.

6. Picker полей заменить на стабильный обычный список без `Command/CommandList`, если cmdk продолжает ломать скролл.
Использовать:
- controlled input;
- filtered array;
- ScrollArea / div с `overflow-y-auto`;
- фиксированный header;
- фиксированный search input;
- список с нормальным вертикальным скроллом.
Главный критерий: скролл работает всегда, header/search не перекрываются.

7. Все пользовательские строки — только на русском.
Английские слова допустимы только в технических идентификаторах `FLD-...` и `{{field:...}}`.

После реализации обязательно обновить proof:
- picker scroll fixed;
- inline validation работает;
- diff modal перед apply работает;
- chip delete работает;
- download original DOCX работает;
- apply создаёт новую версию;
- apply+activate активирует только valid-версию;
- все строки UI на русском.

План: C5-D PATCH — рабочий режим разметки DOCX
```

### Принципиальная позиция

TemplateMarkupDialog перестаёт притворяться Word-редактором. Это **режим разметки шаблона**: заменить старые legacy-плейсхолдеры на FLD-поля, посмотреть результат, создать новую версию. Полноценное редактирование текста/таблиц/форматирования делается в Word, после чего загружается новая версия DOCX. Backend (`canonical-template-apply-markup`) не трогаем.

---

### 1. Перепозиционирование UX (`TemplateMarkupDialog.tsx`)

- Переписать заголовок и `DialogDescription`:
  > «Режим разметки шаблона. Здесь вы заменяете старые плейсхолдеры на FLD-поля. Чтобы изменить текст, таблицы или форматирование — отредактируйте DOCX в Word и загрузите новую версию.»
- Убрать `contentEditable`/намёки на инструменты форматирования из preview (оставить read-only выделение текста + клик по chip/legacy).
- Добавить в шапке кнопку **«Скачать исходный DOCX»** (`supabase.storage…createSignedUrl` или `download` → blob → save). Подпись на русском.
- Лейблы в UI: «Замены», «Авторазметка», «Применить (создать версию)», «Применить и активировать», «Очистить черновик», «Закрыть» — проверить, что нигде не осталось `apply/activate/replacement/preview/draft autosaved/source of truth/manual/auto/changed`. Бейджи статусов используют `STATUS_LABEL_RU`, источник — `SOURCE_LABEL_RU`. Тосты — на русском (через `normalizeEdgeFunctionError` для ошибок edge).

### 2. Новый компонент `FieldPickerPopover`

Файл: `src/components/ai-documents/FieldPickerPopover.tsx`. Принимает `{ open, anchor, contextLabel, refsByCategory, onPick(fld, label, format, case) }`.

Структура:

```
PopoverContent  w-[460px] max-h-[min(560px,calc(100vh-120px))]
                p-0 flex flex-col overflow-hidden z-[100]
├── Header      shrink-0 px-3 py-2 border-b   ("Заменяем: …")
├── Input       shrink-0 px-3 py-2 border-b   (controlled value)
└── List wrap   flex-1 min-h-0 overflow-y-auto overscroll-contain
    └── ScrollArea / простой filtered list по категориям
```

- Не использовать `Command/CommandList` — фильтрация ручная (`useMemo` по query), категории/поля рендерятся как обычные кнопки → гарантированный скролл.
- Категории на русском через `CATEGORY_LABELS_RU`.
- TemplateMarkupDialog заменяет внутренний picker на `FieldPickerPopover` для всех 3 точек входа (selection / legacy / chip-edit).
- `pickerContext` отдаёт человекочитаемый `contextLabel` («Заменяем: `{{ld-…}}`» / «Заменяем выделенное: …» / «Изменить поле для chip»).

### 3. Логика chips и удаления

- Chip получает кнопку-крестик (svg внутри `.docx-chip`, `data-chip-action="remove"`). Делегированный `onClick` в preview:
  - клик по `[data-chip-action="remove"]` → удалить replacement из state, текст вернётся (renderInteractiveHtml перерисует исходный текст);
  - клик по самому chip → открыть picker в режиме `chip` (поменять FLD/формат);
  - клик по `mark.docx-legacy` → picker в режиме `legacy`.
- Tooltip на chip: «Клик — изменить поле, ✕ — отменить замену».

### 4. Длинные chips в таблицах ломают вёрстку

В `src/index.css` для `.docx-chip` добавить:

```
display: inline-flex; max-width: 100%;
flex-wrap: wrap; align-items: baseline;
white-space: normal; word-break: break-word; overflow-wrap: anywhere;
```

Для preview-таблиц:

```
.docx-preview table { table-layout: fixed; width: 100%; }
.docx-preview td, .docx-preview th { word-break: break-word; overflow-wrap: anywhere; vertical-align: top; }
```

Это решает ситуацию «Кнопка оплаты валюта FLD-…» вылезает за ячейку. Скрытый `data-fld` оставляем как `font-size: 0.7em` + `opacity: .6`, чтобы не доминировал.

### 5. Кнопки Apply

- `acceptedCount` уже фильтрует `field_public_id`. Добавить `ambiguousCount` (replacements с `occurrences_total > 1 && occurrence_index == null`) и `withoutFld` (accepted без FLD).
- Кнопка **«Применить (создать версию)»** активна, если `acceptedCount > 0 && ambiguousCount === 0 && withoutFld === 0`.
- Под кнопкой — строка с конкретной причиной, если `disabled`:
  - «Нет принятых замен с выбранным полем»
  - «Есть неоднозначные вхождения — укажите номер вхождения для N замен»
  - «Есть замены без FLD-поля: N»
- Перед `supabase.functions.invoke` логировать `console.debug("[markup-apply]", { template_version_id, total, accepted, ambiguous, payloadPreview })`.
- В `apply` нормализация `manually_added → accepted` уже стоит, оставляем.
- `applyAndActivate` (`activate: true`) — тот же payload, но при невалидной версии backend вернёт ошибки → показать через `normalizeEdgeFunctionError` и НЕ закрывать диалог. На успехе вызвать `onApplied()`.

### 6. После Apply

- Закрыть диалог (или оставить с обновлённым `templateVersion`), `onApplied()` дёргает родителя для рефетча списка версий.
- Тост: «Создана новая версия v{n}. {активирована/требует ручной активации}».

### 7. Backlog (отдельным файлом, не в этом sprint)

`.lovable/backlog/document_generation_full_docx_editor.md`:

- Цель: настоящий WYSIWYG DOCX-редактор внутри платформы.
- Кандидаты: OnlyOffice Docs, Collabora Online, ONLYOFFICE Document Server self-hosted.
- Архитектура: DOCX в Supabase Storage → editor iframe → callback save → новая версия.
- Интеграция FLD-полей как кастомного плагина редактора.
- Это отдельный sprint, не часть C5.

### 8. Proof обновление

`.lovable/proofs/document_generation_sprint11_c5d_docx_markup.md`:

- Раздел **«C5-D — это режим разметки DOCX, не Word-редактор»**: явная формулировка ограничений.
- Раздел **«Почему mammoth/HTML не подходит для редактирования DOCX»**: mammoth — однонаправленный конвертер DOCX→HTML, не сохраняет стили/нумерацию/секции/поля; обратной операции HTML→DOCX с сохранением исходной структуры нет; попытка эмулировать Word через `contentEditable` ломает таблицы и теряет форматирование при сохранении.
- Список proof-пунктов:
  - picker scroll работает (отдельный `FieldPickerPopover`, ручной список + ScrollArea);
  - apply активен при наличии accepted replacement c FLD;
  - apply создаёт новую версию (audit + edge);
  - apply+activate активирует только при validation valid;
  - chip × отменяет replacement;
  - кнопка «Скачать исходный DOCX» работает;
  - все строки UI на русском;
  - chips в таблицах переносятся, не ломают ячейки.
- Ссылка на backlog «Полноценный DOCX-редактор».
- Обновить `.lovable/plan.md`: C5-D = IN PROGRESS → DONE после QA.

---

### Файлы

**Новые**

- `src/components/ai-documents/FieldPickerPopover.tsx`
- `.lovable/backlog/document_generation_full_docx_editor.md`

**Изменяются**

- `src/components/ai-documents/TemplateMarkupDialog.tsx` — заголовок, скачать DOCX, использование FieldPickerPopover, chip × delete, причины disabled, debug log.
- `src/index.css` — `.docx-chip` flex-wrap/break-word, table-layout fixed для `.docx-preview`.
- `.lovable/proofs/document_generation_sprint11_c5d_docx_markup.md` — новые разделы и DoD.
- `.lovable/plan.md` — статус C5-D.

### DoD (проверка после реализации)

- `npm run build` зелёный.
- `/admin/ai → Документы → Шаблоны → Разметка` открывается без ошибок.
- Picker скроллится, header/input не перекрываются.
- Клик по `{{ld-…}}` → picker → chip; chip × отменяет замену.
- Длинный chip в ячейке таблицы переносится, не выходит за границы.
- Apply disabled → видна конкретная причина на русском.
- Apply создаёт новую версию; Apply+Activate активирует только valid.
- Кнопка «Скачать исходный DOCX» сохраняет файл.
- Все строки UI на русском, английских технических терминов нет (кроме `FLD-…` и `{{field:…}}`).
- Proof и backlog обновлены.