# Да, ты прав. Сейчас не нужно сохранять совместимость со старыми форматами, потому что реальных рабочих шаблонов с этими роль-плейсхолдерами ещё нет. Значит, правильная стратегия: **не поддерживать три формата одновременно**, а сделать один чистый канон и удалить/переписать всё старое.

Главная правка к Sprint 3H: **не deprecated warning, а cleanup старой логики**.



# **Правки к Sprint 3H — убрать старую логику role-placeholder и оставить один канон**

`{{ln-XXXXXX}}`

## **0. Главная правка**

Не нужно сохранять старые форматы role-placeholder как deprecated, потому что реальных заполненных документов и рабочих шаблонов с ними ещё нет.

Старые форматы нужно не поддерживать, а удалить/переписать:

```text
Удалить / не использовать:
{{package.role.PKR-XXXXXX}}
{{package.roles.<role_key>.full_name}}
{{package.roles.<role_key>.position}}
{{package.roles.<role_key>.short_name}}

Оставить единственный канон:
{{ln-XXXXXX}}
```

`PKR-XXXXXX` может оставаться только внутренним ID роли в БД, если он уже используется в `document_package_role_catalog.public_id`, но пользовательский плейсхолдер в Word должен быть только `{{ln-XXXXXX}}`.

---

## **1. Изменить цель Sprint 3H**

Было:

```text
поддержать deprecated форматы как warning
```

Стало:

```text
полностью унифицировать role-placeholder на {{ln-XXXXXX}} и удалить старую role-placeholder логику из UI/каталога/валидатора/резолвера, так как рабочих шаблонов с ней нет
```

---

## **2. Cleanup старых форматов**

### **2.1 UI**

В UI больше нигде не показывать:

```text
{{package.role.PKR-XXXXXX}}
{{package.roles.<role_key>.*}}
```

Проверить и исправить:

- `PlaceholdersCatalogTab`;
- `packagePlaceholderCatalog`;
- `PackageTemplateValidationPanel`;
- `PackageRolesManager`;
- `PackagesWorkspace`;
- любые подсказки, tooltips, examples, empty states;
- proof/memory/plan.

В пользовательском UI везде должно быть только:

```text
{{ln-XXXXXX}}
```

### **2.2 Validator**

Validator должен принимать как рабочий формат только:

```text
{{ln-XXXXXX}}
```

Старые форматы:

```text
{{package.role.PKR-XXXXXX}}
{{package.roles.<role_key>.*}}
```

не нужно считать deprecated warning. Сейчас их можно считать `invalid_legacy_role_placeholder` или `unknown_placeholder`, потому что рабочих документов с ними нет.

Сообщение на русском:

```text
Устаревший формат плейсхолдера роли. Используйте плейсхолдер вида {{ln-XXXXXX}} из группы «Пакет: Роли».
```

Если проще — просто error `invalid_syntax`, но текст должен быть понятным.

### **2.3 Resolver**

Resolver должен работать только с `ln-XXXXXX`.

Если внутри resolver ещё есть ветки для:

```text
package.role.PKR
package.roles.<role_key>
```

их нужно удалить или оставить только как закрытый debug/legacy parser, который не вызывается в production. Предпочтительно удалить, чтобы не плодить поддержку мусорных форматов.

---

## **3. Что делать с существующими PKR**

Если `document_package_role_catalog.public_id` сейчас хранит `PKR-XXXXXX`, есть два варианта. Нужно выбрать один и зафиксировать в proof.

### **Вариант A — переименовать public_id ролей из PKR в LN**

Переименовать существующие manually-created роли:

```text
PKR-000012 → ln-000012
```

или в каноническом формате, который уже использует репозиторий:

```text
LN-000012 / ln-000012
```

Важно: формат должен совпадать с тем, что реально уже принято в коде и proof Sprint 3G.

После этого в БД `document_package_role_catalog.public_id` сразу будет соответствовать Word-плейсхолдеру.

### **Вариант B — оставить PKR как внутренний ID, но добавить отдельный placeholder_public_id**

Если нельзя менять `public_id`, добавить отдельное поле:

```sql
placeholder_public_id text unique
```

Пример:

```text
public_id = PKR-000012              -- внутренний ID роли
placeholder_public_id = ln-000012   -- ID для Word-плейсхолдера
```

В UI и Word показывать только:

```text
{{ln-000012}}
```

`PKR` скрыть в обычном UI.

Рекомендация: если реальных данных мало и ничего не используется — лучше Вариант A, проще и чище.

---

## **4. Package UL/IP/FL токены**

Для реквизитов пакета остаётся отдельный package-aware формат, потому что он нужен, чтобы не путать billing context и package context:

```text
{{package.ul.FLD-XXXXXX}}
{{package.ip.FLD-XXXXXX}}
{{package.fl.FLD-XXXXXX}}
```

Их не путать с role-placeholder.

Итого:

```text
Реквизиты ЮЛ пакета: {{package.ul.FLD-XXXXXX}}
Реквизиты ИП пакета: {{package.ip.FLD-XXXXXX}}
Реквизиты ФЛ пакета: {{package.fl.FLD-XXXXXX}}
Роли пакета: {{ln-XXXXXX}}
Системные/документные поля: {{field:FLD-XXXXXX}}
```

---



## **5. Системные и документные**

`{{field:FLD-...}}`

В package template разрешены:

```text
{{field:FLD-000069}} — номер документа
{{field:FLD-000209}} — сегодня прописью
{{field:FLD-000211}} — текущий год
```

и другие системные/документные поля.

Они должны быть `valid`, без warning.

Warning допустим только для billing-реквизитов:

```text
Заказчик ЮЛ
Заказчик ИП
Заказчик ФЛ
Исполнитель ЮЛ
```

---



## **6.**

`role_assignment_missing`

В Sprint 3H обязательно закрыть GAP:

Если в DOCX есть:

```text
{{ln-XXXXXX}}
```

но в анкете конкретного документа не выбран человек на эту роль:

```text
warning: role_assignment_missing
```

Русский текст:

```text
Для этой роли в анкете документа ещё не выбран человек. Заполните анкету документа перед генерацией.
```

Если `ln` принадлежит другому пакету:

```text
error: ln_token_outside_bound_package
```

Если `ln` не найден:

```text
error: ln_token_not_found
```

---

## **7. Удалить старые данные/алиасы, если они больше не нужны**

Проверить и удалить/очистить, если не используется:

- `document_package_token_aliases` со старыми `package.roles.*`;
- legacy alias rows для `package.roles.company_head.*`;
- legacy alias rows для `package.roles.ideology_responsible.*`;
- старые тестовые references в proof/plan/memory;
- старые UI labels с `PKR`.

Если таблица `document_package_token_aliases` больше не нужна вообще — не удалять таблицу сразу, но:

- очистить мусорные строки;
- пометить таблицу как legacy/internal;
- не использовать в новом UI и resolver.

---

## **8. Package generation orchestrator**

Генерация пакета в Sprint 3H должна идти только через существующую генерацию документов.

Запрещено создавать новый independent generation engine.

Правильно:

```text
ai-generate-document-package
  → orchestrator
  → получает package_session
  → получает document_package_template_items
  → для каждого item собирает package context
  → resolve package tokens:
       {{package.ul.FLD-...}}
       {{package.ip.FLD-...}}
       {{package.fl.FLD-...}}
       {{ln-XXXXXX}}
  → вызывает существующий canonical-document-generate-strict / renderer pipeline
  → результат сохраняется стандартным способом
```

Нельзя:

- дублировать DOCX renderer;
- дублировать Gotenberg client;
- напрямую вручную писать в `ai_generated_documents`, если это уже делает существующий pipeline;
- ломать single-document generation.

---

## **9. Proof Sprint 3H**

В proof добавить отдельный раздел:

```text
Legacy role-placeholder cleanup
```

Проверки:

1. В UI больше нет `{{package.role.PKR-...}}`.
2. В UI больше нет `{{package.roles.<key>.*}}`.
3. Каталог ролей показывает только `{{ln-XXXXXX}}`.
4. Validator рабочим считает только `{{ln-XXXXXX}}`.
5. Старые role-format либо удалены, либо дают error с понятным русским текстом.
6. Memory и plan переписаны на `ln`.
7. Если `PKR` остался в БД — он скрыт из обычного UI.
8. Нет рабочих шаблонов, использующих старый формат.
9. Package generation orchestrator использует только `ln` для ролей.

---

## **10. DoD Sprint 3H**

- Единственный пользовательский role-placeholder: `{{ln-XXXXXX}}`.
- Старые role-placeholder форматы не показываются в UI.
- Старые role-placeholder форматы не используются в новых шаблонах.
- `role_assignment_missing` реализован.
- Package validation работает с `ln`.
- Package generation orchestrator готов/подключён через существующий pipeline.
- Single-document generation не изменена.
- Proof и memory обновлены.

Коротко: **да, старое нужно не сохранять, а вычистить**, потому что у нас ещё нет боевых шаблонов с этими роль-плейсхолдерами. Оставляем один чистый стандарт: `{{ln-XXXXXX}}`.

&nbsp;

План: Sprint 3H — role_assignment_missing validation + package generation orchestrator

## Контекст и фиксация канона

Sprint 3G закрыт. Перед стартом 3H фиксируем рабочий канон плейсхолдера роли в пакете:

```text
Канон:        {{ln-XXXXXX}}
Deprecated:   {{package.role.PKR-XXXXXX}}
Deprecated:   {{package.roles.<role_key>.*}}
```

Канон применяется во всех новых артефактах: планах, proof, UI, validator, placeholder catalog, memory, edge functions. `PKR-XXXXXX` остаётся внутренним идентификатором в БД (`document_package_role_catalog.public_id`), но в Word-плейсхолдерах и пользовательском UI не фигурирует. Старые форматы поддерживаются валидатором только как `deprecated_placeholder` warning.

## Цели Sprint 3H

1. Закрыть единственный GAP Sprint 3G — controlled validation `role_assignment_missing`.
2. Унифицировать терминологию `{{ln-XXXXXX}}` во всех точках Sprint 3G/3H.
3. Включить пакетную генерацию как orchestrator поверх существующего pipeline генерации документов — без нового рендерера, Gotenberg-клиента и записи в `ai_generated_documents` собственной логикой.

## Этап 1 — Терминологическая унификация (нулевой риск)

Только текстовые правки, без новой логики.

- `.lovable/plan.md`: блок Sprint 3H пишем сразу в каноне `{{ln-XXXXXX}}`.
- `.lovable/memory/architecture/documents/package-document-level-questionnaires-v1.md`: переписать секцию «Validator scope» — основной токен `{{ln-XXXXXX}}`, `{{package.role.PKR-XXXXXX}}` и `{{package.roles.<role_key>.*}}` отмечены как deprecated warning.
- `src/utils/packagePlaceholderCatalog.ts`: убедиться, что copy-token и описание используют `{{ln-XXXXXX}}`. PKR оставляем только в технической колонке для super_admin.
- `PlaceholdersCatalogTab.tsx` (вкладка «Пакет: Роли»): описание сверху и Пример используют `{{ln-XXXXXX}}`. Текст «Содержимое подставляется по output_template роли» сохраняется. Скриншот пользователя показывает остатки `{{package.role.PKR-XXXXXX}}` в шапке и в колонке «Плейсхолдер» — обновить шапку; колонка остаётся `{{ln-XXXXXX}}`.
- `PackageTemplateValidationPanel.tsx`: коды и сообщения переходят на `ln-token`; коды `pkr_not_found`, `pkr_outside_bound_package` переименовываются в `ln_token_not_found`, `ln_token_outside_bound_package` (BREAKING внутри Sprint 3G/3H, наружу не торчат — только UI-строки).

## Этап 2 — Controlled validation `role_assignment_missing`

Цель: при загрузке/проверке DOCX-шаблона документа внутри package_session показывать warning, если `{{ln-XXXXXX}}` есть, но в анкете документа никто не назначен.

Точка валидации — существующий `PackageTemplateValidationPanel.tsx` + хелпер парсинга плейсхолдеров `src/utils/extractDocxPlaceholders.ts` (read-only DOCX, без генерации).

Логика проверки на пару `(package_session_id, package_template_item_id)`:

```text
для каждого ln-токена в DOCX:
  1. resolve ln → document_package_role_catalog.public_id
     - не найдено              → error: ln_token_not_found
     - role.package_template_id ≠ item.package_template_id
                                → error: ln_token_outside_bound_package  (он же role_outside_bound_package)
  2. lookup document_package_item_role_assignments
     where package_session_id = current
       and package_template_item_id = current
       and role_catalog_id = role.id
       and is_active = true
     - 0 строк                  → warning: role_assignment_missing
     - ≥1 строк                 → valid (multi-value семантика — отдельный backlog)
```

Текст warning (русский, по требованию пользователя):

> «Для этой роли в анкете документа ещё не выбран человек. Заполните анкету документа перед генерацией.»

Параллельно отражаем то же правило в edge-резолвере `supabase/functions/_shared/resolve-package-tokens.ts` (контракт `multiple_role_assignments` уже там, добавляем `role_assignment_missing` как warning при пустом результате document-level branch). `HARDCODED_ENABLED` остаётся `false`.

DoD этапа 2:

- DOCX с `{{ln-XXXXXX}}` + пустая анкета документа → ровно одно warning `role_assignment_missing`, кнопка «Сформировать пакет» не блокируется (warning, не error).
- Назначение человека в «Анкеты документов» → warning исчезает после refetch.
- Роль другого пакета → error `ln_token_outside_bound_package`.
- Несуществующий PKR в ln → error `ln_token_not_found`.
- В edge-резолвере при пустых assignment'ах появляется `warnings: [{ code: 'role_assignment_missing', role_public_id, package_template_item_id }]`, токен не подставляется.

## Этап 3 — Package generation orchestrator (поверх существующего pipeline)

Жёсткое правило: НЕ создавать новый DOCX-рендерер, НЕ дублировать Gotenberg-клиент, НЕ писать руками в `ai_generated_documents`, НЕ трогать `canonical-document-generate-strict`, billing/customer/executor resolver.

Архитектура:

```text
ai-generate-document-package (orchestrator, существует, сейчас не вызывается)
  │
  ├── load package_session + package_template_items (ordered)
  ├── для каждого template_item:
  │     ├── build packageTokenResolveInput { packageSessionId, packageTemplateItemId, ... }
  │     ├── call resolve-package-tokens.ts (document-level branch)
  │     ├── delegate to canonical-document-generate-strict  ← существующий генератор
  │     │     с дополнительным context-слоем package-токенов
  │     └── собрать ai_generated_documents.id, status, warnings
  └── вернуть агрегат { items: [...], package_warnings: [...] }
```

Что меняется:

- В `canonical-document-generate-strict` добавляется ОПЦИОНАЛЬНЫЙ вход `packageContext: { packageSessionId, packageTemplateItemId, packageTokenResolverWarnings[] }`. Если задан — после билдинга обычного контекста вызывается resolve-package-tokens и его результат мёрджится в плейсхолдеры. Если не задан — поведение НЕ меняется (proof: shadow-flag, default off, single-document путь идентичен byte-to-byte).
- В UI `PackagesWorkspace` кнопка «Сформировать пакет»:
  - предусловие: для каждого template_item все ln-токены либо assigned, либо warning подтверждён пользователем (чекбокс «Сформировать с пропусками» — пишет в meta);
  - вызывает `ai-generate-document-package` с `package_session_id`;
  - показывает per-item статус (generated / failed / skipped_missing_role).
- Hook `useAiDocumentPackageGeneration` (уже существует) подключается как единственный consumer.

DoD этапа 3:

- Кнопка «Сформировать пакет» больше не disabled, но блокируется при наличии error-уровневых проблем хотя бы в одном template_item.
- Каждый сгенерированный документ пакета имеет запись в `ai_generated_documents` через стандартный путь (не через orchestrator напрямую).
- В single-document флоу (`canonical-document-generate-strict` без `packageContext`) поведение не изменилось — grep + smoke на одном существующем шаблоне.
- Gotenberg вызывается только из существующего pipeline.
- Audit: каждая операция orchestrator пишет одну запись в `audit_logs` со списком item_id + warnings.

## Этап 4 — Proof + Memory

- Создать `.lovable/proofs/package_documents_sprint3h_role_assignment_missing_and_orchestrator_2026_05.md` с разделами: канон ln-токена, validation matrix (8 кейсов), orchestrator контракт, доказательства непрямого касания `canonical-document-generate-strict` (diff: только новый необязательный параметр), grep подтверждение отсутствия нового рендерера/Gotenberg-клиента.
- Обновить memory `architecture/documents/package-document-level-questionnaires-v1.md`: канон `{{ln-XXXXXX}}`, `role_assignment_missing` теперь реализован (убрать из GAP). При необходимости — отдельная memory `architecture/documents/package-generation-orchestrator-v1.md` со ссылкой на pipeline.
- Обновить `mem://index.md`: добавить строку для новой memory (если создаётся), скорректировать описание существующей.

## Технические детали (для разработчика)

### Файлы под изменение

- `src/utils/packagePlaceholderCatalog.ts` — каноничный токен `{{ln-XXXXXX}}` во всех описаниях/copy-token.
- `src/components/ai-documents/templates/PlaceholdersCatalogTab.tsx` — шапка/описание блока «Пакет: Роли».
- `src/components/ai-documents/packages/PackageTemplateValidationPanel.tsx` — добавить `role_assignment_missing`, переименовать pkr_* коды → ln_token_*, тексты на русском.
- `src/utils/extractDocxPlaceholders.ts` — убедиться, что парсер выделяет `ln-XXXXXX` отдельным классом (не как FLD).
- `src/components/ai-documents/packages/PackagesWorkspace.tsx` — включение кнопки «Сформировать пакет», вызов hook, отображение per-item статусов.
- `supabase/functions/_shared/resolve-package-tokens.ts` — добавить warning `role_assignment_missing` в document-level branch.
- `supabase/functions/canonical-document-generate-strict/*` — добавить опциональный `packageContext`; default-off; без изменений в single-document пути.
- `supabase/functions/ai-generate-document-package/*` — orchestrator: per-item delegation в canonical-document-generate-strict, агрегация результата, audit.
- `.lovable/plan.md`, proof, memory, `mem://index.md`.

### Что НЕ трогаем

- `canonical-template-audit` (вне scope).
- `gotenberg-*` / PDF-конвертер.
- Billing FLD resolvers (`customer_resolver`, `executor_resolver`).
- `document_package_session_participants` (legacy read-only).
- Триггеры/индексы на `document_package_item_role_assignments` (готовы в 3G).

### Регрессионная карта

- Single-document generation (DocumentGeneration page) — smoke на одном продакт-шаблоне до и после.
- Существующие пакетные шаблоны с PKR-токенами в БД — валидатор должен показать deprecated warning, не error.
- ItemRoleAssignment replace-save — без изменений.

## Out of scope (backlog)

- Multi-value role assignment generation семантика (one role → N people в одном документе): пока берём первого по `sort_order`, остальные → warning `multiple_role_assignments` (контракт уже есть).
- Hard switch выключения `{{package.role.PKR-...}}` (полное удаление deprecated) — отдельный sprint после bulk-rewrite шаблонов.
- Атомарность replace-save через RPC — отдельный backlog `document_package_session_save_atomicity`.

## Definition of Done (Sprint 3H)

1. Канон `{{ln-XXXXXX}}` зафиксирован в плане, proof, memory, UI, validator, resolver.
2. `role_assignment_missing` работает и в UI-validator, и в edge-resolver; матрица из 8 кейсов проходит.
3. `ln_token_outside_bound_package` (он же `role_outside_bound_package`) проверяется по `package_template_id`.
4. Пакетная генерация работает через `ai-generate-document-package` → `canonical-document-generate-strict` без нового рендерера/Gotenberg-клиента/прямой записи в `ai_generated_documents`.
5. Single-document путь не изменён (proof: diff + smoke).
6. Proof + memory обновлены, `mem://index.md` синхронизирован.