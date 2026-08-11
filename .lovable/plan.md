# Отчет: READ-ONLY диагностика повторной попытки refund — STOP

Мутаций нет: код, данные, функции, deploy, Publish и реальный возврат не выполнялись.

## 1) Свежий runtime-факт

- Последний вызов `subscription-admin-actions`: **2026-08-11 15:24:20 UTC**.
- Лог: `Admin [redacted] performing refund`.
- После этой строки нет логов `Sending refund to bePaid`, ответа bePaid, `record_refund_atomic` или post-refund.
- Точный исход этого пути: **HTTP 400**.
- Response body (безопасно):

```json
{"success":false,"error":"refundable_order_group_not_found"}
```

- Этап падения: **composable pre-refund RPC `create_composable_refund_intent`**, до обращения к bePaid.

## 2) Сопоставленный заказ (PII и provider UID скрыты)

- Contact: Филиппова Елена (идентичность сверена, в отчёте персональные идентификаторы не приводятся).
- Order ID: `1e5890d0-132a-4f58-9898-516c2671d9fe`.
- Public/order number: `SUB-LINK-MSL13KY3`.
- Order: `paid`, сумма/оплачено `250 BYN`.
- Payment: provider `bepaid`, status `succeeded`, transaction type `payment`, `refunded_amount = 0`, `refunded_at = NULL`.
- Subscription: `09b0f74f-1226-4dd2-aae9-72c19e8684a2`, status `active`, billing type `provider_managed`, auto-renew включён.

## 3) Точная причина

Заказ и платёж сами по себе валидны. Ошибка находится в composable-слое:

- заказ включён в `order_group`;
- в группе есть primary item на 250 BYN, поэтому `RefundDialog` автоматически отправляет `order_group_item_id` и `refund_request_key`;
- но `order_groups.status = pending`, хотя связанный `orders_v2.status = paid` и платёж `succeeded`;
- для item отсутствует строка `payment_allocations`;
- RPC сначала требует статус группы `paid` или `partially_refunded`; из-за `pending` немедленно выбрасывает `refundable_order_group_not_found`;
- функция превращает эту RPC-ошибку в HTTP 400. До следующей проверки `payment_allocation_not_found` выполнение не доходит.

Итого: **это рассинхронизация materialization order group, а не ошибка `keep_subscription`, auth, bePaid или оплаченного платежа**.

## 4) Проверка, произошёл ли возврат

**Нет, возврат в bePaid не произошёл.** Доказательства:

- код вызывает `create_composable_refund_intent` до provider API и завершает запрос HTTP 400 при ошибке RPC;
- нет лога отправки refund в bePaid;
- нет composable refund intent;
- нет refund payment-row для заказа;
- исходный payment остаётся `succeeded`, `refunded_amount = 0`, `refunded_at = NULL`;
- нет refund audit-маркеров для этого заказа/попытки.

Повторная попытка также ничего у провайдера не изменила.

## STOP

Никаких исправлений или дополнительных runtime-вызовов не выполнялось.
