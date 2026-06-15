# PATCH-PACKAGE-CUSTOM-FIELDS-V1 — Proof Bundle

Дата: 2026-06-14
Статус: Phase 1 закрыт доказательствами, Phase 2 — частично (B1 + auto-assign trigger выполнены).

## A1. Migrations & files inventory

### Миграции
- `supabase/migrations/20260614161448_282413e4-1bbc-4f81-8dda-5fc830537ec6.sql` — создание трёх таблиц, RLS, триггеры, RPC `upsert_session_field_values`, `upsert_package_field_catalog`, `report_package_field_dependencies`, smart-date helper, аудит.
- `supabase/migrations/<новая Phase 2>.sql` — серверный триггер `trg_dpti_auto_assign_fields` на `document_package_template_items` (auto-assign по `auto_assign_to_new_items=true`, идемпотентно).

### Созданные / изменённые файлы
- `src/hooks/usePackageFieldCatalog.ts` — CRUD каталога полей.
- `src/hooks/useDocumentItemFieldAssignments.ts` — назначения per-item + bulk `assignToAll`.
- `src/lib/packageFields/smartDate.ts` — pre-fill дат по `default_kind`, TZ `Europe/Minsk`.
- `src/components/ai-documents/packages/PackageFieldsManager.tsx` — CRUD UI каталога (Phase 1).
- `src/components/ai-documents/packages/PackageFieldsAssignmentPanel.tsx` — Phase 2 B1: назначение полей шаблону документа.
- `src/components/ai-documents/packages/DocumentPackageQuestionnairesView.tsx` — встроен `PackageFieldsAssignmentPanel` под блоком ролей в аккордеоне «Анкеты документов».
- `src/components/ai-documents/packages/PackagesWorkspace.tsx` — переименование таба в «Роли и поля пакета».
- `supabase/functions/_shared/resolve-package-tokens.ts` — branch `pf-XXXXXX` (валидация принадлежности пакету, форматирование по `data_type`).
- `supabase/functions/_shared/resolve-package-tokens.pf.test.ts` — Deno-тест 4 сценариев (valid / wrong package / required missing / not found).

## A2. SQL-проверка структуры

### Таблицы (51 столбец суммарно, нормализованные типы)
```
document_package_field_catalog          22 столбца  — каталог полей пакета
document_package_item_field_assignments 15 столбцов — назначения полей шаблонам
document_package_session_field_values   14 столбцов — типизированные значения сессии
```

### Ключевые constraints
```
dpfc_public_id_format_chk    CHECK (public_id ~ '^pf-[0-9]{6,}$')
dpfc_data_type_chk           CHECK (data_type IN ('text','number','date','datetime',
                                                 'time','year','select','multiselect','checkbox'))
dpfc_usage_scope_chk         CHECK (usage_scope IN ('package_all','questionnaire_only','documents_only'))
dpifa_visibility_mode_chk    CHECK (visibility_mode IN ('ask_client','admin_only','hidden_with_default'))

FK  document_package_field_catalog.package_template_id  → document_package_templates(id)  ON DELETE CASCADE
FK  document_package_item_field_assignments.package_template_item_id → document_package_template_items(id) ON DELETE CASCADE
FK  document_package_item_field_assignments.field_catalog_id         → document_package_field_catalog(id)  ON DELETE RESTRICT
FK  document_package_session_field_values.session_id                 → document_package_sessions(id)       ON DELETE CASCADE
FK  document_package_session_field_values.field_catalog_id           → document_package_field_catalog(id)  ON DELETE RESTRICT

UNIQUE uq_dpifa   (package_template_item_id, field_catalog_id)
UNIQUE uq_dpsfv   (session_id, field_catalog_id)
```

### RLS-политики (все таблицы RLS ON)
```
document_package_field_catalog
  dpfc_admin_all                     ALL    authenticated
  dpfc_select_for_package_consumers  SELECT authenticated

document_package_item_field_assignments
  dpifa_admin_all                    ALL    authenticated
  dpifa_select_for_package_consumers SELECT authenticated

document_package_session_field_values
  dpsfv_admin_all                    ALL    authenticated
  dpsfv_select_own                   SELECT authenticated
  dpsfv_insert_own                   INSERT authenticated
  dpsfv_update_own                   UPDATE authenticated
```

### Триггеры
```
document_package_field_catalog
  trg_dpfc_public_id            BEFORE INSERT  → присваивает pf-XXXXXX и валидирует
  trg_dpfc_guard                BEFORE UPDATE/DELETE → immutable {data_type,public_id,field_key,
                                                       package_template_id}; запрет delete при
                                                       зависимостях или is_system=true
  trg_audit_dpfc                AFTER INSERT/UPDATE/DELETE → audit_logs

document_package_item_field_assignments
  trg_dpifa_assert_package_match BEFORE INSERT/UPDATE → field_catalog.package_template_id
                                                        обязан совпадать с package_template_id
                                                        самого item (защита от кросс-пакет-назначения)
  trg_dpifa_updated_at          BEFORE UPDATE

document_package_session_field_values
  trg_dpsfv_updated_at          BEFORE UPDATE

document_package_template_items
  trg_dpti_auto_assign_fields   AFTER INSERT (Phase 2 B1) — авто-назначение полей с
                                auto_assign_to_new_items=true
```

## A3. Audit-факты

На момент создания proof-bundle таблицы `audit_logs WHERE entity_type IN
('document_package_field_catalog', 'document_package_item_field_assignments',
'document_package_session_field_values')` пусто — UI ещё не использовался для
CRUD. Sprint runtime UAT даст реальные строки и они будут вставлены сюда
после фактического UAT-прохода. До UAT proof фиксирует только структурную
готовность аудита (триггер `trg_audit_dpfc` присутствует, см. A2).

## A4. Resolver-тесты

Файл: `supabase/functions/_shared/resolve-package-tokens.pf.test.ts`
Покрытые сценарии:

1. **valid pf-token** → `resolved=true`, значение «ООО Пример», `canonicalFieldPublicId='pf-000123'`.
2. **pf-token из другого пакета** → `resolved=false`, `code='pf_token_outside_bound_package'`.
3. **required без значения** → `resolved=false`, `code='pf_required_value_missing'`.
4. **неизвестный pf-токен** → `resolved=false`, `code='pf_token_not_found'`.

Регрессия `ln-` / `{{field:FLD-…}}`: код-путь не изменён (ветка `LN_RE`
обрабатывается до `PF_RE`, billing `{{field:FLD-…}}` — отдельной функцией
`resolveBillingField` вне этого файла). Совместный smoke-тест на один
шаблон с тремя типами токенов одновременно перенесён в B5 (требует
интеграционной фикстуры DOCX и запуска `canonical-document-generate-strict`
в test-режиме).

## A5. UI-факт

PackageFieldsManager доступен в admin-разделе «Документы» → пакет →
вкладка «Роли и поля пакета». Запись `public_id` создаётся триггером
`trg_dpfc_public_id` (формат `pf-XXXXXX`). UAT-прогон с фиксацией
конкретного public_id и скрином — следующий шаг.

## B1. Назначение полей шаблонам (выполнено)

- `PackageFieldsAssignmentPanel` встроен в аккордеон документа в
  `DocumentPackageQuestionnairesView`.
- Per-item контролы: видимость (`ask_client` / `admin_only` /
  `hidden_with_default`), override обязательности (inherit / required /
  optional — корректный override-контракт: null = наследовать, true =
  принудительно обязательно, false = принудительно нет), локальный
  label.
- Bulk: кнопка «Во все» → `usePackageFieldAssignments.assignToAll(field.id)`,
  идемпотентно (`ON CONFLICT DO NOTHING` в БД).
- Auto-assign на новые шаблоны: серверный триггер
  `trg_dpti_auto_assign_fields` (миграция Phase 2), работает независимо
  от UI/RPC/импорта — пункт 2 уточнений плана выполнен.
- Каталог-свойства (`public_id`, `data_type`, `choices`, `default_kind`,
  global label) панель НЕ дублирует — это read-only справа от свитча.

## Не выполнено (следующие итерации)

- B2: клиентская анкета `pf-` (один вопрос на `field_catalog_id`, дедуп
  по сессии, контролы по типам).
- B3: блок «Поля пакета» в `PackageTemplateValidationPanel` со сверкой
  DOCX-токенов через `extractDocxPlaceholders`.
- B4: backend required-gate в `canonical-document-generate-strict`
  (effective_required = override чёткий приоритет; `hidden_with_default`
  без вычислимого default → конфигурационная ошибка) +
  `meta.tokens_snapshot[]` (add-only, без слома формата).
- B5: интеграционный smoke `ln- + pf- + FLD-` в одной генерации.
- Runtime UAT + audit-выборка в A3.

Каждый из этих пунктов запускается отдельным проходом — они затрагивают
канонический генератор и снимок, поэтому ломать в одном спринте всё
сразу запрещено инвариантом «безопасной модификации».

## B4. Backend required-gate + tokens_snapshot (выполнено)

Расширены два edge-функции — `ai-generate-document-package` (orchestrator)
и `canonical-document-generate-strict` (генератор) — для поддержки
`{{pf-XXXXXX}}` в DOCX-шаблонах пакета. Ни одно из ограничений
канонической точки записи (single SOT, ai_generated_documents add-only,
ln/FLD регрессионная защита) не нарушено.

### Orchestrator (`ai-generate-document-package/index.ts`)

- Добавлен `PF_RE = /^(pf-\d{6})((?:\|[a-z_]+=[A-Za-z0-9_.]+)*)$/` и
  баг-ключ `pf-XXXXXX` в дедуп токенов.
- Один bulk-load на сессию:
  - `document_package_field_catalog` (active, package_template_id) →
    `pfCatalogByPublicId`.
  - `document_package_item_field_assignments` (active, в составе items
    сессии, по `field_catalog_id`) → `pfAssignByItemField`.
  - `document_package_session_field_values` (по `field_catalog_id`) →
    `pfValueByField`.
- На каждом item: для встреченного `pf-` токена проверяется принадлежность
  пакета (иначе `pf_token_outside_bound_package`), вычисляется
  `effective_required` (`assignment.is_required_override` если задан,
  иначе `catalog.required`), `label_override` (если задан), достаётся
  raw-value по `data_type`, форматируется через шаренный
  `formatPfValue(...)` без модификатора, формируется запись:
  ```ts
  preresolved_pf_fields[pfPublicId] = {
    public_id, label, data_type,
    raw_value, rendered_value,
    effective_required,
    default_kind_applied: catalog.metadata.default_kind ?? null,
  }
  ```
- `preresolved_pf_fields` передаётся в `canonical-document-generate-strict`
  внутри `packageContext` (тем же service-role/x-internal-call контрактом,
  что и `preresolved_ln_tokens`).

### Generator (`canonical-document-generate-strict/index.ts`)

- Добавлен `PF_TOKEN_RE` и парсер `parsedPfTokens[]`. Если `pf-` токен
  встречается в order-mode шаблоне — он попадает в существующий
  `packageTokensOutsideContext` и возвращается 400
  `package_token_outside_package_context` (вместе с ln/package). Регрессия
  ln/package не затронута.
- В блоке pre-resolve гарантирий `if (generationContext === 'package_session')`:
  - Если токен не найден в `preresolved_pf_fields` → 400
    `package_field_not_preresolved` + `code: 'pf_token_not_found'`.
  - Required-gate: если `entry.effective_required && raw_value пустой`
    (null/''/[]) → **422** `{ error: 'pf_required_value_missing',
    code: 'pf_required_value_missing', fields: [{public_id, label}] }`.
    Единый код, как и потребовано.
- Подстановка в `resolved` map: `outVal = entry.rendered_value`.
  Docxtemplater использует тот же кастомный parser, что и для ln/package,
  поэтому `{{pf-XXXXXX}}` и `{{pf-XXXXXX|format=…}}` рендерятся как один и
  тот же ключ (format-modifier зарезервирован, не применяет повторного
  форматирования в B4).
- `sourceTrace[raw_inside]` для каждого pf-токена содержит
  `{ kind: 'pf', public_id, label, data_type, required, value,
  format_requested, default_kind_applied }`.

### `meta.tokens_snapshot[]` (add-only)

В `ai_generated_documents.meta` добавлен новый массив `tokens_snapshot`
(никакие существующие поля meta не переписываются: `strict`,
`docx_*`, `file_name_*`, `gotenbergMeta`, `packageMetaExtras` сохранены).

В package-mode записывается по одному элементу на уникальный
`pf-XXXXXX`, встреченный в DOCX этого документа:

```json
{
  "provider": "pf",
  "public_id": "pf-000123",
  "label": "Дата подписания",
  "data_type": "date",
  "raw_value": "2026-06-14",
  "rendered_value": "14 июня 2026 г.",
  "default_kind_applied": "today_minsk"
}
```

В order-mode массив пустой (`[]`) — никакие order-документы не получают
pf-сноски. Имеющиеся поля snapshot (`template_tokens_snapshot`,
`token_manifest_snapshot`, `source_trace`, `snapshot`) не изменены.

### Регрессионная защита (контракты не сдвинуты)

- `ln-XXXXXX` и `field:FLD-…` парсятся теми же regex/блоками — изменений
  в их обработке нет.
- В `file_name_template` поддержка pf-токенов не добавлена (вне
  scope B4); существующий warning `file_name_warnings` сохранён.
- В строгом гард-блоке package-mode остался прежний порядок: legacy →
  unknown_modifier → outside_context → pf_not_preresolved →
  pf_required_missing → field_not_preresolved. ln/package никогда
  не достигают pf-веток.

### Что НЕ закрывается этим проходом

- B5: интеграционный resolver-тест `ln + pf + FLD`.
- Runtime UAT: 422 при пустом required-pf и реальный
  `meta.tokens_snapshot[]` после генерации.
- audit-выборка по `document.package_generation_completed` + проверка
  блока в `ai_generated_documents.meta`.
