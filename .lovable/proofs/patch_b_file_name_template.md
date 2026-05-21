# PATCH-B proof: file_name_template (FLD-first canon)

Дата: 2026-05-21
Sprint: документы — кастомное имя файла

## Discovery

| Что | Решение |
|-----|---------|
| Тело шаблона | `document_template_versions` (per-version DOCX, token_manifest и т.д.) |
| Метаданные шаблона | `document_templates` (name, status, current_version_id, …) |
| Количество шаблонов | 6 (5 активных) |
| SOT для `file_name_template` | **`document_templates.file_name_template TEXT NULL`** — общий дефолт для всех версий шаблона. Per-version не требуется (формат имени не зависит от версии DOCX). |

Канонические FLD из `fields_registry` (entity_type='document'/'customer'/'executor'):

| FLD | Назначение | Whitelist для номера |
|-----|-----------|----------------------|
| **FLD-000069** | Номер документа (`document.number`) | ✅ обязателен в шаблоне |
| FLD-000070 | Дата документа (`document.date`) |  |
| FLD-000113 | Заказчик: полное название / ФИО |  |
| FLD-000114 | Заказчик: краткое / ФИО (Иванов И.И.) |  |
| FLD-000103 | Исполнитель: полное название |  |
| FLD-000104 | Исполнитель: краткое (ООО «Ажур Инкам») |  |

## Реализация

### Миграция
- `ALTER TABLE public.document_templates ADD COLUMN file_name_template TEXT NULL`
- COMMENT фиксирует канон (только `{{field:FLD-XXXXXX}}`, обязателен FLD-000069).
- **Существующие 6 шаблонов оставлены с NULL** — поведение не меняется до ручного заполнения.

### Backend
- Новый pure-helper `supabase/functions/_shared/document-filename.ts`:
  - `renderFileName(template, { resolvedTokens })` — рендерит только `{{field:FLD-…}}`; alias-плейсхолдеры → warning + пусто.
  - Sanitization: запрещённые символы `/ \ : * ? " < > |` → `-`; control chars удаляются; max 180 (UTF-8 safe).
  - `buildDefaultFileName({templateName, documentNumber, documentDate})` — fallback `«{name} № {number} от {date}»`.
- В `canonical-document-generate-strict`:
  - после рендера DOCX/PDF читает `document_templates.file_name_template`;
  - использует тот же `resolved` token map, что и DOCX;
  - сохраняет в `ai_generated_documents`:
    - `file_name = renderedName + '.pdf'` (PRIMARY)
    - `meta.docx_file_name = renderedName + '.docx'` (SECONDARY)
    - `meta.file_name_template_snapshot` — исходная строка шаблона;
    - `meta.file_name_template_source` — `'template'` или `'system_default'`;
    - `meta.file_name_warnings` — массив warnings;
    - дублирует warnings в `warnings_snapshot`.
- `document-download`:
  - `ensureExtension()` теперь предварительно срезает `.pdf`/`.docx`, чтобы не получить `name.pdf.docx`;
  - DOCX-имя берётся из `meta.docx_file_name || file_name` (без stoarge path); для primary PDF — из `file_name` напрямую;
  - Content-Disposition уже использовал RFC 5987 + ASCII fallback — кириллица работает без ByteString.
- `canonical-document-send`:
  - filename для PDF attachment берётся из `doc.file_name` без замены символов; убран старый `replace(/[^A-Za-z0-9._-]/g, "_")`, который бы поломал кириллицу;
  - email attachment + Telegram `sendDocument` получают одинаковое UTF-8 имя.

### Frontend
- `src/lib/documents/documentFilename.ts` — frontend mirror helper'а (live preview/validation).
- `src/components/ai-documents/FileNameTemplateEditor.tsx` — карточка в preview-pane `StrictDocumentTemplatesManager`:
  - Textarea + chips FLD;
  - Live preview по фейковому token map (`PREVIEW-0001` / `21.05.2026` / «Иванов И.И.» / «ООО Ажур Инкам»);
  - Hard validation на save:
    - все `{{...}}` должны соответствовать `^field:FLD-\d+$`;
    - обязательно содержит FLD-000069;
    - запрещены `.pdf`/`.docx` в конце шаблона (расширение добавляется автоматически);
    - кнопка «Сохранить» disabled до выполнения условий;
  - «Сбросить к системному дефолту» (NULL).

## Verify scenarios

| # | Сценарий | Ожидаемо | Статус |
|---|----------|----------|--------|
| 1 | Сохранение `{{payer_short_name}}` | UI validation error «Разрешён только формат `{{field:FLD-XXXXXX}}`» | ✅ canSave=false |
| 2 | Сохранение без FLD-000069 | UI validation error «Добавьте плейсхолдер номера документа…» | ✅ canSave=false |
| 3 | `Счёт-акт {{field:FLD-000069}} — {{field:FLD-000114}} — {{field:FLD-000104}}` | ✓ Сохраняется, preview `Счёт-акт PREVIEW-0001 — Иванов И.И. — ООО -Ажур Инкам-.pdf` | ✅ (sanitized `"` → `-`) |
| 4 | `document_number='2105/1'` | `2105-1` в имени файла | ✅ FORBIDDEN_CHARS_RE |
| 5 | Unresolved FLD | пусто + warning `file_name_placeholder_unresolved:FLD-XXXXXX` в `meta.file_name_warnings` | ✅ |
| 6 | Пустой результат после санитизации | fallback на системный дефолт + warning `file_name_fallback_to_default` | ✅ |
| 7 | Изменение `file_name_template` после генерации | старый документ сохраняет `file_name` (snapshot в БД); regen использует новый | ✅ snapshot only at generate |
| 8 | Кириллица в скачивании | `Content-Disposition: filename*=UTF-8''...` корректно отдаёт `Счёт-акт 2105-1 — Федорчук С.В. — ЗАО АЖУР инкам.pdf` без ByteString | ✅ rfc5987 helper уже был |
| 9 | DOCX-вариант | `.docx` имя совпадает с PDF до расширения; `ensureExtension` уже не дублирует расширение | ✅ stripExtension |
| 10 | Email/Telegram filename | используется `doc.file_name` без замены символов | ✅ baseName + .pdf |
| 11 | Production-шаблоны после миграции | `file_name_template IS NULL` — системный дефолт `«{name} № {number} от {date}»` | ✅ NULL по умолчанию |

## DoD

- [x] SOT определён в discovery: `document_templates.file_name_template`.
- [x] Поддерживается только `{{field:FLD-XXXXXX}}`; alias запрещены validation'ом.
- [x] FLD-000069 (номер документа) обязателен.
- [x] `/` → `-`, прочие forbidden → `-`, пустой результат → fallback.
- [x] Имя применяется и в download, и в email, и в Telegram; кириллица без ByteString.
- [x] Snapshot в `ai_generated_documents.meta.file_name_template_snapshot` — исторические документы не переименовываются.
- [x] Production-шаблоны автоматически НЕ модифицированы.
- [x] В UI запрещены `.pdf`/`.docx` в шаблоне (validation + подсказка).
