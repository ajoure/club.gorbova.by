---
name: Package Token Aliases v1
description: SOT package-context плейсхолдеров поверх существующей базы реквизитов; namespace {{package.ul|ip|fl.FLD-XXXXXX}}; resolver через session/session_participants; HARDCODED_ENABLED=false; никаких записей в fields_registry без manifest. Sprint 3E: jsonb-path для адресов + bank_* в legal_details_persons.
type: feature
---

# Package Token Aliases v1 (Sprint 3D approved, Sprint 3E extended)

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

## Sprint 3E: jsonb-path source для адресов

Плоских колонок `*_address_street/house/...country` в `client_legal_details` **нет** — данные хранятся только в JSONB `leg_address_structured` / `ent_address_structured` (для ФЛ — `legal_details_persons.address_structured`). Resolver-path:

```
client_legal_details.leg_address_structured->>'street'   → {{package.ul.FLD-000035}}
client_legal_details.ent_address_structured->>'street'   → {{package.ip.FLD-000043}}
legal_details_persons.address_structured->>'street'      → {{package.fl.FLD-000032}}
```

Канонические JSON-ключи (соответствуют StructuredAddress): `street, house, building, apartment, city, city_district, region, district, postal_code, country`. FLD-определения переиспользуются из биллинговой базы FLD-000028..050 (label/type общие); package source path — jsonb.

## Sprint 3E: bank_* в legal_details_persons

Миграция `2026_05_28` добавила в `legal_details_persons` nullable колонки `bank_account, bank_name, bank_code`. Package-токены ФЛ переиспользуют биллинговые FLD-000004/5/6:

```
legal_details_persons.bank_account → {{package.fl.FLD-000004}}
legal_details_persons.bank_name    → {{package.fl.FLD-000005}}
legal_details_persons.bank_code    → {{package.fl.FLD-000006}}
```

UI ввода — `PersonFieldsForm` (карточка «Банковские реквизиты»). Никаких отдельных таблиц/FLD не создавалось.

## Resolver contract (read-only описание, не реализовано)

- UL/IP → `client_legal_details WHERE id = session.selected_legal_entity_id`.
- FL → `legal_details_persons WHERE id = (SELECT person_id FROM document_package_session_participants WHERE session_id=? AND role_key=?)`.
- `metadata.position` → `session_participants.metadata->>'position'` по той же выборке.

## Жёсткие ограничения

- `_shared/resolve-package-tokens.ts` — `HARDCODED_ENABLED=false`, 0 production-импортов.
- `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`, billing/customer/executor resolver — не трогаются.
- Никаких новых FLD без manifest-proof; пробелы → backlog (`pending_field` / `missing_source_column` / `deferred`).
- В UI только русские группы «Пакет: ЮЛ / ИП / ФЛ»; «Пакет: Исполнитель ЮЛ» не существует.
- Биллинговые FLD-000004..050 и FLD-000273..346 НЕ изменяются.

## Pending / deferred (Sprint 3E backlog)

- UL/IP «Адрес: район / район города» — есть jsonb-source, нет FLD в `fields_registry` для `leg_address_district / leg_address_city_district / ent_address_district / ent_address_city_district`. Биллинг тоже без них.
- FL «Адрес: полный / корпус / район города / страна» — есть jsonb-source, нет FLD `ind_address_full / ind_address_building / ind_address_city_district / ind_address_country`.

Все они создаются только после manifest-proof, не в этом спринте.

## SOT каталога

`src/utils/packagePlaceholderCatalog.ts` (frontend static) + `mem://architecture/documents/package-token-aliases-v1` (этот файл).

## Pre-flight RLS

`document_package_template_items`: политики «Owner can ... own package items» + admin/super_admin покрывают INSERT/UPDATE/DELETE для авторизованного владельца пакета. Direct INSERT из frontend безопасен — отдельный RPC не требуется.
