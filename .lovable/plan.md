# Sprint 3D (финальный, approved с правками) — Пакетные плейсхолдеры UL / IP / FL поверх существующей базы реквизитов

## 0. Главная архитектурная фиксация

- Базы реквизитов уже есть: `client_legal_details` (юрлицо + ИП), `legal_details_persons` (физлица), `legal_details_entity_person_links`.
- **Одна база реквизитов + два разных контекста выбора + отдельный package resolver.** Биллинговые данные не копируются; `orders_v2` НЕ используется как источник для пакета.

```text
Billing source path:  orders_v2 / customer / executor
Package source path:  document_package_sessions / document_package_session_participants
```

- Пакетный контекст: `document_package_sessions.selected_legal_entity_id → client_legal_details` и `document_package_session_participants.person_id → legal_details_persons` (+ `role_key` + `metadata.position`).

## 1. Жёсткие ограничения

- НЕ трогать `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`.
- НЕ трогать billing/customer/executor resolver и существующие билинговые группы (Заказчик ЮЛ/ИП/ФЛ, Исполнитель ЮЛ) и их FLD.
- НЕ создавать namespace `documents:package:ideology`, НЕ создавать `package.roles.ideology_responsible.*`.
- НЕ создавать роль-specific группы плейсхолдеров.
- НЕ создавать новые FLD без manifest-proof.
- НЕ делать synthetic dry-run.
- Все UI-labels на русском; технические ключи — только в debug-колонке для super_admin.

## 2. Discovery (read-only, делается первым)

### 2.1. Inventory существующих биллинговых групп

```sql
SELECT public_id, key, label, entity_type, data_type
FROM fields_registry
WHERE archived_at IS NULL
ORDER BY entity_type, public_id;
```

Зафиксировать в proof фактический состав:

- Заказчик ФЛ (ожидаем ~26 полей);
- Заказчик ЮЛ (ожидаем ~24);
- Заказчик ИП (ожидаем ~24);
- Исполнитель ЮЛ (ожидаем ~23) — **только как reference, не зеркалится**;
- Универсальные поля.

### 2.2. Inventory колонок-источников

- `client_legal_details`: `leg_*` (ЮЛ), `ent_*` (ИП), `ind_*` (ФЛ-клиент), общие (`bank_account, bank_name, bank_code, phone, email`).
- `legal_details_persons`: `full_name, birth_date, personal_number, passport_*`.
- `document_package_sessions`: `selected_legal_entity_id, package_template_id, status, legal_entity_locked_at, metadata`.
- `document_package_session_participants`: `legal_entity_id, person_id, role_key, role_catalog_id, is_primary, metadata` (включая `metadata.position`).

### 2.3. Сопоставительная таблица (mapping manifest)

Для каждого поля биллинговой группы:

| package_group | package_label (RU) | billing_analog_public_id | billing_analog_label | source_table | source_column | needs_new_fld? | decision | status |
|---|---|---|---|---|---|---|---|---|

Возможные значения `decision`:

- **`reuse_existing_field_definition`** — FLD-определение уже есть, package-контекст переиспользует **label, type, format и source-column mapping**, но НЕ billing resolver/source path. Резолвится через package source path.
- `needs_new_fld` — поля нет в `fields_registry`, но колонка-источник есть → backlog Sprint 3E.
- `missing_source_column` — нет ни FLD, ни колонки → defer + explicit backlog item.
- `package_specific` — только для `metadata.position` физлица в роли.
- `defer` — пока не нужно.

## 3. Статусы плейсхолдеров (вместо размытого `available`)

В каталоге и UI используются явные статусы:

- **`source_available`** — есть source field definition и source column, но package-aware syntax ещё не утверждён.
- **`copy_ready`** — есть source + утверждён package-aware copy-token syntax (см. §5). **Только такие плейсхолдеры копируются в UI.**
- **`pending_field`** — FLD-определения ещё нет (`needs_new_fld`).
- **`missing_source_column`** — нет колонки-источника.
- **`deferred`** — отложено в Sprint 3E или дальше.

В UI кнопка «Скопировать» активна **только** для `copy_ready`. Остальные показываются `disabled` с пояснением статуса.

## 4. Целевой состав групп

В UI «Документы → Плейсхолдеры» добавляются ровно три новые группы (после существующих):

- **Пакет: ЮЛ** — зеркало «Заказчик ЮЛ» (~24 поля), источник `package_session.selected_legal_entity_id → client_legal_details (leg_*)`.
- **Пакет: ИП** — зеркало «Заказчик ИП» (~24 поля), источник `client_legal_details (ent_* + общие)`.
- **Пакет: ФЛ** — зеркало «Заказчик ФЛ» (~26 полей), источник `package_session_participants.person_id → legal_details_persons`.

**Группа «Пакет: Исполнитель ЮЛ» НЕ создаётся.** `Исполнитель ЮЛ` используется только как reference при анализе структуры реквизитов.

Состав групп зеркалит билинговые **по labels и количеству целевой структуры**, но реально как `copy_ready` показываются только поля, удовлетворяющие всем трём условиям:

1. есть колонка в `client_legal_details` / `legal_details_persons`;
2. есть FLD-определение (или утверждённый alias);
3. есть package resolver path.

Остальное → `pending_field` / `missing_source_column` / `deferred`, в manifest как explicit gap, в backlog Sprint 3E. Никаких слепых INSERT в `fields_registry`.

## 5. Copy-token syntax для package context (обязательное решение в Sprint 3D)

**Package placeholder становится `copy_ready` только после утверждения package-aware copy-token syntax.** Старый billing token `{{field:FLD-...}}` копировать в пакетный Word-шаблон **нельзя**, потому что он резолвится через billing context и подставит заказчика заказа, а не компанию/лицо пакета.

В discovery Sprint 3D зафиксировать выбор из трёх вариантов (один) и записать в proof:

- **A. Context modifier:** `{{field:FLD-XXXXXX|context=package}}` — один FLD, контекст как modifier. Требует проверки whitelisted modifier support в renderer.
- **B. Package namespace:** `{{package.ul.FLD-XXXXXX}}` / `{{package.ip.FLD-XXXXXX}}` / `{{package.fl.FLD-XXXXXX}}` — отдельный namespace поверх FLD.
- **C. Alias/wrapper:** alias-token (расширение `document_package_token_aliases`), ссылается на existing field definition, но резолвится через `package_session`.

До утверждения варианта в proof — ни одного `copy_ready` плейсхолдера в UI быть не может. Существующие Sprint-3B alias'ы (`package.roles.company_head.*`, `package.roles.responsible_person.*` поверх FLD-000372/373) переоцениваются в proof: либо реюзаем под выбранный синтаксис, либо deprecate.

## 6. Роли в пакете (НЕ группы плейсхолдеров)

- Роль (`company_head`, `responsible_person`, `document_preparer`, `control_person`…) определяет, **какое физлицо** подставить в FL-плейсхолдер.
- Выбор «человек → роль» происходит в анкете пакета (`document_package_session_participants`), а НЕ в каталоге плейсхолдеров.
- Должность в конкретном пакете — `document_package_session_participants.metadata.position` (Sprint 3C).
- Синтаксис привязки роли к FL-плейсхолдеру выбирается тем же решением §5 (modifier `role=...` или alias-обёртка), отдельных групп плейсхолдеров для ролей не создаётся.

## 7. FLD-000372 / FLD-000373

- Canonical FLD на `legal_details_persons.full_name` и `.position`. Оставляем.
- Manifest должен явно ответить, достаточно ли существующих FLD физлица для покрытия 26-полевого зеркала «Заказчик ФЛ». Если нет — список недостающих идёт в Sprint 3E backlog, без создания сейчас.

## 8. UI-слой (что меняем)

- `PlaceholdersCatalogTab` (или эквивалент «Документы → Плейсхолдеры»): три новые группы поверх существующего рендера:
  - читаем package-каталог из нового `src/utils/packagePlaceholderCatalog.ts` (frontend-only, без записи в БД);
  - каждый элемент = `{ groupId, label_ru, source_table, source_path, billing_fld_analog, package_token, package_resolver_hint, status }`;
  - в UI — русский label, копируемый плейсхолдер (формат из §5), тип данных, доступные модификаторы, пример, копи-кнопка;
  - копи-кнопка активна **только** для `status === 'copy_ready'`.
- Debug-колонка с техническими ключами (`source_table.column`, alias/raw token) видна только при `super_admin` (через `useRbac().isSuperAdmin`).
- Search-фильтр picker'а ищет по русским labels package-каталога.
- Никаких изменений в способе авторства Word: админ копирует плейсхолдер → вставляет в Word → загружает шаблон → привязывает к пакету.

## 9. Привязка шаблона к пакету «Идеология»

- Кнопка «Привязать шаблон документа» в UI пакета создаёт строку в `document_package_template_items` + audit `package_template_item_linked`.
- **Pre-flight (обязательно в Sprint 3D):** проверить RLS/permissions на `document_package_template_items`.
  - Если direct INSERT из frontend доступен только super_admin через корректные RLS-политики — допустимо.
  - Если RLS позволяет INSERT обычному пользователю или политика некорректна — **direct INSERT из frontend не делаем**; вместо этого admin-only edge function/RPC с проверкой `has_role_v2(auth.uid(), 'super_admin')` и записью в `audit_logs`.
  - Обычный пользователь не должен иметь права привязывать шаблоны к пакету.
- Результат проверки и выбранный путь (direct vs RPC) фиксируется в proof.

## 10. Backend / resolver

- `_shared/resolve-package-tokens.ts` остаётся с `HARDCODED_ENABLED=false`, 0 production-импортов.
- Никаких изменений в `canonical-document-generate-strict`.
- Никаких новых edge functions (`package-template-dry-run` отложен до Sprint 3E).
- В proof документируем package-resolver contract (только описание):
  - UL/IP → `client_legal_details WHERE id = session.selected_legal_entity_id`;
  - FL → `legal_details_persons WHERE id = (SELECT person_id FROM session_participants WHERE session_id=? AND role_key=?)`;
  - `metadata.position` → `session_participants.metadata->>'position'` по той же выборке.

## 11. Файлы

**Создаются:**

- `src/utils/packagePlaceholderCatalog.ts` — статический каталог UL/IP/FL с маппингом на existing FLD + статусами (`source_available` / `copy_ready` / `pending_field` / `missing_source_column` / `deferred`).
- `src/utils/packagePlaceholderCatalog.test.ts` — проверки:
  - каждый item с `copy_ready` ссылается на реальный FLD `public_id` и реальную колонку;
  - UL/IP/FL зеркалят соответствующие билинговые группы по целевой структуре;
  - нет токенов `package.roles.ideology_responsible.*`;
  - нет группы «Пакет: Исполнитель ЮЛ»;
  - copy-token формат совпадает с утверждённым в §5.
- `.lovable/proofs/package_documents_sprint3d_ul_ip_fl_placeholders_2026_05.md` — содержит mapping manifest, выбор §5, RLS-проверку §9, package-resolver contract §10, billing regression smoke §12.

**Изменяются:**

- `src/components/ai-documents/PlaceholdersCatalogTab.tsx` (три package-группы, статус-aware copy, debug-колонка для super_admin).
- `src/components/ai-documents/FieldPickerPopover.tsx` (optional `extraGroups`).
- UI пакета «Идеология»: кнопка «Привязать шаблон документа» (direct или RPC по результату §9).
- `.lovable/plan.md` (Sprint 3D финализирован, dry-run в 3E).
- `mem://architecture/documents/package-token-aliases-v1` — обновить под выбранный §5 синтаксис.

**НЕ затрагиваются:** `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`, существующие billing FLD, billing/customer/executor resolver, `document_token_aliases` (legacy), `package-tokens-dry-run` (создано в 3C, не вызывается).

## 12. Billing regression smoke (без генерации)

Запрещено запускать генерацию. Smoke сводится к проверкам:

- существующие группы плейсхолдеров в UI не изменились (визуально и по списку);
- список FLD (`fields_registry` по billing entity_type) до и после Sprint 3D идентичен (diff = 0);
- существующий шаблон акта открывается без ошибок;
- его плейсхолдеры отображаются как раньше (тот же синтаксис, те же значения в превью каталога);
- **генерацию (`canonical-document-generate-strict`, Gotenberg) НЕ запускаем.**

## 13. DoD

- В «Документы → Плейсхолдеры» три новые группы: «Пакет: ЮЛ», «Пакет: ИП», «Пакет: ФЛ»; группа «Пакет: Исполнитель ЮЛ» отсутствует.
- В каталоге используются статусы `source_available` / `copy_ready` / `pending_field` / `missing_source_column` / `deferred`; копи-кнопка активна только для `copy_ready`.
- Package-aware copy-token syntax утверждён и зафиксирован в proof (один из вариантов §5); биллинговый `{{field:FLD-...}}` в пакетных группах не используется как copy-ready.
- Mapping manifest (§2.3) заполнен; для каждого поля `decision ∈ { reuse_existing_field_definition | needs_new_fld | missing_source_column | package_specific | defer }`.
- Никакие новые FLD не созданы; никакие role-specific группы плейсхолдеров не добавлены.
- RLS-проверка `document_package_template_items` выполнена; путь привязки шаблона (direct или admin-only RPC/edge с audit) задокументирован в proof.
- Billing regression smoke по §12 пройден без генерации.
- `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`, billing/customer/executor resolver не тронуты; `HARDCODED_ENABLED=false`.
- Unit-тесты `packagePlaceholderCatalog.test.ts` зелёные.
- Proof заполнен полностью.

## 14. Финальный статус Sprint 3D

`completed: UL/IP/FL package placeholder catalog prepared over existing requisites base (one base + two contexts + dedicated package resolver); package-aware copy-token syntax approved; statuses source_available/copy_ready/pending_field/missing_source_column/deferred; Исполнитель ЮЛ не зеркалится; template→package binding gated by RLS check; no new FLDs; generation and dry-run deferred to Sprint 3E`

## 15. Sprint 3E (после)

- По manifest создать недостающие FLD (если нужны и колонки-источники существуют).
- Загрузить реальный DOCX приказа, привязать к пакету «Идеология», вставить UL/IP/FL плейсхолдеры через picker.
- Запустить controlled `package-template-dry-run` на реальном `template_id`, проверить coverage / unresolved.
- Принять решение о нормализации `ideology_responsible` (rename → `responsible_person` или `generic_role_key`-колонка).
- Только после этого — реальная генерация.
