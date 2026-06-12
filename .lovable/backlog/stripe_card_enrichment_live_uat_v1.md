# Backlog: Stripe Card Enrichment — Live Webhook UAT v1

Дата создания: 2026-06-12
Статус: **DEFERRED — выполнить на первых реальных Stripe-операциях**

## Контекст

PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 закрыт как **CLOSED WITH DEFERRED LIVE UAT**. Технически проверены: code, tests (20/20), controlled deploy, verify_jwt=false smoke, PCI scans, bePaid regression, historical enrichment idempotency. Не проверен **runtime webhook source-path** на трёх live-событиях — это требует реальной оплаты и сознательно отложено владельцем.

Условие: live UAT не требует нового deploy, если текущий bundle `stripe-webhook` не изменён. При любом изменении кода → controlled redeploy по `.lovable/architecture/public_webhook_controlled_redeploy_protocol_v1.md`.

## Сценарии

### Сценарий 1. Первая реальная разовая Stripe-оплата

Триггер: первая live one-time оплата через Stripe Hosted Checkout.

Чек:
- [ ] `checkout.session.completed` → Stripe Dashboard delivery = 2xx
- [ ] `payment_intent.succeeded` → 2xx
- [ ] `payments_v2` для этой операции создан **ровно один раз** (event-level guard)
- [ ] `meta.stripe.payment_method_details.card` заполнен (brand/last4 whitelist)
- [ ] `meta.stripe.payment_method_id` / `charge_id` / `payment_intent_id` присутствуют
- [ ] `card_brand`, `card_last4` заполнены в колонках
- [ ] `meta.stripe.card_data_source` ∈ { `webhook_checkout`, `webhook_payment_intent` }
- [ ] `meta.stripe.card_data_sources_seen` — без дублей
- [ ] `orders_v2` без дублей, access не выдан повторно
- [ ] `payment_links.current_uses` инкрементирован ровно один раз (если ссылка)
- [ ] PCI: 0 запрещённых ключей в `meta`

### Сценарий 2. Первая реальная Stripe-подписка

Триггер: первая live recurring подписка через Stripe.

Чек:
- [ ] `invoice.paid` → Stripe Dashboard delivery = 2xx
- [ ] `payments_v2` materialized **ровно один раз** на invoice
- [ ] `subscriptions_v2` lifecycle корректен (status, current_period_end совпадают со Stripe)
- [ ] `provider_subscriptions` lifecycle корректен
- [ ] Card snapshot заполнен (тот же whitelist)
- [ ] Access не выдан повторно
- [ ] Subsequent `invoice.paid` (следующий цикл): отдельный payment row, extend подписки, access продлён по SOT `grant-access-for-order`
- [ ] PCI: 0 запрещённых ключей

### Сценарий 3. Повторная доставка события (Stripe Dashboard resend)

Триггер: «Resend» того же события из Stripe Dashboard для уже обработанного payment.

Чек:
- [ ] **Event-level duplicate guard** срабатывает (`provider_events` уникальность по event id)
- [ ] **Writer-level guard** `skipped_complete` срабатывает в `_shared/stripe/card-enrichment.ts` (snapshot уже complete)
- [ ] 0 duplicate `payments_v2`
- [ ] 0 duplicate `orders_v2`
- [ ] 0 повторных access grants / `entitlements` mutations
- [ ] Audit `webhook.stripe.*` фиксирует повторную доставку, но без mutate

## Артефакт

После выполнения UAT — создать `.lovable/proofs/stripe_webhook_live_uat_v1.md` с по каждому сценарию: Stripe event id, payment_id, orders/sub diff, card snapshot выписка (masked), PCI scan = 0.

## Финализация

После трёх сценариев = PASS:
- Полный runtime PASS по трём webhook source-path объявляется
- `.lovable/architecture/canonical_infrastructure_v1.md` §8: status `D-STABLE-CANDIDATE` → `D-STABLE`
- Этот backlog закрывается

## Запреты

- Не выполнять test-mode фикстуры вместо live (решение владельца).
- Не передеплоивать `stripe-webhook` ради UAT.
- Не создавать одноразовых helper-функций (см. `.lovable/docs/edge-functions-standards.md` §10.3).
- Не отключать guard'ы / PCI scanners.
