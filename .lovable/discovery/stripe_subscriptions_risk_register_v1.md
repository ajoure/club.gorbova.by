# D8. Risk Register (v1)

| # | Риск | Severity | Mitigation |
|---|------|----------|-----------|
| R1 | Двойное списание (повторный webhook / replay) | high | `provider_events_idem_unique` + idempotent `orders_v2` по `invoice.id` |
| R2 | Расхождение access window (Stripe period vs наш access_end_at) | high | GREATEST в `grant-access-for-order`; Stripe overshoot guard (tolerance 1.5×access_days) |
| R3 | Зомби-подписка (Stripe canceled, локально active) | high | reconcile + INV-22 Stripe-аналог: local cancel при провайдерской смерти |
| R4 | Зомби-подписка (Stripe active, локально canceled) | medium | reconcile сверка → восстановление через manual_review |
| R5 | Ошибочный grant без матча tariff_id | high | `extend-tariff-match-required` распространён на Stripe |
| R6 | Регрессия bePaid контура | critical | freeze bePaid edge-функций и RPC; multi-provider RPC `record_refund_atomic_multi` add-only |
| R7 | Customer Portal изменил карту/отменил подписку — наша БД не знает | high | webhook `customer.subscription.updated` + `payment_method.*` + reconcile fallback |
| R8 | Lost webhook (как в Phase 2) | high | Lost Webhook Recovery (D5): reconcile + events.list replay |
| R9 | Cross-account confusion (event аккаунта A на endpoint B) | high | резолв `account_code` из signing secret; conflict → manual_review |
| R10 | Stripe API outage во время Create | medium | pre-create rollback (как в bePaid): `subscriptions_v2(pending)` чистится по TTL |
| R11 | PaymentMethod expired / SCA challenge | medium | `invoice.payment_action_required` → email с Portal-link |
| R12 | Дублирование подписки cross-provider (bePaid + Stripe на одном продукте) | critical | duplicate-guard extension (D9) |
| R13 | Schedule завершился, но мы не закрыли локально | medium | webhook `subscription_schedule.completed` + reconcile |
| R14 | Currency mismatch (price.currency ≠ tariff_offer expected) | medium | валидация на этапе create-subscription-checkout |
| R15 | Manual_review backlog | low | admin UI с фильтром `meta.manual_review_reason` |

## SOT / Локально / Stripe / Recovery / Multi-account
- Универсальные правила: SOT за Stripe по состоянию подписки; локально — доступ; recovery через reconcile+replay; multi-account через резолв `account_code` на каждом шаге.
