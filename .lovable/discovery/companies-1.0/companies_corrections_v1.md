# companies_corrections_v1.md

Сверка правок по 12 пунктам ревью. Статусы: **внесено** / **частично внесено** / **не внесено**.

| # | Требование ревью | Статус | Где |
|---|---|---|---|
| 1 | Утверждённый контракт `company_contacts` (`relationship_type`, `source`, `is_billing_contact`; убрать `role='billing'`; зафиксировать внешний контакт и source lineage) | **внесено** | `companies_phase1_execution_plan.md` §2.2 (полный DDL + CHECK-инварианты, `profile_id NULL`, `external_full_name/email/phone`, `source_client_legal_details_map_id`); `companies_architecture_freeze.md` §9 (контракт зафиксирован в freeze) |
| 2 | Правильный namespace `CMP-000001` и подтверждённый генератор | **внесено** | `companies_rpc_inventory.md` §2 (реальный `next_public_id` через `pg_get_functiondef`); `companies_phase1_execution_plan.md` §2.1 (INSERT в `public_id_sequences` `('company','CMP',0)`) и §5 (триггер); `companies_architecture_freeze.md` §12; `companies_reuse_matrix.md` (`Public ID` строка обновлена); prefix `co` и `generate_public_id`/`generate_admin_catalog_public_id` отозваны |
| 3 | Границы Phase 1 (убрать trigger на `client_legal_details`, feature flag, registry inserts; восстановить минимальные RPC-скелеты Master Plan v2) | **внесено** | `companies_phase1_execution_plan.md` §1 (Scope + «вне Phase 1»), §4 (2 RPC-скелета `crm_company_get_or_create`, `crm_company_link_contact`), §5 (триггер на `client_legal_details` явно перенесён в Phase 4), §10 (что запрещено); `companies_automation_map.md` §5 (поток через RPC/domain events + safety-net queue); `companies_migration_strategy.md` §2, §8 |
| 4 | `company_kind`; решение `external_ids` vs integration mapping; GRP dates типизировать; `metadata` вместо `meta` и полный audit-набор | **внесено** | `companies_architecture_freeze.md` §8 (canonical company_kind), §7 (external_ids исключён из Phase 1, ADR-0002 в Phase 2); `companies_phase1_execution_plan.md` §2.1 (колонка `company_kind`, `grp_registration_date`/`grp_liquidation_date` типа `date`, `metadata jsonb`), §2.2/§2.3/§2.4 (везде `metadata`, полный audit-набор) |
| 5 | Исполняемый `updated_at` trigger на map-таблице | **внесено** | `companies_phase1_execution_plan.md` §2.3 (добавлены `created_at`, `updated_at`, `metadata` в `client_legal_details_company_map`, триггер `update_updated_at_column` теперь исполним) |
| 6 | Permissions discovery завершён (в т.ч. `admin_gost`); каждая роль — с явным основанием | **внесено** | `companies_permissions_matrix.md` §2 (машинный SELECT `role_admin_resource_access` и `role_admin_section_access` — `admin_gost=0` строк для CRM), §3 (итоговая матрица со столбцом «Основание», `admin_gost=❌` по всем действиям); подтверждено также в `companies_read_only_proof.md` §5 |
| 7 | Reuse verdict `ContactFeedTab` — contact-specific, не расширяется простыми props | **внесено** | `companies_reuse_matrix.md` (строка Timeline: `REFACTOR-FIRST / EXTRACT (deferred)` с обоснованием: `contactId`-prop, `contact_feed_list(_contact_id)` RPC, contact-specific composer); `companies_component_inventory.md` §2 (строка Feed — тот же вердикт) |
| 8 | Согласованная RPC phase matrix; `import-contacts-gc` и прочие integrations разрешены | **внесено** | `companies_rpc_inventory.md` §7 (canonical phase matrix c ролями EXECUTE), §6 (import-contacts-gc — импортер `profiles` из GetCourse, к Companies отношения не имеет, расширение — Phase 9 отдельный ADR, из blocking исключён); `companies_reuse_matrix.md` (`Глобальный поиск` строка — `search_companies` в Phase 2, не Phase 1); `companies_migration_strategy.md` §3 |
| 9 | Verification SQL, backfill counts, queue idempotency, feature flag naming, queue permissions | **внесено** | `companies_migration_strategy.md` §5 (проверки без `companies.client_type`; правильные равенства с `COUNT`/`DISTINCT` для map vs. company_contacts vs. distinct UNP; фактические числа из `companies_read_only_proof.md` §4), §6 (единый idempotency_key `cld:{id}:{updated_at_epoch_ms}`), §8 (единое имя `feature_companies_enabled`), §9 (queue — только `service_role`, `authenticated` без SELECT) |
| 10 | Полный rollback без «CASCADE безопасен» | **внесено** | `companies_phase1_execution_plan.md` §8 (пошаговый обратный порядок для каждого объекта; CASCADE явно запрещён; отдельно указано, что `admin_section/admin_resource/app_settings` не затронуты, поскольку в Phase 1 не вставлялись); `companies_migration_strategy.md` §11 |
| 11 | Устранение всех «если» / «проверить позже» по critical freeze decisions | **внесено** | `companies_automation_map.md` §2 (тип `trigger_event=text` проверен, формулировка «если это jsonb-поле» удалена); `companies_permissions_matrix.md` §3 (`admin_gost` — фактическое решение, «проверить в Phase E execution» удалено); `companies_architecture_freeze.md` §7 (external_ids — решение зафиксировано «исключено из Phase 1, ADR-0002 в Phase 2», формулировка «окончательное решение в Phase 2» без запрета удалена) |
| 12 | Точные db/code/rpc references и воспроизводимые read-only SQL proofs | **внесено** | `companies_read_only_proof.md` (7 воспроизводимых SQL с ожидаемыми результатами: `to_regclass` для 4 таблиц, `public_id_sequences` snapshot, `pg_get_function_identity_arguments` для генераторов, cardinality billing источника, role access basis, отсутствие триггеров `trg_company_*` на `client_legal_details`, список файлов коммита); `companies_permissions_matrix.md` §2 (SQL); `companies_rpc_inventory.md` §2 (SQL с реальным определением функций); `companies_migration_strategy.md` §5 (фактические числа) |

## Статус freeze

DRAFT / NOT APPROVED — **сохраняется**. Phase 1 execution не начинается до отдельного approval пользователем правок v1.

## Отозванные формулировки (снапшот)

- `role text DEFAULT 'billing'` в `company_contacts` — **отозвано** (§1).
- `prefix='co'`, `generate_public_id('co')`, `generate_admin_catalog_public_id` для companies — **отозвано** (§2).
- Trigger на `client_legal_details` в Phase 1 — **отозвано** (§3).
- Feature flag / `admin_section` / `admin_resource` inserts в Phase 1 — **отозвано** (§3).
- `external_ids jsonb` колонка в Phase 1 DDL — **отозвано** (§4).
- `grp_*_date text` — **отозвано**, заменено на `date` (§4).
- `meta jsonb` — **отозвано**, заменено на `metadata` (§4).
- `updated_at` trigger на `client_legal_details_company_map` без колонки `updated_at` — **исправлено** добавлением колонки (§5).
- `admin_gost` = «проверить в Phase E execution» — **отозвано** (§6): решение зафиксировано ❌.
- `ContactFeedTab = REUSE+PROPS (передать entity_type/entity_id)` — **отозвано** (§7).
- «В Phase 1 добавить search_companies / расширить search_global» — **отозвано** (§8): это Phase 2.
- `SELECT ... WHERE client_type <> 'individual' FROM companies` — **отозвано** (§9).
- `COUNT(company_contacts) >= COUNT(source rows)` — **отозвано** (§9): корректное равенство разделено на map vs contacts.
- `(entity_id, run_reason)` как idempotency_key — **отозвано** (§9): каноничен `cld:{id}:{updated_at_epoch_ms}`.
- `feature.companies.enabled` двойное имя — **отозвано** (§9): единственное — `feature_companies_enabled`.
- `GRANT SELECT ON company_sync_queue TO authenticated` — **отозвано** (§9).
- «DROP всех 4 таблиц, cascade безопасен» — **отозвано** (§10).
- «Если это jsonb-поле» про `crm_task_automation_rules.trigger_event` — **отозвано** (§11): тип `text` проверен.
