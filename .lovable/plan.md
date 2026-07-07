# да, согласен, с учетом правок:

## **Главное изменение**

Текущий план слишком быстро уходит в **Phase 1–11**. Сейчас подрядчику нужно дать **только Discovery-спринт**, без DDL, миграций, UI, RPC и backfill.

Архитектурно это правильно: платформа требует сначала `DIAGNOSE → PLAN → DRY RUN → EXECUTE → VERIFY`, без пропуска этапов, а перед созданием нового кода нужно проверить существующие таблицы, RPC, edge functions и UI-компоненты.  

---

# **План: CRM Companies — Discovery перед внедрением сущности «Компании»**

## **Обязательные правила**

- План должен быть составлен на русском языке.
- Отчет о выполненной работе должен быть составлен на русском языке.
- Вся переписка, все пояснения и все результаты должны предоставляться только на русском языке.
- На этом этапе **ничего не менять в коде и БД**.
- Запрещены DDL, миграции, RPC, edge functions, UI-компоненты, backfill, triggers.
- Только read-only discovery.
- Цель этапа — полностью понять текущую систему и подготовить финальный безопасный план внедрения.
- `profiles` не трогать как SoT физлиц.
- `profile_id` в `orders_v2`, access, Telegram, entitlements сохраняет текущий смысл.
- Компания никогда не получает entitlement/Telegram/access.
- Все будущие связи должны проектироваться через UUID.
- Не плодить параллельные SoT без compatibility layer.
- Любые предложения по новой архитектуре должны быть add-only и не ломать production.

---

## **1. Цель Discovery**

Подготовить полный архитектурный документ:

```text
.lovable/architecture/companies_sprint_discovery.md
```

В документе должно быть:

1. что сейчас реально есть;
2. какие сущности уже отвечают за юрлица;
3. где используются контакты;
4. где используются юрлица;
5. как связаны заказы, сделки, оплаты, документы, доступы и задачи;
6. какие риски есть при добавлении `companies`;
7. какой вариант архитектуры безопаснее;
8. финальный план дальнейшей реализации.

---

## **2. Что обязательно проверить**

### **2.1. Текущие таблицы контактов и профилей**

Проверить:

```text
profiles
profile_roles / role tables
contact-related fields
contact UI tables/views/RPC
```

Нужно зафиксировать:

- что считается контактом;
- какие поля обязательны;
- где используется `profile_id`;
- какие таблицы завязаны на `profiles.id`;
- какие RPC/edge functions создают или обновляют profile;
- какие UI-компоненты показывают карточку контакта.

---

### **2.2. Текущие таблицы юрлиц**

Проверить минимум:

```text
client_legal_details
legal_entities_requisites
individual_requisites
legal_details_persons
legal_details_entity_person_links
legal_details_roles_catalog
legal_details_positions_catalog
tenants
tenant_memberships
```

По каждой таблице описать:

- назначение;
- поля;
- FK;
- RLS;
- кто пишет;
- кто читает;
- какие UI-компоненты используют;
- какие документы/оплаты завязаны;
- можно ли использовать как источник для будущей `companies`;
- почему это не полноценная CRM-сущность компании.

Важно: в модуле корпоративных документов уже зафиксирован принцип: постоянные данные юрлица хранятся в карточке юрлица, физлица — в карточке физлица, а роль человека в конкретной компании — в link-слое.  

---

### **2.3. Заказы / сделки / оплаты**

Проверить:

```text
orders_v2
payments_v2
subscriptions_v2
entitlements
entitlement_orders
access_grant_ledger
generated_documents
```

Нужно ответить:

- `orders_v2` сейчас является сделкой или есть отдельная CRM-сущность?
- где хранится payer type;
- где хранится payer legal details;
- можно ли безопасно добавить `company_id`;
- какие старые сценарии завязаны только на `profile_id`;
- где создаётся entitlement;
- где Telegram grant;
- где subscription;
- где invoice/act;
- что сломается, если у сделки появится company.

Критичный вывод должен быть явно записан:

```text
company_id — только CRM/billing/document context.
access recipient — только profile/contact.
```

---

### **2.4. CRM / задачи / активности / звонки**

Проверить:

```text
crm_tasks
crm_activity_log
crm_pipelines
crm_pipeline_stages
crm_task_automation_rules
calls
call_events
call_sync_queue
sms_messages
VOCHI / ManyChat integrations
```

Нужно описать:

- можно ли задачи привязывать к компании;
- как сейчас задачи привязаны к contact/deal;
- можно ли звонить из карточки компании;
- как сейчас хранится номер телефона звонка;
- можно ли звонок связать с `company_id`;
- какие изменения нужны для call-center workflow;
- есть ли риск сломать текущие звонки по контактам.

---

### **2.5. Личный кабинет / реквизиты / документы**

Проверить:

```text
src/pages/settings/LegalDetails.tsx
src/components/legal-details/*
src/hooks/useLegalDetails.tsx
src/hooks/useRequisitesV2.ts
src/components/requisites-v2/*
ai-requisites/*
ai-documents/LegalDetailsPickerDialog.tsx
admin/DealPayerDocumentsCard.tsx
payment/InvoiceCheckoutDialog.tsx
purchases/InvoiceActPreviewDialog.tsx
```

Нужно описать:

- где пользователь создаёт юрлицо;
- в какую таблицу оно пишется;
- как выбирается юрлицо для документов;
- где используется `client_legal_details.id`;
- где используется `legal_entities_requisites.id`;
- можно ли построить compatibility mapping;
- какие места нельзя переводить сразу на `companies`.

---

### **2.6. Импорт / база прозвона**

Проверить:

```text
import_jobs
import_mapping_rules
existing import UI/components
```

Нужно понять:

- можно ли переиспользовать существующий импорт;
- подходит ли он для базы юрлиц;
- есть ли dry-run;
- есть ли mapping полей;
- есть ли отчёт ошибок;
- как массово создать задачи на прозвон.

---

## **3. SQL-отчёты, которые нужно подготовить**

В Discovery должны быть read-only SQL-отчёты.

### **3.1. Юрлица в legacy**

```sql
-- total by client_type / purpose / status
-- unique leg_unp / ent_unp
-- rows without UNP
-- duplicates by normalized UNP
-- conflicts: same UNP, different names
```

### **3.2. Юрлица в v2**

```sql
-- legal_entities_requisites by subject_type / scope
-- data->>'leg_unp'
-- data->>'ent_unp'
-- source_legacy_id coverage
-- duplicates / missing UNP / conflicts
```

### **3.3. Связи с документами**

```sql
-- generated_documents.client_details_id
-- document_package_sessions.selected_legal_entity_id
-- corporate_draft_sessions.legal_details_id
-- document_package_session_participants.legal_entity_id
```

### **3.4. Заказы ЮЛ**

```sql
-- orders_v2 where payer_type='legal_entity'
-- наличие generated_documents/client_details
-- наличие profile_id
-- paid legal orders
-- orders without access recipient risk
```



### **3.5. Использование**

`profile_id`

```sql
-- все FK/колонки profile_id в public schema
-- таблицы с большим риском для access/payment/CRM
```

---

## **4. Code grep / dependency map**

Сделать grep по репозиторию:

```text
client_legal_details
legal_entities_requisites
individual_requisites
legal_details_persons
legal_details_entity_person_links
profile_id
payer_type
legal_entity
entitlement
access_grant
telegram
orders_v2
crm_tasks
calls
ContactDetailSheet
DealDetailSheet
LegalDetailsPickerDialog
InvoiceCheckoutDialog
```

Результат оформить таблицей:

```text
Файл
Что делает
Читает / пишет
Какая таблица
Риск
Что делать в будущем
```

---

## **5. Compatibility matrix**

Сделать таблицу:

```text
Текущая сущность / таблица
Текущий смысл
Будущая роль
Нужно ли добавлять company_id
Можно ли мигрировать сейчас
Риск
Рекомендация
```

Минимум покрыть:

```text
client_legal_details
legal_entities_requisites
legal_details_persons
legal_details_entity_person_links
orders_v2
generated_documents
document_package_sessions
corporate_draft_sessions
crm_tasks
calls
profiles
entitlements
subscriptions_v2
payments_v2
```

---

## **6. Архитектурные варианты, которые нужно сравнить**

Discovery должен сравнить минимум 3 варианта.



### **Вариант A — отдельная**

`companies`

```text
profiles = контакты/физлица
companies = юрлица/организации
company_contacts = связь человек ↔ компания
orders_v2.company_id = компания сделки/плательщика
```

### **Вариант B — company как тип profile**

```text
profiles.type = contact/company
```

Проверить и, скорее всего, отклонить из-за риска смешать access/contact/company.





### **Вариант C — использовать**

`legal_entities_requisites` **как компании**

Проверить и, скорее всего, отклонить как CRM SoT, потому что таблица сейчас owner/profile/tenant-bound, а не глобальная база компаний для CRM и прозвона.

В финале Discovery подрядчик должен явно выбрать рекомендуемый вариант и объяснить почему.

---

## **7. Risk matrix**

Обязательно описать риски:

```text
Риск
Где возникает
Вероятность
Последствие
Как закрываем
Blocker / non-blocker
```

Минимум риски:

- сломать выдачу доступов;
- выдать entitlement компании;
- потерять связь заказа с profile;
- задублировать юрлица по УНП;
- перезаписать реквизиты из ЛК;
- сломать документы;
- создать третий SoT юрлиц;
- сломать ContactDetailSheet;
- сломать звонки;
- сломать задачи;
- сделать компанию обязательной там, где она должна быть nullable;
- смешать подписанта компании с реальным profile/contact;
- не учесть `legal_details_persons`.

---

## **8. Финальный результат Discovery**

В конце подрядчик должен дать не код, а документ:

```text
Отчет о выполненной работе: CRM Companies Discovery
```

В отчёте должны быть:

1. краткий executive summary;
2. полная карта текущих таблиц;
3. полная карта UI;
4. полная карта edge functions/RPC;
5. SQL-отчёты;
6. grep/dependency map;
7. compatibility matrix;
8. risk matrix;
9. recommended architecture;
10. финальный implementation plan по фазам;
11. список того, что нельзя трогать;
12. список точек, где нужен compatibility layer;
13. список открытых вопросов, если они реально остались;
14. proof-файлы в `.lovable/proofs/`.

---

## **9. Что запрещено в этом Discovery-спринте**

Запрещено:

```text
CREATE TABLE
ALTER TABLE
CREATE FUNCTION
CREATE POLICY
CREATE TRIGGER
INSERT/UPDATE/DELETE
создание UI
создание RPC
создание edge function
backfill
merge данных
изменение ContactDetailSheet
изменение LegalDetails
изменение orders_v2
```

Разрешено:

```text
SELECT queries
information_schema queries
pg_catalog queries
grep/read-only code inspection
подготовка markdown-документов
подготовка SQL dry-run queries без выполнения изменений
финальный план реализации
```

---

## **10. Формулировка для подрядчика**

Отправь ему так:

```text
План: CRM Companies — Discovery перед внедрением сущности «Компании»

Нужно выполнить только Discovery. Никаких изменений в БД, коде, UI, RPC, edge functions, RLS, triggers и миграциях не делать.

Цель — полностью изучить текущую систему и подготовить финальный безопасный implementation plan для внедрения сущности «Компании» как отдельной CRM-сущности, связанной с контактами, сделками, ЛК, документами, задачами и базой прозвона.

Обязательные правила:
- План должен быть составлен на русском языке.
- Отчет о выполненной работе должен быть составлен на русском языке.
- Вся переписка, все пояснения и все результаты должны предоставляться только на русском языке.
- Только read-only discovery.
- Не выполнять DDL/DML.
- Не создавать новых таблиц, RPC, функций, компонентов.
- Не изменять ContactDetailSheet, orders_v2, LegalDetails, документы, оплаты и access.
- Access/Telegram/entitlements всегда остаются за profile/contact, не за company.
- profiles остаётся SoT физлиц/контактов.
- Нужно проверить существующие таблицы, RPC, edge functions и UI-компоненты перед любыми будущими изменениями.

Итоговый артефакт:
.lovable/architecture/companies_sprint_discovery.md

Дополнительно:
.lovable/proofs/companies_discovery_sql.md
.lovable/proofs/companies_dependency_map.md
.lovable/proofs/companies_risk_matrix.md

В отчете должны быть:
1. карта существующих таблиц;
2. карта всех FK и зависимостей profile_id/legal_details;
3. карта edge functions/RPC;
4. карта UI-компонентов;
5. SQL-отчеты по client_legal_details и legal_entities_requisites;
6. анализ заказов ЮЛ и payer_type='legal_entity';
7. анализ CRM-задач, звонков и базы прозвона;
8. compatibility matrix;
9. risk matrix;
10. сравнение вариантов: отдельная companies / company как profile type / legal_entities_requisites как CRM company;
11. recommended architecture;
12. финальный план дальнейшей реализации по фазам.

После Discovery вернуться только с отчетом:
Отчет о выполненной работе: CRM Companies Discovery
```

Итог: текущий план как общий master-plan нормальный, но сейчас его нужно сузить до **одного read-only Discovery-спринта**. Это снижает риск сломать оплату, документы, доступы и текущие связи контактов.

&nbsp;

План: CRM Companies — отдельная сущность компаний, связи с контактами, сделками, ЛК и базой прозвона

## Обязательные правила

- Ответ, план и все отчёты — только на русском.
- `profiles` не трогаем как SoT физлиц; `profile_id` в orders_v2/deals/entitlements сохраняем.
- Компания никогда не получает entitlement/Telegram/access. Access всегда за profile/contact.
- Все связи через UUID. Новые таблицы: `id`, `public_id`, `workspace_id`, timestamps, `created_by/updated_by`, `metadata`, audit.
- Никаких DDL/UI до завершения Phase 0 (Discovery gate).
- Порядок: DIAGNOSE → PLAN → DRY RUN → EXECUTE → VERIFY. Пропуск шагов запрещён.
- Перед созданием любой сущности/RPC/компонента — duplicate discovery по существующим таблицам и коду.

---

## Что уже есть в системе (первичный discovery — база плана)

Уже подтверждено запросами к БД и грепом по репозиторию:

### Существующие таблицы юрлиц

1. `**public.client_legal_details**` — исторический основной SoT реквизитов в ЛК.
  - Плоские поля: `client_type` (`individual` / `entrepreneur` / `legal_entity`), `purpose` (`billing` / `document`), `is_default`, `status`.
  - Реквизиты ЮЛ: `leg_name`, `leg_unp`, `leg_address`, `leg_org_form`, `leg_director_*`, `leg_acts_on_basis`, `leg_address_structured`.
  - Реквизиты ИП: `ent_name`, `ent_unp`, `ent_address`, `ent_address_structured`.
  - Банковские: `bank_account`, `bank_name`, `bank_code`.
  - ГРП-обогащение: `grp_short_name`, `grp_status_*`, `grp_tax_office_*`, `grp_registration_date`, `grp_last_fetched_at`.
  - Контакт: `phone`, `email`.
  - FK: `profile_id → profiles(id)`.
  - Ссылаются: `corporate_draft_sessions`, `document_package_session_participants.legal_entity_id`, `document_package_sessions.selected_legal_entity_id`, `generated_documents.client_details_id`, `legal_details_entity_person_links.legal_details_id`.
  - Данные: 42 строки (23 individual, 9 entrepreneur, 4+4 legal_entity billing/document). Реальных ЮЛ ~7 уникальных УНП.
2. `**public.legal_entities_requisites**` — новая (v2) канoническая таблица корпоративных реквизитов.
  - Поля: `tenant_id`, `owner_user_id`, `owner_profile_id`, `scope` (`system_customer` / `user_requisites`), `subject_type` (`legal_entity` / `entrepreneur`), `is_default`, `data jsonb`, `source_legacy_id` (ссылка на `client_legal_details`).
  - Все реквизиты в `data jsonb` (те же поля, что в `client_legal_details`).
  - RLS через `tenant_id` и `user_tenant_ids`. Есть `legacy_id` — значит уже идёт миграция со старого источника.
  - Данные: 11 строк (8 ИП + 3 ЮЛ, все `scope=system_customer`).
3. `**public.individual_requisites**` — аналог для физлиц (`scope`, `data jsonb`), тоже с `source_legacy_id`.
4. `**public.legal_details_persons**` — люди-подписанты (директор, представитель) внутри карточки клиента (не путать с `profiles`).
  - `profile_id → profiles(id)`, полные ФИО/паспорт/адрес/банк/personal_number.
  - 4 строки, 2 profile.
5. `**public.legal_details_entity_person_links**` — связь «юрлицо ↔ человек-подписант»: `legal_details_id`, `person_id`, `role_catalog_id`, `role_type`, `position_catalog_id`, `share_percent`, `acts_on_basis`, `is_primary`, `start_date/end_date`. Плюс `legal_details_roles_catalog` и `legal_details_positions_catalog`.
6. `**public.tenants` / `tenant_memberships**` — есть, но `is_personal=true` у всех. Используются только новой v2-парой (`legal_entities_requisites`, `individual_requisites`).

### Существующий UI/сервисы (частично)

- `src/pages/settings/LegalDetails.tsx` — страница ЛК, где юзер добавляет реквизиты.
- `src/components/legal-details/*` — формы (LegalEntity, Entrepreneur, Individual, Organization).
- `src/hooks/useLegalDetails.tsx`, `useLegalDetailsFields.ts`, `useEntityPersonLinks.ts`, `useEntityDuplicateCheck.ts`, `useGrpRefresh.ts`.
- v2: `src/hooks/useRequisitesV2.ts`, `src/components/requisites-v2/RequisitesV2Manager.tsx`, `src/lib/requisites-v2/fieldMap.ts`.
- Документы: `ai-requisites/*`, `ai-documents/LegalDetailsPickerDialog.tsx`, `admin/DealPayerDocumentsCard.tsx`.
- Оплата: `payment/InvoiceCheckoutDialog.tsx`, `purchases/InvoiceActPreviewDialog.tsx`.

### Оплаты/сделки

- `orders_v2.payer_type` уже есть (`individual` / `legal_entity`): 4035 / 20 записей.
- **Company_id в `orders_v2` нет.** В `profiles` нет company-полей. Т.е. связка ЮЛ↔заказ сейчас косвенная — через `client_legal_details` (например `generated_documents.client_details_id`), не прямая.
- CRM: `orders_v2` = сделки; отдельной таблицы `crm_deals` нет; `crm_pipelines/stages`, `crm_tasks`, `crm_activity_log` есть.
- Таблиц `deal_contacts` / `company_*` / `organizations` / `counterparties` **нет**.
- Звонки: `calls`, `call_events`, `call_sync_queue`, `sms_messages`. Привязки к company нет.
- Импорт: `import_jobs`, `import_mapping_rules` — общий механизм, надо проверить, годится ли для компаний.

### Ключевой архитектурный вывод по discovery

Уже де-факто существуют **два параллельных источника юрлиц**: legacy `client_legal_details` (используется документами/оплатой) и v2 `legal_entities_requisites` (с `source_legacy_id` для миграции). Ни один из них не является CRM-сущностью «Компания» — оба привязаны к владельцу-физлицу (`profile_id`/`owner_profile_id`), одна и та же компания у двух разных клиентов = две записи, дедупа по УНП нет, компании «для прозвона без клиента» негде хранить.

Правильное решение: **canonical `companies` — отдельная сущность, а `client_legal_details` / `legal_entities_requisites` становятся источниками для upsert в `companies**`, не удаляясь. Связь клиента с компанией переезжает в `company_contacts`.

---

## Phase 0. Discovery gate (обязательный, без DDL)

Выход: `.lovable/architecture/companies_sprint_discovery.md` (утверждается перед Phase 1).

Содержимое:

1. **Схема данных по всем связанным таблицам** (расширить над результатом выше):
  - `client_legal_details` — полный список FK-ссылающихся таблиц, все edge functions и RPC, которые пишут/читают её.
  - `legal_entities_requisites` / `individual_requisites` / `legal_details_persons` / `legal_details_entity_person_links` — то же.
  - `orders_v2`, `payments_v2`, `subscriptions_v2`, `entitlements`, `access_grant_ledger`, `entitlement_orders` — все места, где `profile_id` используется и где может понадобиться `company_id`.
  - `crm_pipelines/stages`, `crm_tasks`, `crm_activity_log`, `crm_task_automation_rules` — куда добавлять `company_id`.
  - `generated_documents`, `document_package_sessions`, `document_package_session_participants`, `corporate_draft_sessions` — как переключить с `client_legal_details.id` на company при сохранении совместимости.
  - `document_package_item_role_assignments.person_id` — связь с `legal_details_persons`, важно для представителей компании.
2. **Карта edge functions / RPC**, которые создают/меняют юрлицо, заказ, доступ, задачу, звонок. Реестр `edge_functions_registry` + грепа по `supabase/functions/`.
3. **Карта UI-мест**: `LegalDetails.tsx`, `LegalDetailsPickerDialog`, `DealPayerDocumentsCard`, `RequisitesV2Manager`, `InvoiceCheckoutDialog`, `ai-requisites/*`, `admin/DealDetailSheet`, `admin/ContactDetailSheet`, список контактов/сделок, звонки/ManyChat/VOCHI.
4. **Дубли и коллизии по УНП** — SQL-репорт: сколько уникальных УНП в `client_legal_details` и в `legal_entities_requisites.data->>'leg_unp'/'ent_unp'`, сколько будет схлопнуто, сколько без УНП.
5. **Compatibility матрица**: legacy `client_legal_details.id` vs `legal_entities_requisites.id` vs новый `companies.id` — для каждой ссылающейся таблицы решение: (a) добавить `company_id`, (b) оставить как есть + backfill маппинг, (c) миграция FK.
6. **Reuse-план UI**: какие компоненты вынести в общий shell `EntityDetailSheet`, какие вкладки переиспользовать. Явный список файлов.
7. **Risk matrix**: список рисков (тихая перезапись реквизитов, разрыв ссылок в документах, потеря access) и как их закрываем.
8. **Инварианты и system_health-чеки** — список правил, которые будем проверять в Phase 11.

DoD Phase 0: документ утверждён, риски покрыты, для каждой существующей сущности сказано «переиспользуем» / «источник для backfill» / «создаём новое». Без утверждения — DDL не начинать.

---

## Phase 1. Canonical data model (после утверждения Phase 0)

### 1.1. `public.companies`

Поля: `id`, `public_id` (CMP-000001 через `public_id_sequences`), `workspace_id NOT NULL DEFAULT <system tenant>`, `company_type` (`legal_entity`/`sole_proprietor`/`organization`/`unknown`), `country_code`, `name`, `short_name`, `legal_form`, `unp`, `tax_id_normalized` (нормализованный УНП), `registration_number`, `legal_address jsonb`, `actual_address jsonb`, `phone`, `email`, `website`, `source` (`manual`/`client_legal_details`/`legal_entities_requisites`/`import`/`admin`/`document_generation`/`grp`), `source_ref_table`, `source_ref_id`, `duplicate_group_id`, `status` (`active`/`archived`/`merged`), `merged_into_id`, `grp_snapshot jsonb`, `grp_last_fetched_at`, `notes`, `metadata jsonb`, timestamps, `created_by`, `updated_by`.

Уникальность: `UNIQUE(workspace_id, country_code, tax_id_normalized) WHERE tax_id_normalized IS NOT NULL`. Индексы по `name`, `unp`, `phone`, `email`, `duplicate_group_id`.

GRANT + RLS + audit trigger.

### 1.2. `public.company_contacts`

Поля: `id`, `public_id`, `workspace_id`, `company_id → companies(id)`, `profile_id → profiles(id)`, `relationship_type` (`employee`/`director`/`owner`/`accountant`/`representative`/`signer`/`buyer`/`other`), `position_title`, `is_primary`, `is_decision_maker`, `is_billing_contact`, `is_access_recipient`, `share_percent`, `votes_count`, `authority_basis`, `started_at`, `ended_at`, `source`, `metadata`, timestamps, `created_by`, `updated_by`.

Ограничения: `UNIQUE(workspace_id, company_id, profile_id, relationship_type)`; partial `UNIQUE(company_id) WHERE is_primary=true`.

### 1.3. `public.crm_deal_contacts` — только если discovery подтвердит отсутствие аналога

Поля: `id`, `public_id`, `workspace_id`, `deal_id → orders_v2(id)`, `profile_id`, `role` (`primary`/`participant`/`payer_contact`/`access_recipient`/`decision_maker`), `is_primary`, `metadata`, timestamps.

### 1.4. Nullable `company_id` в существующие таблицы

Только после подтверждения безопасности в Phase 0: `orders_v2.company_id`, `crm_tasks.company_id`, `calls.company_id` (если применимо). Индексы; никакой смены обязательности `profile_id`.

### 1.5. `public.company_import_batches` + `company_import_rows` — для базы прозвона (см. Phase 9).

### 1.6. Опционально — bridge-view/маппинг

`v_client_legal_details_to_company` — обзор соответствий legacy → company (для отчётов и постепенного перехода документов).

---

## Phase 2. Backend / RPC / сервисный слой

Сервисы: `CompanyService`, `CompanyContactService`, `CompanyImportService`, `CompanyDealLinkService`.

RPC (все с `SECURITY DEFINER`, `has_role_v2`, audit, idempotency, workspace-scope):
`crm_company_list`, `_get`, `_create`, `_update`, `_archive`, `_merge`, `_link_contact`, `_unlink_contact`, `_set_primary_contact`, `_link_deal`, `_search` (по имени/УНП/телефону/email), `_upsert_from_legal_details(source_table, source_id)`, `_import_dry_run`, `_import_execute`, `_grp_refresh` (переиспользовать `useGrpRefresh` инфраструктуру).

Каждый RPC пишет:

- `audit_logs` (создание/обновление/merge/link);
- `domain_events` (`crm.company.upserted`, `.merged`, `.contact_linked`, `.imported`) — для будущих воркеров.

---

## Phase 3. Backfill из существующих юрлиц

Источники: `client_legal_details` + `legal_entities_requisites` (у него уже есть `source_legacy_id` → используем как основу маппинга).

Правила:

1. Нормализация УНП: strip whitespace, only digits, длина/чек-сумма — вынести в SQL-функцию `normalize_unp(text, country_code)`.
2. UPSERT по `(workspace_id, country_code, tax_id_normalized)`.
3. Без УНП — не склеивать автоматически: создать company с `duplicate_group_id`, записать в review-list.
4. `company_contacts` link:
  - `client_legal_details.profile_id` → `company_contacts` с `relationship_type='buyer'/'billing'`, `is_billing_contact=true`, `source='client_legal_details'`.
  - `legal_entities_requisites.owner_profile_id` → аналогично.
  - `legal_details_persons` + `legal_details_entity_person_links` → `company_contacts` (representative/director/signer), но `profile_id` персоны, если найден по `profile_id` из `legal_details_persons`.
5. Ручные правки company не перетирать без правил приоритета (`updated_by IS NOT NULL AND source != 'grp'` — не трогать).
6. Dry-run отчёт SQL: total, unique UNP, will create, will update, will link, duplicates, missing UNP, conflicts. Сохранить в `.lovable/proofs/companies_backfill_dryrun.md`.
7. Execute — только после ревью dry-run.

---

## Phase 4. Синхронизация «ЛК → Company»

- Insert/update в `client_legal_details` или `legal_entities_requisites` → сервис `CompanyService.upsertFromLegalDetails()`.
- Реализация: **RPC-обёртка + edge function** — основной путь бизнес-логики; DB-триггер только как safety net на случай прямых INSERT/UPDATE, идущих мимо сервиса (решение зафиксировать в Phase 0).
- При конфликте (разный УНП, разное имя) — не тихая перезапись: заносить в `system_health_discovery_findings` и уведомлять админа, показывая source trace.
- `domain_event 'company.upserted_from_client_legal_details'` для будущих потребителей.

---

## Phase 5. Deals / Orders / Access

### 5.1. Deals (orders_v2)

- Добавить `company_id nullable`, backfill из `client_legal_details` через `generated_documents.client_details_id` и `corporate_draft_sessions.legal_details_id`, где `payer_type='legal_entity'`.
- DealDetailSheet: блоки «Компания», «Основной контакт», «Дополнительные контакты» (`crm_deal_contacts`).

### 5.2. Orders

- Правило: `payer_type='legal_entity' AND matched_legal_details IS NOT NULL → company_id NOT NULL`. Гвард в RPC-создания заказа.

### 5.3. Access (критично)

- Entitlement/telegram/subscription всегда от `profile_id`, никогда от `company_id`.
- Если заказ компании без контакта: `access_status='pending_access_recipient'`, не выдаём entitlement, создаём `crm_task` типа «Указать получателя доступа».
- Инвариант: `NOT EXISTS entitlement WHERE company_id IS NOT NULL AND profile_id IS NULL` — проверка в system_health.

---

## Phase 6. UI: `/admin/companies` (список)

Раздел в левом меню рядом с «Контакты»/«Сделки».

Таблица: название, УНП, телефон, email, счётчик контактов, счётчик сделок, ответственный, источник, статус, дата.

Фильтры: поиск (имя/УНП/телефон/email), источник, «без контактов», «есть сделки», «для прозвона», статус.

Действия: создать компанию, импорт CSV/XLSX (Phase 9), bulk-создание задач.

---

## Phase 7. `CompanyDetailSheet`

Через общий shell `EntityDetailSheet` (переиспользуемый layout: header + tabs + timeline + actions), заимствованный из существующего `ContactDetailSheet`, но **без copy-paste** — выносим shell в отдельный компонент и передаём entity-specific профильную вкладку.

Вкладки:

1. **Профиль** — реквизиты (UNP, адреса, банк), source trace, notes, GRP-refresh (reuse `useGrpRefresh`).
2. **Контакты** — `company_contacts` c ролями/флагами, привязать/создать контакт.
3. **Сделки** — сделки компании, создание/привязка.
4. **Задачи** — `crm_tasks WHERE company_id=…` (reuse `useCrmTasks`).
5. **Звонки** — `calls WHERE company_id=… OR to_number=companies.phone`, кнопка «Позвонить».
6. **Документы** — `generated_documents` + `document_package_sessions`, где использовалась компания (через маппинг legacy `client_details_id ↔ company_id`).
7. **Лента** — `audit_logs` + `crm_activity_log` + `domain_events` (compact).

---

## Phase 8. `ContactDetailSheet` → вкладка «Компании»

Добавить вкладку в существующий `ContactDetailSheet` (обходимся без разрушения текущих вкладок): список `company_contacts WHERE profile_id=contact.id` с ролью/должностью/флагами, сделки по компании, кнопки «Привязать к компании» / «Создать компанию».

---

## Phase 9. Call-center / база прозвона

- `company_import_batches` + `company_import_rows` (см. 1.5).
- UI: `/admin/companies/import` — загрузка CSV/XLSX, mapping-мастер (переиспользовать `import_mapping_rules` если позволит discovery), dry-run с отчётом (создано/обновлено/дубли/ошибки), execute.
- После импорта — bulk-создание `crm_tasks` типа «Прозвон» с назначением ответственного.
- В карточке компании — кнопка «Позвонить» через существующие `calls`/VOCHI (найти в Phase 0).
- Найденный при звонке человек → создать `profiles` + `company_contacts` (роль `employee`/`representative`/`decision_maker`), опционально создать сделку.

---

## Phase 10. Documents / Corporate module

- `companies` = SoT юрлица для корпоративных документов. `client_legal_details` / `legal_entities_requisites` остаются как billing/document input и как источник исторических пакетов; ссылки не ломаем.
- `document_package_sessions.selected_legal_entity_id` — в Phase 1 добавляем nullable `selected_company_id`, backfill; UI-picker показывает companies, но при сабмите продолжает писать `client_legal_details.id` через compatibility layer, пока не мигрируем document module (отдельная задача, вне текущего плана).
- `legal_details_persons` → маппинг в `company_contacts` (relationship_type=`director`/`representative`/`signer`), сохраняя `person_id` для документов через compat-таблицу `company_contact_person_map` (если Phase 0 подтвердит необходимость).

---

## Phase 11. Verification / regression

БД:

- RLS по `workspace_id`, `anon` без доступа, `admin/staff` только свой workspace.
- Дедуп по нормализованному УНП работает.
- Backfill не создаёт дубли (повторный запуск = 0 изменений).
- `orders_v2.company_id` nullable — старые заказы не сломаны.

Payments/Access:

- Старая покупка физлица работает как прежде.
- Покупка ЮЛ создаёт/линкует company.
- Entitlement выдаётся только profile.
- Заказ ЮЛ без контакта → pending + task, а не тихая выдача.

CRM:

- Сделка contact-only, company+contact, company-only — все три сценария открываются.
- Карточка контакта показывает компании; карточка компании — контакты и сделки; звонок и задачи по компании работают.

ЛК:

- Добавление ЮЛ создаёт/обновляет company; billing-документы не ломаются; конфликт реквизитов не затирает без предупреждения.

UI:

- `/admin/contacts`, `ContactDetailSheet` — вкладки на месте.
- `DealDetailSheet` — старые поля на месте, новые блоки добавлены.
- `/admin/companies` работает.

Инварианты (в system_health):

- `company_contact` ссылается на существующие company/profile.
- `order.company_id` заполнен, если `payer_type='legal_entity'` и есть матч legal details.
- Оплаченный legal-заказ имеет access recipient или явный `pending_access` флаг.
- Дедуп по `tax_id_normalized` не нарушается.
- Нет entitlement для company без profile.

DoD плана: Phase 0 утверждён, все Phase 11 проверки зелёные, отчёты на русском в `.lovable/proofs/`.

---

## Что делаем прямо сейчас после утверждения плана

1. Собираем Phase 0 discovery-документ (read-only), фиксируем финальные решения по compat-слою для документов и по DB-триггер vs сервисный upsert.
2. Возвращаемся с итогом Phase 0 и предлагаем миграцию Phase 1.