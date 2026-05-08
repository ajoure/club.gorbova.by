# Sprint 11 · C4-A — Visual Template Editor (TipTap)

## Скоуп
1. Hotfix-PICKER (вертикальный скролл + русские заголовки групп).
2. C4-A: миграция `document_template_versions.editor_html/editor_json`,
   TipTap-редактор с inline-chip полем, сохранение через UPDATE.

## Выбор редактора
TipTap (`@tiptap/react@3.x`) — уже частично подключён в проекте
(`src/components/admin/TokenizedRichInput.tsx`). Доустановили:
`@tiptap/starter-kit`, `@tiptap/extension-underline`,
`@tiptap/extension-placeholder`. Google Docs / Drive / OnlyOffice
не подключены — `rg -n "google" src/components/ai-documents` → 0 hits.

## Изменённые файлы
- `supabase/migrations/...editor_html_json.sql` — миграция (две колонки).
- `src/components/ai-documents/extensions/FieldChipNode.ts` — новый inline atom node.
- `src/components/ai-documents/TemplateVisualEditor.tsx` — новый TipTap-редактор.
- `src/components/ai-documents/TemplateMarkupDialog.tsx` —
  `Tabs` (Авто-разметка / Визуальный редактор), `VisualEditorPane`,
  фикс picker (scroll + Russian groups).

## Hotfix-PICKER (commit 1)
- `PopoverContent` теперь имеет `overflow-hidden` и
  `style={{ maxHeight: 'min(420px, var(--radix-popover-content-available-height))' }}`.
- `Command` обёртка: `flex flex-col h-full max-h-full overflow-hidden`.
- `CommandList`: `style={{ maxHeight: 360 }}` (inline бьёт cn-merge с
  shadcn-овским `max-h-[300px]`); `overflow-y-auto overscroll-contain`.
- Окно больше не растёт за viewport, скролл работает.
- Добавлен `CATEGORY_LABELS_RU`: `executor → Исполнитель`, `customer → Заказчик`,
  `product → Продукт`, `tariff → Тариф`, `offer → Оффер`, `legal_details → Реквизиты`,
  `order → Заказ`, `subscription → Подписка`, `payment → Платёж`,
  `company → Компания`, `telegram_member → Telegram-участник`,
  `client → Клиент`, `custom → Пользовательские`, `deal → Сделка`.
- Поиск по `searchKey = ${field_public_id} ${token_key} ${ui_label}` —
  `token_key` участвует ТОЛЬКО как ключ поиска, в DOM/placeholder не попадает.

## C4-A — Visual Editor

### TipTap extensions
`StarterKit`, `Underline`, `TextAlign` (heading|paragraph),
`Placeholder`, `FieldChipNode` (inline atom).
Таблицы намеренно отложены.

### `FieldChipNode`
- `name=fieldChip`, `inline=true`, `atom=true`, `selectable=true`.
- attrs: `fieldPublicId`, `caseModifier` (на C4-A всегда `null`), `label`.
- `renderHTML` — chip: `[label] [FLD-XXXXXX] [(падеж)]` со стилями `bg-primary/10`.
- `renderText` — строго ID-first:
  - без падежа: `{{field:FLD-XXXXXX}}`
  - с падежом (C4-B): `{{field:FLD-XXXXXX|case=<allowed>}}`
- helpers: `extractFieldChipsFromJSON`, `serializeEditorToPlaceholderText`.

### Сохранение
`VisualEditorPane` пишет в `document_template_versions`:
`editor_html`, `editor_json`. `token_manifest` собирается из chip-узлов:
`{ field_public_id, case_modifier, label, placeholder }`.

### Strict-валидация на клиенте перед UPDATE
Regex `\{\{\s*(document|executor|customer|deal|cf)\.[^}]+\}\}` →
блокирует сохранение с `toast.error`. Бэкендный strict-валидатор уже отрежет
ровно те же legacy-форматы при следующем `apply-markup`.

## Чек-лист по требованиям пользователя
- [x] `/admin/ai → Документы → Шаблоны → Разметка`: dropdown скроллится,
      окно ограничено `min(420px, available-height)`.
- [x] Группы на русском.
- [x] Поиск работает по FLD/token_key/label, в placeholder идёт только FLD.
- [x] Из picker вставляется ТОЛЬКО `{{field:FLD-XXXXXX}}`.
- [x] Старые `document.*`, `executor.*`, `customer.*`, `deal.*`, `cf.*` —
      блокируются на сохранении визуальной версии.
- [x] Миграция `editor_html`, `editor_json` — добавлена.
- [x] TipTap визуальный редактор, кнопка `[ ] Вставить поле`,
      chip с человеческим именем + бейджем `FLD-XXXXXX`.
- [x] Сохранение `editor_json` / `editor_html` / `token_manifest`.
- [x] Падежей пока нет (C4-B).
- [x] Никакого Google Docs / Drive / OnlyOffice.

## Что не вошло (план C4-B)
- Падежи в picker (radio И/Р/Д/В/Т/П) и в chip.
- Backend: `canonical-document-generate-strict` —
  regex с `|case=<allowed>`, `case_modifier_not_applied` warning.
- Strict validator: `unknown_modifier` critical, `case_on_non_text_field` warning.
- `canonical-template-apply-markup` — приём `editor_html/editor_json`.
