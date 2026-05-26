# Sprint 1 — Persisted Package Session для «Идеологии» + очистка навигации

Дата: 2026-05-26. Статус: discovery + UI navigation выполнены, миграция готова к submit.

## 0. Source documents
- Документ-источник «Идеология»: `.lovable/proofs/sources/ideology_source.docx` (приложен пользователем, 50 страниц).
- Текстовое разложение: tool-results снимок (1904 строки). Ключевые блоки: «Компоненты идеологии» (стр. 1–32), ПРИКАЗ (стр. 33–36), ПОЛОЖЕНИЕ (стр. 37–42), ГОДОВОЙ ПЛАН (стр. 43–50).

---

## 1. Этап A — очистка навигации (выполнено, frontend-only)

### Before
- В `/ai` и `/admin/ai` сверху висела вкладка «Документы» из секции `doc-packages`.
- В `/admin/documents` показывались **две** вкладки «Документы» одновременно (`documents` adminOnly + `doc-packages` универсальная) + «Реквизиты».

### After
| Маршрут | hiddenSections | Видимые секции |
|---|---|---|
| `/ai` (user) | `["requisites","doc-packages","documents"]` | Только **Gorbova AI** |
| `/admin/ai` (admin) | `["documents","doc-packages","requisites"]` | Только **Gorbova AI** |
| `/admin/documents` (admin) | `["ai","doc-packages","requisites"]` | Единые **Документы** с подвкладками |
| `/document-generation` (user) | `["ai","documents"]` (без изменений) | **Документы** (pkg-ideology) + **Реквизиты** |

### Подвкладки `/admin/documents` → Документы
1. Плейсхолдеры
2. Шаблоны документов
3. **Пакеты документов** ← новая подвкладка, рендерит `DocumentPackageIdeologyView`
4. История
5. Исполнители

### Изменённые файлы
- `src/components/ai-chat/AiPageContent.tsx` — `DOC_SUB_TABS` расширен подвкладкой `pkg-ideology` (label «Пакеты документов»).
- `src/pages/AI.tsx`, `src/pages/admin/AdminAI.tsx`, `src/pages/admin/AdminDocuments.tsx` — обновлены `hiddenSections`.

### DoD этапа A
- ✅ В «Нейросети» (user+admin) видна только Gorbova AI.
- ✅ В `/admin/documents` одна вкладка «Документы» с полным набором подвкладок.
- ✅ «Идеология» доступна как подвкладка «Пакеты документов».
- ✅ Backend не трогали; `StrictDocumentTemplatesManager`, `PlaceholdersCatalogTab`, executors — без изменений.

---

## 2. Этап B — discovery placeholder-namespace

### 2.1. Текущее состояние `fields_registry` (47–215 fields total)
| entity_type | count | Назначение |
|---|---|---|
| `legal_details` | 47 | Class A токены реквизитов (`{{field:FLD-XXXXXX}}`) |
| `document` | 29 | Поля документа (номер, дата, сумма, валюта, FLD-000069 имя файла) |
| `customer_ind`/`customer_leg`/`customer_ent`/`customer` | 26+24+24+20 = 94 | Заказчик ФЛ/ЮЛ/ИП/универсальный |
| `customer_signer` | 4 | Подписант заказчика |
| `executor` / `executor_leg` | 15+23 = 38 | Исполнитель (наше юрлицо) |
| `deal` | 18 | Сделка |
| `payment` | 14 | Оплата |
| `offer` | 7 | Оффер |
| `product` | 6 | Продукт |
| `tariff` | 6 | Тариф |
| `package` | 8 | **Уже существуют** для корпоративных собраний (FLD-000093…098, 101, 102) |
| `meeting` | 15 | Собрания |
| `entity` / `person` / `entity_person` | 6+12+6 = 24 | Реквизитные сущности |
| `contact` | 6 | Контакт-центр |
| `system` | 11 | Системные ({{today}}, {{year}}, etc.) |
| `user_requisites` | 37 | UI карточки реквизитов |
| `agenda` / `decision` | 1+1 | Повестка/решения |

### 2.2. Существующие package-FLD (НЕ трогать)
```
FLD-000093  package.signer.full_name           — ФИО подписанта
FLD-000094  package.signer.position            — Должность подписанта
FLD-000095  package.chairperson.full_name      — ФИО председателя
FLD-000096  package.secretary.full_name        — ФИО секретаря
FLD-000097  package.participants               — Участники собрания
FLD-000098  package.registered_persons         — Зарегистрированные лица
FLD-000101  package.board_candidates           — Кандидаты в совет директоров
FLD-000102  package.commission_members         — Члены ревизионной комиссии
```
Это **корпоративные** package-токены (общее собрание участников). Для пакета «Идеология» **не подходят** — нужен отдельный набор role-based токенов в namespace `documents:package:ideology` (это **Sprint 3**, не Sprint 1).

### 2.3. Billing regression — гарантия неизменности
Текущие шаблоны актов выполненных работ используют:
- `{{field:FLD-000104}}`, `FLD-000113`, `FLD-000125`, `FLD-000153`, `FLD-000186`, `FLD-000216` (executor, customer, deal, document, sums).
- `FLD-000069` — имя файла (canon: `document_templates.file_name_template`).

**Sprint 1 НЕ меняет:**
- `fields_registry` (никаких INSERT/UPDATE/DELETE в этой таблице).
- `document_token_registry`.
- `document_templates`, `document_template_versions`.
- `_shared/document-render.ts`, `document-field-resolver-v2`.
- `canonical-document-generate-strict`, `ai-generate-document-package` signature.
- `orders_v2.meta.document_data`, `tariff_offers.meta.document_scenarios`.

### 2.4. Conflict matrix (billing vs package namespace)
| Источник данных | Billing token | Будущий package token | Решение |
|---|---|---|---|
| `client_legal_details.leg_unp` | `cf.legal_details.FLD-000XXX` (customer/executor) | `package.legal_entity.unp` (Sprint 3) | Один источник, **разные namespace** |
| `legal_details_persons.full_name` (директор) | `customer_signer.full_name`, `executor.head.full_name` | `package.roles.company_head.full_name` | Разные context paths |
| `legal_details_persons.full_name` (исполнитель доков) | `customer_signer.*` | `package.roles.document_preparer.full_name` | Разные role_key |
| Сама компания клиента | `customer_leg.full_name` | `package.legal_entity.full_name` | Один источник, разные tokens |

### 2.5. Placeholder picker — разделение контекстов
Текущий `TokenizedRichInput` с context `"documents"` показывает все группы. Для Sprint 3 нужно ввести фильтры:
- `documents:billing` → customer/executor/deal/payment/document/system.
- `documents:package:ideology` → новая группа `package_ideology` + общие `system`.

В Sprint 1 picker **не трогаем**.

### 2.6. «Исполнители» (executors)
Вкладка `/admin/documents → Исполнители` — это **наше юрлицо** (provider), не заказчик. Использует `executor`/`executor_leg` FLD-поля. Никак не пересекается с `package.legal_entity` (юрлицо клиента, для которого формируется пакет «Идеология»).

### 2.7. Discovery документа «Идеология» — extracted structure

#### Состав пакета (3 документа)
1. **ПРИКАЗ** «Об организации идеологической работы»: утверждает Положение и Годовой план, назначает ответственного, определяет направления, устанавливает контроль.
2. **ПОЛОЖЕНИЕ** «Об организации идеологической работы»: цели/задачи/принципы, субъекты, идеологический актив, 4 направления (информационное, воспитательное, социально-культурное, контрпропагандистское), планирование, отчётность, документирование.
3. **ГОДОВОЙ ПЛАН** идеологической работы: таблицы мероприятий по разделам, изучение мнения работников.

#### Извлечённые роли → `document_package_role_catalog` для ideology
| role_key | label | allowed_entity_types | required | min | max | basis |
|---|---|---|---|---|---|---|
| `package_company` | Организация пакета | `[legal_entity,entrepreneur]` | true | 1 | 1 | Шапка приказа/положения, «в [наименование организации]» |
| `company_head` | Руководитель организации | `[person]` | true | 1 | 1 | «Общая ответственность возлагается на руководителя» (п. 5.1 Положения), подписывает приказ |
| `ideology_responsible` | Ответственный за идеологическую работу | `[person]` | true | 1 | 1 | «Назначить ответственным…» (п. 2.1 Приказа) |
| `document_signer` | Подписант документов | `[person]` | false | 0 | 1 | Если отличается от руководителя |
| `document_preparer` | Составитель документов | `[person]` | false | 0 | 1 | «Разработка плана», «подготовка материалов» |
| `control_person` | Контролирующее лицо | `[person]` | false | 0 | 1 | «Контроль за исполнением» (п. 10.1) |
| `ideology_active_member` | Член идеологического актива | `[person]` | false | 0 | null | «Идеологический актив» (п. 6 Положения) |
| `ideology_participant` | Участник мероприятий | `[person]` | false | 0 | null | Участники из Годового плана |
| `notified_person` | Ознакомленное лицо | `[person]` | false | 0 | null | «Ознакомление работников с приказом/положением» |
| `report_participant` | Участник отчёта/мероприятия | `[person]` | false | 0 | null | Отчётность (п. 13 Положения) |
| `external_specialist` | Внешний специалист/организация | `[legal_entity,entrepreneur,person]` | false | 0 | null | «Привлечение внешних специалистов» (п. 6 Приказа). **Deferred** — отдельной таблицы контрагентов нет; в Sprint 1 каталог создаём, но UI не реализуем. |

Все `role_key` — стабильные ASCII, label — русский UI-текст.

### 2.8. STOP по B.5 — снят
Документ «Идеология» приложен пользователем, проанализирован, состав пакета и роли финализированы выше.

---

## 3. Этап C — Sprint 1 модель данных

### 3.1. Изменения `document_package_templates`
Текущий чарт: `profile_id NOT NULL`, без `code`/`is_system`. Для seed «Идеология» как **системного** пакета нужно:
```sql
ALTER TABLE public.document_package_templates
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ALTER COLUMN profile_id DROP NOT NULL,
  ADD CONSTRAINT document_package_templates_profile_or_system_chk
    CHECK ((is_system = true AND profile_id IS NULL) OR (is_system = false AND profile_id IS NOT NULL)),
  ADD CONSTRAINT document_package_templates_code_unique_when_system
    EXCLUDE (code WITH =) WHERE (is_system = true AND code IS NOT NULL);
```

### 3.2. `document_package_sessions`
Один экземпляр конфигурации пакета (одно юрлицо + участники + статус) на доступ/покупку/пользователя.

Поля: `id`, `public_id`, `profile_id NOT NULL`, `user_id`, `package_template_id NOT NULL`, `order_id`, `entitlement_id`, `product_id`, `tariff_id`, `selected_legal_entity_id` (FK `client_legal_details`), `status` (draft/ready/locked/archived), `legal_entity_locked_at`, `legal_entity_locked_by_event`, `unlocked_at/by`, `unlock_reason`, `first_generation_batch_id`, `first_generated_document_id`, `metadata jsonb`.

**Uniqueness** (partial):
1. `(profile_id, package_template_id, entitlement_id)` WHERE `entitlement_id IS NOT NULL AND status<>'archived'`
2. `(profile_id, package_template_id, order_id)` WHERE `order_id IS NOT NULL AND status<>'archived'`
3. Временный fallback: `(profile_id, package_template_id)` WHERE `status<>'archived' AND entitlement_id IS NULL AND order_id IS NULL` — **technical debt**, действует до появления access-binding для пакетов.

### 3.3. `document_package_session_participants`
`package_session_id`(cascade), `entity_type` (`legal_entity`/`entrepreneur`/`person`), `legal_entity_id` (FK), `person_id` (FK), `role_key`, `role_catalog_id` (FK), `is_required`, `is_primary`, `metadata`.
Unique: `(session_id, entity_type, COALESCE(person_id, legal_entity_id), role_key)`.

### 3.4. `document_package_role_catalog`
`package_template_id` (FK), `role_key`, `label`, `description`, `allowed_entity_types text[]`, `required`, `min_count`, `max_count`, `sort_order`, `is_active`, `metadata`.
Unique: `(package_template_id, role_key)`.

### 3.5. Lock-механика
**Поля готовы**, но **auto-lock в Sprint 1 НЕ срабатывает** — генерация пакета отложена на Sprint 2. RPC `admin_unlock_package_session(session_id, reason)` создаётся сразу как заглушка для процесса поддержки + пишет `audit_logs`.

### 3.6. Role-token tokens — НЕ создаём
Sprint 1 **не вносит изменений** в `fields_registry` и `document_token_registry`. Все `package.*` token-ключи для ideology создаются в Sprint 3.

---

## 4. RLS + GRANT
- `document_package_sessions`: пользователь видит/правит только свои (через `profiles.user_id = auth.uid()`); запрет UPDATE `selected_legal_entity_id` при `legal_entity_locked_at IS NOT NULL`; admin (`has_role_v2`) — полный доступ.
- `document_package_session_participants`: ownership через session; person/legal_entity должны принадлежать тому же `profile_id`.
- `document_package_role_catalog`: SELECT для authenticated, write только service_role/admin.
- GRANT: `SELECT/INSERT/UPDATE/DELETE` для `authenticated`, `ALL` для `service_role`. `anon` не выдаём.

## 5. Seed (idempotent, в той же миграции)
- INSERT «Идеология» в `document_package_templates` с `is_system=true, code='ideology', profile_id=NULL` через `ON CONFLICT` guard (по `code`).
- INSERT 11 ролей в `document_package_role_catalog` через `ON CONFLICT (package_template_id, role_key) DO NOTHING`.
- `document_package_template_items` для ideology **не заполняем** — в БД нет шаблонов с `category='ideology'` (проверено: 0 строк). Их добавит админ в Sprint 2.

## 6. Audit actions
`document_package.session_created`, `legal_entity_selected`, `legal_entity_locked`, `legal_entity_unlocked`, `participant_added/removed/role_changed`, `session_saved`. Для admin unlock — обязательный `reason`.

## 7. STOP-guards (re-confirmed)
- ✅ Не трогаем `payments_v2`, `orders_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, `tariff_offers`, `allocate_document_number`, document_scenarios, Contact Center, морфологию, refund/access-repair.
- ✅ Не трогаем `fields_registry`, `document_token_registry`, billing resolver, `canonical-document-generate-strict`.
- ✅ Не удаляем `DocumentPackageIdeologyView`, `useDocumentPackages` — расширяем.
- ✅ Связи только UUID. `external_specialist` deferred до появления контрагентной модели.

## 8. Deferred
- **Sprint 2** — admin package builder, генерация одного документа и всего пакета, auto-lock при первой генерации, `package_session_id` в generation context.
- **Sprint 3** — package token namespace `documents:package:ideology`, package resolver слоем над billing resolver, context-aware placeholder picker, role-based tokens (`package.roles.ideology_responsible.full_name` и т.д.), расширение `fields_registry`.
- **Sprint 4** — юридическая логика «Идеология» (периодические отчёты, годовой план как шаблон с массивами мероприятий, листы ознакомления, контрпропагандистские материалы).

## 9. Final status (промежуточный)
- ✅ Этап A (UI navigation) — выполнено.
- ✅ Этап B (discovery + конфликт-матрица + role catalog) — выполнено.
- 🟡 Этап C (миграция + UI refactor) — миграция отправляется отдельным шагом; UI клиентской анкеты на backend-session переводится после approve миграции.


---

## Migration verify (2026-05-26, post-approve)

1. **Таблицы созданы** ✅
   `document_package_sessions`, `document_package_session_participants`, `document_package_role_catalog` — присутствуют в `public`.

2. **Пакет `ideology` создан один раз** ✅
   `document_package_templates` где `code='ideology' AND is_system=true` → 1 строка (id `06068dcf-6943-425c-aa6b-8bfaa550cfd2`). Дублей нет.

3. **11 ролей созданы один раз** ✅
   `document_package_role_catalog` для ideology → 11 ролей (package_company, company_head, ideology_responsible, document_signer, document_preparer, control_person, ideology_active_member, ideology_participant, notified_person, report_participant, external_specialist). Unique-индекс `(package_template_id, role_key)` гарантирует отсутствие дублей.

4. **RLS проверен** ✅
   - `document_package_sessions`: 5 policy — `sessions_select_own`, `sessions_insert_own`, `sessions_update_own_unlocked`, `sessions_delete_own_draft`, `sessions_admin_all`. Scoped по `profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())`.
   - `document_package_session_participants`: 5 policy — `participants_*_own` через JOIN на parent session, plus `participants_admin_all`. Чужие реквизиты вставить нельзя — INSERT WITH CHECK дополнительно проверяет, что `legal_entity_id`/`person_id` принадлежат тому же profile_id.
   - `document_package_role_catalog`: `role_catalog_select_authenticated` (only `is_active = true`) + `role_catalog_admin_all`. Read-only для пользователей.
   - `relrowsecurity = true` на всех трёх таблицах.

5. **GRANT проверен** ✅ (из текста миграции `20260526210730_...sql`)
   - role_catalog: `GRANT SELECT … TO authenticated`, `GRANT ALL … TO service_role`. Anon — нет.
   - sessions: `GRANT SELECT, INSERT, UPDATE, DELETE … TO authenticated`, `GRANT ALL … TO service_role`. Anon — нет.
   - session_participants: то же. Anon — нет.
   - `admin_unlock_package_session(uuid,text)`: `GRANT EXECUTE … TO authenticated` (доступ ограничен внутри RPC через `has_role_v2`).

6. **Не изменены** ✅
   - `fields_registry` — не тронут, миграция не содержит `ALTER TABLE fields_registry` или INSERT в него.
   - billing resolver — не тронут.
   - edge function `canonical-document-generate-strict` — signature и тело не менялись в этом sprint.

7. **Seed-идемпотентность** ✅
   - Template ideology: `INSERT … ON CONFLICT (code) DO NOTHING` (для system-packages) + проверка по `is_system=true`.
   - Roles: `INSERT … ON CONFLICT (package_template_id, role_key) DO NOTHING`. Повторный прогон миграции — 0 новых строк.

## UI rollout (Sprint 1 frontend)

- **Новый hook**: `src/hooks/useDocumentPackageSession.ts`
  - Резолвит template по `code='ideology' AND is_system=true`.
  - Грузит role_catalog (read-only) и единственную session `(profile_id, package_template_id)`.
  - `save({ selectedLegalEntityId, personAssignments })`: upsert session + delete-then-insert participants. Guard: при `legal_entity_locked_at != null` смена юрлица бросает ошибку.
  - После успешного save: `localStorage.removeItem("document_package_questionnaire_ideology_v1")`.
  - Display status: `not_saved | saved | locked | requires_fill`.

- **DocumentPackageIdeologyView**:
  - Бейдж «локально» удалён.
  - Юрлицо/ИП — single-select, читается из `client_legal_details` (legal_entity/entrepreneur).
  - Физлица — выбор `role_key` из `document_package_role_catalog` (исключая `package_company`).
  - Состояние читается из backend session; legacy `localStorage` используется только как one-time read-fallback при отсутствии session (только entity_id мигрируется, роли — нет).
  - Чек-лист обязательных ролей (`required=true`) с визуальной индикацией.
  - Бейдж статуса с цветом и иконкой.
  - Кнопка «Сформировать пакет» осталась disabled с понятной причиной (Sprint 2).

## STOP (выполнено)

- ❌ Не менял `fields_registry`.
- ❌ Не менял billing resolver.
- ❌ Не менял `canonical-document-generate-strict` signature.
- ❌ Не трогал payments / orders / subscriptions / entitlements / access.
- ❌ Не подключал генерацию пакета.
