# State machine RR-заявки (Gate A.1 v3.1)

`initiation_status` не расширяется. Дополнительное состояние — только в `meta.rr` (add-only ключи).

## Ключи в `meta.rr`

| Ключ | Значения |
|---|---|
| `initiation_status` | `pending` \| `created` \| `failed` |
| `payment_url` | https-URL без basic-auth, или null |
| `provider_request_id` | реальный `json.id` от РР или null |
| `upstream_call_state` (v3.1) | `not_started` \| `started` \| `outcome_unknown` \| `completed_unpersisted` \| `completed` |
| `local_persist_failed` | `true` — canonical finalize упал после успешного createOrder |
| `rr_payment_url_recovered` | URL до сбоя persistence |
| `rr_request_id_recovered` | provider_request_id до сбоя persistence |
| `upstream_outcome` | `unknown` \| `rejected` \| `not_created` \| `created` |
| `failure_kind` | `timeout` \| `network` \| `invalid_json` \| `http` \| `invalid_response` \| null |
| `reconciliation_status` | `pending` \| `confirmed_created` \| `not_found` \| `operator_required` \| `resolved` |
| `operator_resolution` | `confirm_created` \| `keep_blocked` \| `allow_new_order` \| null |
| `reconciliation_attempts` | int (заполняется reconciler в Gate A.2) |

## Переходы `upstream_call_state` (v3.1)

| Из | В | Кто | Условие |
|---|---|---|---|
| — (нет заказа) | `not_started` | `rr_get_or_create_pending_order` при INSERT | новый заказ |
| `not_started` | `started` | `rr_mark_call_started` | edge, перед `rrCreateOrder` |
| `started` | `completed` | `rr_finalize_created_order` | canonical happy path |
| `started` | `completed_unpersisted` | `rr_mark_local_persist_failed` | canonical finalize упал |
| `started` | `outcome_unknown` | `rr_mark_upstream_unknown` | вызов РР завершён неопределённо |
| `started` | `completed` | `rr_finalize_order_rejected` | РР явно отклонил |
| `completed_unpersisted` | `completed` | `rr_finalize_created_order` (recovery) | повторный submit после сбоя persistence |
| `outcome_unknown` | `completed` | `rr_reconcile_confirm_created` (via internal) | reconciler подтвердил created |
| `outcome_unknown` | `completed` | `rr_finalize_order_not_created` | reconciler подтвердил not_found (contract flag) |
| любое (кроме created/failed) | `completed` | `rr_operator_resolve` | оператор |

`started` НЕ сохраняется навсегда после post-call marker success. `started` остаётся только пока пост-call marker RPC не выполнился (двойной retry-fail post-call → durable `started` до вмешательства reconciler/оператора — это единственный fail-closed сценарий).

## Приоритет reuse-веток в edge (v3.1)

Строгий порядок в `public-rr-installment-initiate` после `was_reused=true`:

1. `initiation_status='created'` + `isSafePaymentUrl(payment_url)` → **200** с существующим URL.
2. `reconciliation_status='resolved'`:
   - `operator_resolution='confirm_created'` + URL → **200**;
   - `operator_resolution='keep_blocked'` → **503 rr_blocked_by_operator**;
   - иное → **503 rr_operator_pending**.
3. `local_persist_failed=true`:
   - валидный recovered URL → canonical finalize → **200** (recovered=true);
   - невалидный recovered URL → audit `recovery_blocked_no_url` (reason=`invalid_url`|`no_url`) → **503 rr_recovery_pending**.
4. `upstream_outcome='unknown'` → **503 rr_reconciliation_pending**.
5. `upstream_call_state='started'` без создания/failed → **503 rr_call_in_flight**.
6. Иначе — polling до 15s, ожидаем `initiation_status='created'` + валидный URL.

Ключевое v3.1: пункты 3, 4, 5 не пересекаются, потому что post-call marker RPC переводят `upstream_call_state` из `started` в семантически корректное значение.

## Typed-state контракт edge → RPC

Edge требует конкретный `state` в возврате перед продолжением:

| RPC | Допустимые `state` для продолжения | Иначе |
|---|---|---|
| `rr_mark_call_started` | `call_started` | `failClosedReread` (без `rrCreateOrder`) |
| `rr_finalize_created_order` (happy/recovery) | `finalized`, `already_created` | `failClosedReread` |
| `rr_finalize_order_rejected` | `rejected`, `already_rejected` | `failClosedReread` |
| `rr_mark_upstream_unknown` | `unknown_marked`, `already_unknown` | `failClosedReread` |
| `rr_mark_local_persist_failed` | `persist_failed_marked`, `already_persist_failed` | `failClosedReread` |

`failClosedReread` перечитывает `orders_v2.meta` и возвращает клиенту ответ, соответствующий фактическому durable состоянию (created / rejected / not_created / persist_failed / unknown / call_in_flight / unknown_state).

## Canonical success-state writer

Единственный SQL writer canonical success-state — `rr_finalize_created_order_internal`.
`REVOKE ALL FROM PUBLIC, anon, authenticated, service_role`. Вызывается только через:

- `rr_finalize_created_order` (source='canonical') — happy path и recovery, guard против ambiguous source;
- `rr_reconcile_confirm_created` (source='reconciler') — единственный вход `upstream_outcome='unknown' → created`, добавляет `reconciliation_confirmed_created` event.

Прямой вызов `rr_finalize_created_order` для заказа с `upstream_outcome IN ('unknown','rejected','not_created')` без `local_persist_failed=true` → `rr_finalize_ambiguous_source_forbidden` (ERRCODE 22023). Обход невозможен: internal helper не имеет EXECUTE ни для одной роли.
