# План: матрица возвратов

| Канал | Фактический путь в коде | Риск |
|---|---|---|
| Stripe | `stripe-admin-refund` → provider → `charge.refunded` → `record_refund_atomic` | Наиболее близок к canonical |
| bePaid webhook | refund detection, `payments_v2.refunds/refunded_amount` | Повторные/частичные события требуют версии |
| bePaid reconcile | `bepaid-process-refunds` может создавать отрицательную payment-row | Возможное двойное представление возврата |
| Агрегация заказа | `refunds-recompute-order-status` суммирует successful refunds и `refunded_amount` | Нужно доказать единый cumulative amount |

До live SQL нельзя выбрать `refund_id/refund_version` и написать безопасный reversal consumer.
