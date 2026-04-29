---
name: Recurring Snapshot Resolver SOT
description: SOT-aligned read-only resolver for recurring snapshots in grant-access-for-order, audit semantics
type: feature
---
`grant-access-for-order` использует read-only helper `resolveRecurringFromOrderOrTariff(orderOfferId, tariffId)`.

**Source of truth:** `tariff_offers.meta.recurring.is_recurring`. Никакие эвристики (`hasPaymentMethod`, `requires_card_tokenization`, `isClubProduct`, `tariff_id != null`) не классифицируют продукт.

**Decision matrix:**
- `from_order_offer` — `order.offer_id` указывает на recurring offer (`is_recurring=true`).
- `resolved_from_tariff` — `order.offer_id` отсутствует или non-recurring, но у тарифа есть активный recurring offer (выбор: `is_primary` desc → `sort_order` asc).
- `one_time` — у тарифа нет активного recurring offer.
- `not_resolved` — нет ни `offer_id`, ни `tariff_id`.

**Запреты:**
- Helper НИКОГДА не пишет в `orders_v2.offer_id` и не меняет заказ. Только аудит.
- Для `one_time` / `not_resolved` snapshot не создаётся, fallback-аудит не пишется, `_missing`-аудит не пишется.

**Audit semantics:**
- `subscription.recurring_snapshot_resolved_from_tariff` — info-level, нормальный путь когда writer не передал `offer_id`, но SOT подтвердил recurring.
- `subscription.recurring_snapshot_fallback_used` — ТОЛЬКО реальный data-defect: recurring offer найден, но `meta.recurring` неполный (не хватает `is_recurring|billing_period_mode|grace_hours|charge_attempts_per_day|charge_times_local`). Reason: `recurring_offer_present_but_snapshot_incomplete`.
- `subscription.recurring_snapshot_missing` — удалён из новой логики, для one-time продуктов больше не пишется.

Работает идентично в EXTEND и CREATE ветках subscription-апдейта.
