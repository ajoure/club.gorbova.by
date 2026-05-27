# Sprint 3A — Closure with Clarifications

Дата: 2026-05-27
Статус: `completed: reuse-first manifest approved; Sprint 3B requires implementation plan before registry/resolver changes`

## Уточнение 1 — semantics of "direct reuse" для 47 existing `legal_details` FLD

Подтверждено:

- `direct reuse` = переиспользование **source definition** (registry-запись + column mapping в `client_legal_details`), а НЕ переиспользование billing/customer/executor resolver binding.
- В **актах** existing FLD продолжают означать заказчика/исполнителя в billing context (`order.customer_legal_details_id` / `order.executor_legal_details_id`) — не меняется.
- В **пакетах** тот же FLD резолвится только через package context:
  ```
  package_session_id
    → document_package_sessions.selected_legal_entity_id
      → client_legal_details (по этому UUID)
        → колонка по fields_registry.key (например leg_unp)
  ```
- Без `package_session_id` → `unresolved` warning.
- Silent fallback на первого клиента/первое юрлицо/`legal_details_entity_person_links` — запрещён.
- Билинг- и пакет-резолвинг — две независимые ветки, разделение по `template_scope` (`billing` vs `package`).

## Уточнение 2 — почему 5 новых generic package FLD необходимы

Подтверждено:

- `legal_details_person` отсутствует в `fields_registry` (0 entries, проверено в Sprint 3A discovery).
- 8 existing package FLD (`FLD-000093..102`) — legacy corporate (meetings), семантически не подходят.
- Нет existing FLD для физлиц в package-role context.
- Новые FLD будут generic, namespace `documents:package`, source через `document_package_session_participants.role_key → legal_details_persons`.

## Корректировки от ревьюера (фиксируются для Sprint 3B)

1. **Company-role fallback через `legal_details_entity_person_links` НЕ реализуется и НЕ резервируется в коде.** Руководитель компании в package-документах берётся только через явное `role_key='company_head'` в `document_package_session_participants`. Links допустимы только как UI-подсказка при выборе лица, но не как resolver fallback.
2. **Rollback по умолчанию — soft-disable через `archived_at`.** Hard DELETE из `fields_registry` / `document_token_registry` — только отдельным approve и только при условии: 0 использований в `document_templates`, `document_template_versions`, `token_manifest_snapshot`, `source_trace`, `ai_generated_documents`.
3. **`resolvePackageTokens` — отдельный модуль.** В существующем pipeline разрешена только минимальная routing-точка по `template_scope='package'`. Billing resolver/path не менять.
4. **Перед Sprint 3B execution подтвердить покрытие первого шаблона приказа:** organization → existing `legal_details` FLD; дата/номер/город приказа → existing document/system FLD, если уже есть; package-role/context поля → 5 новых generic FLD. Если дата/номер/город не закрыты existing FLD — НЕ создавать автоматически, выносить отдельным manifest decision.
5. **`package.context.plan_year` хранится только в `document_package_sessions.metadata.plan_year`.** Не брать год автоматически из текущей даты. При отсутствии — `unresolved` warning или blocking validation в зависимости от шаблона.

## Что НЕ изменилось

- 0 INSERT/UPDATE/DELETE в `fields_registry`.
- 0 INSERT/UPDATE/DELETE в `document_token_registry`.
- 0 миграций.
- 0 deploy edge functions.
- 0 UI-патчей.
- Sprint 3A — чисто документная фиксация уточнений и корректировок.
