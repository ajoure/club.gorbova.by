# да, согласен, с учетом правок:

## **Главное**

Текущий **Discovery 0.1** правильный, но его нужно усилить: итогом должен быть не только addendum к Discovery, а еще **полный master-plan дальнейшей реализации по фазам**.

То есть подрядчик должен вернуться не с миграцией, а с двумя документами:

```text
.lovable/architecture/companies_sprint_discovery_0_1.md
.lovable/architecture/companies_master_implementation_plan.md
```

Первый — закрывает пробелы Discovery.  
Второй — даёт полный план внедрения Companies по фазам, который потом будем запускать частями.

---

# **Что добавить в план Discovery 0.1**

## **1. Добавить обязательный итоговый master-plan**

В Deliverable добавить:

```text
Дополнительный обязательный файл:
.lovable/architecture/companies_master_implementation_plan.md
```

Содержание:

```text
1. Executive summary
2. Итоговая выбранная архитектура
3. Что остаётся legacy / compat-layer
4. Что создаётся новое
5. Что нельзя трогать
6. Полный phase-by-phase implementation plan
7. Dependencies между фазами
8. Stop-gates перед каждой фазой
9. Rollback strategy
10. Verification matrix
11. Open questions / deferred items
```

---







## **2. В**

`Ready-for-Phase-1` **чек-лист не ставить автоматически все** `yes`

Сейчас написано:

Ready-checklist в конце — все yes.

Лучше заменить на:

```text
Ready-checklist должен быть заполнен фактическими статусами yes/no/blocked.

Если хотя бы один пункт = no/blocked, Phase 1 не планируется как executable migration, а сначала формируется список blocker-доработок.
```

Иначе они могут формально поставить `yes`, даже если часть discovery не доказана.

---







## **3.**

`public_id` **для companies не должен быть** `C-XXXXXX`

В конце указано:

```text
public_id (`C-XXXXXX`)
```

Лучше заменить на:

```text
public_id для companies: CMP-000001 или COM-000001
```

Почему: `C-XXXXXX` обычно читается как Contact. Для компании нужен отдельный namespace, чтобы не смешивать контакты и компании в UI/support.

---





## **4. Уточнить, что**

`.lovable/plan.md` **можно менять только как documentation update**

В DoD указано:

Обновлён `.lovable/plan.md`

Это допустимо, но нужно явно написать:

```text
Разрешено обновлять только markdown-документы Discovery/плана.
Запрещено менять production code, migrations, SQL-функции, UI-компоненты и edge functions.
```

---

# **Добавить раздел 7: полный план дальнейшей реализации**

В Discovery 0.1 нужно добавить новый раздел:

```text
### 7. Draft Master Implementation Plan
```

Он должен дать полный план по фазам, но без выполнения.

Минимальная структура:

## **Phase 1. Canonical Data Model**

Планируемые артефакты:

```text
companies
company_contacts
client_legal_details_company_map
company_contact_person_map
company_sync_queue / notification_outbox decision
```

Должны быть описаны:

- DDL;
- RLS;
- GRANT;
- audit;
- public_id;
- indexes;
- unique constraints;
- dry-run;
- rollback;
- verification SQL.

---

## **Phase 2. Backend / RPC / services**

Планируемые сервисы:

```text
CompanyService
CompanyContactService
CompanyLegalDetailsSyncService
CompanyMergeService
CompanySearchService
```

Планируемые RPC:

```text
crm_company_list
crm_company_get
crm_company_create
crm_company_update
crm_company_archive
crm_company_merge
crm_company_link_contact
crm_company_unlink_contact
crm_company_set_primary_contact
crm_company_search
crm_company_upsert_from_legal_details
```

Обязательно описать:

- idempotency;
- audit;
- RLS;
- workspace resolution;
- duplicate guards;
- no entitlement writes.

---

## **Phase 3. Backfill / dry-run / mapping**

План:

- нормализация УНП;
- dry-run отчёт;
- создание `companies`;
- создание `company_contacts`;
- создание `client_legal_details_company_map`;
- low-confidence cases в review;
- повторный запуск = 0 новых дублей.

Важно: backfill сначала только dry-run, execute отдельным approval.

---

## **Phase 4. ЛК → Company sync**

План:

- сохранить старый flow `client_legal_details`;
- после сохранения вызывать sync service;
- safety-net через queue/outbox;
- не использовать trigger → `pg_net`;
- конфликты реквизитов не перезаписывать молча.

---

## **Phase 5. Orders / deals integration**

План:

- `orders_v2.company_id nullable`;
- `crm_deal_contacts`, если нет аналога;
- DealDetailSheet: компания + основной контакт + доп. контакты;
- company-only deal разрешён для прозвона;
- paid order без access recipient → pending task.

---

## **Phase 6. CRM tasks / calls / activity**

План:

- `crm_tasks.company_id nullable`;
- `calls.company_id nullable`;
- лента компании;
- задачи по компании;
- звонок из карточки компании;
- старые contact/deal calls не ломать.

---

## **Phase 7. UI Companies**

План:

- `/admin/companies`;
- список компаний;
- фильтры;
- поиск;
- карточка компании;
- вкладки: профиль, контакты, сделки, задачи, звонки, документы, лента;
- общий `EntityDetailSheet` shell без copy-paste.

---

## **Phase 8. ContactDetailSheet integration**

План:

- вкладка «Компании» в карточке контакта;
- связь contact ↔ companies;
- роли контакта в компании;
- быстрый переход в карточку компании.

---

## **Phase 9. Import / call-center база прозвона**

План:

- импорт CSV/XLSX;
- mapping fields;
- dry-run;
- duplicates report;
- bulk task creation;
- назначение ответственного;
- звонок → найден контакт → создать/привязать contact.

---

## **Phase 10. Documents / corporate module compatibility**

План:

- не ломать `client_legal_details`;
- добавить `selected_company_id` параллельно legacy FK;
- picker может показывать companies, но документы продолжают работать через compat-layer;
- миграция document module — отдельный follow-up, не смешивать с CRM Companies core.

---

## **Phase 11. System health / invariants / final regression**

План проверок:

```text
нет entitlement на company
company_contacts валидны
нет дублей по normalized UNP
legal orders имеют company_id или review reason
старые contact-only сделки работают
старые документы открываются
старые оплаты работают
ЛК сохраняет реквизиты как раньше
```

---

# **Исправленный текст для подрядчика**

```text
План: CRM Companies — Discovery 0.1 и подготовка полного master implementation plan

Нужно выполнить только read-only Discovery 0.1 и подготовить полный master-plan дальнейшей реализации. Никаких миграций, DDL, DML, RPC, edge functions, UI-компонентов и backfill не выполнять.

Цель:
1. Закрыть 6 пробелов Phase 0 Discovery.
2. Подготовить полный master implementation plan по всем фазам внедрения canonical-сущности companies.
3. Вернуться с документами, которые можно будет отдельно согласовать перед Phase 1.

Обязательные deliverables:
1. .lovable/architecture/companies_sprint_discovery_0_1.md
2. .lovable/architecture/companies_master_implementation_plan.md
3. .lovable/proofs/companies_discovery_0_1_sql.md
4. .lovable/proofs/companies_dependency_map_0_1.md

Discovery 0.1 должен закрыть:

1. Карту RPC / edge functions:
- client_legal_details
- legal_entities_requisites
- legal_details_persons
- legal_details_entity_person_links
- orders_v2
- generated_documents
- ai_generated_documents
- entitlements
- access_grant_ledger
- telegram_access*
- crm_tasks
- crm_activity_log
- calls
- call_events
- invoice/document flows

Формат:
Функция/RPC, тип, читает, пишет, где вызывается, риск при вводе companies, действие в Phase 1+.

2. Полную карту profile_id:
таблица/файл/RPC, семантика profile_id, можно ли добавить company_id рядом, что нельзя трогать.

3. Семантику legal_details_persons.profile_id:
доказать SQL-данными и кодом, что это за profile_id. Автоматический перенос в company_contacts.profile_id запрещён, пока не доказано, что это именно CRM-contact подписанта.

4. Safety-net sync:
основной путь — service/RPC.
safety-net — notification_outbox или company_sync_queue.
trigger → pg_net → RPC запрещён без отдельного technical spike.

5. Workspace / tenant:
доказать, single-workspace сейчас или multi-workspace.
System tenant как DEFAULT допустим только если это подтверждено. Иначе workspace_id должен определяться из user/admin context.

6. Ready-for-Phase-1 checklist:
заполнить фактическими статусами yes/no/blocked.
Если есть no/blocked — Phase 1 не начинать, сначала закрыть blockers.

Дополнительно нужно подготовить полный master implementation plan:

Файл:
.lovable/architecture/companies_master_implementation_plan.md

В master-plan должны быть фазы:

Phase 1. Canonical Data Model
Phase 2. Backend / RPC / services
Phase 3. Backfill / dry-run / mapping
Phase 4. ЛК → Company sync
Phase 5. Orders / deals integration
Phase 6. CRM tasks / calls / activity
Phase 7. UI Companies
Phase 8. ContactDetailSheet integration
Phase 9. Import / call-center база прозвона
Phase 10. Documents / corporate module compatibility
Phase 11. System health / final regression

По каждой фазе указать:
- цель;
- что меняется;
- какие таблицы/RPC/UI затрагиваются;
- что нельзя трогать;
- dependencies;
- stop-gates;
- dry-run/proof;
- rollback;
- verification SQL;
- DoD.

Важно:
- public_id компаний должен быть CMP-000001 или COM-000001, не C-XXXXXX.
- companies и company_contacts пока не создавать.
- company_id пока никуда не добавлять.
- backfill пока не выполнять.
- .lovable/plan.md можно обновлять только как markdown-документацию.
- Production code, migrations, SQL-функции, edge functions, UI-компоненты не менять.

Формат итогового ответа:
Отчет о выполненной работе: CRM Companies Discovery 0.1 и Master Plan

В отчете должны быть:
1. что найдено;
2. какие риски закрыты;
3. какие blockers остались;
4. ссылка на Discovery 0.1;
5. ссылка на Master Implementation Plan;
6. Ready-for-Phase-1 status;
7. предложение следующего шага: подготовить отдельный документ "План: CRM Companies — Phase 1 Canonical Data Model".
```

## **Итог**

План Discovery 0.1 **согласен**, но с обязательным добавлением второго результата: **полного master implementation plan по всем фазам**.

Сейчас подрядчик должен не делать Phase 1, а подготовить финальную карту всей разработки, чтобы потом запускать фазы по очереди.

&nbsp;

План: CRM Companies — Discovery 0.1 (доработка Phase 0 перед Phase 1)

## Контекст

Phase 0 (discovery) принят частично. Основная архитектурная линия зафиксирована:

- `companies` + `company_contacts` — отдельные canonical-сущности;
- `profiles` НЕ превращается в switch contact/company;
- `client_legal_details` и `legal_entities_requisites` остаются как источники/compat-layer;
- access / Telegram / entitlements остаются только за `profile` / `contact`.

Перед Phase 1 (DDL) требуется закрыть 6 пробелов Discovery. Никакой миграции, edge-функции, RPC и UI в этой фазе не делаем — только research + документ.

## Deliverable

Один файл: `.lovable/architecture/companies_sprint_discovery_0_1.md` (дополнение к базовому discovery, не замена). В конце — чек-лист «Ready for Phase 1 planning».

## Содержание Discovery 0.1

### 1. Карта RPC / edge functions (read/write)

Таблица по каждой функции/RPC, которая касается перечисленных сущностей:

| Функция / RPC | Тип (RPC / edge) | Читает | Пишет | Где вызывается (UI/edge/cron) | Риск при вводе `companies` | Действие в Phase 1+ |

Сущности для аудита:

- `client_legal_details`
- `legal_entities_requisites`
- `legal_details_persons`, `legal_details_entity_person_links`
- `orders_v2`
- `generated_documents`, `ai_generated_documents`
- `entitlements`, `access_grant_ledger`, `telegram_access*`
- `crm_tasks`, `crm_activity_log`
- `calls`, `call_events`
- invoice/document flows: `canonical-document-generate-strict`, `canonical-document-send`, `invoice-checkout-issue`, `admin-payment-documents-resolve`, `document-field-resolver-v2*`, legacy `generate-invoice-act` / `send-invoice`

Метод сбора: `rg` по именам таблиц в `supabase/functions/**` и `supabase/migrations/**` (RPC-определения) + перекрёстная проверка вызовов из `src/`.

### 2. Полная карта `profile_id`

Таблица:

| Место (table / file / RPC) | Семантика `profile_id` (кто это: контакт CRM / владелец ЛК / подписант / клиент заказа) | Можно ли добавить `company_id` рядом (yes/no + почему) | Что категорически нельзя трогать |

Скоуп: все таблицы из `<supabase-tables>`, где есть `profile_id`, плюс edge-функции, где `profile_id` фигурирует в payload.

Цель — явно отделить «profile = физлицо-контакт» от «profile = владелец аккаунта в ЛК» и понять, где `company_id` дополняет, а где вообще не имеет смысла.

### 3. Семантика `legal_details_persons.profile_id`

Исследование (read-only SQL + чтение UI/RPC):

- на каких экранах создаётся запись в `legal_details_persons`;
- проставляется ли `profile_id` при добавлении «директор компании X», или только при добавлении собственных реквизитов пользователя;
- SQL-дистрибуция: сколько записей с `profile_id IS NULL`, сколько ссылаются на `profiles.user_id` владельца ЛК, сколько — на «внешних» людей.

Вывод: правило маппинга `legal_details_persons` → `company_contacts` в Phase 2. Автоматический перенос `profile_id` в `company_contacts.profile_id` запрещён до тех пор, пока не доказано, что это CRM-контакт-подписант.

### 4. Safety-net sync — пересмотр

Явно зафиксировать в документе:

- **Основной путь** записи в `companies` / `company_contacts` — сервисная RPC (`get_or_create_company`, `link_company_contact`) или edge-функция; вызывается из места, где создаётся `client_legal_details` / `legal_entities_requisites`.
- **Safety-net** — очередь: `notification_outbox` (существует) ИЛИ отдельная `company_sync_queue` (решение — в Phase 1 плане). Обрабатывается воркером/cron.
- **Запрещено без отдельного technical spike:** trigger → `pg_net` → RPC. Не утверждать в discovery. Записать как «требует отдельного spike, если понадобится».

### 5. Workspace / tenant

Проверить и задокументировать:

- SQL: distinct `workspace_id` в `crm_pipelines`, `orders_v2`, `crm_tasks`, `admin_section` — сейчас все NULL или все = один и тот же.
- Роли `admin/super_admin/employee/crm_manager` — привязаны к workspace или глобальны.
- Использование `tenants` / `tenant_memberships` — операционное или dormant.

Вывод:

- Если подтверждено single-workspace → допустим System tenant `00000000-0000-0000-0000-000000000001` как DEFAULT (как уже сделано для `crm_tasks`).
- Если нет — `workspace_id` для `companies` должен определяться из user/admin context (RPC-параметр или из `tenant_memberships` текущего `auth.uid()`), и это фиксируется как требование к Phase 1 DDL.

### 6. Ready-for-Phase-1 чек-лист

В конце документа — короткий чек-лист (yes/no):

- Карта RPC/edge собрана
- Карта `profile_id` собрана
- Семантика `legal_details_persons.profile_id` подтверждена SQL-данными
- Safety-net решение зафиксировано (сервис + queue, trigger→pg_net отложен)
- Workspace-модель подтверждена (single vs multi)
- Список «нельзя трогать» составлен (access, telegram, entitlements, purchases)

Только после того как все пункты = yes, готовим **отдельный** документ:

`План: CRM Companies — Phase 1 Canonical Data Model` — с DDL, GRANT, RLS, audit, `public_id` (`C-XXXXXX`), bridge-таблицами, dry-run SQL, rollback-скриптом и verification SQL.

## Что НЕ делаем в этой фазе

- Не создаём таблицы `companies` / `company_contacts`.
- Не добавляем колонки `company_id` в существующие таблицы.
- Не пишем migration/RPC/edge/UI.
- Не трогаем `profiles`, `entitlements`, `telegram_access`, `access_grant_ledger`, документ-флоу.

## DoD Discovery 0.1

1. Файл `.lovable/architecture/companies_sprint_discovery_0_1.md` создан.
2. Все 6 разделов заполнены с конкретными именами функций/таблиц/файлов, а не общими формулировками.
3. Для пунктов 3 и 5 — приведены SQL-выкладки (COUNT / distinct), а не догадки.
4. Ready-checklist в конце — все yes.
5. Обновлён `.lovable/plan.md`: Phase 0 → «closed with 0.1 addendum», следующий шаг — «Phase 1 plan draft».