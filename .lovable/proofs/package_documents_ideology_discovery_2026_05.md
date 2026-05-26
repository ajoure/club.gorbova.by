# Discovery: модуль пакетов документов, реквизитов, ролей и placeholder registry

Дата: 2026-05-26. Режим: read-only. Без миграций, edge-deploy, UI-правок и новых таблиц. Все связи зафиксированы по UUID.

---

## 1. Current UI / компоненты

| Слой | Файл |
|---|---|
| Маршрут клиента | `src/pages/DocumentGeneration.tsx` → `<AiPageContent mode="user" initialSection="doc-packages" hiddenSections={["ai","documents"]} />` |
| Хост секций | `src/components/ai-chat/AiPageContent.tsx` |
| Пакет «Идеология» | `src/components/ai-documents/DocumentPackageIdeologyView.tsx` (398 строк) |
| Состав пакета (read-only) | `src/components/ai-documents/StrictDocumentTemplatesManager.tsx` (фильтр category=`ideology`) |
| Реквизиты — юрлица/ИП | `src/components/ai-requisites/EntityTableView.tsx`, `EntityRecordSheet.tsx`, `src/components/legal-details/*` |
| Реквизиты — физлица | `src/components/ai-requisites/PersonsTableView.tsx`, `PersonRecordSheet.tsx`, `PersonFieldsForm.tsx` |
| Связь юрлицо↔физлицо | `src/components/ai-requisites/EntityPersonLinksBlock.tsx`, `EntityPersonLinkForm.tsx`, `PersonLinkedEntitiesBlock.tsx`, `PositionPicker.tsx` |
| Хуки | `useAiEntities`, `useAiPersons`, `useEntityPersonLinks`, `useLegalDetails`, `useRequisitesV2`, `useDocumentPackages`, `useAiDocumentPackageGeneration`, `useCorporatePackageGeneration`, `useLegalDetailsFields` |
| Админ UI | `src/pages/admin/AdminDocuments.tsx`, `AdminProductsDocs.tsx` |

Бейдж «локально» рендерится в `DocumentPackageIdeologyView.tsx:211` (`<Badge>локально</Badge>`).

---

## 2. Реквизиты юрлиц / ИП

Таблица: `public.client_legal_details` (одна таблица на ЮЛ, ИП, физлица; фильтр через `client_type` ∈ `legal_entity` / `entrepreneur` / `individual`, и `purpose` ∈ `billing` / `document`).

Ключевые поля: `id` (UUID), `profile_id` (UUID → `profiles.id`), `client_type`, `purpose`, `status` (`active`/`archived`), `is_default`, `leg_name`/`leg_unp`/`leg_address`/`leg_director_*`/`leg_acts_on_basis`, аналогичные `ent_*`, банковские `bank_*`, GRP-поля, `validation_*`, structured-адреса.

Ownership: только `profile_id`. RLS привязывает к `auth.uid()` через `profiles.user_id`:
- `Users can view/insert/update/delete own legal details` — `profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())`;
- `Admins can manage all legal details` — `super_admin`/`admin` через `user_roles_v2`.

Default/primary: есть `is_default boolean`.

UI показывает только `purpose='document'` (см. `useAiEntities` фильтрует `client_type IN (legal_entity, entrepreneur)` + `archive` через `status`).

Count в БД: 36 строк.

---

## 3. Реквизиты физлиц

Таблица: `public.legal_details_persons`.

Поля: `id`, `profile_id`, `full_name`, `birth_date`, `personal_number`, `passport_*`, `phone`, `email`, `address_structured` (jsonb), `notes`, `is_active`.

Ownership: `profile_id`. RLS зеркальный паттерн через `profiles.user_id = auth.uid()` (вид: «Users can manage own persons» + admin all). Хук `useAiPersons` resolves `profileId = profiles.id WHERE user_id = auth.uid()`.

Count: 6 строк.

---

## 4. Связь физлицо ↔ юрлицо

Таблица: `public.legal_details_entity_person_links`.

Поля: `id`, `profile_id`, `legal_details_id` (UUID → entity), `person_id` (UUID → person), `role_catalog_id`, `role_type` (text), `position_catalog_id`, `custom_role_text`, `custom_position_text`, `share_percent`, `acts_on_basis`, `is_primary`, `start_date`, `end_date`, `notes`.

Это **company-level** связь (директор/учредитель/представитель компании), не package-level. Catalog-таблицы для ролей/должностей есть (`role_catalog_id`, `position_catalog_id`).

Count: 1 строка.

**Вывод**: link-слой пригоден для постоянных корпоративных ролей человека в юрлице (например, «руководитель организации = подписант приказа»), но недостаточен для контекстных ролей пакета (`ideology_responsible`, `ideology_participant`, `notified_person`). Это разные слои и **смешивать их нельзя**.

---

## 5. Пакеты документов и шаблоны

Таблицы:
- `document_package_templates` — `id`, `profile_id`, `name`, `description`, `is_active`, `created_by`. **Строк: 0.**
- `document_package_template_items` — `id`, `package_template_id`, `template_id` (→ `document_templates.id`), `sort_order`, `is_required`, `title_override`. **Строк: 0.**

Текущий «пакет Идеология» в UI — это **не запись в `document_package_templates`**, а специальный view `DocumentPackageIdeologyView`, который рендерит `<StrictDocumentTemplatesManager readOnly>` с фильтром по `document_templates.category='ideology'`. То есть «состав пакета» сейчас определяется не таблицей `document_package_template_items`, а тегом категории на шаблоне.

Доступ клиента к пакету (gap):
- В коде нет таблицы `package_access` / `entitlement` → `package_template_id`.
- Нет связи `tariff_id` / `product_id` → `package_template_id`.
- Сейчас секция `doc-packages` показывается всем авторизованным (см. `AiPageContent` — нет access-gate на пакет Идеология).
- Канонический access pipeline (`access_rules`, `entitlements`, `subscriptions_v2`) к пакетам **не подключён**.

---

## 6. Текущая «Анкета пакета» — blocker check

Файл: `src/components/ai-documents/DocumentPackageIdeologyView.tsx`.

```ts
const STORAGE_KEY = "document_package_questionnaire_ideology_v1";
const STORAGE_VERSION = 1;
function loadFromStorage(): QuestionnaireState { ... localStorage.getItem(STORAGE_KEY) ... }
// onSave:
localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
toast.success("Анкета сохранена локально");
<Badge variant="outline" className="text-[10px]">локально</Badge>
```

State `QuestionnaireState`:
- `selectedEntityIds: string[]` — массив юрлиц/ИП (множественный выбор, без enforcement «одно юрлицо на пакет»);
- `selectedPersonIds: string[]` — массив физлиц;
- `roles: { executorId?, customerId? }` — две заглушечные роли Исполнитель/Заказчик, не отражающие идеологические роли (`company_head`, `ideology_responsible`, `ideology_participant`, `document_signer`, `document_preparer`, `notified_person`).

**Persistence**: только `localStorage`. Нет backend-таблицы package_session. Нет FK на `client_legal_details` / `legal_details_persons`. Нет `selected_legal_entity_id` фикса. Нет lock/unlock.

**Что теряется при смене браузера/устройства**: всё (выбор компании, физлиц, ролей).

**Влияние на генерацию**: блок C (`Сформировать пакет`) всегда `disabled` (см. комментарий в файле: «Фаза 1 (frontend-only)»). То есть localStorage сейчас **не влияет** на pipeline генерации — только на UI preview. Хуки `useAiDocumentPackageGeneration` / `useCorporatePackageGeneration` существуют, но из этого view не вызываются.

**Lock/unlock модель**: отсутствует полностью — ни в коде, ни в БД нет поля `entity_locked_after_first_generation`, нет audit-таблицы unlock.

**Запрет «одно юрлицо на одну покупку»**: отсутствует. UI допускает мульти-выбор юрлиц.

→ **PRODUCTION BLOCKER для SaaS**. Это основание для Sprint 1, но НЕ основание прервать discovery (по правилу §STOP-guards).

---

## 7. Token / placeholder registry

Таблица: `public.fields_registry`. Активных полей: **366**. Контекстов (entity_type): **24**:

```
agenda, contact, customer, customer_ent, customer_ind, customer_leg, customer_signer,
deal, decision, document, entity, entity_person, executor, executor_leg, legal_details,
meeting, offer, package, payment, person, product, system, tariff, user_requisites
```

**Контекст `package` уже существует**. Существующие package-токены (выборка):

| public_id | key | label |
|---|---|---|
| FLD-000093 | `package.signer.full_name` | ФИО подписанта |
| FLD-000094 | `package.signer.position` | Должность подписанта |
| FLD-000095 | `package.chairperson.full_name` | ФИО председателя |
| FLD-000096 | `package.secretary.full_name` | ФИО секретаря |
| FLD-000097 | `package.participants` | Участники собрания |
| FLD-000098 | `package.registered_persons` | Зарегистрированные лица |
| FLD-000101 | `package.board_candidates` | Кандидаты в совет директоров |
| FLD-000102 | `package.commission_members` | Члены ревизионной комиссии |

Канонический формат токена (см. memory `file-name-template-fld-first` + `useLegalDetailsFields`): `{{cf.<entity_type>.<FLD-XXXXXX>}}`. То есть `{{cf.package.FLD-000093}}` уже валидный токен.

**Массивы/роли**: `package.participants` уже массив. Идеологических ролей (`ideology_responsible`, `ideology_participant`, `notified_person`, `company_head`, `document_preparer`) в registry **нет** — это gap для Sprint 3.

Duplicate guard в существующем code/UI registry: проверял по `public_id` (уникален в БД, см. constraints — стандартная практика проекта). Fuzzy-label guard нужно подтвердить на уровне admin UI registry (вне scope discovery).

---

## 8. Generation pipeline и snapshot

Edge functions (`supabase/functions.registry.txt`):

| Функция | Роль |
|---|---|
| `canonical-document-generate-strict` | основной canonical generator (single document) |
| `canonical-document-generate` | legacy generator |
| `canonical-document-regenerate` | пересборка по `regenerated_from_document_id` |
| `canonical-document-send` | отправка результата |
| `canonical-document-payment-hook` | пост-оплата генерация |
| `ai-generate-document` | AI generation entry |
| `ai-generate-document-package` | pipeline для пакета (используется в `useAiDocumentPackageGeneration`) |
| `ai-generate-corporate-package` | corporate pipeline (использует `corporate_draft_sessions`) |
| `document-auto-generate` | auto-generate triggers |
| `document-field-resolver-v2`, `document-field-resolver-v2-snapshot` | shadow resolver (production не переключён) |
| `document-download`, `generate-document-pdf`, `generate-from-template`, `generate-invoice-act` | output/legacy |

Snapshot:
- `ai_generated_documents` — основная snapshot-таблица (53 строки). Поля включают: `template_id`, `template_version_id`, `template_tokens_snapshot`, `token_manifest_snapshot`, `source_trace`, `warnings_snapshot`, `resolver_version`, `registry_version`, `context_type`, `context_id`, `legal_details_id`, `person_id`, `signer_person_id`, `signer_link_id`, `package_template_id`, `package_item_id`, `generation_batch_id`, `idempotency_key`, `document_number`.
- `ai_document_generation_batches` — batch-агрегатор (8 строк). Поля: `package_template_id`, `corporate_draft_session_id`, `meta`, `status`, `title`.
- `document_generation_sessions` — context-driven session (0 строк): `context_type/context_id`, `template_id`, `legal_details_id`, `person_id`, `signer_link_id`, `resolved_tokens`, `missing_tokens`, `warnings`, `expires_at`.
- `corporate_draft_sessions` — corporate-сценарий (0 строк): `legal_details_id`, `report_year`, `procedure_mode`, `charter_*`, `corporate_params`, `package_manifest`, `warnings`, `blocking_errors`.

**Готовность pipeline к package_session**: `ai_generated_documents` уже хранит `package_template_id` + `package_item_id`. `ai_document_generation_batches` уже знает про `package_template_id` и `corporate_draft_session_id`. То есть схема **готова принять package_session_id** через `batches.meta` или новое поле/таблицу. Резолвер контекстов через `context_type/context_id` (`document_generation_sessions`) тоже расширяем.

«Генерация одного документа / всего пакета»: технически возможна через `ai-generate-document-package` (batch over `document_package_template_items.sort_order`). В UI кнопка disabled.

---

## 9. Snapshot / history

Цепочка: `batch` (1) → `generated_documents[]` (N), каждый с `template_tokens_snapshot`, `token_manifest_snapshot`, `source_trace`, `warnings_snapshot`, `template_version`, `resolver_version`, `registry_version`. Достаточно для аудита «что использовали».

---

## 10. RLS и ownership изоляция

`has_table_privilege` для всех целевых таблиц (выборка):

| Таблица | anon | authenticated | service_role |
|---|---|---|---|
| `client_legal_details` | SIUD | SIUD | SIUD |
| `legal_details_persons` | SIUD | SIUD | SIUD |
| `legal_details_entity_person_links` | SIUD | SIUD | SIUD |
| `document_package_templates` | SIUD | SIUD | SIUD |
| `document_package_template_items` | SIUD | SIUD | SIUD |
| `ai_document_generation_batches` | SIUD | SIUD | SIUD |
| `ai_generated_documents` | SIUD | SIUD | SIUD |
| `document_generation_sessions` | SIUD | SIUD | SIUD |
| `corporate_draft_sessions` | SIUD | SIUD | SIUD |
| `fields_registry` | SIUD | SIUD | SIUD |

GRANT-широкие, но защищено RLS:

- `client_legal_details`: 5 policies — owner SELECT/INSERT/UPDATE/DELETE через `profile_id ∈ profiles WHERE user_id=auth.uid()`; admin ALL через `user_roles_v2`.
- `ai_generated_documents`: owner-RW через `profile_id`, admin/super_admin ALL.
- `ai_document_generation_batches`: owner-RW через `profile_id`, admin SELECT/UPDATE.
- `document_generation_sessions`: owner-RW через `created_by = auth.uid()`, admin ALL.
- `corporate_draft_sessions`: owner ALL через `profile_id`.
- `document_package_templates` / `_items`: «Access items through package ownership» (через owner `document_package_templates.profile_id`).

**Anomaly**: `document_package_templates.profile_id` — это owner-of-template (админ-создатель), а не клиент-получатель доступа. То есть «пакет Идеология» по текущей RLS-модели был бы виден ТОЛЬКО его создателю и админам. Это коррелирует с `pkg_templates count = 0`: пакет «Идеология» в БД как запись **не существует** — рендерится через category-фильтр на шаблонах. Это gap, см. §16.

**Доказательство изоляции пользователя**: ✅ для `client_legal_details`, `legal_details_persons`, `ai_generated_documents`, `ai_document_generation_batches`. ⚠️ для `document_package_templates` — RLS-модель не соответствует SaaS-схеме «пакет = публичный продукт, клиенты получают доступ через order/entitlement».

---

## 11. Доступ к шаблонам через URL

Так как `document_package_templates` пустая, открыть `package_template_id` напрямую через URL некуда. Текущий клиентский UI хардкодит «Идеология» как отдельный view (`DocumentPackageIdeologyView`), что показывает все `document_templates.category='ideology'` без entitlement-проверки. **Любой авторизованный пользователь видит список ideology-шаблонов**. Это не критично, пока генерация disabled, но станет критичным в Sprint 1.

---

## 12. Админский UI — что есть / чего нет

Есть: создание шаблонов (`StrictDocumentTemplatesManager`), категоризация (`category`), `is_active`, `document_type`, `file_name_template`, `document_scenarios` (см. memory).

Нет:
- UI для CRUD `document_package_templates` (пустая таблица, нет страницы);
- UI для `document_package_template_items` (mapping шаблонов в пакет);
- UI настройки package roles (нет таблицы);
- UI настройки required tokens для пакета;
- UI preview «какие данные клиент должен заполнить».

---

## 13. Карта связи `entitlement/order → package`

```text
                       ┌─────────────────────────────────────────┐
                       │            ОТСУТСТВУЕТ В БД             │
orders_v2 ──┐         │                                         │
            │         │  package_access(order_id|entitlement_id  │
tariff ─────┼──??──▶ │   → package_template_id, locked_legal_   │
            │         │   entity_id, locked_at, unlock_audit)    │
entitlements┘         │                                         │
                       └─────────────────────────────────────────┘
                                       │
                              package_template_id
                                       ▼
                       ┌─────────────────────────────────────────┐
                       │ document_package_templates (0 rows)     │
                       │ document_package_template_items (0 rows)│
                       └─────────────────────────────────────────┘
                                       │
                                       ▼
                       client_legal_details (RLS by profile_id)
                       legal_details_persons (RLS by profile_id)
                       legal_details_entity_person_links (company-roles)
                                       │
                                       ▼
                       ┌─────────────────────────────────────────┐
                       │            ОТСУТСТВУЕТ В БД             │
                       │  package_session(package_template_id,   │
                       │   profile_id, selected_legal_entity_id, │
                       │   participants[person_id, package_role],│
                       │   draft_answers, locked_at)             │
                       └─────────────────────────────────────────┘
                                       │
                       resolver(token_context='package')
                                       │
                                       ▼
                       canonical-document-generate-strict
                                       │
                                       ▼
                       ai_document_generation_batches
                       ai_generated_documents (snapshot + source_trace)
```

---

## 14. Gaps / blockers

| # | Gap | Severity |
|---|---|---|
| G1 | Анкета пакета хранится только в `localStorage` | **P0 / production blocker** |
| G2 | Нет таблицы `package_session` (selected_legal_entity_id, участники, роли) | **P0** |
| G3 | Нет lock-механизма «одно юрлицо на одну покупку, не менять после первой генерации» | **P0** |
| G4 | Нет связи `order/tariff/entitlement → package_template_id`; access pipeline не подключён | **P0** |
| G5 | Записи пакета «Идеология» в `document_package_templates` нет — состав определяется тегом `category='ideology'`, а не `_items` | P1 |
| G6 | Нет таблицы package-roles catalog + role assignments per session | P1 |
| G7 | В `fields_registry` нет идеологических ролей (`ideology_responsible`, `ideology_participant`, `notified_person`, `company_head`, `document_preparer`) | P1 |
| G8 | UI допускает мультивыбор юрлиц (`selectedEntityIds: string[]`) — нарушение бизнес-правила «одно юрлицо на пакет» | P1 |
| G9 | RLS `document_package_templates` рассчитан на owner-of-template, не на «клиент-получатель доступа» | P1 |
| G10 | Admin UI для пакетов (CRUD package + items + roles + required tokens) отсутствует | P2 |
| G11 | Нет admin unlock procedure с audit (`audit_logs` записи + reason) | P2 |
| G12 | `document-field-resolver-v2` в shadow-режиме, production не переключён — package-context резолв может пойти через legacy | P2 (узнать перед Sprint 3) |

Из 15 вопросов задания:

1. Persisted package session — нет.
2. Selected legal entity — только в localStorage.
3. Selected persons — только в localStorage.
4. Package roles — нет (две заглушки executor/customer в state).
5. localStorage SOT — подтверждено как blocker (G1).
6. Package-template mapping — таблицы есть, но **пустые**; «Идеология» через category-tag.
7. Package access через order/product/entitlement — отсутствует (G4).
8. Token registry context-based — да, `fields_registry.entity_type='package'` уже работает; пригоден к расширению.
9. Existing generation pipeline — да, `canonical-document-generate-strict` + `ai-generate-document-package`; snapshot готов к `package_session_id` через `meta`.
10. Snapshot — `ai_generated_documents` + `ai_document_generation_batches` + `source_trace`/`token_manifest_snapshot`.
11. «Одно юрлицо на пакет» — отсутствует (G3, G8).
12. Запрет смены после первой генерации — отсутствует (G3).
13. Admin unlock — отсутствует (G11).
14. Какие таблицы нельзя дублировать: `client_legal_details`, `legal_details_persons`, `legal_details_entity_person_links`, `fields_registry`, `document_templates`, `ai_generated_documents`, `ai_document_generation_batches`, `document_package_templates`, `document_package_template_items`, `document_generation_sessions`, `corporate_draft_sessions`.
15. Какие UI можно переиспользовать: `EntityTableView`, `PersonsTableView`, `EntityPersonLinksBlock`, `PositionPicker`, `StrictDocumentTemplatesManager`, `useAiEntities`, `useAiPersons`, `useEntityPersonLinks`, `useLegalDetailsFields`, `useDocumentPackages`.

---

## 15. Recommended implementation plan

### Sprint 1 — Persisted Package Session (минимальный)

**Цель**: убрать localStorage SOT и закрыть G1–G4, G8.

**Без новых таблиц это невозможно**. Обоснование: ни одна существующая таблица не моделирует «снимок выбора клиента в рамках одного оплаченного пакета с lock-полем». Ближайший кандидат `document_generation_sessions` — single-document, не package-scoped; `corporate_draft_sessions` — corporate-сценарий, имеет `legal_details_id`, но привязан к годовому отчёту и charter-workflow, не к произвольному пакету.

**Минимально неизбежные сущности (только описание, без SQL — отдельный план потребует согласования)**:

1. `document_package_sessions` — owner=`profile_id`, поля: `id`, `package_template_id`, `access_source` (`order_id` | `entitlement_id`), `selected_legal_entity_id` (UUID → `client_legal_details`), `locked_at`, `locked_by_generation_id`, `unlock_audit_ref` (UUID → `audit_logs.id`), `status` (`draft`/`locked`), `draft_answers` (jsonb), стандартные timestamps. RLS — owner через `profile_id`; admin all.
2. `document_package_session_participants` — `id`, `session_id`, `person_id` (UUID → `legal_details_persons`), `package_role_key` (text, canonical role from registry), `sort_order`. UNIQUE(session_id, person_id, package_role_key).
3. `document_package_role_catalog` — `id`, `package_template_id` (или global), `role_key` (`company_head`, `ideology_responsible`, …), `label`, `is_required`, `min_count`, `max_count`, `allowed_entity_type` (`person`|`legal_entity`).

**Sprint 1 reuse**:
- `client_legal_details` (lookup юрлица),
- `legal_details_persons` (lookup физлиц),
- `legal_details_entity_person_links` (подсказка company-роли),
- `document_package_templates` + `_items` (наконец заполнить запись «Идеология»),
- `useAiEntities`, `useAiPersons`, `EntityTableView`, `PersonsTableView`.

**Sprint 1 файлы, которые НЕ трогаем**:
- `payments_v2`, `orders_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, `tariff_offers`;
- `allocate_document_number`, `document_scenarios`, `document_templates`, `file_name_template`;
- Contact Center / морфология / `fields_registry` (для Sprint 1 хватает существующих `package.*` токенов; новые роли — Sprint 3);
- `canonical-document-generate-strict`, `ai-generate-document-package` — не модифицируем сигнатуру, только дополним `meta.package_session_id` на стороне caller (frontend hook), backend читает opportunistically;
- любые admin pipeline для refund/access repair.

### Sprint 2 — Package Role Catalog + Admin UI
Заполнить `document_package_role_catalog` для «Идеологии» (6 ролей по ТЗ), Admin UI для CRUD пакета + items + ролей.

### Sprint 3 — Package Token Context Extension
Добавить недостающие `fields_registry` для package-context (FLD-XXXXXX): `package.ideology_responsible.*`, `package.ideology_participant[*].*`, `package.notified_person[*].*`, `package.company_head.*`, `package.document_preparer.*`. Duplicate guard по `public_id` уникальности + admin fuzzy-label warning.

### Sprint 4 — Generation Wired Up
Подключить `useAiDocumentPackageGeneration` к session-id; `ai-generate-document-package` принимает `package_session_id`, резолвит токены через `document-field-resolver-v2` (production switch), пишет snapshot + ставит `locked_at` на session при первой генерации.

---

## 16. Sprint 1 — рекомендация reuse vs create

| Сущность | Решение | Аргумент |
|---|---|---|
| Юрлица/ИП | **reuse** `client_legal_details` | Полная схема + RLS уже есть |
| Физлица | **reuse** `legal_details_persons` | Идентично |
| Company-роли (директор и т.п.) | **reuse** `legal_details_entity_person_links` | Подходит как hint, но НЕ как SOT package-роли |
| Package-роли | **create** `document_package_session_participants` + role catalog | Это контекстный слой, не company-слой |
| Selected legal entity per session | **create** `document_package_sessions.selected_legal_entity_id` + `locked_at` | Lock-семантика не моделируется ни в одной существующей таблице |
| Состав пакета (шаблоны) | **reuse** `document_package_templates` + `_items` + **миграция данных**: создать запись «Идеология», смапить ideology-шаблоны | Таблицы есть, использовать вместо category-tag |
| Generation pipeline | **reuse** `ai-generate-document-package`, `canonical-document-generate-strict` | Подпись расширяема через `meta` |
| Snapshot | **reuse** `ai_generated_documents` + `ai_document_generation_batches` | `package_template_id`/`package_item_id` уже есть; добавим `meta.package_session_id` |
| Access binding (order→package) | **create** связь (поле на `tariff_offers.meta.package_template_id` или отдельная таблица `package_access_bindings`) | Сейчас полностью отсутствует |

---

## 17. Proposed data flow diagram

```text
orders_v2.paid ─▶ tariff_offers.meta.package_template_id (NEW binding)
                                │
                                ▼
                  document_package_sessions (NEW, per-purchase)
                  ├─ selected_legal_entity_id  ──▶ client_legal_details
                  ├─ locked_at / unlock_audit_ref ──▶ audit_logs
                  └─ document_package_session_participants[]
                         ├─ person_id ──▶ legal_details_persons
                         └─ package_role_key ──▶ document_package_role_catalog
                                │
                                ▼
                  token resolver (context='package', context_id=session.id)
                  reads: fields_registry.entity_type='package' + session participants + selected legal entity
                                │
                                ▼
                  canonical-document-generate-strict (per item) /
                  ai-generate-document-package (batch)
                                │
                                ▼
                  ai_document_generation_batches (meta.package_session_id)
                  ai_generated_documents
                       ├─ package_template_id, package_item_id (уже есть)
                       ├─ token_manifest_snapshot
                       ├─ template_tokens_snapshot
                       ├─ source_trace
                       └─ warnings_snapshot
                                │
                                ▼
              FIRST successful generation ──▶ session.locked_at = now()
                                              session.locked_by_generation_id = doc.id
```

---

## Финальный статус

**discovery completed, blockers found.**

Подтверждённые P0-блокеры: G1 (localStorage SOT), G2 (нет session), G3 (нет lock), G4 (нет access-binding). Sprint 1 невозможен без минимум одной новой таблицы (`document_package_sessions`) + одной junction (`document_package_session_participants`) + одного catalog (`document_package_role_catalog`). Создание этих таблиц требует отдельного согласованного плана (вне scope discovery).

Sprint 1 can be planned после явного согласования модели §16.
