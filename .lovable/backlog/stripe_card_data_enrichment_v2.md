# PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 (backlog)

**Цель:** материализовать payer card data (brand / last4 / wallet) для Stripe-платежей в момент webhook и сделать targeted enrichment для исторических Stripe-платежей без card data.

## Скоуп

1. В Stripe webhook (`charge.succeeded` / `payment_intent.succeeded` / `invoice.paid`) сохранять в `payments_v2.meta.stripe.payment_method_details.card.{brand,last4,wallet.type}` и/или в DB-колонки `card_brand`, `card_last4` (как уже делает `stripe_targeted_fetch_v1`).
2. Targeted enrichment для исторических платежей без card data: вызов Stripe API (`charges.retrieve` или `payment_intents.retrieve` с expand `latest_charge.payment_method_details`), запись в meta + DB columns. Идемпотентно по `provider_payment_id`.
3. Refund-row продолжает наследовать карту через `stripeParentIndex` (UI-level), без отдельной материализации.

## Не делать

- Не сохранять полный PAN/expiry/CVC.
- Не дублировать данные между `card_*` колонками и `meta` без правила приоритета.
- Не делать enrichment-вызовы из UI (frontend).

## Trigger
Прецедент 2026-06-10: Stripe payment `pi_3TgWoM6UYJj2vm0G1L9yYCCe` (2 USD) — в `meta.stripe` присутствует только `invoice_*` / `payment_intent_id`, card data отсутствует → UI рисует «Карта не определена». Stage 2E (PATCH-STRIPE-UI-INTEGRATION-CLEANUP-V1) показывает это значение честно, не маскируя.
