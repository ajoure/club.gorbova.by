---
name: Stripe Refund Recovery Path
description: Канонический recovery refund-записи для Stripe — admin-stripe-repair-refund-recording (mirror bePaid)
type: feature
---
Канонический Stripe refund recovery (когда webhook не дошёл / Dashboard refund):

- Edge function: `admin-stripe-repair-refund-recording`
- Auth: super_admin JWT, service_role, или `x-cron-secret` header
- Input: `{ payment_intent: 'pi_…', refund_id?: 're_…', account_code?, dry_run? }`
- Поведение:
  - Читает `/v1/refunds?payment_intent=…` (НЕ создаёт refund на Stripe)
  - Фильтрует `status='succeeded'` и `livemode!==false`
  - Для каждого refund-а зовёт canonical RPC `record_refund_atomic_multi` (provider='stripe', idempotent by `refund_uid`)
  - Audit `stripe.refund.repaired_via_admin_repair` с `access_action='keep'`
- Доступ/entitlements не трогает — отдельное admin-решение
- bePaid аналог: `admin-repair-refund-recording`

Прецедент: 2026-06-09 ORD-26-00167, refund `re_3TgMkD6UYJj2vm0G1v5QOXJP` 5.00 BYN.
