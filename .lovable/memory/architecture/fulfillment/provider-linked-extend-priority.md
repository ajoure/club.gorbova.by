---
name: provider-linked-extend-priority
description: Pre-created provider-linked subv2 (past_due/pending) MUST be extended before legacy active-sub lookup
type: feature
---
# Provider-Linked Subscription Extend Priority (PATCH SB1, 2026-05)

## Бизнес-правило (SoT)

`grant-access-for-order` ОБЯЗАН искать target subv2 для extend в следующем порядке:

1. **Provider-linked** (через `provider_subscriptions`): same `order_id` ИЛИ строгий парс `meta.tracking_id = 'subv2:{uuid}:order:{orderId}'`, `provider='bepaid'`, `state IN ('active','pending')`. Если найдено — extend независимо от текущего `subscriptions_v2.status` (включая past_due/pending).
2. Только если ничего не нашлось → legacy lookup `(user_id, product_id, tariff_id, status='active')`.
3. Только если оба пустые → создать новую subv2.

## Почему

Pre-created subv2 имеют `status=past_due`, `access_end_at=NULL` сразу после bePaid `/subscriptions`. Реальный sbs прикреплён именно к ним через `provider_subscriptions`. Без приоритета `grant-access` создаёт параллельную active subv2, sbs продолжает писать в past_due — split-brain (Белько 2026-05-20).

## Strict guard

При обнаружении provider-linked candidate — обязательная валидация:

- `tracking_id` парс по regex `^subv2:{uuid}:order:{uuid}$` (no LIKE-heuristics).
- `parsed_subv2_id == ps.subscription_v2_id`.
- `parsed_order_id == orderId`.
- `subv2.user_id == order.user_id`, `subv2.product_id == order.product_id`, `subv2.tariff_id == order.tariff_id`.
- `subv2.status NOT IN ('canceled','expired','superseded','expired_reentry')`.

При любом нарушении → `outcome='manual_review_provider_linkage_conflict'`, audit `grant-access-for-order.manual_review_provider_linkage_conflict`, merge `orders_v2.meta.manual_review=true`, HTTP 200 skipped. **НИКАКИХ INSERT** в `subscriptions_v2` / `entitlements` / `access_rules` / `telegram_access_queue`.

## Files (SoT)

- `supabase/functions/grant-access-for-order/provider_linked_subscription_resolver.ts`
- `supabase/functions/grant-access-for-order/provider_linked_subscription_resolver_test.ts`
- `supabase/functions/grant-access-for-order/index.ts` (вызов перед legacy extend).

## Audit actions

- `grant-access-for-order.provider_linked_extend` — успешный extend pre-created subv2.
- `grant-access-for-order.manual_review_provider_linkage_conflict` — STOP, manual_review.

## Связь с другими стандартами

- Совместим с `mem://commercial-logic/subscriptions/sbs-mismatch-no-new-sub-guard` (foreign sbs против active sub — другой кейс).
- Соблюдает `mem://architecture/standard/id-first-contract` (строгий UUID-парс).
