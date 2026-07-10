# Gate A.1 — сводка (Sprint B follow-up)

**Область:** durable recovery, working reconciliation-контракт, атомарные terminal finalizers, operator resolution enum, SECURITY DEFINER hardening.

## Что сделано в этом шаге

1. **Миграция** `20260710_gate_a1_hardening.sql`:
   - расширен `rr_get_or_create_pending_order` — durable-block ветки (recovery, ambiguous, operator-resolved) без изменения сигнатуры `(order_id, was_reused, order_number)`;
   - добавлены RPC `rr_mark_upstream_unknown`, `rr_finalize_order_rejected`, `rr_finalize_order_not_created`, `rr_reconcile_confirm_created`, `rr_operator_resolve` — все `SECURITY DEFINER`, `search_path = public, pg_temp`, `EXECUTE` только `service_role`, `REVOKE` у `anon`/`authenticated`.
2. **Edge `public-rr-installment-initiate`** переписан:
   - убран fallback `json.id ?? externalId`; `provider_request_id` = только реальный `json.id`;
   - добавлена классификация `outcomeClass ∈ {upstream_created, upstream_rejected, upstream_outcome_unknown}` + `failureKind ∈ {timeout, network, invalid_json, http, invalid_response, null}`;
   - upstream_rejected → атомарный `rr_finalize_order_rejected` → 502;
   - upstream_outcome_unknown → атомарный `rr_mark_upstream_unknown` → 504;
   - upstream_created → canonical `rr_finalize_created_order`;
   - reuse-ветки: recovery (через canonical finalize), reconciliation-pending → 503, operator resolved → 200/503;
   - валидация `payment_url`: строка, `https:`, без credentials.
3. **RR adapter** (`_shared/rr/rr-adapter.ts` + `rr-http.ts`):
   - расширен `RRHttpCallResult` (`aborted`, `networkError`, `parseError`);
   - `rrCreateOrder` возвращает `outcomeClass` и `failureKind`, никакой строковой эвристики.

## Статус

| Пункт | Статус |
|---|---|
| Durable recovery через canonical finalizer | реализовано |
| Atomic rejected finalizer | реализовано |
| Atomic not_created finalizer | реализовано |
| Ambiguous upstream marker | реализовано |
| Reconciliation confirm (atomic + audit) | реализовано |
| Operator resolve (enum) | реализовано |
| SECURITY DEFINER hardening (search_path, revokes) | реализовано |
| Working reconciler edge (rrGetOrderStatus) | **Gate A.2** — вынесено; см. `state_machine.md §Gate A.2` |
| RR provider contract (URL recovery, идемпотентность createOrder) | **Gate A.2** — требуется подтверждение по документации/test-response до включения confirm_created |
| Integration tests в preview/test env | **Gate A.2** — 11 сценариев, требуют отдельной preview-инфраструктуры |
| UI mini-план (schema-first discovery) | реализовано discovery-документом |

## DoD

Gate A.1 получает **PARTIAL PASS / PASS WITH BLOCKER**:

- backend contract закрыт (RPC, edge, adapter, hardening);
- working reconciler и integration proofs вынесены в **обязательный Gate A.2**;
- Gate B заблокирован до Gate A.2 PASS;
- Sprint B остаётся FAIL; Sprint C не начинать.

См. `state_machine.md`, `recovery_contract.md`, `ambiguous_upstream_contract.md`, `rr_provider_contract.md`, `ui_wiring_mini_plan.md`.
