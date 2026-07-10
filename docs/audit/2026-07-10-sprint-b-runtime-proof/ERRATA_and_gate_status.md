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

