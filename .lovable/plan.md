# да, согласен, с учетом правок:

1. **Унифицировать коды ошибок во всём патче.** Сейчас используются три варианта:
  - `pf_value_missing`;
  - `pf_required_missing`;
  - ранее утверждённый `pf_required_value_missing`.
  Оставить единый канонический код:
  ```text
  pf_required_value_missing
  ```
  Его использовать в resolver tests, backend gate, UI error handling, proof и snapshot warnings.
2. **Auto-assign выполнять серверно, а не только хуком после INSERT.** Логика в `useDocumentPackageItems.addItem` не покрывает создание шаблона через RPC, импорт, service role или другой UI. Добавить серверный trigger/RPC-step:
  &nbsp;
  ```text
  after package item creation
  → insert assignments for active catalog fields
    where auto_assign_to_new_items=true
  → ON CONFLICT DO NOTHING
  ```
  Клиентский хук может только обновлять UI.
3. **Required рассчитывать с корректным override-контрактом:**
  &nbsp;
  ```text
  effective_required =
    CASE
      WHEN assignment.is_required_override IS NOT NULL
        THEN assignment.is_required_override
      ELSE catalog.required
    END
  ```
  Нельзя использовать простой `OR`, поскольку override=`false` должен иметь возможность отключить базовую обязательность поля для конкретного документа.
4. `hidden_with_default` **не должен создавать пустое значение.**
  - есть допустимый `default_kind` → backend вычисляет значение;
  - `generation_date` вычисляется непосредственно при генерации;
  - default отсутствует или неприменим к типу → конфигурационная ошибка;
  - required hidden-поле без вычисляемого значения → `pf_required_value_missing`.
5. **Snapshot должен сохраняться в согласованном формате массива токенов.** Не создавать одновременно несовместимые структуры:
  &nbsp;
  ```text
  meta.tokens_snapshot[]
  ```
  и
  ```text
  meta.tokens_snapshot.pf
  ```
  Сначала подтвердить фактический существующий контракт. Добавить `pf` provider-neutral элементами в текущую структуру, не менять её форму и не ломать старые snapshots.
6. **Для доказательств Phase 1 audit-выборка должна содержать реальные записи.** Если до тестового CRUD таблица пуста, сначала выполнить контролируемое создание/изменение/архивацию тестового поля, затем приложить строки `audit_logs` с `actor_type`, `actor_user_id`, `actor_label`, before/after.
7. **Regression proof должен проверять не только отдельные тесты, но и совместный проход:**
  &nbsp;
  ```text
  {{ln-XXXXXX}}
  {{pf-XXXXXX}}
  {{field:FLD-XXXXXX}}
  ```
  в одном шаблоне и одной генерации.
8. Все пункты исходного Phase 2 и доказательств Phase 1 сохраняются add-only. После этих уточнений можно выполнять A параллельно с B1, затем B2 → B3 → B4 → B5 → B6.
9. &nbsp;
10. План: PATCH-PACKAGE-CUSTOM-FIELDS-V1 — Phase 2 + доказательства Phase 1

Принимаю замечание: Phase 1 — это implementation checkpoint, не закрытый патч. Закрываем оба гэпа: (A) собираем фактические доказательства Phase 1, (B) дореализуем сценарий до DoD.

## A. Доказательная база Phase 1 (proof bundle)

Все артефакты складываются в `.lovable/proofs/package_custom_fields_2026-06-14.md` (дополняется секциями):

1. **Migrations & files inventory** — список миграций (`20260614161448_…`) и созданных/изменённых файлов с git-style diff sizes.
2. **SQL-проверки структуры** через `supabase--read_query`:
  - `information_schema.columns` для трёх таблиц;
  - `pg_constraint` (FK на `package_template_id`, unique `(session_id, field_catalog_id)`, unique `(package_template_item_id, field_catalog_id)`, CHECK на `public_id ~ '^pf-\\d{6}$'`);
  - `pg_policies` (RLS by role);
  - `pg_trigger` (immutability `data_type/public_id/field_key/package_template_id`, delete-guard, audit).
3. **Audit-факты** — выборка `audit_logs WHERE entity_type IN ('document_package_field_catalog','document_package_item_field_assignments','document_package_session_field_values')` с лимитом 20 строк.
4. **Resolver-тесты (deno test)** в `supabase/functions/_shared/resolve-package-tokens.test.ts`:
  - `pf-XXXXXX` валидный → значение по типу;
  - `pf-` из другого пакета → `pf_token_outside_bound_package`;
  - `pf-` без записи в каталоге → `pf_token_not_found`;
  - `pf-` без значения сессии и `required=true` → `pf_value_missing`;
  - regression: `ln-XXXXXX` и `{{field:FLD-XXXXXX}}` продолжают резолвиться без изменений.
5. **UI-факт** — короткий runtime прогон в preview (логин dev-паролем) c созданием поля и фиксацией `public_id` в proof.

## B. Phase 2 — закрытие пользовательского сценария

### B1. Назначение полей шаблонам (вкладка «Анкеты документов»)

- Новый компонент `PackageFieldsAssignmentPanel.tsx` встраивается в `DocumentPackageQuestionnairesView` под текущим блоком ролей, по одному шаблону пакета.
- Использует `useItemFieldAssignments(itemId)` + `usePackageFieldCatalog(packageTemplateId)`.
- Контролы строго настройки использования: `visibility_mode`, `is_required_override`, `label_override`, `help_override`, `section_key`, `sort_order`, `is_active`. Никакого дублирования `public_id/data_type/choices/default_kind/global label`.
- Bulk: кнопка «Использовать во всех документах пакета» → `assignToAll(fieldCatalogId)` из `usePackageFieldAssignments`.
- Auto-assign-to-new-items: новый шаблон при добавлении в пакет получает assignments всех `catalog.auto_assign_to_new_items=true` (хук в `useDocumentPackageItems.addItem` после insert).

### B2. Клиентская анкета (заполнение)

- В `DocumentPackageQuestionnairesView` (клиентский режим/предпросмотр) добавляется секция «Поля пакета» с дедупликацией по `field_catalog_id`: один вопрос на каталог-поле, даже если он назначен N шаблонам.
- Контролы по `data_type`: `Input`, `NumberInput`, `DatePicker`, `DateTimePicker`, `TimePicker`, year-`Select`, `Select`/`MultiSelect` по `options.choices`, `Switch`.
- Префилл по `smart-date` (`default_kind`) только если значения сессии ещё нет.
- Сохранение пачкой через RPC `upsert_session_field_values` (уже есть).

### B3. Сверка DOCX-токенов и блок в «Проверке шаблонов»

- В `PackageTemplateValidationPanel` добавляется блок «Поля пакета»:
  - извлекаем `pf-XXXXXX` из DOCX (через существующий `extractDocxPlaceholders`);
  - сверяем с `document_package_field_catalog` пакета;
  - помечаем: `unknown_pf_token`, `pf_token_outside_bound_package`, `pf_without_assignment` (если есть в DOCX, но нет assignment у этого item), `assignment_without_token` (info).
- Никаких авто-исправлений: только список с CTA «Назначить» / «Создать поле».

### B4. Backend required-gate перед генерацией

- В `canonical-document-generate-strict` (или текущей оркестрации генерации пакета) добавляется precheck:
  - собрать effective-required для item: `catalog.required` с учётом `assignment.is_required_override`;
  - если значения нет в `document_package_session_field_values` и `visibility_mode != 'hidden_with_default'` без `default_kind`, → 422 `{ error: 'pf_required_missing', missing: [{public_id,label,template_item_id}] }`;
  - UI ловит и показывает per-document список незаполненных.
- Snapshot: в `ai_generated_documents.meta.tokens_snapshot.pf` сохраняем `{ public_id, label, data_type, raw_value, rendered_value, default_kind_applied }` для каждого `pf-`, использованного в DOCX. Это и есть «подтверждённый snapshot по pf-».

### B5. Регрессии и тесты

- Resolver-тесты (см. A4) дополняются интеграционным smoke: один документ с `ln-`, `FLD-`, `pf-` одновременно — все три типа резолвятся в одном проходе.
- UI vitest для `PackageFieldsAssignmentPanel`: дедупликация и bulk-assign.
- Runtime UAT в preview: создать поле → назначить шаблону → заполнить в анкете → сгенерировать пакет → проверить, что в DOCX подставлено и snapshot есть. Скрин/лог в proof.

### B6. Memory

- Создаём `mem://architecture/documents/package-custom-fields-v1` с инвариантами:
  - SOT поля = `document_package_field_catalog`; назначения = `document_package_item_field_assignments`; значения = `document_package_session_field_values`;
  - namespace `{{pf-XXXXXX}}`, scope = `package_template_id`, кросс-пакет запрещён;
  - резолвер-приоритет `ln-` → `pf-` → `package.{ul|ip|fl}.FLD-XXXXXX` → ошибка;
  - канон UI: вкладка «Роли и поля пакета», дедуп вопросов по `field_catalog_id`, bulk «во всех документах пакета», auto-assign на новые items;
  - backend required-gate + snapshot `meta.tokens_snapshot.pf` обязательны;
  - `FLD-`, `ln-`, billing/role pipelines не изменяются.
- Добавляем ссылку в `mem://index.md` (раздел Memories).

## DoD первого закрытия патча

- Все секции A1–A5 в proof-файле с реальными данными.
- B1–B4 реализованы и проходят resolver+UI тесты.
- Runtime UAT: создано поле, заполнено, сгенерирован документ, snapshot зафиксирован.
- `mem://index.md` обновлён.
- Нет регрессий `ln-` и `{{field:FLD-…}}` (доказано тестами и smoke).

## Что НЕ трогаем

- `document_package_role_catalog`, `document_package_item_role_assignments`, `ln-` namespace.
- `fields_registry`, `document_token_registry`, `document_package_token_aliases`, billing FLD pipeline.
- Gotenberg, `canonical-document-generate-strict` ядро (правим только precheck-обвязку и snapshot-запись).
- Структуру `ai_generated_documents` (только новый ключ в `meta`).

Подтвердите план — стартую с секции A (доказательства) параллельно с B1, дальше последовательно B2 → B3 → B4 → B5 → B6.