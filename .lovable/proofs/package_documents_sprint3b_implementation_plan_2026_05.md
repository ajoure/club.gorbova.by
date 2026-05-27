# Sprint 3B — Pre-INSERT Implementation Plan (NOT executed)

Дата: 2026-05-27
Статус: `plan_required_before_execution` — никаких INSERT/migration/edge/UI изменений до отдельного approve.

## 0. Принципы (наследуются из 3A closure)

- Reuse-first: existing `legal_details` FLD переиспользуются как source definition в package context.
- Default-deny: без `package_session_id` и без явного `role_key` — `unresolved` warning.
- **Никакого** fallback на `legal_details_entity_person_links` (даже под флагом / в коде / зарезервированной ветке).
- Billing resolver/path не меняется.

## 1. Точный список создаваемых FLD (5 штук, generic)

| key | label | data_type | entity_type | назначение |
|---|---|---|---|---|
| `package.roles.company_head.full_name` | ФИО руководителя компании в пакете | string | package | role_key=`company_head` |
| `package.roles.company_head.position` | Должность руководителя компании в пакете | string | package | role_key=`company_head` (из participants.metadata) |
| `package.roles.responsible_person.full_name` | ФИО ответственного лица в пакете | string | package | role_key=`responsible_person` |
| `package.roles.responsible_person.position` | Должность ответственного лица в пакете | string | package | role_key=`responsible_person` (metadata) |
| `package.context.plan_year` | Плановый год пакета | number | package | из `document_package_sessions.metadata.plan_year` |

Public IDs (`FLD-XXXXXX`) — выделяются последовательно через существующий generator в момент миграции.

## 2. Source mapping (per-FLD)

### 2.1 `package.roles.company_head.full_name`
```
require: package_session_id
join:    document_package_session_participants
filter:  role_key = 'company_head' AND package_session_id = <ctx>
take:    person_id (ровно один, иначе error 'multiple_company_heads')
join:    legal_details_persons by id
read:    full_name
on_miss: { resolved: false, warning: 'package_role_unassigned:company_head' }
fallback: НЕТ (links не используются)
```

### 2.2 `package.roles.company_head.position`
```
require: package_session_id
read:    document_package_session_participants.metadata->>'position'
filter:  role_key = 'company_head'
on_miss: { resolved: false, warning: 'package_role_metadata_missing:company_head.position' }
```

### 2.3 `package.roles.responsible_person.full_name` — аналогично 2.1, role_key=`responsible_person`.
### 2.4 `package.roles.responsible_person.position` — аналогично 2.2, role_key=`responsible_person`.

### 2.5 `package.context.plan_year`
```
require: package_session_id
read:    document_package_sessions.metadata->>'plan_year' (cast to int)
on_miss: { resolved: false, warning: 'package_context_plan_year_missing' }
auto-fill from current date: ЗАПРЕЩЕНО
```

## 3. Duplicate check (выполнен read-only 2026-05-27)

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

Результат: **0 строк**. INSERT разрешён.

Перед execution миграции обязателен повторный duplicate check (+ аналогичный по `document_token_registry.token_key`).

## 4. Покрытие первого шаблона приказа (проверка перед execution)

Перед Sprint 3B execution составить explicit checklist по первому приказу:

| Поле приказа | Источник |
|---|---|
| Наименование организации | existing `legal_details.leg_full_name` (или эквивалент) |
| Город | existing `legal_details.*` address/city — подтвердить наличие; если нет — separate manifest decision |
| Дата приказа | existing document/system FLD — подтвердить; если нет — separate manifest decision |
| Номер приказа | existing document/system FLD — подтвердить; если нет — separate manifest decision |
| ФИО ответственного | new `package.roles.responsible_person.full_name` |
| Должность ответственного | new `package.roles.responsible_person.position` |
| ФИО руководителя/подписанта | new `package.roles.company_head.full_name` |
| Должность руководителя | new `package.roles.company_head.position` |
| Плановый год | new `package.context.plan_year` |

Если дата/номер/город приказа не закрыты existing FLD — **не создавать их автоматически в Sprint 3B**, выносить отдельным manifest decision.

## 5. Rollback / disable strategy

- **Default rollback = soft-disable**: `UPDATE fields_registry SET archived_at = now() WHERE public_id IN (...)`. Резолвер новых FLD после archive возвращает `unresolved`; billing-токены не затрагиваются.
- **Hard DELETE — только отдельным approve** и только при выполнении всех условий:
  - 0 использований в `document_templates` (regex-scan тела);
  - 0 строк в `document_template_versions.tokens`;
  - 0 строк с этими FLD в `token_manifest_snapshot`;
  - 0 строк в `source_trace` любых `ai_generated_documents`;
  - явный approval от ревьюера.
- Feature flag `documents_package_resolver_enabled` (default `false`) гейтит чтение новых FLD в `canonical-document-generate-strict`. Включается отдельно после dry-run.

## 6. Proof: billing/customer/executor tokens не изменяются

Перед INSERT в proof-execution файле:

- diff `document_token_registry WHERE token_key LIKE 'cf.legal_details.%' OR token_key LIKE 'customer.%' OR token_key LIKE 'executor.%'` до/после миграции — идентичен.
- regex-scan активных `document_templates` подтверждает: ни один template не содержит новых package-токенов до явного включения.
- Existing функция-резолвер для billing (`resolveBillingTokens` / эквивалент) — без изменений в сигнатуре и поведении.

## 7. `resolvePackageTokens` — модульная архитектура

- Новый отдельный модуль/файл `_shared/resolve-package-tokens.ts` (или эквивалент по проектной конвенции).
- В существующем `canonical-document-generate-strict` разрешена **только минимальная routing-точка**:
  ```ts
  if (template.template_scope === 'package') {
    return resolvePackageTokens(ctx);
  }
  // billing-path без изменений
  ```
- Билинг-путь, request/response схема edge-функции, контракты `idempotency_key`, `snapshot`, `source_trace`, `template_version_id` — без изменений.
- Любое изменение billing resolver запрещено.

## 8. DoD Sprint 3B (только plan, не execution)

- [x] Список 5 FLD зафиксирован (§1).
- [x] Source mapping per-FLD зафиксирован (§2).
- [x] Duplicate check выполнен read-only, 0 совпадений (§3).
- [x] Checklist первого шаблона приказа зафиксирован (§4).
- [x] Rollback strategy = soft-disable по умолчанию (§5).
- [x] Запрет fallback через `legal_details_entity_person_links` зафиксирован (§0, §2.1).
- [x] Модульная архитектура `resolvePackageTokens` зафиксирована (§7).
- [ ] Approval ревьюера на сам plan.
- [ ] Только после approval — отдельный запрос на migration + edge-патч (Sprint 3B execution).

В рамках этого документа никакие `INSERT`, `migration`, `deploy_edge_functions`, UI-патчи не выполняются.
