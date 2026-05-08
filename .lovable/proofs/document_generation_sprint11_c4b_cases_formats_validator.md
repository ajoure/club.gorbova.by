# Sprint 11 · C4-B — Падежи, format=words/text, strict validator

## Что сделано

### 1. UI: мини-мастер выбора формата и падежа
- Новый компонент `src/components/ai-documents/FieldFormatPicker.tsx`.
- Логика: выбор поля → формат (если применимо) → падеж (если применимо) → «Вставить».
  - **text/string/email/phone** → только падеж (опционально).
  - **number/money/date/datetime** → формат «цифрами / прописью»; падеж только при «прописью».
  - **boolean** → формат «как есть / текстом»; падеж не нужен.
  - прочие — без модификаторов.
- Интегрирован в:
  - `TemplateVisualEditor.tsx` (кнопка `[ ] Вставить поле`).
  - `TemplateMarkupDialog.tsx` (FieldPicker в таблице suggestions).

### 2. FieldChipNode (TipTap)
- Добавлен атрибут `format` (`words` | `text` | null).
- Chip отображает «Label · FLD-XXXXXX · [прописью|текстом] · [И/Р/Д/В/Т/П]».
- `renderText` возвращает строго ID-first плейсхолдер через
  `buildFieldPlaceholder(fld, format, case)`:
  - `{{field:FLD-000123}}`
  - `{{field:FLD-000123|case=genitive}}`
  - `{{field:FLD-000124|format=words}}`
  - `{{field:FLD-000124|format=words|case=genitive}}`
  - `{{field:FLD-000125|format=text}}`

### 3. Backend — `canonical-template-apply-markup`
- Принимает в replacements опциональные `format` / `case_modifier`.
- Сборка placeholder через `buildPlaceholder` с whitelist.
- Strict-валидатор итоговой версии:
  - **legacy_placeholder_format_detected** — для `document.*`, `executor.*`,
    `customer.*`, `deal.*`, `cf.*` и любых не-`field:FLD-…` плейсхолдеров.
  - **unknown_modifier** — модификатор не из {`format=words`, `format=text`,
    `case=<allowed>`} или недопустимое значение.
  - **unknown_field_public_id** — FLD не найден в `fields_registry`.
- Warnings (не блокируют валидацию):
  - `format_words_on_text_field`
  - `format_text_on_non_boolean_field`
  - `case_on_non_text_field_without_words`
- `token_manifest` теперь содержит `{ field_public_id, placeholder, format,
  case_modifier, label, data_type, required }`.

### 4. Backend — `canonical-document-generate-strict`
- Парсер `parseStrictTokenInside` распознаёт `format` + `case` с whitelist.
- Custom docxtemplater `parser`: трактует весь tag (включая `|format=…|case=…`)
  как ключ переменной, чтобы `|` не интерпретировался как filter.
- На C4-B реальное склонение и «прописью» НЕ выполняются — подставляется
  базовое значение, в `source_trace[FLD].variants[].warnings` пишутся:
  - `format_words_not_applied`
  - `format_text_not_applied`
  - `case_modifier_not_applied`
  - `format_words_on_text_field`
  - `format_text_on_non_boolean_field`
  - `case_on_non_text_field_without_words`
- На уровне документа возвращается:
  - 400 + `code: legacy_placeholder_format_detected` для legacy.
  - 400 + `code: unknown_modifier` для неизвестных модификаторов.

## Допустимые/запрещённые placeholder-форматы

### OK
```
{{field:FLD-000123}}
{{field:FLD-000123|case=nominative}}
{{field:FLD-000123|case=genitive}}
{{field:FLD-000123|case=dative}}
{{field:FLD-000123|case=accusative}}
{{field:FLD-000123|case=instrumental}}
{{field:FLD-000123|case=prepositional}}
{{field:FLD-000124|format=words}}
{{field:FLD-000124|format=words|case=genitive}}
{{field:FLD-000125|format=text}}
```

### CRITICAL: legacy_placeholder_format_detected
```
{{document.amount}}
{{executor.name}}
{{customer.name}}
{{deal.amount}}
{{cf.legal_details.name}}
```

### CRITICAL: unknown_modifier
```
{{field:FLD-000124|upper}}
{{field:FLD-000124|lower}}
{{field:FLD-000124|format=money}}
{{field:FLD-000124|word}}
```

### WARNING: case_on_non_text_field_without_words
```
{{field:FLD-000124|case=genitive}}   (если поле number/money/date/datetime)
```

### WARNING: format_words_on_text_field
```
{{field:FLD-000101|format=words}}    (если поле string/text/email/phone)
```

### WARNING: format_text_on_non_boolean_field
```
{{field:FLD-000124|format=text}}     (если поле НЕ boolean)
```

## token_manifest пример
```json
{
  "field_public_id": "FLD-000124",
  "placeholder": "{{field:FLD-000124|format=words|case=genitive}}",
  "format": "words",
  "case_modifier": "genitive",
  "label": "Сумма акта",
  "data_type": "money",
  "required": true
}
```

`token_key` НЕ используется как runtime placeholder — только как search-key
в picker.

## source_trace пример (на этапе stub C4-B)
```json
"FLD-000124": {
  "status": "resolved",
  "field_public_id": "FLD-000124",
  "label": "Сумма акта",
  "data_type": "money",
  "value": "250",
  "variants": [
    {
      "placeholder": "{{field:FLD-000124|format=words|case=genitive}}",
      "format": "words",
      "case": "genitive",
      "warnings": ["format_words_not_applied", "case_modifier_not_applied"]
    }
  ],
  "warnings": ["format_words_not_applied", "case_modifier_not_applied"]
}
```

## Подтверждение требований
- [x] Google Docs / Drive / OnlyOffice не используются (`rg -n "google\|onlyoffice"
      src/components/ai-documents` → 0 hits).
- [x] Email / Telegram / auto-generation OFF — никаких новых триггеров.
- [x] Старые `token_key` НЕ используются как runtime placeholder; только как
      search-key в picker (см. `searchKey = ${field_public_id} ${token_key} ${ui_label}`).
- [x] Реальное склонение / «прописью» вынесено в Sprint C5 — здесь только формат,
      whitelist и warnings.

## Что не вошло (Sprint C5)
- Реальное преобразование чисел/дат «прописью».
- Реальное склонение строк (Federchuk Sergey → Federchuka Sergeya).
- Реальная локализация boolean → «да/нет».
