# да, согласен, с учетом правок:

1. **Сначала обязательно сделать Hotfix-PICKER отдельным коммитом**
  - scroll внутри picker;
  - русские группы;
  - не трогать C4-логику в этом коммите;
  - proof: скрин/описание, что список скроллится и группы русские.
2. **TipTap использовать, если он уже есть в проекте**
  - если TipTap уже подключён — переиспользовать;
  - если не подключён — сначала добавить минимальный пакет только для редактора;
  - не использовать Google Docs / Drive / OnlyOffice.
3. **Важно по DOCX vs visual editor**
  - не писать, что DOCX остаётся единственным source-of-truth, если мы вводим визуальный редактор;
  - правильная модель:
    - `editor_json` = source для визуального редактирования;
    - `editor_html` = preview/staging;
    - DOCX-версия = экспортируемый/генерируемый файл для финальной генерации;
    - `token_manifest` и validation = обязательный контроль перед активацией.
  - То есть визуальный редактор не должен быть “декорацией”, он должен реально сохранять структуру шаблона.
4. **Field chip**
  - в редакторе пользователь видит человеческое название поля, например `Сумма акта`;
  - рядом маленький бейдж `FLD-000123`;
  - сырой `{{field:FLD-000123}}` пользователь не должен видеть в обычном режиме;
  - технический режим можно оставить через toggle.
5. **Падежи**
  - да, делать сразу в C4-B;
  - формат утвердить:
    - `{{field:FLD-000123}}`
    - `{{field:FLD-000123|case=genitive}}`
  - в UI показывать кратко:
    - И — кто? что?
    - Р — кого? чего?
    - Д — кому? чему?
    - В — кого? что?
    - Т — кем? чем?
    - П — о ком? о чём?
  - если склонение пока не реализовано, generation не блокировать, но писать warning `case_modifier_not_applied`.
6. **Strict validator**
  - оставить жёстко:
    - старые `{{document.*}}`, `{{executor.*}}`, `{{customer.*}}`, `{{deal.*}}`, `{{cf.*}}` = critical error;
  - новый формат с `case` разрешить;
  - неизвестные модификаторы типа `|upper`, `|format=` = critical `unknown_modifier`.
7. **Сохранение**
  - миграция только в `document_template_versions`:
    - `editor_html text`
    - `editor_json jsonb`
  - новых таблиц не создавать.
  - `token_manifest` собирать из chip-node, а не из старых token_key.
8. **Очередность правильная**
  - Коммит 1: Hotfix-PICKER.
  - Коммит 2: C4-A — editor scaffold + field-chip + вставка FLD-полей.
  - Коммит 3: C4-B — падежи + backend validator/generator + proof.
9. **В proof добавить обязательную проверку**
  &nbsp;
  ```bash
  rg -n "document\.|executor\.|customer\.|deal\.|cf\." src/components/ai-documents supabase/functions/canonical-document-generate-strict supabase/functions/canonical-template-apply-markup
  ```
  Результат должен быть пустой либо только в тексте ошибок/валидации, где эти форматы запрещаются.
10. **Не задерживаться на полноценном склонении**  
Сейчас главное — правильная архитектура placeholder с `case`. Реальное склонение ФИО/названий можно вынести в следующий PATCH после рабочего цикла генерации.
11. &nbsp;
12. План: Sprint 11 C4 — визуальный редактор шаблонов

## Контекст

TipTap уже подключён (`@tiptap/react`, `@tiptap/core`, StarterKit-набор частично). Используется в `src/components/admin/TokenizedRichInput.tsx` — переиспользуем этот опыт. Google Docs/Drive не подключаем.

Перед C4 — два срочных фикса в `FieldPicker` (TemplateMarkupDialog.tsx).

## Срочные фиксы (выкатываем первыми, отдельно от C4)

1. **Скролл в выпадающем списке.** Заменить `<CommandList className="max-h-[360px]">` на сочетание с `overflow-y-auto` явно (cmdk сам не всегда даёт scroll внутри `PopoverContent`). Также закрепить высоту `PopoverContent` и добавить `overscroll-contain`.
2. **Русские заголовки групп.** Сейчас `CommandGroup heading={cat}` рендерит `executor` / `customer` / `product` / `tariff` / `offer` / `legal_details` / `order` / `subscription` / `payment` / `company` / `telegram_member` / `custom`. Завести `CATEGORY_LABELS_RU` и переводить.

```text
executor       → Исполнитель
customer       → Заказчик
product        → Продукт
tariff         → Тариф
offer          → Оффер
legal_details  → Реквизиты
order          → Заказ
subscription   → Подписка
payment        → Платёж
company        → Компания
telegram_member→ Telegram-участник
client         → Клиент
custom         → Пользовательские
```

## C4-1 — TipTap editor scaffold

Новый компонент `src/components/ai-documents/TemplateVisualEditor.tsx`:

- Extensions: `StarterKit`, `Underline`, `TextAlign`, `Placeholder`, `Link` (если уже есть в проекте), таблицы — отложить до пилота (риск со стилями).
- Тулбар: B / I / U, выравнивание, заголовки H1–H3, списки ul/ol, undo/redo, кнопка «Вставить поле» `[ ]`.
- Кастомный inline node `field-chip` (atom, `inline: true`, `selectable: true`) с атрибутами `field_public_id`, `case_modifier`, `label`. Renders как `<span class="inline-flex ... bg-primary/10 ...">label <Badge>FLD-XXXXXX</Badge> <Badge>case=…</Badge></span>`.
- Сериализация: при сохранении узел рендерится как текст `{{field:FLD-XXXXXX}}` или `{{field:FLD-XXXXXX|case=genitive}}`.

## C4-2 — Интеграция в `StrictDocumentTemplatesManager`

Tabs внутри markup flow: `Preview DOCX` | `Visual editor` | `Suggestions / Fields`. Текст из mammoth → editor.setContent (paragraphs).

## C4-3 — Field picker внутри редактора

Кнопка тулбара открывает тот же `FieldPicker` (вынесем в отдельный файл `src/components/ai-documents/FieldPicker.tsx`, переиспользует `TemplateMarkupDialog`). При выборе — вставка узла `field-chip`.

## C4-4 — Падежи

Подменю в picker (RadioGroup): И / Р / Д / В / Т / П (`nominative`, `genitive`, `dative`, `accusative`, `instrumental`, `prepositional`). Дефолт — без падежа.

- Падеж только для `data_type ∈ {string,text}` (для number/date/money — disable + tooltip).
- В chip — пометка `(Р)`.

## C4-5 — Backend `canonical-document-generate-strict`

Регэксп заменить на `\{\{field:(FLD-\d{6})(?:\|case=(nominative|genitive|dative|accusative|instrumental|prepositional))?\}\}`.

- Если `case` указан и значение строковое — TODO-stub применения (пока identity), `source_trace.warnings.push("case_modifier_not_applied")`.
- Generation НЕ блокировать.

## C4-6 — Сохранение

В `document_template_versions` добавить (миграция) колонки:

- `editor_html text NULL` — TipTap HTML.
- `editor_json jsonb NULL` — TipTap JSON (приоритет при reload).
Никаких новых таблиц. `token_manifest` собирается из `field-chip` узлов (id+case).

## C4-7 — Strict validator (canonical-template-apply-markup + где валидируется upload)

- ALLOW: `{{field:FLD-\d{6}}}` и `{{field:FLD-\d{6}\|case=<allowed>}}`.
- BLOCK (critical): legacy формы (`{{document.*}}`, `{{executor.*}}`, `{{customer.*}}`, `{{deal.*}}`, `{{cf.*}}`).
- BLOCK: неизвестный modifier (`|format=`, `|upper`, …) → critical `unknown_modifier`.
- WARNING (не block на C4): `case` на нестроковом поле → `case_on_non_text_field`.

## C4-8 — Proof

`.lovable/proofs/document_generation_sprint11_c4_visual_editor.md`:

- выбор TipTap (уже в стеке, нет Google Docs);
- список изменённых файлов;
- grep `google` / `docs.google` / `drive` → 0;
- скрин редактора + chip + chip с падежом (описание UI, реальные скрины снимет пользователь);
- пример сохранённого `{{field:FLD-000123|case=genitive}}`;
- validator: valid для нового, critical для `{{document.amount}}`;
- `source_trace` пример с `case_modifier_not_applied`;
- email/Telegram/auto-generation flags = OFF.

## Технические детали

- TipTap node spec для `field-chip`:

```text
name: 'fieldChip', group: 'inline', inline: true, atom: true, selectable: true,
attrs: { fieldPublicId, caseModifier, label }
parseHTML: span[data-field-public-id]
renderHTML: span с data-* + chip-разметка
renderText: '{{field:'+id+(case?'|case='+case:'')+'}}'
```

- `editor.getText({ blockSeparator: '\n' })` будет возвращать строку с подставленными плейсхолдерами благодаря `renderText`. Эту строку прокидываем в существующий strict validator + используем для DOCX генерации (на C4 — DOCX из storage остаётся канонической версией; HTML — staging для редактора, как в `useCorporateTemplateEditor` уже принято).
- `canonical-template-apply-markup` дополним: принимает `editor_html`, `editor_json`, делает strict-валидацию текста, обновляет колонки версии.

## Очерёдность коммитов

1. **Hotfix-PICKER**: scroll + русские группы (отдельный коммит, без C4).
2. **C4-A**: миграция (editor_html/json) + TipTap-редактор + chip-node + интеграция в markup-диалог + reused FieldPicker.
3. **C4-B**: падежи (UI + сериализация) + backend + strict validator + proof.

## Что не делаем

- Google Docs/Drive/OnlyOffice;
- auto-generation, email, telegram отправку;
- batch;
- alias-layer / token_key как runtime placeholder;
- новые таблицы;
- редактирование DOCX-XML напрямую — DOCX остаётся source-of-truth для финальной генерации, editor_html — staging.