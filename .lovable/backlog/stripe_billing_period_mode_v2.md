# PATCH-STRIPE-BILLING-PERIOD-MODE-V2 (backlog)

**Цель:** admin UI/back-логика для просмотра и редактирования Stripe recurring параметров (`interval`, `interval_count`, `collection_method`), включая смену периодичности подписки (proration policy, schedule).

## Скоуп
- Read-only view существующего `subscriptions_v2.meta.stripe.{price.recurring, collection_method}` в карточке подписки.
- Сценарий смены периодичности → Stripe Subscription Schedule API.
- Audit + миграция статусов локально.

## Не блокирует
PATCH-STRIPE-UI-INTEGRATION-CLEANUP-V1 (Stage 2D) — там только фиксация значений в proof, без изменений.
