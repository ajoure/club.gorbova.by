# да, согласен, с учетом правок:

1. **Не создавать** `document_token_registry` **как полностью новую параллельную систему без mapping к** `fields_registry`**.**  
Правильно: `document_token_registry` = document-specific catalog над существующим `fields_registry`, где возможно.  
Нужно явно добавить:
  - если токен связан с existing custom field → хранить `field_id`;
  - если токен computed/system → `field_id = null`, но `resolver_key` обязателен;
  - запрет дублировать уже существующие `fields_registry`-поля.
2. `document_templates += current_version_id` **делать осторожно.**  
Нужно добавить STOP-guard:
  - если `document_templates` уже используется старым AI-flow, миграция не должна ломать старые строки;
  - `current_version_id` сначала nullable;
  - backfill только для новых шаблонов MVP;
  - NOT NULL — только отдельным follow-up после миграции старых шаблонов.
3. **Не помечать deprecated-функции слишком агрессивно.**  
Формулировку заменить:
  - не “410”;
  - а “deprecated for new document templates, legacy calls remain active”.
  Иначе можно сломать текущие счета/акты/автогенерацию.
4. `ai_generated_documents` **не должен становиться единственным canonical ledger без проверки.**  
В dry-run нужно проверить, нет ли уже таблицы/журнала генераций. Если есть — расширять existing. Если нет — тогда использовать `ai_generated_documents`.
5. `source_trace` **должен быть машинно проверяемым.**  
Добавить формат:
6. **Для** `orders_v2` **лучше не добавлять много колонок в MVP без discovery.**  
Предварительный предпочтительный вариант:
  - `contract_number`, `contract_date`, `act_number`, `act_date` — можно как structured поля, если это core-сценарий;
  - `service_period`, `service_description`, `services[]` — лучше через `field_values`/metadata/session, потому что структура услуг может меняться.
7. **Нужно добавить отдельный dry-run preview endpoint / mode без записи мусора.**  
`mode=preview` не должен создавать полноценные генерации. Максимум:
  - `document_generation_sessions`;
  - TTL/cleanup status;
  - без файла, если не нужен preview-file.
8. **Нужно добавить защиту от DOCX-токенов, которых нет в registry.**  
Правило:
  - unknown required tokens блокируют публикацию шаблона;
  - unknown optional tokens требуют ручного mapping/create;
  - автосоздание токена запрещено без duplicate-check и подтверждения админа.
9. **Нужно явно добавить поддержку loops не в Sprint 1, но не сломать будущую модель.**  
В registry сразу предусмотреть:
  - `is_array`;
  - `array_item_schema`;
  - `parent_scope`;
  - пример будущего `deal.services[]`.
10. `TokenizedRichInput` **может не подходить для DOCX напрямую.**  
Уточнить: в MVP он используется только для UI-подсказок/copy token/sidebar, а не как редактор самого DOCX.
11. **Audit должен писать не только successful generation, но и preview/block.**  
Добавить:

- `document.generation_previewed`;
- `document.generation_blocked_missing_required`;
- `document.template_token_mapping_updated`;
- `document.template_version_activated`.

12. **Storage path должен быть детерминированным.**  
Добавить формат:

```text
document-templates/{workspace_id}/{template_id}/v{version}/template.docx
generated-documents/{workspace_id}/{context_type}/{context_entity_id}/{generated_document_id}.docx
```

13. **Нужен антивирус/безопасность файла хотя бы на уровне ограничений MVP.**  
Добавить:

- принимать только `.docx`;
- MIME/type check;
- лимит размера;
- запрет macro-enabled форматов `.docm`;
- не принимать `.zip`, `.rtf`, `.doc`.

14. **Нужно добавить rollback/compatibility plan.**  
Если новый render core падает:

- старые AI-функции не трогаются;
- новые таблицы add-only;
- feature flag `documents_canonical_generation_enabled`;
- UI вкладка скрывается, если feature flag выключен.

15. **DoD по smoke старых вызовов усилить.**  
Нужно проверить:

- старый `ai-generate-document` без `context_type`;
- старый template upload;
- corporate package wizard;
- document-auto-generate;
- invoice/act legacy flow, если он production.

16. **Memory-пункт заменить на обычный архитектурный файл/заметку, если в Lovable нет mem://.**  
Формулировка:

- если есть memory-механизм — сохранить `mem://...`;
- если нет — создать `.lovable/architecture/documents_canonical_render_engine.md`.

17. **Добавить юридико-делопроизводственный формат DOCX.**  
В MVP не нужно валидировать весь СТБ, но нужно сохранить:

- поля страницы;
- нумерацию;
- шрифты;
- таблицы;
- подписи;
- разрывы страниц;
- колонтитулы.

18. **Добавить правило: AI не участвует в MVP render.**  
Функция называется `ai-generate-document`, но фактически MVP должен быть deterministic document generation. AI можно оставить только для будущего Sprint 5.
19. **Название shared core лучше сделать без AI.**  
Например:

```text
supabase/functions/_shared/document-render.ts
supabase/functions/_shared/document-context-resolver.ts
supabase/functions/_shared/document-token-resolver.ts
supabase/functions/_shared/docx-renderer.ts
```

20. **Добавить финальный machine-check.**  
В proof должны быть SQL-запросы:

- шаблон имеет active version;
- все detected tokens имеют registry mapping;
- generated document имеет snapshot;
- snapshot содержит `source_trace`;
- audit_logs содержит `document.generated`;
- old functions smoke OK.

В остальном план хороший: правильный MVP, правильный отказ от Google Docs/ONLYOFFICE в первом спринте, правильный акцент на registry-first, versioning, snapshot и единый render core.

&nbsp;

План: Генерация документов DOCX — MVP «Акт выполненных работ»

## Жёсткие правила исполнения

1. Все коммуникации, отчёты, DoD, SQL, имена, proof — на русском.
2. Add-only. Ничего не ломать без dependency audit.
3. Discovery → Plan → Dry-run → Execute → Verify. Пропуски запрещены.
4. Запрещено создавать новый параллельный генератор, если можно переиспользовать.
5. Все связи через UUID. Никаких email/name/slug для бизнес-логики.
6. Все критические действия — в `audit_logs`.
7. Каждая новая таблица: `id`, `public_id`, `workspace_id` (если применимо), `created_at`, `updated_at`, `created_by`, `updated_by`, `metadata`.
8. Перед созданием новой сущности — duplicate/discovery check (exact key + exact token + fuzzy label).
9. Финальный отчёт — список изменённых файлов, миграций, таблиц, функций, UI, тестов и diff-summary.

---

## Часть 0. Цель и принципиальное решение

**Цель MVP:** администратор может (1) загрузить DOCX «Акт выполненных работ», (2) увидеть найденные плейсхолдеры, (3) сопоставить их с единым token registry, (4) выбрать сделку/контакт/юрлицо как контекст, (5) увидеть preview/missing fields, (6) сгенерировать DOCX, (7) скачать, (8) увидеть историю + snapshot.

**Архитектурное решение:**

- **Платформа = SOT** для шаблонов, токенов, данных, генерации, истории.
- **DOCX + Docxtemplater** = canonical engine генерации (уже стоит в проекте).
- **Supabase Storage** = хранилище шаблонов и результатов.
- **Google Docs / Google Drive** — НЕ ядро. Только опциональная точка расширения (поля в схеме, без UI и без runtime-веток в MVP).
- **ONLYOFFICE embedded editor** — НЕ в MVP. Только архитектурная точка расширения (template editor adapter). Sprint 2.
- **AI** — не SOT. Только helper (предложить текст, объяснить missing). В MVP не задействуем.

---

## Часть 1. Discovery (первый и обязательный шаг)

### 1.1. Edge functions генерации (текущая инвентаризация)

Все используют связку `Docxtemplater@3.47.1 + PizZip@3.1.6`. Различаются источником payload и обвязкой.


| Функция                                           | Кто зовёт                                | Назначение                                                                                              | Решение                                                                                              |
| ------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ai-generate-document`                            | UI «Создать документ» (`useAiDocuments`) | Один документ для произвольного клиента (legal_details_id + person + signer) → `ai_generated_documents` | **Кандидат №1 в canonical**, расширяем под `context_type = deal/order`                               |
| `ai-generate-document-package`                    | UI «Сформировать пакет»                  | Цикл по списку шаблонов поверх `ai-generate-document`                                                   | Оставляем как обёртку поверх canonical                                                               |
| `ai-generate-corporate-package`                   | Corporate wizard (closing-year)          | Специализированный 3-layer manifest для protocols/notices                                               | **Не трогаем** в MVP. Позже — переиспользование `_shared/document-render.ts` без изменения поведения |
| `document-auto-generate`                          | UI кнопок «Перегенерировать»             | Старая ветка билинговых счёт-актов → `generated_documents`                                              | **Deprecated после MVP**. Поведение покрывает canonical                                              |
| `generate-from-template`                          | Никем (мёртвая)                          | Дубль `document-auto-generate`                                                                          | **Deprecated сразу**                                                                                 |
| `generate-invoice-act`                            | Никем (мёртвая)                          | Второй дубль счёт-актов с собственным email-стеком                                                      | **Deprecated сразу**                                                                                 |
| `generate-document-pdf`                           | Никем (изолирована)                      | Захардкоженный шаблон в файле функции                                                                   | **Deprecated сразу**                                                                                 |
| `bepaid-docs-backfill`, `bepaid-get-payment-docs` | bePaid                                   | Чеки от bePaid                                                                                          | Другой домен. Не трогаем                                                                             |


### 1.2. Хелперы

`supabase/functions/_shared/`:

- `docx-helpers.ts` — `dateToRussianFormat`, `fullNameToInitials`, `generateDocumentNumber`, `buildAddress`, `entityName`, `sanitizeFileName`. Используется только `ai-generate-corporate-package`.
- В `ai-generate-document`, `document-auto-generate`, `generate-from-template`, `generate-invoice-act` — **3-4 копии** `numberToWordsRu`, `dateToRussianFormat` и пр. Консолидировать в `_shared/docx-helpers.ts`.
- `systemTokens.ts` (`{{today}}`, `{{tomorrow}}`) — переиспользовать.

### 1.3. Таблицы


| Таблица                                                                              | Текущее состояние                                                                            | Роль в MVP                                                          |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `document_templates`                                                                 | 20 шаблонов, `template_path`, `placeholders` jsonb, `template_scope`, `editor_draft_content` | Расширить полями версионирования и snapshot                         |
| `ai_generated_documents`                                                             | История AI-конструктора                                                                      | Canonical таблица результатов в MVP                                 |
| `generated_documents`                                                                | 216 строк, билинговые счёт-акты                                                              | Не трогаем, остаётся за `document-auto-generate` до его deprecation |
| `document_generation_rules`                                                          | 0 строк                                                                                      | Не используем в MVP                                                 |
| `product_document_templates`                                                         | 0 строк                                                                                      | Не используем в MVP                                                 |
| `executors` (1)                                                                      | Наше юрлицо                                                                                  | Источник полей исполнителя                                          |
| `client_legal_details`, `legal_details_persons`, `legal_details_entity_person_links` | 26 + персоны                                                                                 | Источник полей заказчика                                            |
| `fields_registry`, `field_values`                                                    | Существуют                                                                                   | Реюз для resolver полей                                             |
| `orders_v2`                                                                          | SOT сделок                                                                                   | Источник `contract_*`, `act_*`, сумм, валюты                        |
| `document_number_sequences`                                                          | Используется частично                                                                        | Сквозная нумерация актов                                            |


### 1.4. UI

`/admin/ai → Документы → Шаблоны документов` (`AdminDocumentTemplates → DocumentTemplatesContent`):

1. **Шаблоны** — `AiDocumentTemplatesManager`. CRUD + загрузка DOCX в bucket `documents-templates` + парсинг `extractDocxPlaceholders`. Открывает `CorporateTemplateEditorDialog` (просмотр с подсветкой токенов через `templateEditorMapper`).
2. **Правила генерации** — пустая.
3. **Журнал документов** — `generated_documents` + `ai_generated_documents`.
4. **Плейсхолдеры** — справочник.

`CorporateTemplateEditorDialog + EditorModeView/PreviewModeView` — декоративный preview через mammoth (не настоящий редактор; форматирование теряется при импорте). Это staging, runtime его не использует — оставляем, в MVP не расширяем.

### 1.5. Существующие хуки/утилиты для переиспользования

- `src/hooks/useAiDocuments.ts` — CRUD + `generate` через `ai-generate-document`. **Расширяем**, не дублируем.
- `src/hooks/useAiDocumentPackageGeneration.ts` — пакеты. Не трогаем.
- `src/hooks/useLegalDetailsFields.ts` — токены `{{cf.legal_details.<public_id>}}` через `fields_registry`. Реюз в registry MVP.
- `src/utils/extractDocxPlaceholders.ts` — парсер `{{...}}` из DOCX через mammoth. Реюз.
- `src/lib/corporate/templateEditorMapper.ts` + `tokenRegistry.ts` — отображение `{{...}}` → `[Человекочитаемое]`. **Расширяем до полноценного registry.**
- `src/components/admin/TokenizedRichInput.tsx` — UI вставки токенов. Реюз для token sidebar в MVP.

---

## Часть 2. Архитектура canonical pipeline

```text
                   document_templates (+versioning, +snapshot fields)
                           │
                           ▼
              document_template_versions (новая)
                           │
                           ▼
              document_token_registry (новая, или расширение existing token map)
                           │
                           ▼
   ┌───────── _shared/document-render.ts (НОВЫЙ canonical core) ─────────┐
   │  1. fetchTemplateBuffer(template_version)                            │
   │  2. resolveContext(context_type, context_entity_id)                  │
   │       → executor + customer + signer + deal/order + computed         │
   │  3. validatePayload → missing[], warnings[]                          │
   │  4. renderDocx(buffer, payload) via Docxtemplater                    │
   │  5. writeStorage('documents/...')                                    │
   │  6. writeSnapshot + writeAudit                                       │
   └─────┬───────────────────────────────────────────────────────┬───────┘
         │                                                       │
   ai-generate-document                                ai-generate-corporate-package
   (расширен под context = deal/order/contact)         (без изменений в MVP)
         │
   ai-generate-document-package (loop wrapper)
```

**Single canonical writer** = `_shared/document-render.ts`. Все будущие документы — через него.

---

## Часть 3. Token registry (registry-first модель)

### 3.1. Принципы

- В DOCX-шаблоне физически написано `{{legal_entity.short_name}}` — canonical token (как сейчас, не меняем).
- В UI админ видит `[Название компании]` — UI label.
- Mapping `canonical_key ↔ system_token ↔ ui_label ↔ resolver_key` лежит в **одной таблице** `document_token_registry`.
- Запрещены локальные списки токенов «по месту». Текущие константы в `src/lib/tokens/tokenRegistry.ts` мигрируем в БД.

### 3.2. Группы токенов MVP (минимум для акта)


| Группа                          | Примеры canonical_key                                                                                                                                                                                                   | Resolver                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `executor`                      | `executor.legal_name`, `executor.unp`, `executor.legal_address`, `executor.director_full_name`, `executor.director_initials`, `executor.basis`, `executor.bank_*`                                                       | `executors` (default = наше юрлицо)                                                     |
| `customer`                      | `customer.short_name`, `customer.unp`, `customer.address`, `customer.signer_full_name`, `customer.signer_basis`, `customer.passport_*`                                                                                  | `client_legal_details` + `legal_details_persons` через `legal_details_id` / `person_id` |
| `deal`                          | `deal.contract_number`, `deal.contract_date`, `deal.act_number`, `deal.act_date`, `deal.service_period_from`, `deal.service_period_to`, `deal.amount`, `deal.amount_in_words`, `deal.currency`, `deal.services` (array) | `orders_v2` + `field_values`                                                            |
| `system`                        | `today`, `today_full_ru`, `tomorrow`                                                                                                                                                                                    | `_shared/systemTokens.ts` (реюз)                                                        |
| `cf.legal_details.<FLD-XXXXXX>` | Кастомные поля юрлица через `fields_registry`                                                                                                                                                                           | Реюз `useLegalDetailsFields` логики на серверной стороне                                |


### 3.3. Поля сделки (audit перед добавлением)

Проверить `orders_v2`/связанные таблицы на наличие:
`contract_number`, `contract_date`, `act_number`, `act_date`, `service_period_from`, `service_period_to`, `service_description`, `service_amount`, `currency`.

Если отсутствуют — НЕ хардкодить в генераторе. Решение в dry-run:

- (A) добавить structured колонки в `orders_v2` (миграция);
- (B) использовать `fields_registry`/`field_values` как универсальный механизм;
- (C) хранить в `orders_v2.metadata` jsonb.

Финальный выбор фиксируется в proof после проверки реального состояния таблиц.

---

## Часть 4. Миграции БД

```text
1. document_templates  +=  current_version_id, document_type (enum включая 'service_act'),
                            template_code, status

2. document_template_versions (новая)
   id, template_id, version_number, file_path, token_manifest jsonb,
   detected_tokens text[], validation_status, created_at, created_by, metadata

3. document_token_registry (новая)
   id, public_id, canonical_key UNIQUE, system_token UNIQUE, ui_label,
   entity_scope, data_type, resolver_key, is_required, is_array,
   metadata, created_at, updated_at, created_by, updated_by

4. document_generation_sessions (новая, draft preview)
   id, template_id, template_version_id, context_type, context_entity_id,
   status, resolved_data jsonb, missing_fields jsonb, warnings jsonb,
   preview_file_path, created_at, created_by, metadata

5. ai_generated_documents  +=  template_version_id, generation_session_id,
                                context_type, context_entity_id

6. document_generation_snapshots (новая)
   id, generated_document_id, template_snapshot, token_manifest_snapshot,
   placeholder_data_snapshot, warnings_snapshot, source_trace,
   resolver_version, registry_version, created_at

7. (опционально) orders_v2 +=  contract_number, contract_date, act_number,
                                act_date, service_period_from, service_period_to,
                                service_description, service_amount, currency
   — финальное решение по результатам discovery
```

RLS на всех новых таблицах: чтение/запись только админам через `has_role`.

---

## Часть 5. Edge functions

### 5.1. Новый shared core

`supabase/functions/_shared/document-render.ts`

- `fetchTemplateBuffer(versionRow)` — Storage.download.
- `resolveContext({context_type, context_entity_id, executor_id?, signer_id?})` — собирает payload из всех источников.
- `validatePayload(payload, tokenManifest)` → `{missing[], warnings[]}`.
- `renderDocx(buffer, payload)` — Docxtemplater.
- `writeOutput({buffer, fileName, bucket})` → `{file_path, file_url}`.
- `writeSnapshot(generatedDocId, payload, manifest, warnings, sources)`.

### 5.2. Расширение `ai-generate-document`

Принимает дополнительно:

- `context_type` ∈ {`adhoc` | `deal` | `order` | `contact`},
- `context_entity_id`,
- `mode` ∈ {`preview` | `generate`} — в `preview` пишет в `document_generation_sessions` без файла; в `generate` — пишет в `ai_generated_documents` + snapshot.
- `allow_blank` (boolean) — если `true`, отсутствующие необязательные поля заменяются `__________`; обязательные всё равно блокируют.

Полностью переходит на `_shared/document-render.ts` и `_shared/docx-helpers.ts`. Поведение для существующих вызовов (без `context_type`) — обратно совместимо (`adhoc`).

### 5.3. Deprecated сразу

- `generate-from-template` — header-комментарий + 410 в README, не удаляем файл.
- `generate-invoice-act` — то же.
- `generate-document-pdf` — то же.

### 5.4. Без изменений

- `ai-generate-corporate-package` — corporate flow остаётся.
- `document-auto-generate` — оставляем активным до отдельного спринта миграции счёт-актов на canonical.

---

## Часть 6. UI MVP

### 6.1. `/admin/ai → Документы` — три подвкладки

**Шаблоны (расширение существующего `AiDocumentTemplatesManager`):**

- Загрузка `.docx` (как сейчас) → создаёт `document_templates` + первую `document_template_versions`.
- Парсинг токенов через `extractDocxPlaceholders`.
- Каждый найденный токен сопоставляется с `document_token_registry`:
  - matched → зелёная плашка с UI label;
  - unknown → жёлтая плашка с кнопкой «Создать токен в registry» (после duplicate check).
- Показ версии шаблона, дата, автор. Загрузка нового `.docx` → новая версия (старые не удаляются, история сохраняется).

**Генерация (новый раздел или расширение `GenerateAiDocumentDialog`):**

1. Выбор шаблона (фильтр по `document_type`).
2. Выбор контекста: `Сделка` / `Заказ` / `Контакт + юрлицо` / `Adhoc`.
3. Подгрузка кандидатов (autocomplete по `orders_v2` / `client_legal_details`).
4. Preview: список найденных токенов с подставленными значениями, missing required (красное, блокирует), missing optional (можно «оставить пустую линию»).
5. Кнопка «Сгенерировать DOCX» → вызов `ai-generate-document` (mode=generate). Скачивание + редирект в Историю.

**История (расширение существующего журнала):**

- Дата, шаблон, версия, контекст (с deeplink на сделку/контакт), кто сгенерировал, скачать DOCX, открыть snapshot (модалка с jsonb-deep-view).

### 6.2. Token Sidebar (для будущих editor-режимов)

В MVP — компактная панель в шаблоне и в генерации: группы токенов (Исполнитель / Заказчик / Сделка / Системные / Кастомные поля), кнопка copy `{{token}}`, отображение UI label.

Реюз `TokenizedRichInput` где применимо.

### 6.3. Что НЕ делаем в UI

- ONLYOFFICE / Word-like editor.
- Google Docs link/embed.
- Авторассылка.
- Конвертация в PDF.
- Личный кабинет клиента «Мои документы».

---

## Часть 7. Snapshot и audit

### 7.1. Snapshot (обязателен на каждой генерации)

Сохраняем в `document_generation_snapshots`:

- `template_id`, `template_version_id`, `template_code`, `template_version`,
- `registry_version` (хеш registry на момент рендера), `resolver_version` (semver `_shared/document-render.ts`),
- `context_type`, `context_entity_id`,
- `placeholder_data_snapshot` (полный payload как ушёл в Docxtemplater),
- `token_manifest_snapshot` (что в шаблоне),
- `template_tokens_snapshot` (что реально было подставлено),
- `warnings_snapshot`, `source_trace` (по каждому полю — откуда взято: таблица + UUID + колонка).

### 7.2. Audit

В `audit_logs`:

- `document_template.created`, `document_template.version_uploaded`,
- `document_token_registry.token_created/updated`,
- `document.generated` с `meta = {template_id, version_id, context, generated_doc_id, missing_count, warnings_count}`,
- `document.generation_blocked_missing_required`.

---

## Часть 8. Точки расширения (готовим, но не реализуем)

В схеме `document_templates` и `ai_generated_documents` сразу резервируем:

- `storage_provider` text default `'supabase_storage'` (`'supabase_storage' | 'google_drive'`),
- `external_file_id` text NULL,
- `external_file_url` text NULL,
- `sync_status` text NULL.

В UI этих полей не показываем. Это исключительно future-ready для Sprint 3 (Google Drive sync).

ONLYOFFICE — никакой инфраструктуры в MVP. В архитектурный заметках фиксируем «template editor adapter» как будущий слой над `document_template_versions`.

---

## Часть 9. Roadmap


| Sprint            | Содержание                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **1 (этот план)** | DOCX upload + versioning + token registry + canonical render core + generate UI + snapshot + history. Только `service_act`. |
| 2                 | ONLYOFFICE embedded editor + token sidebar внутри редактора.                                                                |
| 3                 | Google Drive export/sync (через уже зарезервированные поля).                                                                |
| 4                 | Loops в DOCX (массивы услуг/участников), правила генерации, миграция `document-auto-generate` на canonical.                 |
| 5                 | AI-помощник (предложение текста шаблона, объяснение missing).                                                               |
| 6                 | Авто-триггеры из `grant-access-for-order`, PDF, авторассылка email/Telegram.                                                |


---

## DoD первого спринта (MVP)

1. Discovery-отчёт по существующим генераторам, таблицам, UI приложен в proof. Дублирующий генератор не создан.
2. Миграции применены: `document_template_versions`, `document_token_registry`, `document_generation_sessions`, `document_generation_snapshots`, расширение `document_templates` и `ai_generated_documents`. RLS настроены.
3. Token registry заполнен минимальным набором (executor + customer + deal + system) через миграцию-seed.
4. `_shared/document-render.ts` создан. `_shared/docx-helpers.ts` собрал все копии форматтеров.
5. `ai-generate-document` расширен под `context_type` и `mode=preview/generate`. Старые вызовы работают (smoke).
6. `generate-from-template`, `generate-invoice-act`, `generate-document-pdf` помечены deprecated.
7. UI: вкладки «Шаблоны / Генерация / История» работают. Загружен тестовый шаблон «Акт выполненных работ.docx». Распознаны токены, сопоставлены с registry.
8. Сгенерирован акт по реальному заказу: preview показал все поля, missing проверены, DOCX скачан, форматирование сохранено.
9. `ai_generated_documents` содержит запись с `template_version_id`, `context_type='order'`, `context_entity_id=<UUID>`. `document_generation_snapshots` содержит полный snapshot.
10. `audit_logs` содержит `document.generated`.
11. `ai-generate-corporate-package` (closing-year wizard) проверен smoke — без регрессий.
12. Proof-файл `.lovable/proofs/document_generation_mvp_service_act_2026_05.md` с SQL, скриншотами UI, snapshot-выгрузкой, diff-summary, списком архивированных функций.
13. Memory `mem://architecture/documents/canonical-render-engine` фиксирует canonical writer + запрет на дубли + registry-first контракт + правила deprecation.

---

## Открытые вопросы (решить в dry-run перед execute)

1. **Поля сделки для акта** — добавить колонки в `orders_v2`, или использовать `fields_registry`/`field_values`, или `orders_v2.metadata`. Решение фиксируется после реального discovery текущей схемы.
2. **Versioning стратегии** — каждая загрузка DOCX = новая версия (`version_number++`). При этом активной всегда одна (`current_version_id`). Старые остаются read-only для воспроизводимости snapshot. Подтвердить.
3. **Numbering актов** — реюз `document_number_sequences` или новая последовательность для `service_act`. По умолчанию — реюз.
4. **Deprecation `document-auto-generate**` — оставляем активным до Sprint 4 (миграция счёт-актов). В MVP только пометка «не использовать для новых шаблонов».