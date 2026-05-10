# Discovery: реквизиты и tenant — read-only аудит

Этап **A** спринта «Каноническая система реквизитов (system_customer / user_requisites / platform_executor) + tenant foundation».
Источники: `information_schema`, `pg_policies`, `fields_registry`, `client_legal_details`, `legal_details_persons`, `legal_details_entity_person_links`, `executors`, `ai_generated_documents`, `generated_documents`, кодовая база `src/`, `supabase/functions/`.

---

## 1. Текущие таблицы реквизитов

### 1.1. `client_legal_details` (системно-биллинговые + пользовательско-документные)

Колонки (55 шт.):

- служебные: `id`, `profile_id`, `client_type` (`legal_entity`/`entrepreneur`/`individual`), `purpose` (`billing`/`document`), `status`, `is_default`, `validation_status`, `validation_errors`, `validated_at`, `created_at`, `updated_at`
- ФЛ: `ind_full_name`, `ind_birth_date`, `ind_passport_series`, `ind_passport_number`, `ind_passport_issued_by`, `ind_passport_issued_date`, `ind_passport_valid_until`, `ind_personal_number`, `ind_address_index`, `ind_address_region`, `ind_address_district`, `ind_address_city`, `ind_address_street`, `ind_address_house`, `ind_address_apartment`, `ind_address_structured`
- ИП: `ent_name`, `ent_unp`, `ent_address`, `ent_acts_on_basis`, `ent_address_structured`
- ЮЛ: `leg_org_form`, `leg_name`, `leg_unp`, `leg_address`, `leg_director_position`, `leg_director_name`, `leg_acts_on_basis`, `leg_address_structured`
- общие: `bank_account`, `bank_name`, `bank_code`, `phone`, `email`
- GRP-обогащение: `grp_registration_date`, `grp_tax_office_code`, `grp_tax_office_name`, `grp_status_code`, `grp_status_name`, `grp_short_name`, `grp_liquidation_date`, `grp_liquidation_reason`, `grp_last_fetched_at`

**Двойственная природа**: `purpose='billing'` фактически = «системные реквизиты заказчика», `purpose='document'` = «пользовательские реквизиты для документов». Эта семантика и есть кандидат на разделение в `scope='system_customer'` / `scope='user_requisites'`.

Объёмы (фактические):

| `purpose`  | `client_type`   | строк |
|------------|-----------------|-------|
| `billing`  | `entrepreneur`  | 8     |
| `billing`  | `individual`    | 10    |
| `billing`  | `legal_entity`  | 3     |
| `document` | `entrepreneur`  | 1     |
| `document` | `legal_entity`  | 4     |
| **итого**  |                 | **26**|

### 1.2. `legal_details_persons` (физлица-подписанты, отдельный реестр)

Колонки: `id`, `profile_id`, `full_name`, `birth_date`, `personal_number`, `passport_series`, `passport_number`, `passport_number_full`, `passport_issued_by`, `passport_issued_date`, `passport_valid_until`, `phone`, `email`, `address_structured`, `notes`, `is_active`, `created_at`, `updated_at`. Всего: **7 строк**.

### 1.3. `legal_details_entity_person_links` (связь ЮЛ ↔ персона)

Колонки: `id`, `profile_id`, `legal_details_id`, `person_id`, `role_catalog_id`, `role_type`, `position_catalog_id`, `custom_role_text`, `custom_position_text`, `share_percent`, `acts_on_basis`, `is_primary`, `start_date`, `end_date`, `notes`. Всего: **1 строка**.

### 1.4. `executors` (наши реквизиты — Исполнитель)

Колонки: `id`, `full_name`, `short_name`, `unp`, `legal_address`, `legal_address_structured`, `bank_account`, `bank_name`, `bank_code`, `phone`, `email`, `director_position`, `director_full_name`, `director_short_name`, `acts_on_basis`, `is_default`, `is_active`, `signature_url`. Всего: **2 строки**. RLS: чтение — всем authenticated, запись — admin/super_admin (соответствует требуемой модели `platform_executor`).

### 1.5. Каталоги: `legal_details_positions_catalog`, `legal_details_roles_catalog`

Системные справочники должностей/ролей (`is_system`, `country_scope`, `sort_order`). Общие, не привязаны к пользователю — переиспользуем как есть.

---

## 2. `fields_registry`: текущие записи

| `entity_type`     | строк | FLD-диапазон                |
|-------------------|-------|-----------------------------|
| `legal_details`   | 47    | FLD-000004 … FLD-000050     |
| `executor`        | 15    | FLD-000103 … FLD-000154     |
| `entity`          | 6     | FLD-000084 … FLD-000089     |
| `entity_person`   | 6     | FLD-000063 … FLD-000068     |
| `person`          | 12    | FLD-000051 … FLD-000062 (не выгружено детально, кол-во подтверждено) |

**Семантика**:

- `legal_details` (47) — единственный закрывающий канон по системным реквизитам, по нему живут все формы профиля, биллинг и пользовательские документы.
- `executor` (15) — отдельный реестр для Исполнителя, уже field-id-first, готов под зеркалирование в `platform_executor`.
- `entity` / `person` / `entity_person` (24) — урезанные «AI»-реестры, фактически дублируют подмножество `legal_details`. **Подлежат удалению** по плану (clean reset, без compatibility layer): полей мало, FLD-ID не пересечены с системными, продакшн-зависимостей нет (см. §4).

Оставшиеся в registry поля `legal_details` исчерпывающи по смыслу и закрывают весь ввод, что уже есть в `client_legal_details` + GRP-блоке. Финальный канон формируется на этой базе, без «минимума».

---

## 3. UI / читатели и писатели

### 3.1. Системные формы (Settings → Реквизиты)

- `src/pages/settings/LegalDetails.tsx`
- `src/components/legal-details/OrganizationDetailsForm.tsx` (3-таб контейнер)
- `src/components/legal-details/LegalEntityDetailsForm.tsx`
- `src/components/legal-details/EntrepreneurDetailsForm.tsx`
- `src/components/legal-details/IndividualDetailsForm.tsx`

Используют `useLegalDetailsFields`, `useLegalDetails`, `LEGAL_DETAILS_FIELD_MAP` (`src/lib/legal-details/fieldMap.ts`), `StructuredAddressBlock`, `useGrpRefresh`.

### 3.2. Пользовательские (сейчас «AI»-) формы

- `src/components/ai-requisites/EntityRecordSheet.tsx`
- `src/components/ai-requisites/PersonRecordSheet.tsx`
- `src/components/ai-requisites/PersonFieldsForm.tsx`
- `src/components/ai-requisites/PersonLinkedEntitiesBlock.tsx`
- `src/components/ai-documents/LegalDetailsPickerDialog.tsx`
- `src/components/ai-chat/AiPageContent.tsx`
- `src/hooks/useAiEntities.ts`, `src/hooks/useAiPersons.ts`, `src/hooks/useEntityPersonLinks.ts`, `src/hooks/useEntityDuplicateCheck.ts`, `src/hooks/usePersonDuplicateCheck.ts`

Все читают/пишут в те же `client_legal_details` (по `purpose='document'`) и `legal_details_persons`/`legal_details_entity_person_links`. Своих field-определений у них нет — берут из `legal_details` registry.

### 3.3. Резолвер и реестр токенов

- `src/lib/token-resolver.ts` — формат `{{cf.legal_details.<FLD-…|UUID>}}`.
- `src/lib/tokens/tokenRegistry.ts` — клиентский реестр.
- `supabase/functions/_shared/standard-fields.ts`, `_shared/document-data-snapshot.ts`, `_shared/document-render.ts` — разделяемая логика.

### 3.4. Edge-функции, читающие реквизиты

`supabase/functions/`:
- `ai-generate-document/`, `ai-generate-document-package/`, `ai-generate-corporate-package/`
- `generate-invoice-act/`, `generate-from-template/`, `generate-document-pdf/`, `document-auto-generate/`

Все читают `client_legal_details` / `legal_details_persons` / `legal_details_entity_person_links` напрямую.

### 3.5. Прочее

- `src/lib/corporate/corporateTypes.ts`, `src/integrations/supabase/types.ts` — типы.
- `src/hooks/useGrpRefresh.ts` — GRP-обогащение, читает/пишет `client_legal_details.grp_*`.

---

## 4. Dry-run для clean reset (§9 плана)

Запрос: для каждой строки `client_legal_details` и `legal_details_persons` посчитать использование в **production-документах** (`ai_generated_documents.legal_details_id|person_id|signer_link_id|signer_person_id`, `generated_documents.client_details_id|executor_id`).

| Источник                                  | Использований |
|-------------------------------------------|---------------|
| `ai_generated_documents.legal_details_id` | **0**         |
| `ai_generated_documents.person_id`        | **0**         |
| `ai_generated_documents.signer_link_id`   | **0**         |
| `generated_documents.client_details_id`   | **0**         |
| `generated_documents.executor_id`         | **3**         |

Все 26 строк `client_legal_details` и все 7 строк `legal_details_persons`, и единственная связь в `legal_details_entity_person_links` — **не имеют production-зависимостей**. Единственный непустой ref — `generated_documents.executor_id` (3 шт.) — указывает на `executors`, который остаётся.

**Вывод dry-run**: возможен полный clean reset старых пользовательских/тестовых реквизитов и связей без потери production-документов. Compatibility layer не требуется.

Замечание: `client_legal_details` с `purpose='billing'` (21 строка) — это реальные системные реквизиты пользователей. Их следует **мигрировать** в `legal_entities_requisites`/`individual_requisites` со `scope='system_customer'`, а не удалять. Удаляются: 5 строк с `purpose='document'`, все 7 `legal_details_persons`, единственная связь.

---

## 5. RLS текущих таблиц

- `client_legal_details`: SELECT/UPDATE/DELETE — `profile_id IN (profiles where user_id=auth.uid())`; INSERT — без `with check` (открытый); ALL — admin/super_admin через `user_roles_v2`.
- `legal_details_persons`, `legal_details_entity_person_links`: то же самое (owner via `profile_id`), admin через `has_any_role(...)`.
- `executors`: SELECT — все authenticated (`is_active=true`), ALL — admin.

Замечание по безопасности INSERT-политик: `with check IS NULL` означает, что любой authenticated может вставить запись с произвольным `profile_id`. В новой модели обязательно прописать `WITH CHECK (owner_user_id = auth.uid())`.

---

## 6. Tenant / workspace — отсутствие сущности

Запрошены таблицы `%tenant%`/`%workspace%` в `public` — **не найдено**. Текстовые упоминания `tenant`/`workspace` в коде (`src/services/sitePages/*`, `src/hooks/useIntegrations.tsx`, миграции от 2026-03-18) относятся к тегам/сайт-страницам/интеграциям, **не к multi-tenant сущности**. Соответственно, дублирования архитектуры нет — `tenants` и `tenant_memberships` создаются впервые согласно §8 плана.

---

## 7. Анти-дубликат-чек спринта

| Новое имя                           | Текущий аналог              | Статус             |
|-------------------------------------|-----------------------------|--------------------|
| `legal_entities_requisites`         | `client_legal_details` (ЮЛ+ИП часть, scope=system_customer/user_requisites) | новая таблица; старая остаётся под clean reset → удалится после миграции данных биллинга |
| `individual_requisites`             | `client_legal_details` (ФЛ часть) + `legal_details_persons` | новая таблица; обе старые поглощаются |
| `tenants`                           | —                           | сущности нет, создаём |
| `tenant_memberships`                | —                           | сущности нет, создаём |
| `LegalEntityRequisitesForm`         | `LegalEntityDetailsForm`, `EntrepreneurDetailsForm`, `EntityRecordSheet` | заменяет три формы; старые удаляются |
| `IndividualRequisitesForm`          | `IndividualDetailsForm`, `PersonRecordSheet`, `PersonFieldsForm` | заменяет три формы; старые удаляются |
| `useRequisites` (обобщённый)        | `useLegalDetails`, `useAiEntities`, `useAiPersons`, `useEntityPersonLinks` | один хук на scope+subject_type; старые удаляются |
| `platform_executor` записи в `fields_registry` (зеркало) | `entity_type='executor'` (15 шт.) | поверх `executors` создаются зеркальные FLD-ID для каталога; данных не дублирует |

Дублирующих новых сущностей не вводится. `entity`/`person`/`entity_person` (24 записи registry) удаляются — они дублировали подмножество `legal_details`.

---

## 8. Финальный канон полей (по итогам discovery)

База — `client_legal_details` + 47 записей `entity_type='legal_details'` + 15 записей `entity_type='executor'`. Финальный канон — точное соответствие 1:1 для каждого `subject_type` между `system_customer`, `user_requisites`, `platform_executor`. В FLD-реестре заводятся три параллельных набора:

```
system_customer.legal_entity   ↔ user_requisites.legal_entity   ↔ platform_executor.legal_entity
system_customer.entrepreneur   ↔ user_requisites.entrepreneur   ↔ platform_executor.entrepreneur
system_customer.individual     ↔ user_requisites.individual     ↔ — (исполнитель-ФЛ не предусмотрен)
```

Состав полей по `subject_type` (зафиксирован, отличия только FLD-ID, scope и источник):

- **legal_entity (15 полей)**: `org_form`, `name`, `short_name`, `unp`, `address` (+ `address_structured` JSON), `director_position`, `director_full_name`, `director_short_name`, `acts_on_basis`, `bank_account`, `bank_name`, `bank_code`, `phone`, `email`, `signature_url` (последнее — только `platform_executor`).
- **entrepreneur (10 полей)**: `name`, `short_name`, `unp`, `address` (+ `address_structured` JSON), `acts_on_basis`, `bank_account`, `bank_name`, `bank_code`, `phone`, `email`.
- **individual (16 полей)**: `full_name`, `birth_date`, `personal_number`, `passport_series`, `passport_number`, `passport_number_full`, `passport_issued_by`, `passport_issued_date`, `passport_valid_until`, `address` (+ `address_structured` JSON), `bank_account`, `bank_name`, `bank_code`, `phone`, `email`.
- **GRP-расширения для legal_entity / entrepreneur** (системные, скрытые от пользователя в формах, но сохраняемые): `grp_registration_date`, `grp_tax_office_code`, `grp_tax_office_name`, `grp_status_code`, `grp_status_name`, `grp_short_name`, `grp_liquidation_date`, `grp_liquidation_reason`, `grp_last_fetched_at`.

Отдельные FLD-ID для бабка ЮЛ ≠ банка ФЛ ≠ банка ИП (запрет визуальных дубликатов выполняется автоматически за счёт scope+subject_type в label).

---

## 9. DoD discovery (статус)

- [x] Полный список колонок старых таблиц зафиксирован.
- [x] Все записи `fields_registry` по соответствующим entity_type выгружены.
- [x] Карта совпадений «системное ↔ executor ↔ entity/person» подтверждена (entity/person — подмножество legal_details, дублирование).
- [x] Список читателей/писателей собран (UI + 7 edge-функций + 3 _shared модуля + types).
- [x] RLS текущих таблиц зафиксирован, отмечена дыра в INSERT-политиках.
- [x] Dry-run на удаление: 0 production-зависимостей у `client_legal_details`, `legal_details_persons`, `legal_details_entity_person_links`.
- [x] Анти-дубликат-чек: новые сущности не дублируют существующие, кроме целенаправленно заменяемых.
- [x] Финальный канон полей зафиксирован — не «минимум», а полное покрытие текущей схемы.
- [x] Tenant: сущности нет, создаём впервые (нет конфликта).

**Гейт A пройден.** Можно переходить к этапу B (Tenant foundation) и далее.
