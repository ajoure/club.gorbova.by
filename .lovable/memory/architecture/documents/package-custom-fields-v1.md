---
name: Package Custom Fields v1
description: pf-XXXXXX namespace, scope by package_template_id, dedup by field_catalog_id, override-rules, auto-assign trigger, generation gate plan
type: feature
---
PATCH-PACKAGE-CUSTOM-FIELDS-V1.

## SOT
- Поле каталога — `document_package_field_catalog` (public_id `pf-XXXXXX`,
  immutable: `public_id`, `data_type`, `field_key`, `package_template_id`).
- Назначения на шаблон документа — `document_package_item_field_assignments`
  (uniq `(package_template_item_id, field_catalog_id)`, BEFORE-триггер
  `dpifa_assert_package_match` запрещает кросс-пакет-назначение).
- Значения сессии — `document_package_session_field_values`
  (uniq `(session_id, field_catalog_id)`; типизированные колонки
  text/number/date/datetime/time/boolean/json).

## Namespace и резолвер
- Word-токен: `{{pf-XXXXXX}}`.
- Приоритет в `_shared/resolve-package-tokens.ts`:
  `ln-` → `pf-` → `package.{ul|ip|fl}.FLD-…` → `alias_missing` (default-deny).
- Кросс-пакет → `pf_token_outside_bound_package`.
- Каталог отсутствует → `pf_token_not_found`.
- Required без значения → `pf_required_value_missing` (единый код).
- Несовпадение типа → `pf_value_type_mismatch`. Soft-empty для не-required.

## Override-контракт (effective_required)
```
effective_required =
  CASE WHEN assignment.is_required_override IS NOT NULL
       THEN assignment.is_required_override
       ELSE catalog.required
  END
```
`OR`-логика запрещена: override=false должно мочь снять каталоговую
обязательность для конкретного документа.

## Visibility
- `ask_client` — рендерится в клиентской анкете.
- `admin_only` — только в админ-анкете.
- `hidden_with_default` — не рендерится; обязано иметь вычислимый
  default (`default_kind` или `generation_date`); без default — конфиг-
  ошибка, а если required — `pf_required_value_missing`.

## Auto-assign на новые items
- SOT — серверный триггер `trg_dpti_auto_assign_fields`
  AFTER INSERT ON `document_package_template_items`.
- Создаёт назначения для активных полей каталога с
  `auto_assign_to_new_items=true`, `ON CONFLICT DO NOTHING`.
- Клиентский хук не источник истины — только обновление UI.

## UI канон
- Вкладка пакета: «Роли и поля пакета» (роли + `PackageFieldsManager`).
- В аккордеоне «Анкеты документов» под блоком ролей —
  `PackageFieldsAssignmentPanel`: только настройки использования
  (видимость / override обязательности / локальный label / bulk «Во все»),
  без дублирования свойств каталога.
- Клиентская анкета (B2): один вопрос на `field_catalog_id`,
  дедуп по сессии; значение из RPC `upsert_session_field_values`.

## Backend gate (B4, в плане)
- Перед генерацией precheck по effective_required.
- Если значения нет и нет вычислимого default — 422
  `pf_required_value_missing` с per-document списком.
- Snapshot: add-only элементы в `ai_generated_documents.meta.tokens_snapshot[]`
  с `{ provider:'pf', public_id, label, data_type, raw_value, rendered_value,
  default_kind_applied }`. Не создавать параллельный `meta.tokens_snapshot.pf`.

## Что не трогаем
- `ln-` namespace и `document_package_item_role_assignments`.
- billing `{{field:FLD-…}}`, `fields_registry`, `document_token_registry`,
  `document_package_token_aliases`.
- Gotenberg, ядро `canonical-document-generate-strict` (только обвязка
  precheck + snapshot-запись).
