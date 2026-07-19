# да, согласен, с учетом правок:

1. **Зафиксировать неизменяемые инварианты Master Plan v2.** Discovery 1.0 проверяет способы реализации и переиспользование, но не открывает заново уже принятые архитектурные решения:

```text
- companies — standalone canonical CRM-сущность;
- profiles остаётся сущностью физлица/контакта;
- access, entitlements и Telegram всегда привязаны только к profile_id;
- auto-source только:
  client_legal_details.purpose='billing'
  AND client_type IN ('legal_entity','entrepreneur');
- purpose='document', legal_details_persons,
  legal_details_entity_person_links не участвуют в CRM auto-source;
- client_legal_details остаётся compat SOT;
- company_contact_person_map не входит в Phase 1 и остаётся deferred для Phase 10+;
- Phase 1 core ограничен:
  companies,
  company_contacts,
  client_legal_details_company_map,
  company_sync_queue либо доказанным переиспользованием существующей очереди.

```

Discovery может уточнить детали реализации этих решений, но отменить их можно только отдельным ADR с явным approval пользователя.

2. **Phase C не должна реально выбирать Entity-абстракцию как равноправный путь текущего спринта.** ADR-0001 должен фиксировать:

```text
Решение текущего спринта:
companies + company_contacts как standalone-модель.

Entity abstraction:
только потенциальное эволюционное направление после Phase 11,
не часть текущего DDL и не основание для рефакторинга CRM сейчас.

```

Иначе Discovery может снова вернуть проект к уже закрытой архитектурной дискуссии.

3. **Phase J не должна автоматически требовать добавления `parent_company_id` и `hierarchy_type` в Phase 1.** Это пока speculative future scope. Правильная формулировка:

```text
Discovery документирует будущие требования к hierarchy.
Добавление parent_company_id / hierarchy_type в Phase 1 допускается
только если подтвержден реальный ближайший use case и принято отдельное
решение в Phase 1 плане. Иначе поля остаются deferred.

```

Не нужно добавлять поля «на всякий случай».

4. `**companies_phase1_execution_[plan.md](http://plan.md)` должен быть явно нерunnable.** Поскольку Final Discovery ещё не утверждён, документ необходимо маркировать:

```text
Статус: DRAFT / NOT APPROVED / DO NOT EXECUTE

```

Он должен содержать предполагаемые DDL/RLS/rollback/verification, но никакая миграция не запускается до отдельного approval после проверки всех discovery-документов.

5. **В Final Discovery нужно закрыть вопрос очереди.** Сейчас в Master Plan остаётся развилка:

```text
company_sync_queue
vs
переиспользование notification_outbox / другой существующей queue

```

Discovery обязан:

- проинвентаризировать существующие outbox/queue/worker-паттерны;
- проверить payload, retry, locking, status, attempts, observability;
- дать однозначную рекомендацию;
- запретить создание `company_sync_queue`, если существующая очередь семантически подходит;
- либо обосновать отдельную очередь, если notification-outbox предназначен только для уведомлений.

Решение зафиксировать в `companies_architecture_[freeze.md](http://freeze.md)` и Phase 1 draft.

6. **Разделить activity, domain events и audit по назначению.** Discovery не должен выбирать одну таблицу как универсальную. Нужно отдельно определить:

```text
crm_activity_log
— бизнес-лента CRM;

domain_events / domain_executions
— междоменная доставка, lineage, retries;

audit_logs
— аудит критических действий пользователя/администратора.

```

Для каждого будущего события Companies указать, куда оно должно попадать. Это соответствует принципам событийности, аудита, ID-driven связей и запрета дублирования.

7. **Все упоминания `entity_type='company'` считать гипотезой до проверки schema constraints.** Нужно проверить:

- тип колонки;
- CHECK constraint;
- PostgreSQL ENUM;
- FK;
- nullable;
- используемые RPC;
- TypeScript-типы;
- hardcoded switch/case.

Недостаточно увидеть текстовую колонку `entity_type`. В deliverable должен быть вердикт:

```text
работает без DDL;
требует расширения CHECK;
требует изменения enum;
не поддерживается текущей моделью.

```

8. **Permissions matrix строить только по реально существующим ролям.** Если `crm_manager`, `readonly` или другая роль отсутствует, не создавать её концептуально и не утверждать, что она существует. Указать:

```text
existing;
alias;
not found;
future role — outside scope.

```

Также проверить не только таблицы ролей, но и:

- sidebar/navigation guards;
- route guards;
- RPC authorization;
- RLS;
- resource/section registry;
- hidden UI actions.

9. **AmoCRM `companies` не считать внутренней CRM-моделью без доказательств.** В Discovery нужно различить:

```text
external AmoCRM company model
≠
canonical internal companies

```

Интеграции должны оставаться anti-corruption layer/adapters. Нельзя автоматически сделать структуру AmoCRM источником внутренней схемы или канонических полей. Это также должно быть отражено в dependency/reuse matrix.

10. **Добавить явную проверку duplicate storage.** Для каждого предполагаемого поля `companies` нужно указать:


| Поле | Текущий источник | Canonical в Companies | Mirror/compat | Правило обновления |
| ---- | ---------------- | --------------------- | ------------- | ------------------ |


Особенно:

- УНП;
- полное и краткое наименование;
- legal form;
- адрес;
- email;
- телефон;
- директор;
- банковские реквизиты;
- статус;
- регистрационные данные.

Discovery должен не просто перечислить таблицы реквизитов, а доказать, что Phase 1 не создаёт третий независимый SoT. Корпоративный модуль также требует разделения постоянных данных компании, данных физлица, link-данных и данных конкретной процедуры.

11. **Phase H — только агрегированные данные.** В markdown запрещено переносить персональные данные, телефоны, email, ФИО и реальные реквизиты клиентов. Разрешено фиксировать:

- counts;
- distinct counts;
- null rates;
- duplicate counts;
- распределение по типам;
- обезличенные примеры структуры.

SQL может читать данные, но deliverables не должны становиться выгрузкой production PII.

12. **Оценку `companies` считать только по утверждённому billing-source guard.** Не по всей таблице `client_legal_details`, не по `legal_entities_requisites` самостоятельно и не по document-реквизитам:

```sql
WHERE purpose = 'billing'
  AND client_type IN ('legal_entity', 'entrepreneur')

```

Отдельно посчитать:

- строки billing-source;
- строки с нормализуемым УНП;
- уникальные `country + normalized_unp`;
- строки без УНП;
- коллизии одного УНП с разными именами/legal form;
- несколько billing-карточек разных profiles на одну компанию.

13. **В Phase D проверить не только RPC с префиксами `search_*`/`list_*`.** Также искать:

- PostgREST queries;
- hooks с `.from(...).select(...)`;
- shared search services;
- command palette/global search;
- server-side pagination;
- SQL views;
- autocomplete;
- fuzzy/trigram search.

Иначе inventory поиска будет неполным.

14. **В Phase B запретить refactor существующих Sheet-компонентов в рамках Discovery и Phase 1.** Результат `Extract shared` или `Refactor first` является только рекомендацией. Такой refactor не должен автоматически становиться blocker для создания Companies, если UI можно безопасно реализовать с существующими primitives.

Некритичный shared-shell refactor нужно вынести в deferred list, а не тормозить основной scope.

15. **Phase I должна разделять основной implementation sprint и follow-up validation sprint.** Paper strategy должна включать:

```text
Main implementation:
schema → RPC → backfill → sync → integration → UI.

Follow-up validation:
runtime smoke → regression → performance → proof gaps →
cleanup → deferred technical debt.

```

Некритичные proof gaps не должны бесконечно блокировать основной безопасный scope, но должны сохраняться в deferred list.

16. **Добавить обязательный реестр unresolved decisions.** В `companies_architecture_[freeze.md](http://freeze.md)` должен быть раздел:

```text
Resolved decisions
Deferred decisions
Explicitly rejected options
Blockers before Phase 1
Non-blocking follow-up

```

Architecture freeze нельзя подписывать, если в нём скрыто остаются формулировки «решить позже» по критическим вопросам DDL, SoT, dedupe, queue, RLS или audit.

17. **Каждая ссылка на текущее состояние должна быть точной.** Требовать формат:

```text
DB:
public.crm_tasks.column_name
constraint/function/policy name

Code:
src/path/File.tsx:Lx-Ly
supabase/functions/name/index.ts:Lx-Ly

RPC:
public.function_name(signature)

```

Недостаточно общих фраз вроде «в проекте есть поиск» или «Sheet можно переиспользовать».

18. **Добавить отдельный раздел source/field ownership.** Для будущих обновлений компании определить:

```text
Какие поля может обновлять billing sync;
какие поля редактирует администратор;
какие поля импортируются;
какие поля никогда не перезаписываются автоматически;
как обрабатываются расхождения;
что происходит с archived/merged company.

```

Это должно согласовываться с ранее принятым правилом: совпадение УНП создаёт map + billing contact, но не перезаписывает критичные поля без review.

19. **В DoD добавить проверку отсутствия изменений репозитория и БД.**

```text
- git diff по application/schema/migrations = пусто;
- нет новых migration files;
- нет изменённых SQL/RPC/edge/UI файлов;
- изменены только markdown-файлы в approved discovery paths;
- DB schema до и после Discovery идентична.

```

20. **Во все документы и в запрос Lovable добавить языковой контракт:**

```text
План должен быть составлен на русском языке.
Отчёт о выполненной работе должен быть составлен на русском языке.
Вся переписка, пояснения, результаты и deliverables —
только на русском языке.

```

Сообщение Lovable должно начинаться с обязательной маркировки:

```text
План: CRM Companies — Final Discovery 1.0

```

А после выполнения:

```text
Отчет о выполненной работе:
CRM Companies — Final Discovery 1.0

```

Это обязательное правило оформления проекта.

После внесения этих правок план готов к передаче Lovable. Это один consolidated-пакет замечаний; повторная проверка должна быть только сверкой: **внесено / частично внесено / не внесено**.

&nbsp;

План: CRM Companies — Final Discovery 1.0 (Architecture Freeze)

Цель — до старта Phase 1 полностью зафиксировать архитектуру Companies поверх существующего CRM, максимально переиспользуя таблицы, RPC, hooks и UI. Работа строго read-only: без миграций, без правок кода, без edge functions. Результат — набор markdown-документов, после которого архитектура считается замороженной; любое отклонение — только через ADR.

## Границы

- Только discovery: чтение БД (schema, sample counts), чтение исходников, статический анализ.
- Ничего не создаём: ни таблиц, ни RPC, ни компонентов, ни feature flag'ов.
- Все выводы фиксируем как deliverables ниже. Никаких «попутных фиксов».

## Что уже подтверждено чтением проекта (нужно для точности плана)

- CRM SoT (см. `.lovable/discovery/crm-tasks-diagnose.md`): сделка = `orders_v2`, контакт = `profiles`, воронки = `crm_pipelines` / `crm_pipeline_stages`, задачи = `crm_tasks` + `crm_task_types` + `crm_task_automation_rules` + `crm_task_notifications`, активность = `crm_activity_log`, события = `domain_events` / `domain_executions`, аудит = `audit_logs`.
- Реквизиты юрлиц (billing SoT) уже существуют: `legal_entities_requisites`, `individual_requisites`, `client_legal_details`, `legal_details_persons`, `legal_details_entity_person_links`, `legal_details_positions_catalog`, `legal_details_roles_catalog`. Отдельной таблицы `companies` / `company_contacts` в БД пока нет.
- Sheet-шеллы уже существуют: `src/components/admin/ContactDetailSheet.tsx`, `DealDetailSheet.tsx`, `PreregistrationDetailSheet.tsx`, `ConsentDetailSheet.tsx`, `diagnostics/BillingDetailSheet.tsx`, `payments/links/LinkDetailsDrawer.tsx`, `payments/PaymentDocumentsDrawer.tsx`.
- Табы контакта: `src/components/admin/contact/ContactDealsTab.tsx`, `ContactFeedTab.tsx`, `ContactArtifactsTab.tsx`, `ContactWebinarsTab.tsx`, плюс `ContactChannelsSection.tsx`, `ContactTelegramChat.tsx`, `bepaid/ContactDealsDialog.tsx`.
- Задачи: `src/components/admin/tasks/*` (Create/Edit/View/List/Board/Filters/Stats), hooks `useCrmTasks`, `useCrmTaskAutomationRules`, `useCrmTaskStats`, `useDealTaskSummary`, `useTaskRelations`.
- Звонки: `src/components/admin/calls/*` (CallButton, CallRecordingPlayer, CallsHistorySection).
- Amo/интеграции уже упоминают companies: `supabase/functions/amocrm-webhook`, `integration-sync`, `IntegrationSyncSettingsDialog`, `FieldMappingDialog`, `AmoCRMFieldMappingInfo`, `useIntegrationSync` — их нужно проверить на предмет уже существующей модели «компания».
- Страницы: `AdminContacts`, `AdminDeals`, `AdminTasks`, `AdminCalls`, `AdminUnresolvedCalls` — отдельной `AdminCompanies` нет.

Всё остальное про «Companies как Entity», backfill, permissions и т.д. — гипотезы, которые Discovery должен подтвердить или опровергнуть чтениями.

## Phase A. Инвентаризация текущего CRM

Для каждой сущности из списка ниже собрать таблицу: **таблицы БД → RPC/edge → hooks → UI-компоненты → страницы → политика переиспользования (reuse / partial / avoid duplicating)**.

Сущности: Contacts, Deals, Tasks, Calls, Pipelines/Stages, Activity/Timeline, Documents, Invoices, Payments, Offers, Products, Tags, Legal requisites, Integrations (Amo/GC/Manychat).

Метод:

- `rg` по именам таблиц/hook'ов/RPC.
- Чтение `supabase/functions/*/index.ts` и `src/hooks/*` без исполнения.
- Проверка `crm_activity_log`, `domain_events`, `audit_logs` на предмет полей `entity_type`/`entity_id` (чтобы понять, можно ли туда добавить `company` без alter).

## Phase B. Разбор ContactDetailSheet и DealDetailSheet

Разложить оба sheet'а поблочно (Header, Profile, Timeline, Deals, Tasks, Calls, Documents, Notes, Actions, Permissions, Toolbar, Dialogs; для Deal — Participants, Products, Payments, Automation, Activity Feed). Для каждого блока — вердикт: **Reusable as-is / Reusable with props / Extract shared / Refactor first / Company-specific**.

Дополнительно: определить, есть ли уже общий shell (общий Sheet/Drawer wrapper) — если нет, зафиксировать это как отдельный технический долг, но **не решать в этом Discovery**.

## Phase C. Модель Companies: Entity vs Standalone

Не принимаем решение до фактов. Discovery должен ответить, есть ли в проекте фактические предпосылки к абстракции Entity (общие поля `entity_type`+`entity_id` в timeline/activity/tasks/notes и т.п.). Итог фазы — рекомендация с аргументами:

- Вариант 1 (default): `companies` + `company_contacts` как отдельные таблицы, интеграция через FK и `entity_type='company'` в существующих логах.
- Вариант 2: Entity-абстракция.

Согласно указанию пользователя, дефолтная рекомендация — Вариант 1 с эволюционным переходом позже. Discovery фиксирует это как ADR-0001.

## Phase D. Инвентаризация RPC/поиска

Собрать список существующих `search_*` / `list_*` RPC (contacts, deals, tasks) и оценить: расширять их через `entity_type` или добавить отдельный `search_companies`. Решение фиксируем в reuse-matrix.

## Phase E. Permissions

Пройтись по `has_role_v2`, `user_roles_v2`, `role_admin_resource_access`, `role_admin_section_access`, `admin_resource`, `admin_section`. Составить матрицу видимости Companies для ролей: super_admin, admin, employee, crm_manager, support, readonly. Без изменений — только карта.

## Phase F. Automation

Проверить `crm_task_automation_rules`, `tariff_offers.meta.auto_tasks`, триггеры на `orders_v2`. Ответ: покрывают ли существующие правила события Companies (create/update/link_contact/link_deal), или потребуется новый триггерный источник. Никаких изменений — только вывод.

## Phase G. UI consistency

Каталогизировать текущие паттерны: ширина Sheet, tabs, toolbar, bulk actions, pagination, empty state, filters, search input. Задача — чтобы будущая `CompanyDetailSheet` и `AdminCompanies` шли по тем же паттернам. Deliverable — чек-лист.

## Phase H. Performance baseline

Через `supabase--read_query` снять cardinality: `profiles`, `orders_v2`, `legal_entities_requisites`, `individual_requisites`, `client_legal_details`. Оценить ожидаемый размер `companies` (по уникальным ИНН/УНП в billing). Зафиксировать требуемые индексы (btree на FK, trigram/GIN на name/ИНН) как рекомендации к Phase 1 — **без создания**.

## Phase I. Migration strategy (paper only)

На бумаге: последовательность DDL → GRANT → RLS → policies → backfill из billing → verification → feature flag → production switch → rollback. Никакого SQL к запуску — только описание порядка.

## Phase J. Future extensions

Кратко зафиксировать требования к будущим Holding / Parent / Subsidiary / Branches / Company Hierarchy: минимальные поля (`parent_company_id`, `hierarchy_type`), чтобы Phase 1 их учитывал на уровне схемы (nullable), но не реализовывал.

## Deliverables

Все документы кладём в `.lovable/discovery/companies-1.0/`:

- `companies_architecture_freeze.md` — итоговое архитектурное решение и ADR-0001 (standalone + эволюция к Entity).
- `companies_reuse_matrix.md` — таблица «блок → существующее → вердикт reuse».
- `companies_component_inventory.md` — UI-компоненты и sheets.
- `companies_rpc_inventory.md` — RPC/edge и решение по `search_*`.
- `companies_ui_inventory.md` — UI-паттерны и чек-лист consistency.
- `companies_permissions_matrix.md` — Phase E.
- `companies_automation_map.md` — Phase F.
- `companies_performance_notes.md` — Phase H.
- `companies_migration_strategy.md` — Phase I.
- `companies_future_extensions.md` — Phase J.
- `companies_phase1_execution_plan.md` — детальный план Phase 1 (DDL/RLS/audit/public_id/очереди) уже с опорой на freeze.

## Definition of Done

- Все 11 файлов созданы и связаны между собой.
- Каждое утверждение о текущем состоянии проекта имеет ссылку на файл/таблицу/RPC.
- Для каждого будущего блока Companies указано, что переиспользуется и что создаётся.
- Ни одной новой таблицы, RPC, edge function, миграции, компонента — Discovery только читает.
- В `companies_architecture_freeze.md` явно записано: «архитектура заморожена, изменения только через ADR».

## Что дальше

После утверждения Discovery 1.0 идём строго по фазам 1–11 из твоего сообщения. Ни одна фаза не стартует до подписания freeze-документа.