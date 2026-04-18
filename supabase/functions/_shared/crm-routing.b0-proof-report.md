# B.0 Proof Report — Final (post PATCH 1 + PATCH 2)

**Дата:** 2026-04-18
**Статус:** B.0 закрыт в части public-link writer / pending / materialize / legacy reconcile / negative-guards. Terminal webhook proof — НЕ закрыт live (только runtime-equivalent для P3, out-of-scope для P2). Recurring — out-of-scope.

### Карта статусов
- **closed (live):** P2 pending+snapshot, P2 entitlement reconcile, P3 GET, P3 POST materialize, P4a-1 negative, P4a-2/P4b static
- **closed with runtime-equivalent proof only:** P3 terminal (через `grant-access-for-order`, не реальный webhook)
- **out of scope / not live-proven:** P2 terminal via webhook, recurring

## Сценарии

| Сценарий | Статус | Доказательство |
|---|---|---|
| **P2 exact pending+snapshot** | **closed (live)** | order `68a0dee0-...` создан через `admin-create-payment-link`, snapshot+stage_on_pending materialized |
| **P2 entitlement reconciliation** | **closed after PATCH 2** | повторный `grant-access-for-order` → `entitlement.action="legacy_backfilled"`, audit `entitlement.legacy_product_id_backfilled`, expires_at GREATEST (2026-05-17 → 2026-06-16), product_id NULL → `9d0d6de8-...` |
| **P2 terminal via webhook** | **out-of-scope** | требует реальный bePaid webhook |
| **P3 GET (read row)** | **closed (live)** | `public-checkout?token=fad6...` вернул product/tariff/amount/payment_type |
| **P3 POST materialize** | **closed (live)** | link `d7cc855e-...` → order `7cbb1a7e-...`, status=pending, pipeline_stage_id = `snapshot.stage_on_pending`, offer_id/product_id/tariff_id заполнены, `current_uses=1` |
| **P3 terminal** | **runtime-equivalent only** | через `grant-access-for-order` (CRM terminal делает webhook) |
| **P4a-1 negative** | **closed (live)** | `existing_subscription_conflict` блокирует до записи order |
| **P4a-2 / P4b** | **closed (static + unit)** | Deno-тесты `_shared/crm-routing.ts` |

## PATCH 1 — payment_links writer

- `admin-create-public-link` (JWT + admin/super_admin).
- **Anti-duplication:** НЕ создаёт `orders_v2`, НЕ вызывает bePaid. Только INSERT row + `/pay/<url_token>`.
- **Row proof (live):** status=active, current_uses 0→1, url_token непустой, product_id/tariff_id/offer_id/amount/payment_type заполнены, created_by=admin uid.
- **RLS:** policy `Admins can manage payment links` уже покрывает; anon read через service-role в `public-checkout`. RLS не менялся.
- **UI:** в `AdminPaymentLinkDialog` два CTA одного диалога: «Создать ссылку и открыть оплату» (admin-create-payment-link) / «Создать публичную ссылку» (admin-create-public-link).
- **Audit:** `payment_link.created` ✅

## PATCH 2 — grant-access-for-order legacy reconciliation

Канонический lookup-flow:
- (a) `(user_id, product_id)` — primary
- (b) fallback `(user_id, product_code) WHERE product_id IS NULL` → backfill (только если NULL)
- (c) idempotent replay при 23505 → reread by product_code, merge с safety (refuse если existing product_id ≠ expected)

Invariants: GREATEST(expires_at), status='active', чужие поля не трогаем. Audit: `entitlement.legacy_product_id_backfilled` (live ✅), `grant_access.idempotent_replay` (для replay).

## "Новый payment-path не создан"

**Не тронуто:** `bepaid-webhook`, `_shared/create-payment-checkout.ts`, `_shared/crm-routing.ts`, `public-checkout/index.ts`, `admin-create-payment-link/index.ts`.

**Где создаются артефакты:**
- `payment_links` row → только `admin-create-public-link` (PATCH 1, pre-materialize writer)
- `orders_v2` materialize (public) → `public-checkout` → `_shared/create-payment-checkout.ts` (без изменений)
- `orders_v2` materialize (admin direct) → `admin-create-payment-link` → `_shared/create-payment-checkout.ts` (без изменений)
- terminal apply (paid + stage_on_success) → `bepaid-webhook` (PATCH 2 — только reconcile side-effects в fulfillment, terminal path не меняет)

## STOP-guards triggered: нет
## Blocked: нет

**Backlog (out of scope B.0):**
- Recurring proof — отдельный пакет
- `public-checkout` email-lookup пагинация (`auth.admin.listUsers()`) — отдельный мелкий PATCH; не блокирует B.0 (pre-assigned user_id работает)
