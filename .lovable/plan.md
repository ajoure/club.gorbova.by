Да, согласен, с учетом правок:

1. **tenant_id не оставлять только как резервную колонку**
  - Не просто добавить nullable tenant_id.
  - В рамках этого же спринта добавить отдельный PATCH: **Tenant/Workspace foundation для реквизитов**.
  - Реализовать минимально, без полной workspace-логики во всём проекте, но так, чтобы модель не потерялась.
2. **Добавить в план отдельный этап / PATCH в конце спринта**  
**PATCH: Tenant foundation для реквизитов**  
Цель: заложить рабочую tenant-модель именно для реквизитов, без масштабного внедрения tenants во все модули.  
Что сделать:
  - создать/использовать таблицу tenants, если она уже есть — не дублировать;
  - добавить связь пользователя с tenant/workspace, если уже есть tenant_memberships — использовать её;
  - если tenant-модель уже частично существует в проекте — провести discovery и подключить реквизиты к существующей модели;
  - legal_entities_requisites.tenant_id и individual_requisites.tenant_id должны реально заполняться, а не висеть NULL;
  - для каждого пользователя должен определяться active/default tenant;
  - RLS проверяет не только owner_user_id, но и принадлежность пользователя к tenant_id;
  - owner-поля оставить:
    - owner_user_id
    - owner_profile_id
    - tenant_id
  - tenant используется как основная граница будущего workspace-доступа.
3. **Правило для RLS**
  - Пользователь видит реквизиты, если:
    - он владелец записи через owner_user_id = auth.uid(), **или**
    - он состоит в соответствующем tenant_id с разрешённой ролью,
    - либо он admin/super_admin.
  - Чужие tenant-записи без membership недоступны.
4. **Правило для resolver**
  - В контекст resolver добавить обязательный tenant_id.
  - Резолвер не должен читать реквизиты только по owner_user_id, если в записи есть tenant_id.
  - Для системных документов:
    - заказчик = scope='system_customer' в tenant клиента;
    - исполнитель = platform_executor;
    - пользовательские реквизиты запрещены.
  - Для пользовательских документов:
    - только scope='user_requisites' внутри текущего tenant;
    - без fallback на системные реквизиты.
5. **Discovery перед PATCH tenant**
  - Проверить, какие tenant-таблицы уже есть:
    - tenants
    - tenant_memberships
    - любые текущие workspace/tenant связи
  - Если они уже используются в проекте — не создавать новые сущности, а встроиться в существующую архитектуру.
6. **DoD tenant PATCH**
  - У нового ЮЛ/ИП/ФЛ реквизита заполнен tenant_id.
  - Пользователь из другого tenant не видит эти реквизиты.
  - Пользователь внутри того же tenant с разрешённой ролью видит/редактирует по правилам.
  - Resolver получает tenant_id и не подставляет реквизиты из другого tenant.
  - SQL-proof + RLS-proof двумя пользователями/двумя tenant.
  - В отчёте отдельно показать: tenant_id реально используется, а не просто добавлен в схему.
7. **Остальные ранее утверждённые правки сохранить**
  - Убрать все упоминания AI.
  - Использовать только:
    - system_customer
    - user_requisites
    - platform_executor
  - Старые тестовые реквизиты удалить после dry-run без архива.
  - Системные и пользовательские поля должны иметь одинаковый смысловой состав, но разные FLD-ID.
  - platform_executor завести как полноценную группу FLD-ID поверх executors.
  - Labels без Основное.
  - Default — только свойство записи, не часть label.

&nbsp;

## План: каноническая система реквизитов (system_customer / user_requisites / platform_executor) + tenant foundation

## 0. Жёсткие правила

1. Никакого AI-нейминга нигде: ни в БД, ни в UI, ни в labels, ни в комментариях, ни в docs.
2. Используются только три домена: `system_customer`, `user_requisites`, `platform_executor`.
3. Перед SQL — read-only discovery (см. §3) с явным отчётом по дублированию таблиц/функций/UI.
4. Старые тестовые/неиспользуемые реквизиты удаляются после dry-run без архива и без compatibility layer (если dry-run не нашёл production-зависимостей).
5. Поля ЮЛ/ИП/ФЛ канонически совпадают по смыслу между `system_customer` и `user_requisites`. Различие — только FLD-ID, `domain/scope` и источник.
6. Запрещены визуально одинаковые labels с разными FLD-ID.
7. Запрещено слово «Основное» в labels. `is_default=true` — только свойство записи.
8. Каждый этап имеет DoD: SQL-proof, RLS-proof, resolver-proof, UI-proof.
9. Discovery подтверждает финальный канонический состав полей — никаких «минимумов» как финал.

---

## 1. Discovery как первый этап спринта (read-only)

Артефакт: `docs/audits/requisites-fields-discovery.md`.

### 1.1. Текущее состояние (уже подтверждено беглым осмотром)

- Таблицы реквизитов: `client_legal_details`, `legal_details_persons`, `legal_details_entity_person_links`, `legal_details_positions_catalog`, `legal_details_roles_catalog`, `executors`.
- `fields_registry`: `legal_details=47`, `executor=15`, `entity=6`, `person=12`, `entity_person=6`.
- UI: `OrganizationDetailsForm`, `LegalEntityDetailsForm`, `EntrepreneurDetailsForm`, `IndividualDetailsForm` (system); `EntityRecordSheet`, `PersonRecordSheet`, `PersonFieldsForm` (user/AI). Все читают через `useLegalDetailsFields` + `LEGAL_DETAILS_FIELD_MAP` → `client_legal_details`.
- Резолвер: `src/lib/token-resolver.ts` — формат `{{cf.legal_details.<FLD-…|UUID>}}`.
- **Tenant**: таблиц `tenants`/`tenant_memberships` в БД нет. Совпадения `tenant`/`workspace` в коде — это **не сущность**, а текстовые поля (теги, сайт-страницы, интеграции). Дублирования архитектуры избегаем — tenant-сущности придётся создавать впервые.

### 1.2. Что зафиксировать в отчёте

1. Полный список колонок `client_legal_details`, `legal_details_persons`, `executors` → один к одному в каноническую таблицу.
2. Все записи `fields_registry` (`legal_details`, `executor`, `entity`, `person`, `entity_person`) с public_id и label.
3. Карта совпадений «системное поле ↔ executor-поле ↔ entity/person-поле» по смыслу — для подтверждения, что мы не теряем поля и не плодим дубли.
4. Все читатели/писатели: `useLegalDetailsFields`, `useLegalDetails`, `useAiEntities`, `useAiPersons`, `useEntityPersonLinks`, `useGrpRefresh`, `LegalDetailsPickerDialog`, `AiPageContent`, `tokenRegistry`, `token-resolver`, `LegalDetails.tsx` (settings).
5. RLS текущих таблиц.
6. Dry-run кандидатов на удаление: какие записи `client_legal_details`/`legal_details_persons`/`legal_details_entity_person_links` не используются в production-документах (`document_data`, `documents`, оплаченных актах) и могут быть удалены безвозвратно.
7. **Анти-дубликат-чек спринта**: подтверждение, что новые `legal_entities_requisites`/`individual_requisites`/`tenants`/`tenant_memberships` не дублируют существующие — со ссылкой на каждый проверенный объект.

DoD discovery: финальный канон полей по каждому subject_type зафиксирован в отчёте. Только после этого начинается этап B.

---

## 2. Бизнес-логика (закрепление)

- **system_customer** — клиент платформы как Заказчик в документах платформа↔клиент. Источник — настройки профиля.
- **platform_executor** — наши реквизиты как Исполнителя. Источник — `executors`. Клиент не редактирует. **Заводим зеркальные FLD-ID в `fields_registry` поверх `executors**`, чтобы Исполнитель был полноценной группой каталога и резолвер работал по тому же field-id-first принципу.
- **user_requisites** — реквизиты, которые клиент создаёт для своих документов (протоколы, решения, доверенности, договоры с третьими лицами).

Запрещено смешивать домены в одном документе.

---

## 3. Каноническая модель полей

Состав по subject_type — финализируется discovery, но обязательно совпадает по смыслу:

- `system_customer.legal_entity` ≡ `user_requisites.legal_entity`
- `system_customer.entrepreneur` ≡ `user_requisites.entrepreneur`
- `system_customer.individual` ≡ `user_requisites.individual`

Различия — только FLD-ID, domain/scope, источник. `platform_executor.legal_entity` зеркалит ту же структуру, но читает из `executors`.

Поля «банк/расчётный счёт/адрес/паспорт» у разных subject_type — **разные FLD-ID** (никаких общих полей между ЮЛ и ФЛ).

---

## 4. Labels (финал)

- Системные: `Сист. заказчик · ЮЛ · Полное наименование`, `Сист. заказчик · ФЛ · Расчётный счёт`.
- Исполнитель: `Исполнитель · ЮЛ · Расчётный счёт`, `Исполнитель · ЮЛ · Руководитель ФИО`.
- Пользовательские: `ЮЛ · Расчётный счёт`, `ФЛ · Расчётный счёт`.
- Слово «Основное» в labels запрещено. `is_default=true` — только свойство записи.

`label = label_short`. `metadata`:

```json
{
  "domain": "system_customer | user_requisites | platform_executor",
  "scope":  "system_customer | user_requisites | platform_executor",
  "subject_type": "legal_entity | entrepreneur | individual",
  "field_key": "bank_account",
  "label_short": "Сист. заказчик · ЮЛ · Расчётный счёт",
  "label_full":  "Системные реквизиты клиента → Заказчик → ЮЛ → Расчётный счёт",
  "aliases": ["юрлицо","юл","банк","расчётный счёт","iban","р/с"]
}
```

---

## 5. Структура БД

### 5.1. `legal_entities_requisites` (ЮЛ + ИП)

- `id uuid pk`, `owner_user_id uuid not null`, `owner_profile_id uuid not null`, `tenant_id uuid not null` (см. §8)
- `scope text not null check (scope in ('system_customer','user_requisites'))`
- `subject_type text not null check (subject_type in ('legal_entity','entrepreneur'))`
- `is_default boolean default false`
- все канонические поля ЮЛ/ИП после discovery
- `created_by`, `updated_by`, `created_at`, `updated_at`

### 5.2. `individual_requisites` (ФЛ)

- те же служебные + `subject_type` default `'individual'`
- `scope` тот же check
- все канонические поля ФЛ после discovery

### 5.3. Default

Partial unique `(owner_user_id, scope, subject_type) where is_default`. Default не влияет на label.

### 5.4. Триггеры

`set_updated_at`, `set_updated_by`, `enforce_single_default_per_scope_subject`, `audit_logs` на insert/update/delete.

### 5.5. `platform_executor` хранения **не получает** — это виртуальный scope поверх `executors`. В `fields_registry` создаются зеркальные FLD-ID для каталога/резолвера.

---

## 6. RLS

Пользователь видит запись, если:

- `owner_user_id = auth.uid()`, **или**
- состоит в `tenant_memberships` для `tenant_id` записи с разрешённой ролью, **или**
- `has_role_v2(auth.uid(),'admin'|'super_admin')`.

`platform_executor` доступен на чтение всем authenticated; правка — только admin (как сейчас в `executors`).

---

## 7. Resolver (жёсткие правила)

Контекст вызова:

```json
{
  "tenant_id": "...",
  "owner_user_id": "...",
  "source": "system_customer.legal_entity | system_customer.individual | platform_executor.legal_entity | user_requisites.legal_entity | user_requisites.entrepreneur | user_requisites.individual",
  "selected_requisites_id": "..."
}
```

Правила:

- **Системные документы платформы**: Заказчик — только `scope='system_customer'` в `tenant_id` клиента; Исполнитель — только `platform_executor` (из `executors`); `user_requisites` запрещён.
- **Пользовательские документы**: только `scope='user_requisites'` внутри текущего `tenant_id`; `system_customer` и `platform_executor` запрещены; запись не выбрана и default отсутствует → ошибка `REQUISITES_NOT_SELECTED`.
- Несовпадение source/scope → `REQUISITES_SCOPE_MISMATCH`. Никаких fallback между доменами/тенантами.
- Резолвер не читает запись только по `owner_user_id`, если у неё есть `tenant_id` — обязательная проверка принадлежности.

---

## 8. PATCH: Tenant foundation для реквизитов (внутри этого же спринта)

Цель — заложить рабочую tenant-модель именно для реквизитов, не разворачивая tenants во всём проекте.

### 8.1. Discovery (внутри §1)

Подтвердить отсутствие сущностей `tenants`/`tenant_memberships`/`workspaces` (текстовые `tenant`/`workspace` в коде не считаются). Если в discovery всплывёт скрытая сущность — встроиться в неё, не дублировать.

### 8.2. Минимальные таблицы (создаём только если discovery подтвердит отсутствие)

- `tenants`: `id uuid pk`, `name text`, `slug text unique`, `owner_user_id uuid`, `created_at`, `updated_at`.
- `tenant_memberships`: `id uuid pk`, `tenant_id uuid fk`, `user_id uuid`, `role text check (role in ('owner','admin','member','viewer'))`, `is_active boolean`, `unique (tenant_id, user_id)`.
- На каждого существующего пользователя — backfill: личный tenant (`role='owner'`), он же дефолтный.

### 8.3. Резолюция активного tenant

- RPC/хелпер `get_active_tenant_for(user_id)`: возвращает явно выбранный (из `profiles.active_tenant_id`, если введём) либо личный tenant.
- В UI — пока без полноценного переключателя; в скрытом виде записываем в реквизиты `tenant_id` активного tenant.

### 8.4. Связка с реквизитами

- `legal_entities_requisites.tenant_id NOT NULL` и `individual_requisites.tenant_id NOT NULL` — заполняются при insert; backfill сделанных в спринте записей через `get_active_tenant_for(owner_user_id)`.
- RLS-политики реквизитов читают `tenant_memberships` (см. §6).

### 8.5. DoD tenant-PATCH

- У каждой новой записи реквизитов реально записан `tenant_id`, не NULL.
- Пользователь из другого tenant без membership не видит реквизиты — RLS-proof двумя пользователями.
- Пользователь того же tenant с разрешённой ролью видит/редактирует.
- Резолвер получает `tenant_id` и не подмешивает реквизиты другого tenant.
- В отчёте отдельный раздел: «tenant_id реально используется», с примерами SQL-выборок.

---

## 9. Удаление старых данных (clean reset, без архива и compatibility layer)

После dry-run отчёта (§1.2 п.6):

- удалить старые **пользовательские/тестовые** реквизиты из `client_legal_details`;
- удалить старые ФЛ из `legal_details_persons`;
- удалить связи `legal_details_entity_person_links`, относящиеся к удаляемым;
- старые неполные `entity`/`person`/`entity_person` записи `fields_registry` — удалить (deprecated не нужен).

Если dry-run найдёт production-зависимости (оплаченные акты, активные заказы, prod generation flow) — сузить удаление до строго неиспользуемых. Compatibility layer не делаем.

---

## 10. UI

### 10.1. Настройки профиля → Реквизиты

Назначение — `system_customer`. Заголовки: «Системные реквизиты заказчика», «Юридическое лицо», «Индивидуальный предприниматель», «Физическое лицо».

### 10.2. Документы / Нейросеть → Реквизиты

Назначение — `user_requisites`. Заголовки: «Пользовательские юрлица», «Пользовательские ИП», «Пользовательские физлица». Слова «AI» нет.

### 10.3. Единые формы

`LegalEntityRequisitesForm`, `IndividualRequisitesForm` — используются в обоих разделах. Различие — props: `scope`, `subjectType`. Заменяют `OrganizationDetailsForm`, `LegalEntityDetailsForm`, `EntrepreneurDetailsForm`, `IndividualDetailsForm`, `EntityRecordSheet`, `PersonRecordSheet`, `PersonFieldsForm` — старые компоненты удаляются.

---

## 11. Каталог плейсхолдеров

Группы: `Системный заказчик`, `Исполнитель`, `Пользовательские ЮЛ`, `Пользовательские ИП`, `Пользовательские ФЛ`.

```
[Сист. заказчик]    [ЮЛ] Полное наименование — FLD-0000xx
[Сист. заказчик]    [ФЛ] Расчётный счёт      — FLD-0000yy
[Исполнитель]       [ЮЛ] Расчётный счёт      — FLD-0001xx
[Пользовательские]  [ЮЛ] Расчётный счёт      — FLD-0010xx
[Пользовательские]  [ФЛ] Расчётный счёт      — FLD-0020xx
```

DoD каталога: нет одинаковых визуальных labels с разными FLD-ID; видна группа и subject_type; банк ЮЛ/ФЛ — разные поля; поиск по «расчётный счёт» показывает все варианты с понятными подписями.

---

## 12. Этапы спринта

- **A. Discovery** — `docs/audits/requisites-fields-discovery.md` + анти-дубликат-чек (§1).
- **B. Tenant foundation** — `tenants`, `tenant_memberships`, backfill личных tenant, `get_active_tenant_for` (§8.2–8.3).
- **C. Новые таблицы реквизитов и RLS** — `legal_entities_requisites`, `individual_requisites`, индексы, триггеры, RLS с tenant-membership (§5–6).
- **D. Новый `fields_registry**` — канонические FLD-ID для `system_customer` ЮЛ/ИП/ФЛ, `platform_executor` (зеркальные поверх `executors`), `user_requisites` ЮЛ/ИП/ФЛ. Состав по subject_type совпадает между доменами (§3, §4).
- **E. Clean reset** — удалить старые **пользовательские/тестовые** реквизиты и связи; старые `entity`/`person`/`entity_person` записи реестра — удалить. Без архива (§9).
- **F. UI** — единые `LegalEntityRequisitesForm`/`IndividualRequisitesForm`; убрать AI-нейминг; обновить каталог плейсхолдеров; default — свойство записи (§10).
- **G. Resolver** — обновить `token-resolver`, `tokenRegistry`, document snapshot; жёсткие правила и коды ошибок (§7).
- **H. Verify** — RLS-двумя-пользователями, RLS-двумя-tenant, генерация системного акта и пользовательского документа, отсутствие дубликатов в каталоге, AI-нейминга нигде нет.

---

## 13. DoD спринта

- Discovery-отчёт зафиксировал финальный канон полей и анти-дубликат-чек.
- `tenants`/`tenant_memberships` созданы (или подтверждено использование существующих).
- `legal_entities_requisites`/`individual_requisites` созданы; `tenant_id NOT NULL` и реально заполнен.
- RLS не пускает чужих пользователей и чужих tenant.
- В коде/UI/labels/comments/docs только: `system_customer`, `user_requisites`, `platform_executor`. Слова «AI» в реквизитах нет.
- Системные реквизиты — только в документах платформы; пользовательские — только в пользовательских; Исполнитель — только из `executors` через `platform_executor`.
- Состав и смысл полей совпадают между `system_customer` и `user_requisites` по каждому subject_type.
- Labels не содержат «Основное»; визуальных дубликатов нет; банк ЮЛ ≠ банк ФЛ.
- Резолвер требует `tenant_id` и `source`, ошибки `REQUISITES_NOT_SELECTED`/`REQUISITES_SCOPE_MISMATCH` работают, fallback запрещён.
- Один пользователь не видит реквизиты другого; в одном tenant возможны несколько ЮЛ/ИП/ФЛ; default — только выбор записи.
- Старые тестовые реквизиты удалены; старые документы и текущая generation pipeline не сломаны.