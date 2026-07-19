# CRM Companies — Final Discovery 1.0 (Architecture Freeze)

Статус: **ЧЕРНОВИК / NOT APPROVED / DO NOT EXECUTE** до подписания пользователем.

Языковой контракт: все документы, план и отчёт — только на русском языке.
Каждое инженерное сообщение начинается либо с «План:», либо с «Отчёт о выполненной работе:».

## Неизменяемые инварианты Master Plan v2 (не пересматриваются в Discovery 1.0)

- `companies` — standalone canonical CRM-сущность.
- `profiles` остаётся сущностью физлица/контакта.
- Access, entitlements и Telegram привязаны только к `profile_id`.
- Auto-source только: `client_legal_details.purpose='billing' AND client_type IN ('legal_entity','entrepreneur')`.
- `purpose='document'`, `legal_details_persons`, `legal_details_entity_person_links` **не** участвуют в CRM auto-source.
- `client_legal_details` остаётся compat SoT.
- `company_contact_person_map` **не входит** в Phase 1 и отложен до Phase 10+.
- Phase 1 core ограничен: `companies`, `company_contacts`, `client_legal_details_company_map`, `company_sync_queue` **или** доказанное переиспользование существующей очереди (см. `companies_architecture_freeze.md` §Queue).

Отменить любой инвариант можно только отдельным ADR с явным approval пользователя.

## Deliverables (11 документов)

1. `companies_architecture_freeze.md` — ADR-0001, реестр решений, инварианты.
2. `companies_reuse_matrix.md` — reuse-матрица «блок → существующее → вердикт».
3. `companies_component_inventory.md` — UI-инвентаризация.
4. `companies_rpc_inventory.md` — RPC/edge/поисковые пути.
5. `companies_ui_inventory.md` — UI-паттерны и чек-лист consistency.
6. `companies_permissions_matrix.md` — реальные роли и guards.
7. `companies_automation_map.md` — activity vs domain_events vs audit + automation.
8. `companies_performance_notes.md` — cardinality и рекомендации по индексам.
9. `companies_migration_strategy.md` — paper-only последовательность.
10. `companies_future_extensions.md` — Holding/Parent/Subsidiary как future scope.
11. `companies_phase1_execution_plan.md` — DRAFT-план Phase 1 (не запускать).

## Границы Discovery 1.0

- Только чтение: schema, sample counts, статический анализ исходников.
- Никаких миграций, RPC, edge functions, UI, feature flag.
- `git diff` по коду/миграциям/SQL/edge = пусто; изменены только markdown в `.lovable/discovery/companies-1.0/`.
- Все ссылки на текущее состояние — с указанием `db:<table>.<col>`, `code:<path>:Lx-Ly`, `rpc:<signature>`.

## Definition of Done

- 11 файлов созданы и перекрёстно связаны.
- Каждое утверждение о состоянии — с точной ссылкой.
- Для каждого будущего блока Companies зафиксирован вердикт reuse.
- В `companies_architecture_freeze.md` есть разделы: Resolved / Deferred / Explicitly rejected / Blockers before Phase 1 / Non-blocking follow-up.
- DB schema до/после идентична.
