# да, согласен, с учетом правок:

1. **Главное: план стал правильным по логике**

Lovable наконец зафиксировал верную модель:

- existing `legal_details` FLD переиспользуются как **source definition**, а не как billing/customer context;
- для пакетов используется отдельный package-aware resolver;
- `package_session_id` обязателен;
- без session/role assignment — только `unresolved + warning`;
- silent fallback запрещён;
- `documents:package:ideology` не создаётся;
- новые FLD — только минимально и только потому, что нет `legal_details_person` в registry.

Это соответствует тому, что ты хотел: **реквизиты одни, контексты использования разные**.

---

## **Что нужно поправить перед approve Sprint 3B-plan**

### **1. Убрать идею “company-role fallback” вообще из Sprint 3B**

Сейчас он пишет:

company_head fallback из `legal_details_entity_person_links` под флагом

Я бы это **не разрешал даже как зарезервированную ветку** в Sprint 3B.

Причина: ты хочешь, чтобы в анкете пакета пользователь явно назначал роли. Если включить fallback, система опять начнет “догадываться”.

Заменить на:

```md
Company-role fallback через `legal_details_entity_person_links` в Sprint 3B не реализуется и не резервируется в коде.

Руководитель компании для package-документов берется только через явное назначение `role_key='company_head'` в `document_package_session_participants`.

`legal_details_entity_person_links` можно использовать только как UI-подсказку при выборе лица, но не как resolver fallback.
```

---

### **2. Не создавать rollback через hard DELETE без строгого запрета использования**

Он предлагает rollback:

```sql
DELETE FROM document_token_registry ...
DELETE FROM fields_registry ...
```

Лучше не давать ему привычку удалять registry entries.

Заменить на:

```md
Rollback strategy по умолчанию — soft-disable через `archived_at`.

Hard DELETE допустим только если:
- токены не использованы ни в одном шаблоне;
- нет snapshot/source_trace;
- нет token_manifest_snapshot;
- нет document_template_versions;
- есть отдельный approve.

В обычном rollback использовать только `archived_at`.
```

---

### **3. “Новая независимая функция resolvePackageTokens” — хорошо, но не “не editing existing”**

Он пишет:

только новая независимая функция `resolvePackageTokens` (новый файл, не editing existing)

Это правильно как направление, но подключение всё равно потребует минимальной точки интеграции.

Уточнить:

```md
`resolvePackageTokens` должен быть отдельным файлом/модулем.

Разрешена только минимальная интеграционная точка в существующем pipeline для маршрутизации по `template_scope='package'`.

Billing path не менять. Любое изменение billing resolver запрещено.
```

---

### **4. Проверить, что 5 новых FLD действительно достаточны для первого приказа**

Для приказа нужны минимум:

- наименование организации;
- город;
- дата приказа;
- номер приказа;
- ответственное лицо;
- должность ответственного;
- руководитель/подписант;
- ФИО руководителя;
- год плана.

Он предлагает 5 новых FLD:

```text
package.roles.company_head.full_name
package.roles.company_head.position
package.roles.responsible_person.full_name
package.roles.responsible_person.position
package.context.plan_year
```

Это нормально, **если** остальные поля переиспользуются из existing `legal_details` и existing document/system fields:

- организация → existing legal_details FLD;
- дата/номер приказа → existing document/system FLD или отдельный документный контекст;
- город → existing legal_details address/city или document field.

Добавить проверку:

```md
Перед Sprint 3B execution подтвердить, что для первого приказа все поля закрыты:
- existing FLD;
- новые 5 package FLD;
- existing document/system FLD.

Если дата/номер/город приказа не закрыты existing FLD — не создавать их автоматически, а вынести отдельным manifest decision.
```

---



### **5. Уточнить**

`package.context.plan_year`

`plan_year` — это не реквизит юрлица и не физлицо. Это **контекст пакета/документа**.

Нужно явно указать:

```md
`package.context.plan_year` хранится в `document_package_sessions.metadata.plan_year`.

Если `plan_year` отсутствует — unresolved/warning или blocking validation для документов, где год обязателен.

Не брать год из текущей даты автоматически без подтверждения пользователя.
```

---

## **Готовый ответ Lovable**

```md
да, согласен, с учетом правок:

1. Логика Sprint 3A подтверждена: direct reuse existing `legal_details` FLD означает reuse source definition, а не подключение billing/customer context к пакетам. Это правильно.

2. Перед Sprint 3B внести правку: company-head fallback через `legal_details_entity_person_links` не реализовывать и не резервировать в коде. Руководитель для package-документов берется только через явное назначение `role_key='company_head'` в `document_package_session_participants`. `legal_details_entity_person_links` можно использовать только как UI-подсказку, но не как resolver fallback.

3. Rollback strategy изменить: по умолчанию только soft-disable через `archived_at`. Hard DELETE из `fields_registry` / `document_token_registry` допустим только отдельным approve и только если токены нигде не использовались: templates, template_versions, token_manifest_snapshot, source_trace, generated documents.

4. `resolvePackageTokens` делать отдельным модулем. В существующем pipeline разрешена только минимальная routing-точка по `template_scope='package'`. Billing resolver/path не менять.

5. Перед Sprint 3B execution подтвердить, что первый шаблон приказа закрывается:
   - existing `legal_details` FLD для организации;
   - existing document/system FLD для даты/номера/города, если они уже есть;
   - 5 новыми generic package FLD только для package-role/context полей.
   
   Если дата/номер/город приказа не закрыты existing FLD — не создавать их автоматически, а вынести отдельным manifest decision.

6. `package.context.plan_year` хранить только в `document_package_sessions.metadata.plan_year`. Не брать год автоматически из текущей даты без подтверждения пользователя. Если год отсутствует — unresolved/warning или blocking validation, в зависимости от документа.

После этих правок можно закрывать Sprint 3A и переходить к Sprint 3B implementation plan. Само выполнение INSERT/миграций/edge-патчей — только после отдельного approve Sprint 3B-plan.
```

## **Итог**

Он сейчас понял задачу **почти правильно**.  
Нужно только убрать опасный fallback на руководителя из company-links и запретить hard delete registry entries как стандартный rollback.

&nbsp;

План Sprint 3A closure + Sprint 3B pre-INSERT implementation plan

## Часть 1. Подтверждение двух уточнений (Sprint 3A)

### Уточнение 1 — semantics of "direct reuse" для 47 existing `legal_details` FLD

**Подтверждаю:**

- `direct reuse` НЕ означает прямое подключение billing/customer token context к пакету.
- Existing 47 FLD (`legal_details.*`, например `FLD-000009` UNP, `FLD-000011` name) — это **переиспользование source definition** (registry-запись + column mapping в `client_legal_details`), а не переиспользование resolver binding из актов.
- В **актах** existing FLD продолжает означать заказчика/исполнителя в billing context (`order.customer_legal_details_id` / `order.executor_legal_details_id`) — это не меняется.
- В **пакетах** тот же FLD резолвится **только** через package context:
  ```
  package_session_id
    → document_package_sessions.selected_legal_entity_id
      → client_legal_details (по этому UUID)
        → колонка по fields_registry.key (например leg_unp)
  ```
- Без `package_session_id` package-context резолвинг возвращает `unresolved` warning.
- Silent fallback на первого клиента / первое юрлицо / `legal_details_entity_person_links` — **запрещён**.
- Билинг-резолвинг и пакет-резолвинг — две независимые ветки в `canonical-document-generate-strict`; разделение по `template_scope` (`billing` vs `package`).

Если уточнение не подтверждается ревьюером — **Sprint 3B стоп**, повторный discovery.

### Уточнение 2 — почему 5 новых generic package FLD необходимы

**Подтверждаю:**

- Новые FLD нужны исключительно потому, что:
  - `legal_details_person` отсутствует в `fields_registry` (0 entries по discovery);
  - 8 existing package FLD (`FLD-000093..102`) — legacy corporate (meetings), не подходят по семантике;
  - нет existing FLD для физлиц в package-role context.
- Новые FLD будут:
  - **generic** (без слова `ideology`, без слова `meeting`);
  - namespace только `documents:package` (через `entity_type='package'` + `key` префикс `package.roles.*` / `package.context.*`);
  - source только через `document_package_session_participants.role_key` → `person_id` → `legal_details_persons`;
  - **без** fallback на `legal_details_entity_person_links`, кроме одного отдельно утверждаемого company-role сценария (см. §3.4 ниже — требует явного approval перед включением).

---

## Часть 2. Финальный статус Sprint 3A

```
Sprint 3A:
completed: reuse-first manifest approved;
Sprint 3B requires implementation plan before registry/resolver changes
```

Никаких INSERT/UPDATE/edge/UI изменений в рамках Sprint 3A не производилось и не будет.

---

## Часть 3. Sprint 3B implementation plan (pre-INSERT, требует отдельного approval)

Перед любым `INSERT` в `fields_registry` / `document_token_registry` будет создан отдельный proof-файл со всеми разделами ниже.

### 3.1. Точный список создаваемых FLD (5 шт, generic)


| key                                          | label                                    | data_type | entity_type | назначение                                         |
| -------------------------------------------- | ---------------------------------------- | --------- | ----------- | -------------------------------------------------- |
| `package.roles.company_head.full_name`       | ФИО руководителя компании в пакете       | string    | package     | role_key=`company_head`                            |
| `package.roles.company_head.position`        | Должность руководителя компании в пакете | string    | package     | role_key=`company_head` (из participants.metadata) |
| `package.roles.responsible_person.full_name` | ФИО ответственного лица в пакете         | string    | package     | role_key=`responsible_person`                      |
| `package.roles.responsible_person.position`  | Должность ответственного лица в пакете   | string    | package     | role_key=`responsible_person` (metadata)           |
| `package.context.plan_year`                  | Плановый год пакета                      | number    | package     | из `document_package_sessions.metadata.plan_year`  |


Public IDs (`FLD-XXXXXX`) — выделяются последовательно через существующий generator; точные номера фиксируются в proof-файле в момент исполнения.

### 3.2. Source mapping (per-FLD)

Для каждого FLD в proof:

- источник: таблица.колонка или JSONB-путь;
- предусловие резолвинга: какой `role_key` / какое поле `package_session` должно присутствовать;
- поведение при отсутствии: всегда `unresolved` warning, без fallback.

Пример для `package.roles.company_head.full_name`:

```
require: package_session_id
join:    document_package_session_participants
filter:  role_key = 'company_head'
         AND package_session_id = <ctx>
take:    person_id (первый и единственный — иначе error 'multiple_company_heads')
join:    legal_details_persons by id
read:    full_name
on_miss: { resolved: false, warning: 'package_role_unassigned:company_head' }
```

### 3.3. Duplicate check (обязательный шаг перед INSERT)

В proof:

```sql
SELECT id, public_id, key, entity_type
FROM fields_registry
WHERE entity_type = 'package'
  AND key IN (
    'package.roles.company_head.full_name',
    'package.roles.company_head.position',
    'package.roles.responsible_person.full_name',
    'package.roles.responsible_person.position',
    'package.context.plan_year'
  );
```

Ожидаемый результат: 0 строк. Если ≥1 — INSERT блокируется, decision rule меняется на `reuse_existing`.

Аналогично для `document_token_registry`:

```sql
SELECT id, field_id, token_key
FROM document_token_registry
WHERE token_key IN (...);
```

### 3.4. Company-role fallback сценарий (требует отдельного approval)

Единственный потенциальный fallback: если для `role_key='company_head'` participant не назначен, **разрешается** опционально подтянуть head из `legal_details_entity_person_links` (where `legal_details_id = package_session.selected_legal_entity_id AND role='head'`).

- По умолчанию **выключен**.
- Включается флагом `package_resolver.company_head_link_fallback_enabled` в `app_settings` (default `false`).
- В Sprint 3B будет только зарезервирован флаг + код-ветка под флагом; включение — отдельное решение.

### 3.5. Rollback / disable strategy

- Все 5 INSERT идут одной миграцией с `BEGIN; ... COMMIT;`.
- Rollback миграция готовится одновременно (отдельный файл): `DELETE FROM document_token_registry WHERE field_id IN (...); DELETE FROM fields_registry WHERE public_id IN (...);` — только если FLD не использованы ни в одном `document_template_versions.tokens` (предварительная проверка в rollback-скрипте).
- Soft-disable: `UPDATE fields_registry SET archived_at = now() WHERE public_id IN (...)` — резолвер новых FLD после archive возвращает `unresolved`, billing-токены не затрагиваются.
- Feature flag `documents_package_resolver_enabled` (default `false`) гейтит чтение новых FLD в `canonical-document-generate-strict`. Включается отдельно после dry-run.

### 3.6. Proof: billing/customer/executor tokens не изменяются

В proof перед INSERT:

- diff списка billing-токенов (`document_token_registry WHERE token_key LIKE 'cf.legal_details.%' OR token_key LIKE 'customer.%' OR token_key LIKE 'executor.%'`) до/после миграции — должен быть **идентичен**;
- regex-scan активных `document_templates` подтверждает: ни один существующий template не содержит новых package-токенов до их явного включения;
- resolver-функция для billing-context (`resolveBillingTokens`) не получает изменений в сигнатуре или поведении — только новая независимая функция `resolvePackageTokens` (новый файл, не editing existing).

### 3.7. Proof: `canonical-document-generate-strict` signature не меняется

- Внешняя request/response схема edge-функции остаётся прежней.
- Внутри добавляется ветка `if (template.template_scope === 'package') { ... }` — изолированная, не затрагивает billing-путь.
- Контракт `idempotency_key`, `snapshot`, `source_trace`, `template_version_id` — без изменений.
- Proof включает diff-блок сигнатуры edge-функции (до/после) с пометкой `signature unchanged`.

### 3.8. DoD Sprint 3B (только plan, не execution)

- Proof-файл `package_documents_sprint3b_implementation_plan_2026_05.md` создан с разделами 3.1–3.7.
- Duplicate check выполнен (SELECT, read-only) — 0 совпадений.
- Template regex-scan подтверждает отсутствие конфликтов.
- Approval от ревьюера на сам plan.
- **Только после approval** — отдельный запрос на migration + edge-патч.

В рамках Sprint 3B-plan **никакие** `INSERT`, `migration`, `deploy_edge_functions`, UI-патчи не выполняются.

---

## Часть 4. Файлы, которые будут изменены/созданы (после switch в build mode)

- **Создан** `.lovable/proofs/package_documents_sprint3a_closure_clarifications_2026_05.md` — фиксация двух уточнений и финального статуса 3A.
- **Создан** `.lovable/proofs/package_documents_sprint3b_implementation_plan_2026_05.md` — pre-INSERT implementation plan по §3.1–3.8.
- **Обновлён** `.lovable/plan.md` — Sprint 3A → `completed with clarifications`; Sprint 3B → `plan_required_before_execution`.

Никаких изменений в `fields_registry`, `document_token_registry`, edge-функциях, UI, миграциях.