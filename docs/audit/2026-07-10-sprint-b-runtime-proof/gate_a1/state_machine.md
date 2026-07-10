# State machine RR-заявки (add-only)

`initiation_status` не расширяется. Дополнительное состояние — только в `meta.rr` (add-only ключи).

## Ключи в `meta.rr`

| Ключ | Значения |
|---|---|
| `initiation_status` | `pending` \| `created` \| `failed` |
| `payment_url` | string(https) или null |
| `provider_request_id` | реальный `json.id` от РР или null |
| `local_persist_failed` | `true` — canonical finalize упал после успешного createOrder |
| `rr_payment_url_recovered` | URL, полученный до сбоя persistence |
| `rr_request_id_recovered` | provider_request_id до сбоя persistence |
| `upstream_outcome` | `unknown` \| `rejected` \| `not_created` \| `created` |
| `failure_kind` | `timeout` \| `network` \| `invalid_json` \| `http` \| `invalid_response` \| null |
| `reconciliation_status` | `pending` \| `confirmed_created` \| `not_found` \| `operator_required` \| `resolved` |
| `operator_resolution` | `confirm_created` \| `keep_blocked` \| `allow_new_order` \| null |
| `reconciliation_attempts` | int (заполняется reconciler в Gate A.2) |

## Переходы

| Из | В | Кто | RPC | Событие(я) | Снятие durable-блока | Новый заказ после? |
|---|---|---|---|---|---|---|
| — (нет) | `pending`, `initiation_status='pending'` | edge (public) | `rr_get_or_create_pending_order` | — | — | — |
| `pending`, свежий (<120s) | `pending` (reuse) | edge | `rr_get_or_create_pending_order` | — | — | нет |
| `pending` | `created`, `payment_url` | edge, happy path | `rr_finalize_created_order` | `create_order_succeeded` | сразу | нет (тот же order) |
| `pending`, upstream_rejected | `failed`, `upstream_outcome='rejected'` | edge | `rr_finalize_order_rejected` (атомарно) | `create_order_rejected` | сразу | **да** (новым `external_id`) |
| `pending`, upstream_outcome=unknown | `pending`, `upstream_outcome='unknown'`, `reconciliation_status='pending'` | edge | `rr_mark_upstream_unknown` (атомарно) | `create_order_outcome_unknown` | требуется reconciler | нет |
| `pending`, canonical finalize упал | `pending`, `local_persist_failed=true`, recovered fields | edge | `rr_mark_local_persist_failed` | `create_order_persist_failed` | до успешного recovery finalize | нет |
| `pending`, `local_persist_failed=true` (повторный submit) | `created` | edge | `rr_finalize_created_order` (canonical) | `create_order_succeeded` + audit `create_order_recovered` | сразу | нет |
| `pending`, `upstream_outcome='unknown'` | `created` | reconciler (Gate A.2) | `rr_reconcile_confirm_created` (атомарно: canonical finalize + audit) | `create_order_succeeded` + `reconciliation_confirmed_created` | сразу | нет |
| `pending`, `upstream_outcome='unknown'`, definitive not_found | `failed`, `upstream_outcome='not_created'`, `reconciliation_status='not_found'` | reconciler (Gate A.2) | `rr_finalize_order_not_created` (атомарно) | `create_order_confirmed_not_created` | сразу | **да** |
| `pending`, URL не восстановим | `pending`, `reconciliation_status='operator_required'` | reconciler (Gate A.2) | обновление meta | `operator_required` (audit) | только оператором | нет |
| `pending`, `operator_required` | `pending`/`created`/`failed`, `resolved` + resolution | оператор | `rr_operator_resolve` (enum) | `operator_intervention` (+ canonical при confirm_created) | зависит от resolution | зависит |

## Операторские резолюции (`rr_operator_resolve`)

| `_resolution` | Эффект | Новый заказ после? |
|---|---|---|
| `confirm_created` | делегирует `rr_reconcile_confirm_created` (обязателен `_payment_url`); `initiation_status='created'`, `reconciliation_status='confirmed_created'`, `operator_resolution='confirm_created'` | нет — заказ уже валидный |
| `keep_blocked` | `reconciliation_status='resolved'`, `operator_resolution='keep_blocked'`; заказ остаётся `pending` и блокирует новые попытки этой identity | нет |
| `allow_new_order` | заказ переводится в terminal `failed`, `reconciliation_status='resolved'`, `operator_resolution='allow_new_order'`; выходит из reuse-кандидатов | **да** |

Произвольное JSON-редактирование оператором запрещено. Только через RPC с enum-параметром.

## Reuse-приоритет (RPC `rr_get_or_create_pending_order`)

1. `local_persist_failed = true` — без временного окна;
2. `upstream_outcome = 'unknown'` и `reconciliation_status ∈ (pending, operator_required)` — без временного окна;
3. `reconciliation_status = 'resolved'` и `operator_resolution ∈ (keep_blocked, confirm_created)` — без временного окна;
4. `initiation_status = 'created'` с валидным `payment_url`, `created_at ≥ now() - 30m`;
5. `initiation_status = 'pending'`, `created_at ≥ now() - 120s`, без durable-маркеров (concurrency happy path).

Заказы с `operator_resolution = 'allow_new_order'` в terminal `failed` — не reuse-кандидаты (позволяют новую заявку).

## Что вынесено в Gate A.2

- Edge-функция `rr-reconcile-order` (private, `verify_jwt=true`, service role/cron only) на существующем `rrGetOrderStatus`.
- Retry/backoff policy (`reconciliation_attempts`, `next_reconciliation_at`, terminal-guard).
- Подтверждение RR-контракта (см. `rr_provider_contract.md`).
- Integration proofs (11 сценариев) в отдельной preview/test Supabase environment.

Gate B заблокирован до полного PASS Gate A.2.
