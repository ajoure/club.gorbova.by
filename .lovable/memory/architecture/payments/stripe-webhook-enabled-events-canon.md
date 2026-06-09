---
name: Stripe Webhook Enabled Events Canon
description: Канонический набор enabled_events для live Stripe webhook endpoint
type: feature
---
Live Stripe webhook endpoint (`/functions/v1/stripe-webhook`) ОБЯЗАН быть подписан на полный канонический набор events. Любой меньший набор = recording desync risk (refund в UI не появится).

Канон (8 events):
- `checkout.session.completed`
- `checkout.session.expired`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `refund.created`
- `refund.updated`
- `charge.dispute.created`

SOT поддержки: `supabase/functions/stripe-ensure-webhook/index.ts` (ENABLED_EVENTS) и handler `stripe-webhook/index.ts`. При расхождении actual vs канон — обновлять Stripe endpoint идемпотентно (merge, без replace).

Прецедент: 2026-06-09 — live endpoint `we_1TeCag6UYJj2vm0G0xZSkWbM` был подписан ТОЛЬКО на `checkout.session.completed`, из-за чего Dashboard-refund 5 BYN по ORD-26-00167 не дошёл и refund не отобразился в админке.
