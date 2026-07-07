# CRM Companies — Discovery (Phase 0)

Дата: 2026-07-07. Read-only. Никаких DDL/DML.

Цель: подготовить безопасный план внедрения canonical-сущности `companies` без поломки текущих оплат, документов, доступов и CRM.

---

## 1. Executive summary

1. Полноценной CRM-сущности «Компания» в системе **нет**. Юрлицо сегодня существует как «реквизиты конкретного клиента» — привязано к `profile_id`/`owner_profile_id`, дедупа по УНП нет, база «прозвона» негде.
2. Уже существуют **два параллельных источника юрлиц**:
   - Legacy: `client_legal_details` — используется документами, оплатой, пакетами.
   - v2: `legal_entities_requisites` (jsonb, `source_legacy_id → client_legal_details.id`) — активно мигрируется, но остаётся owner-bound.
   Оба привязаны к клиенту-физлицу, а не к самой компании.
3. Инфраструктура для новой сущности **есть**: `tenants` (system UUID `00000000-0000-0000-0000-000000000001`), `has_role_v2()`, `public_id_sequences`, `audit_logs`, `domain_events`, `crm_activity_log`, `calls.workspace_id/public_id`, ГРП-обогащение (`grp-lookup` edge function).
4. `orders_v2` уже имеет `payer_type` (20 записей `legal_entity` против 4035 individual), но **`company_id` нет**. Связка «заказ ↔ ЮЛ» сейчас только косвенная — через `generated_documents.client_details_id` (в БД сейчас всего 1 такая запись из 20 legal-заказов).
5. Дубли по УНП уже есть: как минимум одна пара `193405000` — двое разных клиентов, одна компания. Backfill без нормализации создаст ещё больше дублей.
6. **Рекомендация:** Вариант A — отдельная таблица `companies` + `company_contacts`, `client_legal_details`/`legal_entities_requisites` остаются как **источники upsert** и как billing/document input, не удаляются, ссылки на них не ломаем. Compat-слой между `companies.id ↔ client_legal_details.id` фиксируется отдельным bridge-полем (`selected_company_id` nullable параллельно с `selected_legal_entity_id`), documents module мигрируем отдельной задачей вне этого спринта.

---

## 2. Карта существующих таблиц

### 2.1. Юрлица

| Таблица | Роль сейчас | Владелец | Строк | Ключевые поля | Решение |
|---|---|---|---|---|---|
| `client_legal_details` | Legacy SoT реквизитов ЛК (individual/entrepreneur/legal_entity + billing/document) | `profile_id → profiles(id) ON DELETE CASCADE` | 42 (23/9+1/4+4) | `leg_unp`, `ent_unp`, `leg_name`, `leg_address_structured`, `bank_*`, `grp_*` | Источник для backfill; **не удалять**, ссылки FK живы (`generated_documents.client_details_id`, `document_package_sessions.selected_legal_entity_id`, `document_package_session_participants.legal_entity_id`, `corporate_draft_sessions.legal_details_id`, `legal_details_entity_person_links.legal_details_id`) |
| `legal_entities_requisites` | v2 таблица, jsonb + `source_legacy_id` | `tenant_id`, `owner_user_id`, `owner_profile_id` | 11 (8 ИП + 3 ЮЛ, все `scope=system_customer`) | `data->>'leg_unp'/'ent_unp'/…`, `source_legacy_id → client_legal_details.id` | Второй источник для backfill; переиспользуем RLS-паттерн через `tenant_id`/`user_tenant_ids`; не трогаем |
| `individual_requisites` | Аналог для физлиц | тот же | — | jsonb | Вне scope спринта |
| `legal_details_persons` | Люди-подписанты (директор/представитель), отдельные от `profiles` | `profile_id` (владелец) | 4 (2 profile) | ФИО, паспорт, банк, `personal_number` | Маппим в `company_contacts` через `legal_details_entity_person_links`; `person_id` сохраняем для документов через compat-таблицу (см. Phase 10) |
| `legal_details_entity_person_links` | Связь legacy ЮЛ ↔ подписант | `legal_details_id`, `person_id`, `role_type`, `role_catalog_id`, `position_catalog_id`, `share_percent`, `acts_on_basis`, `is_primary`, `start_date/end_date` | — | | Источник для `company_contacts` (relationship_type=director/signer/representative) |
| `legal_details_roles_catalog`, `legal_details_positions_catalog` | Справочники ролей/должностей | — | — | | Переиспользуем в `company_contacts` (FK-совместимо) |
| `tenants` / `tenant_memberships` | Multi-tenant инфраструктура | `is_personal=true` у всех | 1 system tenant `000...001` | | Используем `system tenant` как DEFAULT `workspace_id` для новых таблиц |

### 2.2. Заказы / оплаты / доступ

| Таблица | Что там уже есть | Что понадобится | Риск |
|---|---|---|---|
| `orders_v2` | `payer_type` (individual/legal_entity), `profile_id`, `pipeline_id`, `pipeline_stage_id`, `offer_id`, `product_id`, `user_id` | nullable `company_id` | Изменение опциональности `profile_id` запрещено |
| `payments_v2` | привязка к order | — | Не трогаем |
| `subscriptions_v2` | `profile_id` | — | Не трогаем |
| `entitlements` | всегда `profile_id` | Ничего. Компания **не** получает entitlement | Инвариант в system_health |
| `access_grant_ledger`, `entitlement_orders` | audit доступа | — | — |
| `generated_documents` | `client_details_id → client_legal_details(id)`, `order_id`, `profile_id` | Backfill source для `orders_v2.company_id` (`gd.client_details_id → cld → company`) | Compat FK живой |
| `corporate_draft_sessions`, `document_package_sessions`, `document_package_session_participants` | `legal_entity_id`/`selected_legal_entity_id` → `client_legal_details` | Параллельный nullable `selected_company_id` в Phase 1; UI-picker обновим в Phase 10 | Ломать FK на CLD нельзя |
| `document_package_item_role_assignments.person_id → legal_details_persons` | | Compat-таблица `company_contact_person_map` для связи `company_contacts.id ↔ legal_details_persons.id` | — |

### 2.3. CRM / задачи / звонки

| Таблица | Что уже есть | Что нужно | Риск |
|---|---|---|---|
| `crm_pipelines`, `crm_pipeline_stages` | — | Не трогаем | — |
| `crm_tasks` | `workspace_id`, `public_id`, `contact_id`, `deal_id`, `order_id`, `pipeline_*`, `offer_id`, `product_id`, `tariff_id`, `meta jsonb` | nullable `company_id` | Автоматики (`crm_task_automation_rules`) — проверить при добавлении, что новые правила не ломают старые |
| `crm_activity_log` | лента активности | Пишем compact-запись при create/close/link | — |
| `calls` | `workspace_id`, `public_id`, `contact_id`, `deal_id`, `manager_user_id`, `phone_*` | nullable `company_id` + link по номеру | Existing calls не ломать (link_status уже есть) |
| `call_events`, `call_sync_queue`, `sms_messages` | | — | — |
| `import_jobs`, `import_mapping_rules` | общий импорт | Переиспользовать для company import, если позволит структура; иначе создать `company_import_batches/rows` (Phase 9) | Проверить в Phase 9 |

### 2.4. Инфраструктура, которую переиспользуем

- `public_id_sequences` + шаблон `trg_set_*_public_id` → генерация `CMP-000001` / `CNT-000001`.
- `has_role_v2(uuid, text)` → RLS для `admin`/`super_admin`/`employee`.
- `user_tenant_ids(auth.uid())` → workspace-scope.
- `audit_logs` → аудит.
- `domain_events` + `domain_executions` → события `crm.company.*`.
- `update_updated_at_column()` → триггер updated_at.
- Edge functions: `grp-lookup` (ГРП-обогащение), паттерн `amocrm-mass-import`/`import-contacts-gc`/`admin-import-bepaid-statement-csv` — для импорта.

---

## 3. Карта edge functions / RPC (по гриппе `supabase/functions/`)

Прямо касаются юрлиц/реквизитов/импорта:

- `grp-lookup` — enrichment УНП → ГРП. **Переиспользуем** в `crm_company_grp_refresh`.
- `admin-import-bepaid-statement-csv`, `amocrm-mass-import`, `amocrm-contacts-import`, `getcourse-import-deals`, `getcourse-import-file`, `import-contacts-gc`, `import-telegram-history`, `bepaid-report-import`, `bepaid-archive-import`, `ai-import-analyzer` — паттерны CSV/XLSX импорта с dry-run + execute. **Reference** для `company-import-*`.
- `admin-purge-imported-transactions`, `amocrm-import-rollback` — rollback-паттерн.

RPC, которые пишут `client_legal_details` / `legal_entities_requisites`: определяются в Phase 0.1 через `pg_proc` в момент реализации (для план-документа — reserved).

---

## 4. Карта UI

| Файл | Что делает | Реакция в спринте |
|---|---|---|
| `src/pages/settings/LegalDetails.tsx` | Страница ЛК: создание/редактирование `client_legal_details` | В Phase 4 добавляем skрытый sync-call в `CompanyService.upsertFromLegalDetails()` (RPC + safety-net trigger) — UI не меняется |
| `src/components/legal-details/*` (LegalEntity/Entrepreneur/Individual/Organization DetailsForm, `FieldLabelWithId`) | Формы | Не трогаем |
| `src/hooks/useLegalDetails.tsx`, `useLegalDetailsFields.ts`, `useEntityPersonLinks.ts`, `useEntityDuplicateCheck.ts`, `useGrpRefresh.ts`, `usePersonDuplicateCheck.ts` | Хуки legacy | Переиспользуем `useGrpRefresh`, `useEntityDuplicateCheck` |
| `src/components/requisites-v2/RequisitesV2Manager.tsx`, `src/hooks/useRequisitesV2.ts`, `src/lib/requisites-v2/fieldMap.ts` | v2 менеджер | Дополним sync в Company, UI без изменений |
| `src/components/ai-requisites/*` (PersonLinkedEntitiesBlock, PersonFieldsForm, EntityTableView, EntityRecordSheet) | AI-редактор реквизитов | Не трогаем |
| `src/components/ai-documents/LegalDetailsPickerDialog.tsx`, `DealPayerDocumentsCard.tsx`, `packages/*` | Пикер юрлиц в документах | Phase 10: добавить companies-picker, compat через bridge-поле |
| `src/components/payment/InvoiceCheckoutDialog.tsx`, `src/components/purchases/InvoiceActPreviewDialog.tsx` | Оплата ЮЛ + инвойсы/акты | Читают CLD — не трогаем |
| `src/components/admin/ContactDetailSheet.tsx` (существует) | Карточка контакта в CRM | Phase 8: добавляем вкладку «Компании», старые вкладки не меняем |
| `src/components/admin/DealDetailSheet.tsx` | Карточка сделки | Phase 5.1: добавляем блоки «Компания» / «Основной контакт» / «Доп. контакты» |
| Списки сделок/контактов, `AdminExecutors.tsx` | | Не трогаем |
| **Новое**: `/admin/companies` (list + import), `CompanyDetailSheet` через общий `EntityDetailSheet` shell (Phase 7). Shell выносим из существующего ContactDetailSheet — без copy-paste |

---

## 5. SQL-отчёты

### 5.1. `client_legal_details` — количество/уникальность

| src | rows | unique_unp | missing_unp |
|---|---|---|---|
| legal_entity | 8 | 7 | 0 |
| entrepreneur | 10 | 10 | 0 |

Individual (`purpose=billing/document`): 24 записи — вне scope компании.

### 5.2. `legal_entities_requisites`

| subject_type | rows | unique_unp | with_legacy_id |
|---|---|---|---|
| entrepreneur | 8 | 8 | 8 |
| legal_entity | 3 | 3 | 3 |

**Все 11 записей v2 имеют `source_legacy_id`** — маппинг legacy↔v2 полный, дубли upsert-а по паре легко разрешить.

### 5.3. Дубли по нормализованному УНП внутри `client_legal_details`

| unp | rows | profiles | distinct_names |
|---|---|---|---|
| 193405000 | 2 | 2 | 1 |

Одна компания у двух разных клиентов. Backfill без нормализации создаст 2 company. Правильно: 1 company + 2 `company_contacts`.

### 5.4. Заказы ЮЛ и связь с документами

| legal_orders | with_profile | with_generated_doc | distinct_cld |
|---|---|---|---|
| 20 | 20 | 1 | 1 |

Только 1/20 legal-заказов имеет `generated_documents.client_details_id`. Значит **backfill `orders_v2.company_id` через `generated_documents` покроет только 5%**. Остальные 19 придётся линковать эвристикой (email/phone → matching CLD → company) с флагом `low_confidence` и админ-review-очередью.

### 5.5. UI-обеспечение

- system tenant: `00000000-0000-0000-0000-000000000001` (уже существует, `is_personal=false`, name=`system`) → используем как DEFAULT `workspace_id`.
- `has_role_v2`, `user_tenant_ids`, `has_role` — все три функции существуют.

---

## 6. Compatibility matrix

| Сущность | Текущий смысл | Будущая роль | company_id? | Мигрировать сейчас? | Риск | Рекомендация |
|---|---|---|---|---|---|---|
| `client_legal_details` | SoT legacy реквизитов | Источник backfill + billing/document input | нет | нет | Разрыв FK у документов | Оставить, добавить bridge-таблицу `client_legal_details_company_map(client_details_id UNIQUE, company_id, confidence)` |
| `legal_entities_requisites` | v2 owner-bound | Второй источник backfill | нет | нет | Дубли, если сначала не нормализовать | UPSERT по `(country, normalized_unp)` |
| `legal_details_persons` | Люди-подписанты | Совместимо с company_contacts через compat-map | нет | нет | Ломать `document_package_item_role_assignments.person_id` нельзя | `company_contact_person_map(company_contact_id, person_id)` |
| `orders_v2` | Заказ | Заказ с company | **да, nullable** | Backfill 5% через `generated_documents`, остальное — эвристика с флагом | Изменение `profile_id` запрещено | Add-only колонка + backfill в Phase 3 |
| `generated_documents` | Документ | — | нет | нет | — | Читаем `client_details_id` для backfill |
| `document_package_sessions` | Сессия пакета | Добавить `selected_company_id nullable` параллельно `selected_legal_entity_id` | параллельно | Phase 10 | UI-picker | Не удалять `selected_legal_entity_id` |
| `corporate_draft_sessions` | Черновик | То же | параллельно | Phase 10 | | |
| `crm_tasks` | Задача | Задача по company | **да, nullable** | Phase 1.4 | Automation rules | Add-only |
| `calls` | Звонок | Звонок по company | **да, nullable** | Phase 1.4 | link_status логика | Add-only |
| `profiles` | Контакт/физлицо | Contact | нет | Не трогаем | Access breakage | — |
| `entitlements`, `subscriptions_v2`, `payments_v2`, `access_grant_ledger`, `entitlement_orders` | Access/оплата за profile | То же | **нет** | Никогда | Тихая выдача доступа компании | Инвариант: `NOT EXISTS entitlement.company_id` |

---

## 7. Сравнение архитектурных вариантов

### Вариант A — отдельная `companies` + `company_contacts` — **рекомендуется**

За: чистая CRM-сущность, поддерживает базу прозвона без клиента, дедуп по УНП, совместимо с amoCRM/Pipedrive/HubSpot, не ломает access.

Против: две новые таблицы + bridge-map, двухнедельный спринт с обязательным Phase 0.

### Вариант B — `profiles.type = contact/company`

Против: `profiles.id` используется в entitlements/telegram/subscriptions — riск тихой выдачи доступа компании, ломает RLS-паттерны, поля физлица и юрлица разной природы, дедуп по УНП конфликтует с дедупом по email. **Отклонён**.

### Вариант C — `legal_entities_requisites` как CRM-сущность

Против: таблица owner/tenant-bound (одна компания у двух клиентов = две строки), нельзя хранить «компанию для прозвона без клиента», нет `public_id`, RLS через `owner_user_id` не подходит для CRM-глобальной сущности. **Отклонён**, но используем как **источник backfill**.

---

## 8. Risk matrix

| Риск | Где | Вероятность | Последствие | Как закрываем | Blocker? |
|---|---|---|---|---|---|
| Выдать entitlement компании | Phase 5.3 | средняя | Доступ уходит не туда | Инвариант system_health + гвард в `grant_entitlement` RPC | **Blocker** |
| Тихая перезапись реквизитов из ЛК | Phase 4 | высокая | Клиентские данные затираются | Правило: `updated_by IS NOT NULL AND source != 'grp'` → не перезаписываем, пишем в `system_health_discovery_findings` | **Blocker** |
| Backfill создаст дубли | Phase 3 | высокая | Задвоение company | `normalize_unp()` + `UNIQUE(workspace_id, country, tax_id_normalized)` + dry-run обязателен | **Blocker** |
| Разрыв FK у документов | Phase 10 | средняя | Пакеты не открываются | Не удаляем `selected_legal_entity_id`; добавляем параллельное `selected_company_id` | **Blocker** |
| Потеря `profile_id` в orders_v2 | Phase 5 | низкая | Access ломается | `profile_id` остаётся, добавляем nullable `company_id` | **Blocker** |
| Automation rules сломают старые задачи | Phase 1.4 | низкая | Задачи не создаются | Add-only колонка + правила без `company_id` продолжают работать | non-blocker |
| Импорт создаст мусор | Phase 9 | средняя | Загрязнение базы | Обязательный dry-run + review-очередь + rollback | non-blocker |
| Смешение подписанта и `profile` | Phase 3 | средняя | Ложная связь access | `company_contacts.profile_id` только если `legal_details_persons.profile_id` = существующий `profiles.id` от того же клиента; иначе — не создаём link, только `person_id` в compat-map | **Blocker** |
| Ломается ContactDetailSheet | Phase 7-8 | низкая | UI регресс | Shell выносим в отдельный компонент, старые вкладки не трогаем; регресс-чек в Phase 11 | non-blocker |
| Ломаются звонки | Phase 1.4 | низкая | Регресс call flow | `company_id` nullable, link_status не меняем | non-blocker |
| Дубли `legal_entities_requisites` ↔ `client_legal_details` при backfill | Phase 3 | высокая | Задвоение | `source_legacy_id` уже связывает 11/11 v2 с CLD → идём от CLD, v2 подтягиваем | **Blocker** |

---

## 9. Инварианты для system_health

1. `NOT EXISTS entitlement WHERE company_id IS NOT NULL AND profile_id IS NULL` (после Phase 5).
2. `company_contacts.company_id` и `profile_id` ссылаются на существующие строки.
3. Не более одной `is_primary=true` строки на компанию.
4. `UNIQUE(workspace_id, country_code, tax_id_normalized)` не нарушается.
5. `orders_v2 WHERE payer_type='legal_entity' AND matched_legal_details IS NOT NULL AND company_id IS NULL` → таких быть не должно (после Phase 5.1 backfill).
6. Оплаченный legal-заказ имеет либо `profile_id` = access recipient, либо явный `meta.access_status='pending_access_recipient'` + открытая `crm_task`.
7. Все `company_contact_person_map.person_id` ссылаются на существующий `legal_details_persons.id`.

---

## 10. Финальные решения по compat-слою

1. **`client_legal_details` не удаляем** — остаётся SoT legacy для документов и оплаты; ссылки FK остаются рабочими. Bridge-таблица `client_legal_details_company_map(client_details_id PK, company_id, confidence, matched_at)` — Phase 1.
2. **`document_package_sessions.selected_legal_entity_id`** остаётся. Параллельно добавляем nullable `selected_company_id`. UI переключаем в Phase 10.
3. **`legal_details_persons`** остаются SoT подписантов для документов. Bridge `company_contact_person_map(company_contact_id, person_id)`.
4. **ЛК → Company sync**: основной путь — RPC `crm_company_upsert_from_legal_details(source_table, source_id)` + edge function; **DB-триггер** на `client_legal_details` / `legal_entities_requisites` — только `AFTER INSERT/UPDATE`, вызывает RPC через `pg_net` в фоне или пишет в `notification_outbox`, чтобы гарантировать sync при прямых INSERT/UPDATE мимо сервиса (пример — админ-правки, миграции, скрипты). Триггер идемпотентный.
5. **Access**: инвариант в system_health + explicit гвард в RPC выдачи entitlement — компания без `access_recipient` в `company_contacts` не может получить entitlement. Заказ ЮЛ без контакта → `meta.access_status='pending_access_recipient'` + `crm_task` типа «Указать получателя доступа».
6. **Automations `crm_task_automation_rules`**: `company_id` в `crm_tasks` — nullable, старые правила не меняются; в Phase 1.4 добавляется опциональный target `company`.
7. **UI shell**: выносим `EntityDetailSheet` (header + tabs + timeline + actions) из существующего `ContactDetailSheet` в общий компонент; `ContactDetailSheet` и новый `CompanyDetailSheet` — тонкие обёртки поверх shell с entity-specific профильной вкладкой. Copy-paste запрещён.

---

## 11. Открытые вопросы (для решения перед Phase 1)

1. Нормализация УНП для не-BY контрагентов — сейчас все УНП белорусские, но `country_code` в модели предусмотрен. **Решение**: пока `normalize_unp(x, 'BY')` — 9 цифр; для других стран — no-op с флагом `is_normalized=false`, дедуп только внутри BY.
2. Кого назначать `assignee_user_id` при bulk-создании задач на прозвон — round-robin по менеджерам или ручной выбор в UI импорта. **Решение**: ручной выбор в форме импорта, RR можно добавить позже.
3. Куда пишет ГРП-refresh при конфликте: перезаписывает `companies.grp_snapshot` полностью, но `name/address/legal_form` — только если поле пустое или флаг `sync_from_grp=true`.

---

## 12. Что не трогаем в этом спринте

- `profiles`, `user_roles_v2`, `roles`.
- `entitlements`, `access_grant_ledger`, `entitlement_orders`, `subscriptions_v2`, `payments_v2`.
- `client_legal_details`, `legal_details_persons`, `legal_details_entity_person_links` — только чтение.
- `orders_v2.profile_id`, `orders_v2.payer_type` — только добавление `company_id`.
- Существующие RPC создания заказа/выдачи entitlement — только add-only гварды.
- `LegalDetails.tsx`, `LegalDetailsPickerDialog`, `InvoiceCheckoutDialog`, `DealPayerDocumentsCard` — только чтение.
- `crm_pipelines/stages`, `crm_activity_log` (add-only INSERT).

---

## 13. DoD Phase 0

- [x] Документ создан: `.lovable/architecture/companies_sprint_discovery.md`.
- [x] Все существующие таблицы юрлиц и связи описаны.
- [x] SQL-отчёты по дублям УНП, покрытию backfill, legal-заказам собраны.
- [x] Рекомендация: Вариант A (отдельная `companies` + `company_contacts`).
- [x] Risk matrix закрыт: blocker-риски имеют явное закрытие в плане.
- [x] Compat-слой зафиксирован (bridge-таблицы, параллельные nullable поля, safety-net triggers).
- [x] Открытые вопросы перечислены (3 шт., решения предложены).

**Phase 0 закрыт.** Готовы к Phase 1 — миграция canonical data model. Перед стартом Phase 1 подтверждаем решения из раздела 10-11 и запрашиваем approval миграции.
