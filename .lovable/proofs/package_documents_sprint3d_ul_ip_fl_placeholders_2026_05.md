# Sprint 3D Execution Report — UL/IP/FL package placeholders over existing requisites base

Дата: 2026-05-28
Статус: `completed: UL/IP/FL package placeholder catalog prepared over existing requisites base; package resolver context documented; Word authoring readiness; no new FLDs created without manifest proof; generation and dry-run deferred to Sprint 3E`

## 1. Архитектурная фиксация

Одна база реквизитов + два разных контекста выбора + отдельный package resolver.

```
Billing source path:  orders_v2 / customer / executor      (НЕ используется в пакете)
Package source path:  document_package_sessions / document_package_session_participants
```

- UL/IP резолвятся через `session.selected_legal_entity_id → client_legal_details (leg_*/ent_*/общие)`.
- FL резолвится через `session_participants.person_id → legal_details_persons` по `role_key`.
- `metadata.position` физлица берётся из `session_participants.metadata.position` (Sprint 3C).

## 2. Pre-flight RLS на `document_package_template_items`

Действующие политики (validated 2026-05-28):

- `Owner can select own package items` — owner (через profiles.id→user_id) OR admin/super_admin.
- `Owner can insert own package items` — owner OR admin/super_admin (WITH CHECK).
- `Owner can update own package items` — owner OR admin/super_admin (USING + WITH CHECK).
- `Owner can delete own package items` — owner OR admin/super_admin.
- Дополнительный набор политик через JOIN на `document_package_templates p.profile_id = auth.uid()` — некорректен (`profiles.id ≠ auth.uid()`), на практике никогда не срабатывает; функциональной роли не играет, оставлен как legacy.

**Вердикт:** direct INSERT из frontend через `useDocumentPackageItems.addItem` безопасен и достаточен. Admin-only RPC/edge function не требуется. Обычный пользователь без `profile_id` пакета и без admin-роли получает ошибку доступа из обоих наборов политик.

## 3. Mapping manifest

См. `src/utils/packagePlaceholderCatalog.ts`. Сводка:

| Группа | Всего | copy_ready | pending_field | missing_source_column | deferred |
|---|---|---|---|---|---|
| Пакет: ЮЛ | 24 | 22 | 0 | 2 | 0 |
| Пакет: ИП | 24 | 18 | 0 | 2 | 4 |
| Пакет: ФЛ | 26 | 12 | 11 | 3 | 0 |
| **Итого** | **74** | **52** | **11** | **7** | **4** |

`decision`:

- **`reuse_existing_field_definition`** — для всех `copy_ready`. Переиспользуется label/type/format/source-column mapping. **НЕ** переиспользуется billing resolver/source path.
- **`needs_new_fld` (`pending_field`)** — для address-breakdown полей `legal_details_persons.address_structured` (jsonb): либо новый FLD на jsonb-path, либо нормализация колонок. Backlog Sprint 3E.
- **`missing_source_column`** — `leg_address_district / leg_address_city_district / ent_address_district / ent_address_city_district / legal_details_persons.bank_*`. Backlog Sprint 3E.
- **`deferred`** — четыре «руководитель ИП» поля (для ИП руководитель = сам предприниматель, требуется решение резолвера).
- `package_specific` — `metadata.position` (Sprint 3C), отдельным каталогом не выносится.

Никаких INSERT/UPDATE/DELETE в `fields_registry` не выполнено.

## 4. Утверждённый copy-token syntax (§5)

**Выбран Variant B — package namespace:**

- `{{package.ul.FLD-XXXXXX}}` — Пакет: ЮЛ.
- `{{package.ip.FLD-XXXXXX}}` — Пакет: ИП.
- `{{package.fl.FLD-XXXXXX}}` — Пакет: ФЛ.

Аргументы:

- Не пересекается с billing `{{field:FLD-...}}` (не путает резолвер).
- Парсится отдельной веткой `_shared/resolve-package-tokens.ts` без изменения `canonical-document-generate-strict`.
- Совместим с существующими Sprint-3B alias'ами `package.roles.company_head.*` / `package.roles.responsible_person.*` (единая корневая ветка `package.*`).

Sprint-3B alias'ы (`package.roles.<role>.FLD-...`) реюзаются как role-modifier поверх FL-плейсхолдеров; отдельных групп ролей в каталоге плейсхолдеров не создаётся (роль выбирается в анкете пакета).

## 5. UI-изменения

- `src/components/ai-documents/PlaceholdersCatalogTab.tsx`: три новые секции в нижней части той же таблицы — «Пакет: ЮЛ / Пакет: ИП / Пакет: ФЛ»; статус-badge (готов / нет FLD / нет колонки / Sprint 3E); copy-кнопка активна только для `copy_ready`; debug-строка (tech_key + source_path + billing FLD-аналог) видна только при `super_admin` через `useRbac()`; счётчик «пакетные (UL/IP/FL): N» добавлен в шапку; group-filter содержит три новых пункта.
- `src/utils/packagePlaceholderCatalog.ts` — новый статический каталог с типами `PackageGroupId | PackagePlaceholderStatus | PackagePlaceholderItem` и 74 записями.
- `src/utils/packagePlaceholderCatalog.test.ts` — 8 unit-тестов (зелёные): три группы / отсутствие «Исполнитель ЮЛ» / уникальные tech_key / валидный copy-token формат / запрет `{{field:...}}` / отсутствие `ideology_responsible` / правильный source_table по группе / whitelisted статусы.
- `FieldPickerPopover.tsx` — НЕ менялся: пакетные плейсхолдеры распространяются через каталог (Документы → Плейсхолдеры), а вставка в Word делается копированием. `extraGroups`-проп окажется нужен только в Sprint 3E при разметке реального DOCX.
- UI пакета «Идеология» — путь привязки шаблона уже существует (`useDocumentPackageItems.addItem` через RLS-валидный direct INSERT), отдельной кнопки в Sprint 3D не добавляется.

## 6. Backend — без изменений

- `_shared/resolve-package-tokens.ts` — `HARDCODED_ENABLED=false`, 0 production-импортов.
- `canonical-document-generate-strict` — не трогается.
- Gotenberg — не вызывается.
- `ai_generated_documents` — не пишется.
- Никаких новых edge functions; `package-template-dry-run` отложен до Sprint 3E.
- Никаких миграций.

## 7. Billing regression smoke (без генерации)

- `fields_registry` diff (entity_type IN customer/customer_leg/customer_ent/customer_ind/executor_leg/legal_details/legal_details_person): **0**.
- Существующие секции «Заказчик ФЛ / ЮЛ / ИП», «Исполнитель ЮЛ», «Универсальные поля», «Документ», «Сделка», «Оплата», «Системные», «Технические», «Нет источника данных» — рендерятся как раньше (логика секций не менялась, добавление пакетных секций сделано отдельным блоком после существующих).
- Существующие билинговые copy-токены `{{field:FLD-XXXXXX}}` / `{{field:FLD-XXXXXX|format=...|case=...}}` — без изменений.
- Существующий шаблон акта открывается без ошибок; плейсхолдеры отображаются как раньше.
- Генерация документа (`canonical-document-generate-strict`, Gotenberg) **НЕ запускалась**.

## 8. DoD

- [x] Три новые группы в каталоге: «Пакет: ЮЛ» / «Пакет: ИП» / «Пакет: ФЛ»; «Пакет: Исполнитель ЮЛ» отсутствует.
- [x] Статусы `source_available / copy_ready / pending_field / missing_source_column / deferred`; копи-кнопка активна только для `copy_ready`.
- [x] Package-aware copy-token syntax утверждён (Variant B, `{{package.<ul|ip|fl>.FLD-XXXXXX}}`); биллинговый `{{field:FLD-...}}` в пакетных группах не используется как copy-ready.
- [x] Mapping manifest заполнен; decision ∈ approved-множества.
- [x] Никакие новые FLD не созданы; role-specific группы плейсхолдеров не добавлены.
- [x] RLS-проверка `document_package_template_items` выполнена; путь — direct INSERT через `useDocumentPackageItems.addItem`.
- [x] Billing regression smoke пройден без генерации.
- [x] `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`, billing/customer/executor resolver не тронуты; `HARDCODED_ENABLED=false`.
- [x] Unit-тесты `packagePlaceholderCatalog.test.ts` — 8/8 зелёные.
- [x] Memory `mem://architecture/documents/package-token-aliases-v1` обновлена под Variant B.

## 9. Backlog → Sprint 3E

- Manifest decisions для 22 не-`copy_ready` полей (11 FL address-breakdown через jsonb-path или нормализацию; 7 missing columns; 4 ИП-руководитель решений).
- Загрузить реальный DOCX приказа, привязать к пакету «Идеология», вставить UL/IP/FL плейсхолдеры через picker.
- Реализовать `_shared/resolve-package-tokens.ts` (`HARDCODED_ENABLED=true`) с поддержкой `{{package.<ul|ip|fl>.FLD-XXXXXX}}` и role-modifier для FL.
- Запустить controlled `package-template-dry-run` на реальном `template_id`, проверить coverage / unresolved.
- Решение о нормализации `ideology_responsible` (rename → `responsible_person` или generic `role_key`-колонка).
- Только после этого — реальная генерация.
