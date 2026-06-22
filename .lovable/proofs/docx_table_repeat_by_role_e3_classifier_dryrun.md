# PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.3 — classifier / validator / dry-run support для `{{tableRepeat:TR-XXXXXX}}`

**Статус:** PASS (PROOF, dry-run / structured-only слой).

## Prerequisites (закрыты ранее)

- PATCH-DPIRA-METADATA-MERGE-V1 — PASS (`save_session_document_atomic` сохраняет custom/position_gender/enable_person_subfields).
- Stage E.1 — PASS.
- Stage E.1a — PASS (`.lovable/proofs/docx_table_repeat_by_role_e1a_custom_fields.md`).
- Stage E.2 — PASS (`.lovable/proofs/docx_table_repeat_by_role_e2_ui_config.md`).

## Что реализовано (scope E.3)

### 1. Classifier — новый kind `package_table_repeat`

Зеркальные изменения:

- `src/lib/documents/placeholderClassifier.ts`
- `supabase/functions/_shared/placeholderClassifier.ts`

Добавлено:

- Union member `{ kind: 'package_table_repeat'; public_id: string }`.
- Regex `RE_PACKAGE_TABLE_REPEAT = /^tableRepeat:(TR-\d{6,})$/`.
- Match-блок в `classifyPlaceholder` ВЫШЕ `RE_PACKAGE_ROLE_CUSTOM` (исключает любые коллизии с `ln-` regex).
- `evaluatePlaceholderInScope` — `package_table_repeat` ведёт себя как package-aware токен: `scope='billing'` → `package_token_outside_package_context`; `scope='package'|'unknown'` → `ok`.

Поведение по входам:

| inside                                    | classifyPlaceholder.kind             | evaluatePlaceholderInScope('package') |
| ----------------------------------------- | ------------------------------------ | -------------------------------------- |
| `tableRepeat:TR-000001`                   | `package_table_repeat`               | `ok`                                   |
| `tableRepeat:TR-XYZ`                      | `invalid`                            | `legacy_placeholder_format_detected`   |
| `tableRepeat:TR-000001\|format=text`      | `invalid`                            | `legacy_placeholder_format_detected`   |
| `tableRepeat:TR-000001` (`scope=billing`) | `package_table_repeat`               | `package_token_outside_package_context` |
| `field:FLD-000001`                        | `field`                              | `ok` (регрессия не задета)             |
| `ln-000015`                               | `package_role`                       | `ok`                                   |
| `ln-000015.custom.votes`                  | `package_role_custom_field`          | `ok` (E.1a регрессия не задета)        |
| `pf-000001`                               | `package_field`                      | `ok`                                   |
| `package.ul.FLD-000001`                   | `package_requisite`                  | `ok`                                   |

Parity frontend ↔ edge mirror: оба файла получили идентичные блоки (union, regex, match-блок). Существующий parity-test на классификатор покрывает оба зеркала.

### 2. Template-level validator `validateTableRepeatMarkersInTemplate`

Зеркальные изменения:

- `src/lib/documents/tableRepeatSpec.ts`
- `supabase/functions/_shared/table-repeat-spec.ts`

Pure helper, без I/O. Контракт:

- `unknown_tr_id` (error) — marker есть в шаблоне, но конфиг с таким TR-id отсутствует **в текущем `item.metadata.table_repeats`** (НЕ ищет глобально).
- `duplicate_tr_marker_in_template` (warn, occurrences=N) — один TR-id встречается >1 раза.
- `tr_config_has_errors` (error) — TR-id есть, но `validateTableRepeatConfig` вернул хотя бы один error; warnings типа `orphan_custom_key` НЕ блокируют (как и требовалось).
- Пустой `templateText` → `[]` (neutral state).

Примеры:

- `templateText = "Стороны: {{tableRepeat:TR-999999}}"`, configs `[{ id: "TR-000001", ... }]` → `unknown_tr_id` (severity=error, occurrences=1).
- `templateText = "{{tableRepeat:TR-000001}} ... {{tableRepeat:TR-000001}}"`, configs содержат `TR-000001` → `duplicate_tr_marker_in_template` (severity=warn, occurrences=2).
- TR-id есть в configs, но `validateTableRepeatConfig` вернул `missing_role` → `tr_config_has_errors` (error, `cfg_errors` агрегирует).

### 3. Dry-run resolver `resolveTableRepeatTokenCore` + structured response

Изменения:

- `supabase/functions/_shared/resolve-package-tokens.ts` — добавлен `resolveTableRepeatTokenCore`, типы `TableRepeatResolveResult` / `TableRepeatCellPreview` / `TableRepeatRowPreview` / `TableRepeatColumnSummary`, импорт `table-repeat-spec.ts`.
- `supabase/functions/package-tokens-dry-run/index.ts` — роутинг: классифицируем `inside`, при `package_table_repeat` → отдельный resolver, иначе legacy `resolvePackageTokenCore`. Response schema поддерживает оба варианта:
  - `{ alias_token, kind: 'scalar', resolved, value, ... }`
  - `{ alias_token, kind: 'package_table_repeat', resolved, value: null, preview: { tr_id, role_catalog_id, role_key, rows_count, rows_preview_limit: 5, rows_preview_truncated, columns: [...], rows_preview: [...] } }`
- Не сломал scalar UI: scalar branch продолжает возвращать `value: string` как раньше; новый `kind` — отдельная ветка рендера.

Ключевые контракты резолвера:

- `packageTemplateItemId` обязателен → `tr_no_template_item`.
- TR-id отсутствует в `item.metadata.table_repeats` → `tr_id_not_found`.
- Конфиг невалиден (error из `validateTableRepeatConfig`) → `tr_config_invalid` + `issues[]`.
- Роль из чужого пакета → `tr_config_invalid` (`role_outside_bound_package`).
- 0 active assignments → `tr_role_has_no_assignments`.
- ≥1 assignment → `resolved: true`.

Per-row context (amendment 10/11): **не вызываем** scalar `resolveLnCustomToken`/`resolveLnSubFieldToken` — там multi-policy выдала бы `multiple_persons_for_scalar_role_*` на нормальной таблице с 2+ участниками. Вместо этого:

- `role_person` → пер-assignment рендер через низкоуровневый `extractLnSubFieldRaw` + `formatPersonName`/`formatLnDate`/`inflectRu` (без scalar multi-policy).
- `assignment_custom_field` → прямое чтение `assignment.metadata.custom[key]` для текущей строки.
- `package_field` → резолвится **один раз** через существующий `resolvePfFieldToken`, значение повторяется в каждой строке, в columns/cell ставится hint `package_field_same_for_all_rows`.
- `static_text` → литерал из `source_key`.
- `row_number` → `1..N` (по индексу строки в preview).
- `empty` → пустая строка.
- `assignment_metadata` → super_admin-only (dry-run и так super_admin); читает `assignment.metadata[source_key]` исключая `custom` (`tr_metadata_custom_not_allowed_via_metadata_source`).

Ограничения preview (amendment 8):

- `TABLE_REPEAT_PREVIEW_MAX_ROWS = 5` (`rows_preview_truncated: boolean` сообщает, что real `rows_count` больше).
- `TABLE_REPEAT_CELL_VALUE_MAX_CHARS = 200` (`cell.truncated = true` + хвост `…`).

Audit (amendment 5):

- `package_tokens_dry_run` строка содержит `meta.table_repeats: [{ tr_id, rows_count, codes, resolved, code? }]` + общий `codes` counter; **значения** ячеек (ФИО, паспорта, custom values) и `rows_preview` НЕ сериализуются.
- Чувствительные данные показываются только в UI super_admin preview (Dialog рендерит JSON.stringify result, который НЕ пишется в audit).

### 4. UI — Dry-run button в `TableRepeatsEditor`

- `TableRepeatsEditor` принимает новый prop `packageSessionId: string`. `PackageDocumentCard` передаёт `sessionId`.
- Кнопка "Dry-run preview" с иконкой `FlaskConical` — рендерится только при `isSuperAdmin`. Обычный admin её не видит (amendment 22).
- При клике вызывает `supabase.functions.invoke('package-tokens-dry-run', { body: { package_session_id, package_template_item_id, alias_tokens: ['{{tableRepeat:TR-...}}'] } })`.
- Результат / ошибка показываются в `Dialog` как JSON (для super_admin).
- Бейдж "найден в шаблоне" сейчас не показан: editor не получает template text. Это намеренно — amendment 21: не делать тяжёлый fetch ради бейджа. Когда вызывающий хочет показать бейдж, он будет использовать `validateTableRepeatMarkersInTemplate` со своим templateText (Stage E.4 подключит).

## Что **не** входит в E.3 (и не было затронуто)

- `canonical-document-generate-strict` — не изменён; реальная DOCX-подстановка → Stage E.4.
- `ai-generate-document-package` — не изменён.
- `save_session_document_atomic` — сигнатура и тело не изменены.
- Миграций нет.
- Новых SECURITY DEFINER функций нет.
- `HARDCODED_ENABLED=false` в `resolve-package-tokens.ts` сохранён — production-вход через `resolvePackageToken` по-прежнему возвращает `feature_off`. `resolveTableRepeatTokenCore` явно НЕ guarded флагом, потому что её зовёт ТОЛЬКО `package-tokens-dry-run` (super_admin + rate-limit + audit). Импорт `resolveTableRepeatTokenCore` в production-пайплайн запрещён теми же правилами, что и `resolvePackageTokenCore`.
- RLS / GRANT / роли не менялись.
- Глобальный `packagePlaceholderCatalog` не расширялся TR-токенами — TR это item-level config marker, а не общий placeholder (amendment 27/28).
- Super_admin gate, JWT, rate-limit 5s в `package-tokens-dry-run` сохранены.

## End-to-end проверки (DoD)

- `tableRepeat:TR-000001` (валидный конфиг, 3 participants) → `kind: 'package_table_repeat'`, `resolved: true`, `rows_count: 3`, `rows_preview.length === 3`, каждая строка имеет N ячеек (= число колонок конфига), значения для assignment_custom_field берутся **per-row** (не падают на `multiple_persons_*`). `audit_logs.package_tokens_dry_run` создан, значения **не** утекли.
- `tableRepeat:TR-999999` без конфига → `resolved: false`, `code: 'tr_id_not_found'`.
- Вызов без `package_template_item_id` → `code: 'tr_no_template_item'`.
- Конфиг с ролью без assignments → `code: 'tr_role_has_no_assignments'`.
- Конфиг с `missing_role` → `code: 'tr_config_invalid'` + `issues[]`.
- Регрессия E.1a: `{{ln-000015.custom.votes}}` продолжает резолвиться через `resolveLnCustomToken` идентично до E.3 (scalar branch, `kind: 'scalar'`).
- Регрессия legacy: `field:FLD-XXXXXX`, `package.ul.FLD-XXXXXX`, `ln-XXXXXX`, `pf-XXXXXX` — `kind: 'scalar'`, поведение не изменено.

## Файлы

Изменены:

- `src/lib/documents/placeholderClassifier.ts`
- `supabase/functions/_shared/placeholderClassifier.ts`
- `src/lib/documents/tableRepeatSpec.ts`
- `supabase/functions/_shared/table-repeat-spec.ts`
- `supabase/functions/_shared/resolve-package-tokens.ts`
- `supabase/functions/package-tokens-dry-run/index.ts`
- `src/components/ai-documents/packages/PackageDocumentCard.tsx` (+ prop `packageSessionId`)
- `src/components/ai-documents/packages/TableRepeatsEditor.tsx`
- `.lovable/plan.md`

Создано:

- `.lovable/proofs/docx_table_repeat_by_role_e3_classifier_dryrun.md` (этот файл).

## Итог

**PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.3 — PASS: classifier / validator / dry-run support для `{{tableRepeat:TR-XXXXXX}}`.**

Не заявляется, что строки DOCX уже реально размножаются. Stage E.4 — отдельным планом и отдельным отчётом, только после явного PASS-подтверждения по E.3.
