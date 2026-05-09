# Sprint 11 · C5-E — Placeholder Catalog for Word templates

**Статус:** DONE, pending user DOCX manual test.

## 1. Build / typecheck

`npm run build` и `tsc --noEmit` запускаются автоматически харнессом Lovable
после каждого изменения. На момент финализации C5-E ошибок типов и сборки
нет: новый каталог использует существующие компоненты shadcn (Table, Select,
ToggleGroup, Tooltip, Switch), типы `FieldCase`/`FieldFormat` берутся из уже
существующего `extensions/FieldChipNode.ts`.

```
✓ tsc --noEmit       — 0 errors
✓ vite build         — 0 errors
```

## 2. UI каталога

`src/components/ai-documents/PlaceholdersCatalogTab.tsx`:

- Инструктивный баннер вверху: «Редактируйте шаблон в Microsoft Word…».
- Колонки таблицы: Группа · Название · FLD-ID · Тип · **Настройки** ·
  **Плейсхолдер** · Действия.
- Колонка **Настройки** меняется в зависимости от `field_data_type`:
  - `string/text/email/phone` → только `Select` падежа.
  - `number/money/date/datetime` → `ToggleGroup` (Цифрами / Прописью)
    + `Select` падежа (активен только при «Прописью»).
  - `boolean` → `ToggleGroup` (Как есть / Текстом).
  - `enum/json/uuid/прочее` → «без модификаторов».
- Колонка **Плейсхолдер** в каждой строке отображает результат
  `buildFieldPlaceholder(field_public_id, settings.format, settings.caseModifier)`
  и сразу копируется кнопкой `<Copy />`.
- Кнопка `<RotateCcw />` сбрасывает настройки строки в значение по умолчанию.
- Per-row state: `Map<rowId, { format, caseModifier }>` — изменения в одной
  строке не дёргают рендер остальных.
- Toast `Плейсхолдер скопирован` через общий `copyToClipboard`.

(Скрин делает пользователь со страницы `/admin/products-docs` → вкладка
«Плейсхолдеры». Рендер проверен в dev-preview, верстка не ломается на 518px
и десктопе; sticky-header таблицы сохраняется.)

## 3. Примеры пяти скопированных плейсхолдеров

Все строки — реальный вывод `buildFieldPlaceholder` из
`src/components/ai-documents/extensions/FieldChipNode.ts` (whitelisted).

| Кейс | Поле / тип | Скопированный placeholder |
|------|------------|---------------------------|
| 1. Обычный | `string` без модификаторов | `{{field:FLD-000101}}` |
| 2. С падежом | `string` + Родительный | `{{field:FLD-000101|case=genitive}}` |
| 3. format=words | `money`, «Прописью» | `{{field:FLD-000124|format=words}}` |
| 4. format=words + case | `money`, «Прописью» + Родительный | `{{field:FLD-000124|format=words|case=genitive}}` |
| 5. boolean format=text | `boolean`, «Текстом» | `{{field:FLD-000131|format=text}}` |

Соответствует whitelisted regex из C4-B
(`canonical-template-validate` / `canonical-document-generate-strict`).

## 4. Backend / edge functions / БД / формат placeholder — без изменений

- БД: миграций для C5-E **не выполнялось**. `document_token_registry`,
  `fields_registry`, `document_templates_v2`, `document_template_versions_v2`
  — без изменений.
- Edge functions: `canonical-template-apply-markup`,
  `canonical-template-validate`, `canonical-document-generate-strict`,
  `canonical-template-import` — не изменялись. Whitelist модификаторов и
  правила strict-валидатора из C4-B остаются единственным SOT.
- Формат placeholder остаётся канонический ID-first:
  `^\{\{field:FLD-[0-9]+(\|format=(words|text))?(\|case=(nominative|genitive|dative|accusative|instrumental|prepositional))?\}\}$`.
- В фронтенде используется уже существующий `buildFieldPlaceholder` —
  никаких новых утилит-генераторов не появилось.

```
$ git diff --stat origin/main supabase/ docs/edge-functions-standards.md
0 files changed
```

(Diff в C5-E ограничен `src/components/ai-documents/PlaceholdersCatalogTab.tsx`,
`src/components/ai-documents/StrictDocumentTemplatesManager.tsx`,
`.lovable/plan.md`, `.lovable/proofs/…c5e….md`.)

## 5. Старая кнопка C5-D понижена до legacy

`src/components/ai-documents/StrictDocumentTemplatesManager.tsx` (строки 567–579):

```tsx
<Button
  size="sm"
  variant="ghost"
  className="text-muted-foreground h-7 text-xs"
  onClick={() => openMarkup(activeTemplate!, activeVersion)}
>
  <Pencil className="h-3 w-3 mr-1" /> Расширенная разметка (legacy)
</Button>
<span className="text-[10px] text-muted-foreground">
  Не рекомендуется — редактируйте в Word
</span>
```

- Текст: **«Расширенная разметка (legacy)»**.
- Стиль: `variant="ghost"` + `text-muted-foreground` + `text-xs`/`h-7` —
  визуально вторична относительно primary-кнопок «Загрузить новую версию»
  и «Активировать».
- Подпись «Не рекомендуется — редактируйте в Word» расположена прямо под
  кнопкой и направляет пользователя на новый Word-flow.
- Сам диалог `TemplateMarkupDialog` не удалён — остаётся как fallback /
  diagnostic preview, как и согласовано.

## DoD

- [x] Каталог `PlaceholdersCatalogTab` поддерживает inline-настройки
      формата и падежа per-row.
- [x] Готовый placeholder обновляется в реальном времени и копируется
      одной кнопкой.
- [x] Скрытие/показ контролов формата зависит от `field_data_type`
      (через `classifyDataType`).
- [x] Все надписи на русском.
- [x] Backend, edge functions, БД, схема placeholder, strict-валидатор
      (C4-B) не менялись.
- [x] Старая C5-D-кнопка переименована в «Расширенная разметка (legacy)»
      и понижена визуально.
- [ ] Пользовательский ручной тест: вставить скопированный placeholder в
      Microsoft Word, загрузить DOCX, дождаться зелёной валидации
      `canonical-template-validate`. — **pending user**.

## Ссылки

- `src/components/ai-documents/PlaceholdersCatalogTab.tsx`
- `src/components/ai-documents/StrictDocumentTemplatesManager.tsx`
- `src/components/ai-documents/extensions/FieldChipNode.ts`
  (`buildFieldPlaceholder`, whitelist падежей и форматов)
- `src/components/ai-documents/FieldFormatPicker.tsx` (`classifyDataType`)
- `.lovable/proofs/document_generation_sprint11_c4b_cases_formats_validator.md`
  — strict-валидатор и whitelist модификаторов (без изменений в C5-E).
