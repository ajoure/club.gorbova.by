# Sprint 11 — Foundation Reset (clean slate для strict ID-first DOCX)

> Этапы 1–2 + полный wipe legacy. Это **первый коммит** Sprint 11. Этапы 3–14 (новые компоненты, edge-функции, picker, validate, generate, deal card, audit) — отдельными коммитами поверх этой основы.

## 1. Backfill `field_id` (157/157)

```sql
SELECT COUNT(*) total, COUNT(field_id) with_field_id
FROM document_token_registry WHERE archived_at IS NULL;
-- total=157, with_field_id=157
```

Детально — `.lovable/proofs/document_generation_sprint11_field_id_discovery.md`.

## 2. Полный wipe legacy документного слоя

| Таблица | До | После |
|---|---:|---:|
| `document_templates` | 21 | **0** |
| `document_template_versions` | 2 | **0** |
| `ai_generated_documents` | 20 | **0** |
| `generated_documents` (legacy) | 222 | **0** |
| `corporate_draft_sessions` | 16 | **0** |
| `document_package_template_items` | 0 | 0 |
| `document_package_templates` | 1 | **0** |
| `document_generation_sessions` | 0 | 0 |
| `document_generation_rules` | 0 | 0 |
| `document_token_aliases` | 6 | **0** |

**Сохранено** (база для новой системы):

| Таблица | Строк |
|---|---:|
| `fields_registry` | 209 (47 legal_details + 102 пред-Sprint 11 + 60 backfill) |
| `document_token_registry` | 157 (все с `field_id`) |
| `document_number_sequences` | без изменений |
| `orders_v2.meta.document_data` | без изменений |

Миграция выполнена в одну транзакцию с hard-verification (`RAISE EXCEPTION` если осталось хоть что-то).

## 3. Что осталось сделать (отдельные коммиты)

После этого reset нужно построить новую strict pipeline согласно плану. Основные блоки:

### 3.1. Cleanup runtime (FIELD-ID-CLEANUP-1 — глобально)

- `supabase/functions/_shared/document-render.ts` — оставить **единственную** ветку резолва `{{field:FLD-XXXXXX}}` через `fields_registry.public_id` → `orders_v2.meta.document_data.fields[FLD-...]` (fallback резолв тоже строго по `public_id`). Удалить все ветки `document.*`, `executor.*`, `customer.*`, `cf.*`.
- Удалить legacy edge-функции, привязанные к старой модели:
  - `ai-generate-document`
  - `ai-generate-document-package`
  - `ai-generate-corporate-package`
  - `generate-from-template`
  - `generate-invoice-act`
  - `generate-document-pdf`
  - `document-auto-generate`
  - `canonical-document-regenerate` — пересобрать поверх нового резолвера
  - `canonical-document-payment-hook` — пересобрать на snapshot-формат `fields[FLD-...]`
- `supabase/functions/_shared/customFieldTokens.ts` — удалить (новый резолвер не использует `cf.*`).
- `src/lib/token-resolver.ts` — переписать: единственный API-метод `resolveByPublicId(publicId, snapshot, ctx)`. Удалить ветки `cf.legal_details.*`, `cf.product.*`.
- `src/lib/tokens/tokenRegistry.ts` — клиентский справочник тянет только `document_token_registry` строки с `field_id`, отдаёт `{ public_id, label, category, data_type, placeholder: '{{field:'+public_id+'}}' }`.

### 3.2. Strict-каталог + picker (FIELD-ID-3 / DOCX-MARKUP-3)

- `src/components/ai-documents/PlaceholdersCatalogTab.tsx` — колонки: Группа · Название · `FLD-XXXXXX` · Placeholder · Тип · Источник · Обязательное · Пример · Копировать (`{{field:FLD-XXXXXX}}`).
- `src/components/admin/TokenizedRichInput.tsx` (или новый picker внутри `ai-documents`) — выбор поля показывает `ui_label` + `FLD-XXXXXX`, вставляет `{{field:FLD-XXXXXX}}`.
- Старые вкладки `AliasesTab`, `TokenMappingDialog`, `DocumentSnapshotDialog` — пометить deprecated/удалить (оценить риски, скорее всего удалить).

### 3.3. Загрузка + разметка DOCX (DOCX-MARKUP-1/2/4)

- `CanonicalTemplateVersionsPanel` (или новый `DocumentTemplateMarkupDialog`):
  1. upload `.docx` → bucket `documents` (private, service_role only) → новая `document_template_versions` (draft).
  2. `extractDocxPlaceholders` для текущих `{{...}}` + `mammoth` для read-only HTML preview.
  3. Auto-suggest по словарю синонимов на `ui_label`/`category`/`data_type` (только из строк `document_token_registry` с `field_id`). Статусы: `suggested|accepted|changed|skipped`.
  4. Кнопка «Применить разметку» → backend (новая edge-функция, например `canonical-template-apply-markup`) делает XML-замену в `.docx`, сохраняет marked DOCX как новую версию, заполняет `token_manifest` массивом `{ field_id, field_public_id, placeholder, ui_label, category, location, required }` (только `field_public_id`, без `token_key`).

### 3.4. Strict validation (FIELD-ID-CLEANUP-3)

- `supabase/functions/canonical-template-validate/index.ts`:
  - regex `^\{\{field:FLD-[0-9]+\}\}$` для каждого `{{...}}` в DOCX. Любое несоответствие → critical `legacy_placeholder_format_detected` («В шаблоне найден старый формат плейсхолдера. Используйте только `{{field:FLD-XXXXXX}}`.»).
  - проверка существования каждого `FLD-XXXXXX` в `fields_registry`.
  - проверка обязательных полей категории.
  - `is_current=true` ставится только при отсутствии critical.

### 3.5. Strict generation (DOCX-GENERATION-1)

- `supabase/functions/canonical-document-generate/index.ts`:
  - резолв строго `snapshot.fields[FLD-XXXXXX].value` → fallback по `fields_registry` (computed/system) → если required и пусто, блок генерации с явной ошибкой.
  - `source_trace` строго из `{ field_public_id, manual_override, computed_field, system_generated }`.
  - запись в `ai_generated_documents` (canonical).

### 3.6. Snapshot формат (Sprint 10 → переход на public_id)

- `supabase/functions/_shared/document-data-snapshot.ts` — переписать формат:

```json
{
  "fields": {
    "FLD-000123": {
      "value": 250,
      "source": "offer.document_defaults.amount",
      "label": "Сумма акта",
      "updated_at": "..."
    }
  }
}
```

(резолв `tariff_offers.document_defaults.*` → `field_public_id` через `fields_registry.key`).

### 3.7. Deal card (DEAL-DOCS-1/2/3)

- `src/components/admin/DealDocumentsCard.tsx`:
  - вкладка «Поля»: редактирование `orders_v2.meta.document_data.fields[FLD-...]`. На сохранение → server-side audit `document_data.field_updated` (через тонкую edge-функцию или direct UPDATE с триггером — выбрать).
  - вкладка «Preview»: таблица «Поле | `FLD-...` | Значение | Источник | Статус», кнопка генерации блокируется при required-empty.
  - вкладка «История»: только `ai_generated_documents`. Legacy `generated_documents` не показывается.

### 3.8. Audit (AUDIT-1)

В `audit_logs` (server-side) добавить actions:
- `document_template.uploaded`, `document_template.markup_suggested`, `document_template.markup_applied`, `document_template.version_saved`, `document_template.version_activated`,
- `document_data.field_updated`,
- `document.generate_preview`, `document.generated`, `document.regenerated`.

## 4. Подтверждения «do not touch»

- `documents_canonical_generation_enabled` — должен оставаться `false` до окончания Sprint 11. Включение только после ручного апрува в финальном тестовом сценарии.
- `documents_service_act_auto_generation_enabled` — `false`.
- Email/Telegram — не подключаются.
- `generated_documents` (legacy table) — после wipe пустая, новая pipeline её не пишет и не читает. Таблица оставлена как schema-only артефакт; в коде новой системы она не используется.

## 5. DoD-чеклист (для финального коммита Sprint 11)

- [x] Все 157 токенов в `document_token_registry` имеют `field_id`.
- [x] Все legacy-данные документного слоя вычищены (templates, versions, packages, sessions, generated × 2, corporate drafts).
- [ ] В новой документной pipeline нет runtime-использования `token_key`/`document.*`/`executor.*`/`customer.*`/`deal.*`/`cf.*`.
- [ ] В DOCX допустим только `{{field:FLD-XXXXXX}}`.
- [ ] Каталог копирует только `{{field:FLD-XXXXXX}}`.
- [ ] Validation блокирует все старые форматы как critical.
- [ ] Resolver не умеет резолвить старые форматы.
- [ ] `orders_v2.meta.document_data.fields` хранит значения по `public_id`.
- [ ] `document_template_versions.token_manifest` хранит только `field_public_id`.
- [ ] `source_trace` содержит только `field_public_id`/`manual_override`/`computed_field`/`system_generated`.
- [ ] DealDocumentsCard редактирует только snapshot, audit пишется на каждое изменение.
- [ ] Generation использует manual value из snapshot.
- [ ] История сделки читает `ai_generated_documents`. `generated_documents` не трогается.
- [ ] `documents_*_enabled` flags = false. Email/Telegram не подключены.
- [ ] Тестовый шаблон акта собран только из `{{field:FLD-...}}`.
- [ ] `rg`-проверка: новые компоненты/edge-функции не содержат запрещённых форматов.
