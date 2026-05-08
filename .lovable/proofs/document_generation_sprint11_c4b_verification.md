# Sprint 11 — C4-B verification (перед C5)

Дата: 2026-05-08

## 1. Picker вставляет ТОЛЬКО strict-форматы
Источник: `src/components/ai-documents/extensions/FieldChipNode.ts`
функция `buildFieldPlaceholder()` собирает строго:
```
{{field:FLD-XXXXXX}}
{{field:FLD-XXXXXX|format=words}}
{{field:FLD-XXXXXX|format=words|case=genitive}}
{{field:FLD-XXXXXX|format=text}}
```
Других веток нет. `renderText()` chip-узла использует только её → копия
текста из визуального редактора всегда даёт strict ID-first плейсхолдер.

## 2. Chip отображается человекочитаемо
`renderHTML()` собирает три бейджа:
- `attrs.label` (название поля),
- `FLD-XXXXXX` (мелким моно-шрифтом),
- если `format` → «прописью»/«текстом» (sky-badge),
- если `caseModifier` → одна из И/Р/Д/В/Т/П (amber-badge).
`title` тултипа дублирует label · FLD · format · падеж.

## 3. Старые форматы блокируются
`canonical-template-apply-markup`: `STRICT_FIELD_RE` + явная проверка
`/^(document|executor|customer|deal|cf)\./i` → возвращает
`legacy_placeholder_format_detected`.
`canonical-document-generate-strict` (строки 174–203) повторяет ту же
проверку перед рендером — `legacy_placeholders_in_active_version` 400.
Тестовые кейсы, которые отбрасываются:
- `{{document.amount}}` → legacy
- `{{executor.name}}` → legacy
- `{{customer.name}}` → legacy
- `{{deal.amount}}` → legacy
- `{{cf.foo}}` → legacy
- `{{field:FLD-1|foo=bar}}` → unknown_modifier

## 4. token_manifest не содержит token_key как runtime-id
`canonical-template-apply-markup` пишет manifest со схемой:
`{ field_public_id, placeholder, format, case_modifier, label, data_type, required }`.
`token_key` сохраняется только как UI/search metadata в registry; в
runtime-резолвере (`generate-strict`) он не читается — обращение идёт
исключительно по `field_public_id`/`FLD-…`.

## 5. generate-strict не падает на расширенный плейсхолдер
Кастомный `parser` Docxtemplater трактует весь tag (`field:FLD-1|format=words|case=genitive`)
как ключ переменной → `resolved[raw_inside]` подставляется как одно значение.
Сейчас (до C5) подставляется базовое значение поля; warning-и пишутся
в `source_trace[fid].warnings` и `variants[].warnings`:
- `format_words_not_applied`
- `format_text_not_applied`
- `case_modifier_not_applied`
плюс контекстные: `format_words_on_text_field`, `case_on_non_text_field_without_words`.

## 6. source_trace по полю содержит
```
field_public_id, label, data_type, value, required, source,
manual_override, updated_at, updated_by,
variants: [{ placeholder, format, case, warnings }],
warnings: [...]
```

## 7. Каналы выключены
- email/Telegram доставки: не вызываются ни из одного из трёх
  edge-функций (`apply-markup`, `activate-version`, `generate-strict`).
- auto-generation: нет cron / триггеров на `ai_generated_documents`.
- batch: единый ручной вызов `mode=preview|generate`.

## DoD
- C4-B принят.
- Готовы к C5-A (прописью) — реальное применение `format=words`
  для number/money/date и `format=text` для boolean прямо в
  `canonical-document-generate-strict`.
