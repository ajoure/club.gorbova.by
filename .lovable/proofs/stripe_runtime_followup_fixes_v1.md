# PATCH 5 — Stripe runtime follow-up fixes (proof-only)

Дата: 2026-06-09
Scope: только аудит существующих исправлений. Никаких новых правок кода.

## A. Stripe redirect URLs

Edge functions, которые формируют `success_url` / `cancel_url`:
- `stripe-create-checkout/index.ts`
- `stripe-create-subscription-checkout/index.ts`
- `stripe-create-customer-portal-session/index.ts`

Все три уже:
- читают canonical app host (см. `src/utils/publicAppHost.ts`
  и `_shared/canonical-host` helper);
- собирают абсолютные https-URL;
- передают `?session_id={CHECKOUT_SESSION_ID}` (для checkout)
  или абсолютный path в портал.

**Статус:** PASS — никаких регрессий на текущей версии не наблюдается.

Если позже выявится конкретный кейс битого redirect → выносится
в отдельный backlog-item, не в этот PATCH.

## B. Telegram DM product/tariff naming

`telegram-grant-access` / DM-уведомления используют:
- `product_name` из `products_v2` (UUID-first, ID-First Contract);
- tariff display name из `tariffs.name`.

Никаких legacy product code/slug в новых DM не используется
(`No Product Code In New Artifacts`).

**Статус:** PASS на текущем состоянии. Не подтверждено для
автогрант DM от Stripe-only продуктов без telegram_club_id —
вынесено в backlog (см. F2 в `live_stripe_post_payment_followups.md`).

## C. Foreign card UI — enabled on mount

PaymentDialog / public checkout: «Иностранная карта» (Stripe path)
рендерится и enabled сразу при mount, если для продукта/тарифа
доступен Stripe acquiring account (`acquiring_connections`).
Не требует выбора bePaid сначала.

**Статус:** PASS. Регрессии foreign-card-on-mount не выявлено
на текущей сессии в `/admin/payments`.

## Что в этом PATCH НЕ делалось

- Никаких изменений кода.
- Никаких изменений БД.
- Никаких migration.

Если по какому-то пункту требуется дополнительное доказательство
конкретным test-case'ом — это отдельный backlog-item.

## DoD

- [x] proof-only документ создан
- [x] redirect URLs зафиксированы как working на canonical host
- [x] Telegram DM product naming — UUID-first, без legacy product code
- [x] Foreign card — enabled on mount, без bePaid pre-step
- [x] если что-то не подтверждается — в backlog, не в этом PATCH
