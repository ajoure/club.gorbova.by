---
name: Package Token Aliases v1
description: SOT package-context плейсхолдеров поверх существующей базы реквизитов; namespace {{package.ul|ip|fl.FLD-XXXXXX}}; resolver через session/session_participants; HARDCODED_ENABLED=false; никаких записей в fields_registry без manifest.
type: feature
---

# Package Token Aliases v1 (Sprint 3D approved)

Архитектура: **одна база реквизитов + два разных контекста выбора + отдельный package resolver.**

```
Billing source path:  orders_v2 / customer / executor
Package source path:  document_package_sessions / document_package_session_participants
```

## Copy-token syntax (Variant B, утверждено Sprint 3D §5)

- `{{package.ul.FLD-XXXXXX}}` — реквизиты ЮЛ пакета.
- `{{package.ip.FLD-XXXXXX}}` — реквизиты ИП пакета.
- `{{package.fl.FLD-XXXXXX}}` — реквизиты физлица пакета (по выбранной роли).

Биллинговый `{{field:FLD-XXXXXX}}` в пакетных шаблонах **НЕ copy-ready** — он резолвится через billing context (заказчик заказа), не через package_session.

## Sprint-3B alias'ы

`package.roles.company_head.FLD-XXX`, `package.roles.responsible_person.FLD-XXX` (поверх FLD-000372/373) — реюзаются под тот же namespace; роль определяет выборку физлица из `session_participants`, не отдельную группу плейсхолдеров.

## Resolver contract (read-only описание, не реализовано)

- UL/IP → `client_legal_details WHERE id = session.selected_legal_entity_id`.
- FL → `legal_details_persons WHERE id = (SELECT person_id FROM document_package_session_participants WHERE session_id=? AND role_key=?)`.
- `metadata.position` → `session_participants.metadata->>'position'` по той же выборке.

## Жёсткие ограничения

- `_shared/resolve-package-tokens.ts` — `HARDCODED_ENABLED=false`, 0 production-импортов.
- `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`, billing/customer/executor resolver — не трогаются.
- Никаких новых FLD без manifest-proof; пробелы → backlog Sprint 3E (`pending_field` / `missing_source_column`).
- В UI только русские группы «Пакет: ЮЛ / ИП / ФЛ»; «Пакет: Исполнитель ЮЛ» не существует.

## SOT каталога

`src/utils/packagePlaceholderCatalog.ts` (frontend static) + `mem://architecture/documents/package-token-aliases-v1` (этот файл).

## Pre-flight RLS

`document_package_template_items`: политики «Owner can ... own package items» + admin/super_admin покрывают INSERT/UPDATE/DELETE для авторизованного владельца пакета. Direct INSERT из frontend безопасен — отдельный RPC не требуется.
