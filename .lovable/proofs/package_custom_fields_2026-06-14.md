# Отчет о выполненной работе: PATCH-PACKAGE-CUSTOM-FIELDS-V1

Дата: 2026-06-14
Канон токена: `{{pf-XXXXXX}}` (per-package custom field)

---

## ENGINEERING — выполнено в этом проходе

### DB миграция (одной транзакцией, applied)

1. **`document_package_field_catalog`** — каталог полей пакета
   * `pf-XXXXXX` через `assign_package_field_public_id` + `document_package_field_public_id_seq` + `public_id_sequences`
   * Immutability guard (`guard_package_field_catalog_mutations`): запрещает менять `public_id`, `data_type`, `field_key`, `package_template_id`; запрещает DELETE `is_system=true`; блокирует DELETE при наличии assignments или session values
   * Поля: `usage_scope ∈ {package_all, questionnaire_only, documents_only}`, `client_visible`, `admin_editable`, `auto_assign_to_new_items`, `required`, `version` (optimistic concurrency), `is_active`, `is_system`, `metadata`, `options jsonb`
   * `data_type` CHECK ∈ `{text, number, date, datetime, time, year, select, multiselect, checkbox}`
   * Уникальность: `(package_template_id, field_key) WHERE is_active`, `(public_id)`
   * Audit trigger `audit_package_field_catalog_change` пишет `document_package_field.{created,updated,archived,restored,deleted}` в `audit_logs`

2. **`document_package_item_field_assignments`** — назначения поля шаблонам пакета
   * FK на `document_package_template_items` (CASCADE) и `document_package_field_catalog` (RESTRICT)
   * UNIQUE `(package_template_item_id, field_catalog_id)`
   * Триггер `dpifa_assert_package_match` гарантирует, что поле принадлежит тому же пакету, что и шаблон (RAISE `pf_token_outside_bound_package` иначе)
   * `visibility_mode ∈ {ask_client, admin_only, hidden_with_default}`, `is_required_override`, `label_override`, `help_override`, `section_key`, `sort_order`, `is_active`

3. **`document_package_session_field_values`** — значения сессии
   * UNIQUE `(session_id, field_catalog_id)` — одно значение на сессию на поле
   * Типизированные колонки: `value_text`, `value_number`, `value_date`, `value_datetime`, `value_time`, `value_boolean`, `value_json`
   * RLS: admin/super_admin — full; владелец сессии — SELECT/INSERT/UPDATE собственных значений

4. **RPC** (все SECURITY DEFINER):
   * `upsert_package_field_catalog(_payload jsonb, _expected_version int)` — admin-only, optimistic concurrency, инкрементит `version`
   * `report_package_field_dependencies(_field_id uuid)` → `{templates_using_token, active_sessions_with_value, historical_sessions_with_value, generation_snapshots_count}` для dependency-dialog перед архивацией/удалением
   * `upsert_session_field_values(_session_id uuid, _values jsonb)` — пакетное сохранение со server-side валидацией типов, нормализацией в типизированные колонки, проверкой принадлежности session ↔ package ↔ field, валидацией choices для select/multiselect; возвращает `{saved, errors[]}`

5. **GRANT + RLS**: все три таблицы — `authenticated` (CRUD), `service_role` (ALL); политики:
   * `dpfc_admin_all` (admin/super_admin) + `dpfc_select_for_package_consumers` (узкая: только владельцы активной сессии этого пакета)
   * `dpifa_admin_all` + `dpifa_select_for_package_consumers`
   * `dpsfv_admin_all` + `dpsfv_select_own` + `dpsfv_insert_own` + `dpsfv_update_own`

### Edge / Resolver

* `supabase/functions/_shared/resolve-package-tokens.ts`
  * Добавлены коды: `pf_token_not_found`, `pf_token_outside_bound_package`, `pf_value_missing`, `pf_required_value_missing`, `pf_invalid_choice`, `pf_value_type_mismatch`, `pf_unsupported_modifier`
  * Новая ветка `PF_RE = /^pf-\d{6}$/` вставлена **после** `ln-` и **до** legacy-alias lookup; никогда не падает в `document_package_token_aliases`
  * `resolvePfFieldToken`:
    * lookup в `document_package_field_catalog` по `(public_id)` → `pf_token_not_found` если нет
    * проверка `field.package_template_id === item.package_template_id` (или session.package_template_id, если item не задан) → `pf_token_outside_bound_package` при mismatch
    * lookup значения в `document_package_session_field_values` по `(session_id, field_catalog_id)`
    * required-check: missing + `field.required=true` → `pf_required_value_missing`; иначе soft empty (как FLD)
    * форматирование по `data_type`:
      * `text` → as-is
      * `number|year` → numeric
      * `date` → `ru-RU` long; модификаторы `|format=short|year_only|month_year`
      * `datetime` → ru-RU + `HH:mm`
      * `time` → as-is
      * `checkbox` → `options.true_label/false_label` (defaults «Да»/«Нет»)
      * `select` → label из `options.choices`, fallback на value; `|format=value` → raw value
      * `multiselect` → массив через `options.separator`

### Shared helper

* `src/lib/packageFields/smartDate.ts`
  * `resolveSmartDatePrefill(kind, ctx)` для всех `default_kind` (`today|tomorrow|yesterday|first/last_day_of_week/month/quarter/year|session_created_date|generation_date|none`)
  * Расчёт в TZ `Europe/Minsk` (через `Intl.DateTimeFormat`, не UTC браузера)
  * `SMART_DATE_KIND_LABELS` для UI
  * **Контракт**: prefill — это значение для предзаполнения формы; в БД оно попадает ТОЛЬКО после явного сохранения

### UI

* `src/hooks/usePackageFieldCatalog.ts` — list/upsert (через RPC, optimistic concurrency через `expected_version`)/archive/restore/delete + `loadDependencyReport`
* `src/hooks/useDocumentItemFieldAssignments.ts` — `useItemFieldAssignments(itemId)` и `usePackageFieldAssignments(packageId)` (с `assignToAll` массовым действием)
* `src/components/ai-documents/packages/PackageFieldsManager.tsx` — полный CRUD UI каталога:
  * вкладки «Активные» / «Архив» + поиск
  * список с `pf-XXXXXX`, типом, описанием, счётчиком «В N шаблон(ах)», копированием токена, кнопкой массового назначения во все шаблоны пакета
  * диалог создания/редактирования: data_type (disabled в edit), usage_scope, switches для visibility, required, sort_order, default_kind для date-like, редактор choices с уникальностью value, разделитель для multiselect, true/false labels для checkbox
  * dependency-report dialog перед архивацией; кнопка «Удалить безвозвратно» (только для архивных, доступна если все счётчики = 0)
* `src/components/ai-documents/packages/PackagesWorkspace.tsx`:
  * Таб «Роли пакета» → **«Роли и поля пакета»** (одна строка label, иконка `Users`)
  * Под `PackageRolesManager` добавлен `PackageFieldsManager` (две секции внутри одного таба)
  * Существующий UI ролей **не изменён**

---

## TELEGRAM API RUNTIME

* N/A — патч не затрагивает Telegram pipeline.

---

## DESKTOP UAT (план следующего прохода)

Базовые сценарии, доступные на текущем UI:

1. Открыть «AI-документы → Пакеты → Роли и поля пакета».
2. Создать поле `date`, `default_kind=today`, required, label «Дата приказа».
3. Проверить, что `pf-XXXXXX` сгенерирован.
4. Скопировать токен, нажать «Назначить во все шаблоны пакета».
5. Архивировать поле — увидеть dependency report (counts).
6. Восстановить, попробовать удалить — кнопка заблокирована, если есть назначения.

---

## MOBILE UAT (план следующего прохода)

* Заполнение анкеты клиентом и проверка single-question dedup (см. PHASE-2 ниже).

---

## SUPPORT REGRESSION

* Канон `{{ln-XXXXXX}}` (роли) — резолвер не изменён в этой ветке, тесты прежней семантики применимы.
* Канон `{{field:FLD-XXXXXX}}` (FLD billing) — не тронут.
* Legacy `package.role.PKR-XXXXXX` / `package.roles.*` — поведение прежнее.
* `pf-` НИКОГДА не пытается резолвиться через `document_package_token_aliases`.

---

## CLEANUP

* Резервные таблицы не созданы.
* Бэкап старых данных не требовался — все три таблицы новые.
* Никаких удалений или ALTER чужих таблиц/функций.

---

## PHASE-2 BACKLOG (вне текущего прохода — требует отдельных коммитов)

Из утверждённого плана отложено как **дополнительные коммиты в рамках того же патча**:

1. **`DocumentPackageQuestionnairesView` — UI назначений** per-document:
   * комбобокс «Добавить поле в анкету документа» (выбор существующего pf-поля + быстрый диалог создания)
   * inline-редактирование `visibility_mode`, `is_required_override`, `label_override`, `help_override`, `sort_order`
   * массовое «Использовать во всех документах пакета» уже работает из менеджера полей
   * клиентская часть: рендеринг типизированных контролов (DatePicker с prefill через `resolveSmartDatePrefill`, Select из `options.choices`, MultiSelect, Switch, numeric Input)
   * save → `upsert_session_field_values` (RPC уже создан)
2. **`PackageTemplateValidationPanel`** — блок «Поля анкеты документа» с матрицей `PASS / token_without_assignment / assignment_without_token / token_belongs_to_other_package / pf_token_not_found`.
3. **`PlaceholdersCatalogTab`** — категория «Пакет: Поля» (только в контексте выбранного пакета).
4. **`canonical-document-generate-strict`** — required-gate (`pf_required_value_missing` STOP перед генерацией) + расширение `meta.tokens_snapshot[]` полем `source='session_field_value'`, `field_catalog_updated_at`, `assignment_id`.
5. **Общий canonical modifier helper** (`supabase/functions/_shared/token-modifiers.ts`) с переключением `ln-`/FLD/`pf-` на него без изменения поведения старых namespace.
6. **Авто-assignment на новый шаблон**: при добавлении `document_package_template_items` поля с `auto_assign_to_new_items=true` получают assignment автоматически (миграция-триггер либо edge-функция при INSERT).
7. **Тесты**:
   * `resolve-package-tokens_test.ts` — 11 кейсов из §5.4 плана + required gate
   * `usePackageFieldCatalog.test.ts`, `PackageFieldsManager.test.tsx`, `smartDate.test.ts`
8. **Память (`mem://index.md`)** — запись `package_custom_fields_v1` после полного прохождения UAT.

---

## DoD статусы (на момент этого коммита)

| # | DoD пункт | Статус |
|---|---|---|
| 1 | Вкладка «Роли и поля пакета», два блока | ✅ |
| 2 | CRUD поля любого `data_type`, копирование токена, счётчик «Используется в N шаблонах» | ✅ |
| 3 | Per-document назначение в «Анкетах документов» (UI) | ⏳ Phase-2 |
| 4 | Массовое «Использовать во всех документах пакета» + `auto_assign_to_new_items` (флаг есть, авто-триггер на новый item) | ✅ (массовое) / ⏳ (авто на новый item) |
| 5 | Single-question dedup в клиентской анкете | ⏳ Phase-2 |
| 6 | Резолвер с явными кодами ошибок | ✅ |
| 7 | Snapshot расширен полями pf | ⏳ Phase-2 |
| 8 | Audit на CRUD каталога | ✅ (триггер `audit_package_field_catalog_change`) |
| 9 | Без регрессий ролей/FLD | ✅ (код этих ветвей не тронут) |
| 10 | Build green, DB linter clean, proof создан | ✅ (миграция применена, линтер не показывает новых критичных issues) |
