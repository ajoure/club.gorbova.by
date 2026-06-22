## да, согласен, с учетом правок:

1. Stage E.3 можно выполнять как отдельный syntax + validator + dry-run слой.
  &nbsp;
  Итоговый статус после выполнения должен быть строго:
  ```text
  Stage E.3 — PASS: classifier / validator / dry-run support для tableRepeat marker
  ```
  Без заявлений, что строки DOCX уже реально размножаются.
2. В scope E.3 не включать `canonical-document-generate-strict`.
  &nbsp;
  Это правильно. Реальное применение `{{tableRepeat:TR-XXXXXX}}` к `word/document.xml` остаётся только на E.4.
3. В scope E.3 не включать `ai-generate-document-package`.
  &nbsp;
  Если для dry-run достаточно `package-tokens-dry-run` + read из `document_package_template_items.metadata.table_repeats`, не трогать orchestrator генерации документов.
4. В `package-tokens-dry-run` TR-preview должен быть super_admin/admin-only так же строго, как текущий dry-run.
  &nbsp;
  Не ослаблять:
  - JWT check;
  - RBAC;
  - rate-limit 5s;
  - audit.
5. В audit `package_tokens_dry_run` запрещено писать значения из таблицы preview.
  &nbsp;
  Писать только summary:
  ```text
  token kind
  tr_id
  rows_count
  codes counter
  error/warning codes
  ```
  Не писать ФИО, паспорта, custom values, голоса, адреса.
6. Уточнить, как dry-run возвращает `package_table_repeat`.
  &nbsp;
  Поскольку обычные token resolvers возвращают строку/value, а TR возвращает структуру, response schema `package-tokens-dry-run` должна явно поддерживать structured result:
  ```json
  {
    "token": "{{tableRepeat:TR-000001}}",
    "kind": "package_table_repeat",
    "resolved": true,
    "value": null,
    "preview": {
      "tr_id": "TR-000001",
      "rows_count": 3,
      "columns": [],
      "rows_preview": []
    }
  }
  ```
  Не пытаться запихнуть table preview в строковое `value`.
7. Если текущий UI dry-run ожидает только строковый `value`, не ломать его.
  &nbsp;
  Добавить отдельную ветку рендера:
8. Для `rows_preview` ограничение ≤5 строк подтверждаю.
  &nbsp;
  Также добавить ограничение по длине значения в ячейке, например:
  ```text
  max 200 символов на cell.value
  ```
  Чтобы dry-run preview не тащил огромные тексты/адреса/паспортные блоки в UI.
9. Для `rows_preview` не показывать чувствительные данные в audit, но в UI super_admin preview показывать можно.
  &nbsp;
  В proof явно разделить:
10. В `resolveTableRepeatTokenCore` нельзя переиспользовать `resolveLnCustomToken` как готовую функцию, если она применяет scalar multi-policy.

Для table-repeat по каждой строке нужен per-assignment context:

```text
текущий assignment → metadata.custom[key]
```

А не scalar resolver роли, который при 3 assignments даст `multiple_persons_for_scalar_role_custom_field`.

Поэтому правильно:

- использовать общие helper/spec для чтения custom values;
- не вызывать scalar `resolveLnCustomToken` напрямую для `assignment_custom_field`;
- иначе table preview сломается на нормальном сценарии 3 участников.

11. То же для `role_person`.

Не вызывать scalar `ln-000015.passport_number_full`, если он применяет multi-policy. Нужно рендерить sub-field по конкретному `person` текущей строки.

Допустимо переиспользовать низкоуровневый helper `renderLnSubField(person, subField, format/case)`, если он не зависит от scalar multi-policy.

12. Для `package_field` можно использовать существующий pf resolver/value bag, но помнить: значение одинаковое для всех строк.

В preview можно показывать одно и то же значение в каждой строке, но в columns добавить hint:

```text
package_field_same_for_all_rows
```

13. Для `assignment_metadata` в dry-run:

- если request user не super_admin → `tr_metadata_source_super_admin_only`;
- если super_admin → читать только `assignment.metadata[source_key]`, но не `metadata.custom`, потому что для custom есть отдельный source_type.

14. `assignment_metadata` должен оставаться advanced fallback.

В proof показать, что обычный admin не видит/не использует этот source в UI, если это уже реализовано на E.2.

15. В classifier `tableRepeat:TR-000001|format=text` лучше фиксировать как invalid / unknown modifier.

Рекомендация:

```text
invalid_table_repeat_modifier
```

Но если текущая система не имеет таких granular codes, допустимо `invalid`. Главное — не считать valid.

16. В `evaluatePlaceholderInScope` для `scope='unknown'` можно считать marker syntactically valid, но в UI всё равно показывать, что он требует package item context для dry-run.

То есть:

```text
syntax ok
dry-run needs package_template_item_id
```

17. `validateTableRepeatMarkersInTemplate` должен быть pure helper без I/O — подтверждаю.

Но уточнить источник `templateText`:

- если это extracted text из DOCX, ок;
- если это plain template body, ок;
- если template file не загружен/недоступен, validator должен возвращать neutral state, а не error.

18. Код `unknown_tr_id` должен относиться только к marker в template, которого нет в current item metadata.table_repeats.

Не искать TR-id глобально по другим items.

19. `duplicate_tr_marker_in_template` как warning подтверждаю.

Но в proof указать поведение будущего E.4:

```text
каждое вхождение одного TR будет разворачиваться одинаково
```

Если это ещё не утверждено для E.4, оставить как warning без final runtime promise.

20. `tr_config_has_errors` должен агрегировать только errors из `validateTableRepeatConfig`.

Warnings типа orphan custom key не должны блокировать marker validation, но должны быть видны как warning.

21. В UI `TableRepeatsEditor` бейдж «не найден в шаблоне» требует доступа к template text.

Если в текущей карточке документа нет template text / extracted tokens, не делать новый тяжёлый fetch. Тогда показать бейдж только если template text уже доступен. Иначе:

```text
Проверка наличия маркера будет доступна после загрузки/валидации шаблона
```

22. Dry-run кнопка должна быть super_admin only.

Если пользователь admin, но не super_admin, кнопка скрыта или disabled с tooltip. Не расширять права.

23. В proof добавить проверку, что `package_template_item_id` обязателен.

Вызов dry-run с TR token без `package_template_item_id` должен вернуть:

```text
tr_no_template_item
```

24. В proof добавить проверку `tr_id_not_found`.

Вызов:

```text
{{tableRepeat:TR-999999}}
```

в контексте item, где такого config нет, должен вернуть:

```text
tr_id_not_found
```

25. В proof добавить проверку `tr_role_has_no_assignments`.

Создать/использовать TR-config с ролью без активных assignments или временно проверить на такой роли.

26. В proof по regression обязательно проверить, что E.1a custom scalar dry-run не сломан:

```text
{{ln-000015.custom.votes}}
```

Должен вести себя как после E.1a.

27. Не расширять глобальный `packagePlaceholderCatalog` TR-токенами без item context.

План правильно фиксирует, что глобальный каталог не расширяется. Сохранить это.

28. Если TR markers добавлены в локальный UI E.2, не называть это global placeholder catalog.

Это item-level config marker, а не универсальный placeholder.

29. В proof `HARDCODED_ENABLED=false` можно проверить только если этот флаг реально существует в файле и уже контролируется проектом.

Если его нет или название другое — не добавлять новый флаг, а указать фактический guard, который есть.

30. После E.3 дать отдельный отчёт и не переходить к E.4 без подтверждения.

После этих правок Stage E.3 можно выполнять.

План: Stage E.3 — classifier / validator / dry-run support для `{{tableRepeat:TR-XXXXXX}}`

### Prerequisites (зафиксировать в proof)

- PATCH-DPIRA-METADATA-MERGE-V1 — PASS
- Stage E.1 — PASS
- Stage E.1a — PASS (`.lovable/proofs/docx_table_repeat_by_role_e1a_custom_fields.md`)
- Stage E.2 — PASS (`.lovable/proofs/docx_table_repeat_by_role_e2_ui_config.md`)

### Scope (что входит)

Чистый «syntax + dry-run» слой для `{{tableRepeat:TR-XXXXXX}}`. Никакой DOCX row-expansion, никакой записи в snapshot/ai_generated_documents/storage, никакого касания `canonical-document-generate-strict` и `save_session_document_atomic`.

#### 1. Classifier — новый kind `package_table_repeat`

Файлы (frontend + edge mirror, parity сохраняется):

- `src/lib/documents/placeholderClassifier.ts`
- `supabase/functions/_shared/placeholderClassifier.ts`

Изменения:

- Добавить тип:
  ```ts
  | { kind: 'package_table_repeat'; public_id: string /* TR-XXXXXX */ }
  ```
- Regex `RE_PACKAGE_TABLE_REPEAT = /^tableRepeat:(TR-\d{6,})$/` (без модификаторов в v1).
- Проверять ДО `RE_PACKAGE_ROLE_SUB` / `RE_PACKAGE_FIELD`.
- В `evaluatePlaceholderInScope`:
  - `scope='billing'` → `package_token_outside_package_context`;
  - `scope='package'|'unknown'` → синтаксически валиден (`ok`).
- Реальный gate «TR-id существует в `metadata.table_repeats[]`» делается отдельным валидатором (см. §2) — НЕ внутри classifier.

#### 2. Template-level validator `validateTableRepeatMarkersInTemplate`

Файлы:

- `src/lib/documents/tableRepeatSpec.ts` (+ edge mirror `supabase/functions/_shared/table-repeat-spec.ts`)

Pure helper, без I/O. Вход:

- `templateText: string`
- `configs: TableRepeatConfig[]` (из `document_package_template_items.metadata.table_repeats`)

Выход — массив `TableRepeatMarkerIssue` с кодами:

- `unknown_tr_id` (error) — marker ссылается на TR-XXX, которого нет в configs текущего item;
- `duplicate_tr_marker_in_template` (warn) — один TR-id встречается в шаблоне >1 раза (v1 — predictable: каждое вхождение раскроется одинаково; warn, не блокер);
- `tr_config_has_errors` (error) — TR-id есть, но `validateTableRepeatConfig` возвращает severity='error' (агрегируем).

Используется в admin UI `TableRepeatsEditor` / preview panel `PackageDocumentCard.tsx` (только UI-индикация, без правок логики save).

#### 3. Dry-run resolver через `package-tokens-dry-run`

Файлы:

- `supabase/functions/package-tokens-dry-run/index.ts`
- `supabase/functions/_shared/resolve-package-tokens.ts` (добавить `resolveTableRepeatTokenCore` рядом с `resolveLnCustomToken`)

Контракт:

- Input — те же `alias_tokens[]`. Если token классифицируется как `package_table_repeat`, маршрутизация в новый `resolveTableRepeatTokenCore({ trId, packageSessionId, packageTemplateItemId, supabase })`.
- `packageTemplateItemId` обязателен для TR-токенов (как и для `ln-*.custom.*`). Без него — `code: 'tr_no_template_item'`.
- Resolver читает `document_package_template_items.metadata.table_repeats[]`, находит конфиг по `trId`.
- Source-of-rows: активные `document_package_item_role_assignments` для пары `(packageTemplateItemId, role_catalog_id)` — те же правила, что в E.2 preview.
- Возвращает **превью-структуру** (НЕ строку):
  ```ts
  {
    resolved: true,
    kind: 'table_repeat',
    tr_id: 'TR-000001',
    role_catalog_id: '...',
    rows_count: N,
    columns: [{ cell_index, source_type, source_key, sample_value, sample_code }],
    rows_preview: [ /* до 5 строк, каждая колонка с resolved-значением или кодом */ ]
  }
  ```
  `sample_value`/`rows_preview` ограничены первыми 5 назначениями, длина каждой строки — N колонок конфига.
- Колоночные source_type'ы переиспользуют существующих сабрезолверов:
  - `role_person` → существующий ln-резолвер (person по `assignment.person_id`);
  - `assignment_custom_field` → существующий `resolveLnCustomToken` (logic only, без выпуска отдельного токена);
  - `package_field` → существующий pf-резолвер;
  - `static_text` → литерал;
  - `row_number` → 1..N;
  - `empty` → пустая строка;
  - `assignment_metadata` → защитный код `tr_metadata_source_super_admin_only` если кто-то поднимет конфиг без super_admin контекста (dry-run super_admin — пропускается).

Новые коды в `PackageTokenResolveCode`:

- `tr_no_template_item`
- `tr_id_not_found`
- `tr_role_has_no_assignments`
- `tr_config_invalid` (агрегат validateTableRepeatConfig errors)
- `tr_column_resolve_failed` (внутри одной ячейки — фиксируется в `rows_preview[].cells[i].code`, верхний уровень остаётся resolved=true)

Audit `package_tokens_dry_run` дополняется codes-counter этих новых кодов. Значения колонок (`sample_value`/`rows_preview.cells[].value`) **не** пишутся в audit — только summary by code.

#### 4. UI: индикация TR-маркеров в admin

Файл `src/components/ai-documents/packages/TableRepeatsEditor.tsx` (расширение, без изменения контракта save):

- Бейдж «не найден в шаблоне» (если TR-id не встречается в template text) — warning;
- Бейдж «есть в шаблоне Nx» — info;
- Кнопка «Dry-run preview» (super_admin only) на конфиге — открывает диалог с результатом `package-tokens-dry-run` для `{{tableRepeat:TR-...}}` в контексте выбранной session (тот же `packageSessionId` UI-флоу, что в E.1a custom preview).

### Что **не** входит в E.3 (зафиксировать в proof)

- DOCX row expansion / реальная подстановка в `.docx` → Stage E.4;
- Любые изменения `canonical-document-generate-strict`, `save_session_document_atomic`, `ai-generate-document-package`;
- Любые миграции БД;
- Любые SECURITY DEFINER функции;
- Глобальный `packagePlaceholderCatalog` не расширяется TR-токенами (catalog v1 — только tokens, раскрывающиеся в строку);
- Контракт хранения `metadata.table_repeats[]` не меняется;
- RLS/GRANT не меняются.

### Файлы (план изменений)

Изменяются:

- `src/lib/documents/placeholderClassifier.ts`
- `supabase/functions/_shared/placeholderClassifier.ts`
- `src/lib/documents/tableRepeatSpec.ts`
- `supabase/functions/_shared/table-repeat-spec.ts`
- `supabase/functions/_shared/resolve-package-tokens.ts` (+ новый `resolveTableRepeatTokenCore`)
- `supabase/functions/package-tokens-dry-run/index.ts` (routing + поддержка TR-результата в response)
- `src/components/ai-documents/packages/TableRepeatsEditor.tsx` (бейджи + dry-run кнопка, super_admin)
- `.lovable/plan.md` (прогресс)

Создаётся:

- `.lovable/proofs/docx_table_repeat_by_role_e3_classifier_dryrun.md`

### Proof (что обязательно показать)

- Ссылки на закрытые prerequisites (E.1 / E.1a / E.2 / metadata-merge).
- Classifier parity: одинаковый вывод frontend и edge для набора входов: `tableRepeat:TR-000001`, `tableRepeat:TR-XYZ`, `tableRepeat:TR-000001|format=text` (последний — `invalid` или `unknown_modifier`, фиксируем выбор), `tableRepeat:TR-000001` в `billing` scope → `package_token_outside_package_context`.
- Template validator: пример с unknown TR-id, duplicate marker, валидным конфигом.
- Dry-run end-to-end: вызов `package-tokens-dry-run` с TR-токеном на реальной сессии:
  - rows_count совпадает с UI preview из E.2;
  - rows_preview содержит ≤5 строк, длиной = number of columns;
  - audit-row `package_tokens_dry_run` создан, значения не утекли (только codes counter).
- Регресс: `field:FLD-…`, `package.ul.FLD-…`, `ln-…`, `pf-…`, `ln-….custom.…` продолжают резолвиться идентично E.1a.
- Подтверждения:
  - `save_session_document_atomic` сигнатура и тело не изменены;
  - `canonical-document-generate-strict` не изменён;
  - миграций нет;
  - `HARDCODED_ENABLED=false` в `resolve-package-tokens.ts` без изменений;
  - новых SECURITY DEFINER функций нет;
  - RLS/GRANT не менялись;
  - super_admin gate в `package-tokens-dry-run` не ослаблен;
  - rate-limit 5s сохраняется;
  - E.4 (DOCX expansion) НЕ начинался.

### DoD

- Все 4 пачки изменений (classifier / template validator / dry-run resolver / UI бейдж+кнопка) реализованы и parity-совместимы.
- Proof собран и содержит все пункты выше.
- Отдельный отчёт `PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.3 — PASS / PARTIAL / FAIL`.
- Возврат к Stage E.4 — только после явного подтверждения PASS пользователем.