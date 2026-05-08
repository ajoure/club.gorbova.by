# Sprint 11 — C1: Strict ID-First Documents (catalog + upload + validator)

Дата: 2026-05-08. Коммит C1 из 3.

## 0. Safety-check после wipe

См. `.lovable/proofs/document_generation_sprint11_post_wipe_safety_check.md`.

| Слой | Counts |
|---|---|
| orders_v2 | 3 359 |
| payments_v2 | 5 704 |
| subscriptions_v2 | 1 135 |
| entitlements | 923 (active 795 / expired 126 / revoked 2) |
| access_grant_ledger | 88 700 |
| products_v2 / tariffs / tariff_offers | 27 / 42 / 38 |
| fields_registry | 209 (с public_id) |
| document_token_registry | 157 (157/157 имеют field_id) |
| document_templates / versions / ai_generated_documents / generated_documents | 0 / 0 / 0 / 0 |

Аудит за 4ч — только штатный фон (live_access_granted, telegram cron, bepaid sync). Нет всплеска revoke/expire. Edge functions `grant-access-for-order`, `bepaid-webhook`, `telegram-grant-access`, `telegram-revoke-access` не модифицированы.

## 1. Что сделано в C1

### 1.1. Legacy документный UI отключён из админки

`src/components/ai-chat/AiPageContent.tsx`:
- Удалены импорты `AiDocumentsGenerateView`, `AiDocumentsHistoryView`, `CanonicalActGenerator`, `CanonicalTemplateVersionsPanel`, `AliasesTab`.
- Удалён lazy импорт `AdminDocumentTemplates.DocumentTemplatesContent`.
- В `DOC_SUB_TABS` остались только: **Плейсхолдеры**, **Шаблоны документов**, **История** (placeholder), **Исполнители**.
- Убраны: `canonical-acts`, `aliases`, `generate` (legacy).
- `DEFAULT_SUB.documents` = `placeholders`.
- Вкладка `history` показывает заглушку: «История генераций (canonical) появится после реализации генерации из сделки в C3».

Файлы legacy остаются в репозитории как dead-code (см. план user-а: cleanup-коммит после C3).

Grep-проверка, что legacy компоненты не импортируются активной страницей AI:

```
$ rg -n "AliasesTab|CanonicalActGenerator|CanonicalTemplateVersionsPanel|AiDocumentsGenerateView|AiDocumentsHistoryView|LazyDocumentTemplatesContent" src/components/ai-chat/
# (нет результатов, кроме комментария «Sprint 11 C1: …»)
```

### 1.2. Каталог плейсхолдеров — strict ID-first

`src/components/ai-documents/PlaceholdersCatalogTab.tsx` переписан:

- Запрос: `document_token_registry` join `fields_registry` (FK `document_token_registry_field_id_fkey`).
- Скрываются строки без `field_id` или без `fields_registry.public_id` (счётчик «скрыто без field_id» в шапке).
- Колонка **Field ID** — `FLD-XXXXXX` как primary identifier.
- Колонка **Плейсхолдер** показывает только `{{field:FLD-XXXXXX}}`.
- Кнопка «Скопировать» копирует только `{{field:FLD-XXXXXX}}`. Старого формата `{{token_key}}` нигде нет.
- `token_key` доступен только в развёрнутых технических деталях, без кнопки копирования, с пометкой «legacy, только для поиска».
- Группы: Контакт / Заказчик / Подписант / Исполнитель / Сделка / Продукт / Тариф / Кнопка оплаты / Документ / Системные / Custom-поля.

Пример из `fields_registry` (1 строка):

```sql
SELECT public_id, label, data_type FROM fields_registry WHERE public_id IS NOT NULL LIMIT 1;
-- public_id="FLD-000001", label="…", data_type="…"
```

### 1.3. Strict шаблоны: upload + preview + validator + activation gate

`src/components/ai-documents/StrictDocumentTemplatesManager.tsx` (новый):

**Upload:**
- Только `.docx`, ≤10 MB. `.doc/.docm/.rtf/.zip` блокированы клиентом.
- Bucket: `documents` (private, RLS «Admins can manage all documents»).
- Создаёт `document_templates` (status=draft, is_active=false) + `document_template_versions` (version_number=1, is_current=false, validation_status=pending).
- `detected_tokens` снимается через `extractDocxPlaceholders` (mammoth).

**Preview:**
- Скачивает .docx из storage, mammoth raw text, регекс `\{\{([^}]+)\}\}`.
- Показывает file_name, размер, badges всех tokens (валидные = secondary, мусорные = destructive), первые 3000 символов текста.
- Если placeholder-ов нет — «Шаблон ещё не размечен. Выберите поля и примените разметку.» (разметка — в C2).

**Strict validator (`strictValidate`):**
- Regex плейсхолдера: `^field:FLD-\d+$`.
- Любой другой формат → `legacy_placeholder_format_detected` с UI-текстом:
  «В шаблоне найден старый формат плейсхолдера «{{…}}». Используйте только `{{field:FLD-XXXXXX}}`».
- FLD не из `fields_registry.public_id` → `unknown_field_public_id`.
- Нет ни одного плейсхолдера → `no_placeholders_in_template`.
- DOCX не читается → `docx_unreadable`.
- Результат сохраняется в `document_template_versions.validation_status` / `validation_errors` / `validation_checked_at` / `detected_tokens`.

**Activation gate:**
- Кнопка «Сделать текущей» disabled, если `validation_status !== "valid"`.
- При активации: снимается `is_current` со всех версий шаблона, выставляется на новой, `document_templates.current_version_id = ver.id`, `template_status = 'active'`.

### 1.4. DoD сверка

| Требование | Статус |
|---|---|
| `/admin/ai → Документы`: нет вкладок legacy-генерации | ✅ |
| Нет UI для aliases / token mapping / corporate / package | ✅ (все скрыты) |
| Каталог копирует только `{{field:FLD-XXXXXX}}` | ✅ |
| Strict validator блокирует все старые форматы | ✅ (regex + UI-текст) |
| `generated_documents` не читается и не пишется | ✅ (компонент не упоминает таблицу) |
| Email/Telegram/auto-generation не включаются | ✅ (никаких флагов не трогали) |
| `documents_canonical_generation_enabled=false` | ✅ (не менялся) |

### 1.5. Что НЕ делалось в C1 (по плану — C2/C3)

- Ручная разметка DOCX (auto-suggest + apply).
- `token_manifest` запись после ручной разметки.
- Genering акта из сделки + edit полей сделки + audit.
- Физическое удаление dead-code legacy файлов.
- Удаление legacy edge functions `ai-generate-document*`, `ai-generate-corporate-package`, `generate-from-template`, `generate-invoice-act`, `generate-document-pdf`, `document-auto-generate` — отложено в финальный cleanup-коммит после C3.

## 2. Файлы

- created: `src/components/ai-documents/StrictDocumentTemplatesManager.tsx`
- rewritten: `src/components/ai-documents/PlaceholdersCatalogTab.tsx` (FLD-only)
- edited: `src/components/ai-chat/AiPageContent.tsx` (sub-tabs, imports, default)
- created: `.lovable/proofs/document_generation_sprint11_post_wipe_safety_check.md`
- created: `.lovable/proofs/document_generation_sprint11_docx_markup_field_id.md` (этот файл, C1-часть)
