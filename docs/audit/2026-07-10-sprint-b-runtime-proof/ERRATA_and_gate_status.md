# Sprint B — Errata и Gate-статус (обновлено после ревью Gate A.1 v1)

Дата: 2026-07-10
Автор: Lovable engineer

## Общий статус спринта

**Sprint B — FAIL.** Sprint C **не начинать**.

## Gate-статус

| Gate | Статус | Условие закрытия |
|---|---|---|
| A (первичный hardening: honeypot, persistence, atomic finalize) | PASS | — |
| A.1 (durable recovery, ambiguous, atomic rejected, hardening, discovery) | **PARTIAL PASS / PASS WITH BLOCKER** | backend contract закрыт; reconciler и integration proofs вынесены в A.2 |
| A.2 (working reconciler, RR contract, retry policy, 11 integration tests в preview/test env) | **NOT STARTED** — обязателен до Gate B | см. `gate_a1/README.md` |
| B (UI patch, deploy, public E2E, negative proofs v2) | **BLOCKED** до Gate A.2 PASS | — |

## Errata предыдущих отчётов

- Фактическое имя миграции concurrency-фикса: `supabase/migrations/20260710085550_3d877fb1-215b-4219-a311-d84952134c83.sql`. В `REPORT.md` встречалось `20260710085555_*` — опечатка, физического второго файла нет.
- Gate A.1 v1 содержал ошибки, устранённые в v2:
  - `contact_hash` — не вводится; identity остаётся `offer_id + user_id + email_norm + phone_norm`;
  - JSON-path для recovery-полей — только `meta->'rr'->>'...'`, не `meta->>'...'`;
  - сигнатура `rr_get_or_create_pending_order` **не меняется**;
  - recovery выполняется через canonical `rr_finalize_created_order`, не через отдельный `rr_recover_persist_failed_order` (последний **не создавался** в этой итерации);
  - reconciler использует существующий `rrGetOrderStatus` из `_shared/rr/rr-adapter.ts`; никакой `rrClient.ts`/`rrReconcileByExternalId` не добавляется;
  - `initiation_status='upstream_unknown'` не вводится; всё ambiguous-состояние — только в `meta.rr.upstream_outcome` + `reconciliation_status`;
  - rejected-state фиксируется атомарным `rr_finalize_order_rejected` (единая транзакция);
  - `local_persist_failed` — только для сбоя persistence после успешного createOrder, не для rejection.

## Изменения кода в Gate A.1 v2

- Migration: расширение `rr_get_or_create_pending_order` (durable-block кандидаты без смены сигнатуры), новые RPC `rr_mark_upstream_unknown`, `rr_finalize_order_rejected`, `rr_finalize_order_not_created`, `rr_reconcile_confirm_created`, `rr_operator_resolve`. Все — `SECURITY DEFINER`, `search_path = public, pg_temp`, `EXECUTE service_role only`, `REVOKE` у `anon`/`authenticated`.
- Edge `public-rr-installment-initiate`: полная переработка ветвлений (recovery / reconciliation-pending / operator-resolved / new order с классификацией outcomeClass + failureKind).
- `_shared/rr/rr-adapter.ts` + `rr-http.ts`: убран fallback `json.id ?? externalId`; добавлены `outcomeClass`, `failureKind`, транспортные флаги (`aborted`, `networkError`, `parseError`); валидация `payment_url` (https, без credentials).

## Что вынесено в Gate A.2

1. Непубличная edge-функция `rr-reconcile-order` (`verify_jwt=true`, service-role/cron only, negative auth tests).
2. `rr_provider_contract.md` — подтверждение поведения `getOrderStatus`, идемпотентности `createOrder`, definitive `not_found`, retry policy.
3. Backoff / attempts policy (`reconciliation_attempts`, `next_reconciliation_at`, terminal-guard, alert на `operator_required`).
4. Integration tests (11 сценариев) в отдельной preview/test Supabase environment. Production `orders_v2`/`provider_events` не создавать.
5. Финальный отчёт `REPORT_v2.md`.

Только после Gate A.2 PASS открывается Gate B (UI patch + public E2E + negative proofs v2).
## Gate A.1 v3 — статус после доставки

Дата: 2026-07-10 20:41 UTC. **Superseded by v3.1.**

- Миграция `20260710204120_*.sql` применена; runtime-артефакты в `gate_a1_v3/runtime_proof/`.
- Edge `public-rr-installment-initiate` переработан: pre-call durable marker, retry marker RPC, HTTP 500 `local_state_unconfirmed`, аудит через `rr_insert_idempotent_audit_event`.
- Adapter `_shared/rr/rr-adapter.ts`: пустой `RR_DOCUMENTED_REJECTION_CODES`, redacted `link`.
- Обнаружены критические ошибки приоритета state machine (см. Gate A.1 v3.1).

## Gate A.1 v3.1 — статус после доставки

Дата: 2026-07-10 21:14 UTC.

- Миграция `20260710211440_*.sql` применена. Все затронутые RPC подтверждены runtime-артефактами в `gate_a1_v3_1/runtime_proof/`.
- Блокеры №1, №2, №3, №4 закрыты (см. `gate_a1_v3_1/README.md`).
- Блокер №5 (14 integration tests) — **PARTIAL**: SQL-контракт подтверждён runtime; полный edge-integration suite с fault-injection отложен до согласования механизма (амандмент №10 плана).
- Обновлён `gate_a1/state_machine.md` — новая модель `upstream_call_state` и порядок reuse-веток.

**Статусы:**
- Gate A.1 v3.1 implementation: **PASS**
- Gate A.1 v3.1 acceptance: **PARTIAL PASS** (SQL contract PASS, edge integration suite отложен)
- Gate A.2: **BLOCKED**
- Gate B: **BLOCKED**
- Sprint B: **FAIL**
- Sprint C: **не начинать**

## Gate A.1 v3.1a — статус подготовки (без runtime)

Дата: 2026-07-11 UTC.

Preview/test Supabase environment ещё не создан. По поправке №1 плана в этом шаге выполнены только discovery, подготовка миграции и статический анализ. Никаких изменений в production БД, edge deploy, backfill, SQL integration tests, edge integration tests и fault injection не выполнялось.

**Draft-артефакты Gate A.1 v3.1a:**
- `gate_a1_v3_1a/draft/migration_gate_a1_v3_1a.sql`
- `gate_a1_v3_1a/draft/proposed_edge_diff.md`
- `gate_a1_v3_1a/draft/sql_test_suite.md` (18 сценариев)
- `gate_a1_v3_1a/draft/edge_test_suite.md` (16 сценариев)
- `gate_a1_v3_1a/draft/mock_rr_ledger_contract.md`
- `gate_a1_v3_1a/draft/fault_injection_architecture.md`
- `gate_a1_v3_1a/draft/rollback_strategy.md`
- `gate_a1_v3_1a/draft/runtime_proof_templates.md`

**Артефакт preview:**
- `preview_environment_setup.md`

**Discovery Gate B (без правок):**
- `ui_wiring_discovery.artifacts/site_page_cb.json`
- `ui_wiring_discovery.artifacts/blocks.json`
- `ui_wiring_discovery.artifacts/renderers.md`
- `ui_wiring_discovery.artifacts/action_schema.md`
- `ui_wiring_discovery.artifacts/offer_bindings.md`

**Статусы:**
- Gate A.1 v3.1a code preparation: **PARTIAL** (только draft-файлы; не применены)
- Gate A.1 v3.1a runtime execution: **BLOCKED** — preview/test environment отсутствует
- Gate A.1 acceptance: **FAIL**
- Gate A.2: **BLOCKED**
- Gate B discovery: **выполнен**
- Gate B patch/deploy/E2E: **BLOCKED**
- Sprint B: **FAIL**
- Sprint C: **BLOCKED**

Статус `IMPLEMENTED, NOT VERIFIED` к draft-файлам не применяется (файлы не задеплоены и не применены к БД).


## Gate A.1 v3.1a — обновление после ревью discovery (2026-07-10, поправки заказчика)

Добавлены обязательные артефакты по 6 пунктам ревью:

1. **UI discovery — доказательство цепочки события.** `ui_wiring_discovery.artifacts/event_chain_proof.md`: ссылки на конкретные строки `src/components/shared/HtmlIframePreview.tsx` (304, 362, 368, 378, 386, 847) и `src/pages/SitePageBySlug.tsx` (4, 30, 41–47, 61–72, 74, 77, 136, 150–166, 188–189, 253–254).
2. **`amount=0` вынесен отдельно.** `ui_wiring_discovery.artifacts/amount_zero_investigation.md`: возможные причины, план проверок (все read-only), обоснование, что discovery не блокируется, но Gate B — блокируется до подтверждения источника суммы.
3. **Draft migration scope manifest.** `gate_a1_v3_1a/draft/migration_scope_manifest.md`: SHA-256 `5da444ab11ff6391236abc85c19314621e86eaa5dc772881035c0284362444bc`, 474 строки, полный список из 8 функций (1 новая + 7 replace), expected schema diff, anti-scope.
4. **Runtime proof templates — полный перечень.** `gate_a1_v3_1a/draft/runtime_proof_templates.md` содержит именованный список из 20 файлов (`migration_applied.txt`, `migration_runtime_proof.md`, `functiondef_before.txt`, `functiondef_after.txt`, `proconfig.txt`, `owner_security_matrix.txt`, `privilege_matrix.txt`, `internal_helper_privileges.txt`, `legacy_backfill_before.txt`, `legacy_backfill_after.txt`, `sql_integration_tests.md`, `edge_integration_tests.md`, `mock_rr_ledger.json`, `fault_injection_enable_disable.txt`, `fault_injection_absent_in_production.txt`, `deploy_proof.txt`, `production_snapshot_before.txt`, `production_snapshot_after.txt`, `production_attribution_diff.txt`, `rollback_strategy.md`).
5. **Preview environment — уточнения.** `preview_environment_setup.md` переписан: добавлены §2 (версии PostgreSQL / Supabase / PostgREST / GoTrue / Deno с процедурой проверки), §3 (синхронизация схем строго через `supabase/migrations/`, порядок применения production-миграций, запрет ручных правок), а также переформулирована ответственность: создание preview-окружения — задача платформы Lovable / владельца инфраструктуры; агент не имеет доступа к management-API Lovable и не может создать preview project, service-role key, Edge Function Secrets. Соответствующий пункт зафиксирован как внешний инфраструктурный блокер (R2).
6. **Known unresolved risks.** `known_unresolved_risks.md`: R1 provider contract, R2 preview environment (внешний блокер), R3 runtime suite, R4 reconciler, R5 UI wiring, R6 Gate B, плюс R7 (`amount=0`), R8 (расхождение цен Tilda vs DB, вне scope), R9 (fault-injection hook в prod bundle), R10 (backfill не валидирован на реальных данных). Правило снятия — только по ссылке на runtime-артефакт.

### Итоговый статус (без изменений по сути, уточнены формулировки)

- Gate A.1 v3.1a code preparation: **PARTIAL** (draft + manifest + templates готовы).
- Gate A.1 v3.1a runtime execution: **BLOCKED — внешний инфраструктурный блокер (R2), preview environment отсутствует на стороне Lovable Cloud**.
- Gate A.1 acceptance: **FAIL**.
- Gate A.2: **BLOCKED**.
- Gate B discovery: **выполнен** (см. `ui_wiring_discovery.artifacts/`).
- Gate B patch/deploy/E2E: **BLOCKED**.
- Sprint B: **FAIL**.
- Sprint C: **BLOCKED**.

Никаких production writes, никаких deploy'ев в этом шаге.
