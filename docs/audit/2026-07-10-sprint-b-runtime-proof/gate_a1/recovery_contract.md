# Durable recovery contract

## Условие срабатывания

`orders_v2.meta.rr.local_persist_failed = true`. Маркер выставляется только когда РР уже вернул валидный `payment_url` (upstream_created), но `rr_finalize_created_order` упал (сбой БД, deadlock, connection loss).

`local_persist_failed` **не используется** для rejection и не используется для ambiguous upstream.

## Требования

- `payment_url` (`meta.rr.rr_payment_url_recovered`) **обязателен**.
- `provider_request_id` (`meta.rr.rr_request_id_recovered`) — **опционален** (nullable): РР может не возвращать `json.id` в некоторых сценариях. Отсутствие ID **не** блокирует recovery.
- Подстановка `external_id` вместо `provider_request_id` **запрещена**.

## Алгоритм повторного submit

1. `rr_get_or_create_pending_order` возвращает тот же `order_id`, `was_reused=true` (кандидат приоритета 1).
2. edge читает `meta.rr.rr_payment_url_recovered` (+ optionally `rr_request_id_recovered`).
3. Если URL отсутствует → **HTTP 503 `rr_recovery_pending`**, `provider_events.recovery_blocked_no_url` (идемпотентно). `rrCreateOrder` **не вызывается**. Новый `orders_v2.id` **не создаётся**.
4. Если URL присутствует → **canonical** `rr_finalize_created_order(order_id, url, provider_request_id_or_null, null, {source:"recovery"}, correlation_id)`.
5. Отдельный audit-only event `create_order_recovered` (идемпотентно, best-effort).
6. Ответ: `{ payment_url, order_id, reused:true, recovered:true }`.

## Postcondition canonical finalize (полный)

```json
{
  "initiation_status": "created",
  "payment_url": "<canonical https url>",
  "provider_request_id": "<real or null>",
  "local_persist_failed": false,
  "reconciliation_status": null | "confirmed_created",
  "upstream_outcome": null | "created"
}
```

Forensic-поля `rr_payment_url_recovered`, `rr_request_id_recovered`, `local_persist_error` **не удаляются физически** (audit ценность), но `local_persist_failed=false` снимает reuse-приоритет 1, и рабочая логика больше не считает их активным маркером.

## Идемпотентность

Событие `create_order_succeeded` вставляется с `idempotency_key = '<order_id>:create_order_succeeded'` (UNIQUE constraint `provider_events.idempotency_key`). Повторный recovery не создаёт дубликата.

Пять параллельных повторов старого `local_persist_failed`-заказа обязаны дать: **1 order_id, 0 новых `rrCreateOrder`, 1 canonical `create_order_succeeded`** (проверяется integration-тестом в Gate A.2).
