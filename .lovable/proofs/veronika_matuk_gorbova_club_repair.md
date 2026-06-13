# PATCH-VERONIKA-MATUK-GORBOVA-CLUB-REPAIR — Proof

Date: 2026-06-13
Scope: bePaid recurring tracking → recovery queue & parser parity.
Contact: Вероника Матук — `profiles.id = 4e8834a5-0f6a-44d6-b05a-8d7ec3b4d6e9`,
`user_id = 341e6f46-79dd-4920-b500-da78e3574aab`, email `nika.1900735@mail.ru`,
Telegram user_id `1337365629`.
Product: Gorbova Club — `products_v2.id = 11c9f1b8-0355-4753-bd74-40b42aa53616`,
tariff BUSINESS `7c748940-dcad-4c7c-a92e-76a2344622d3`.

## Root cause
Recurring autocharges arrived through `bepaid-webhook` with
`tracking_id = subv2:b3fd405f-bd62-4e5a-b44f-ad1f0de71fc6`, but that
`subscriptions_v2.id` no longer exists. The webhook materialized the
payment for the per-cycle REBILL order (`payments_v2` rows do exist), but
the corresponding `payment_reconcile_queue` rows stayed `pending` with
`last_error = Could not match to order`, and
`bepaid-fetch-transactions` did not know the `subv2:*` format at all.
Result: admins saw "no payment received" while the customer's card was
charged successfully — every month.

## Code changes
1. `supabase/functions/_shared/bepaid-tracking-id.ts` — new SOT parser
   for bePaid `tracking_id` (`subv2:{sub}:order:{order}`, legacy
   `subv2:{sub}`, `link:*`, bare uuid, uuid pair).
2. `supabase/functions/_shared/bepaid-tracking-id.test.ts` — 8 Deno tests.
3. `supabase/functions/bepaid-webhook/index.ts`
   - import shared parser, delegate inline `parseTrackingId`;
   - convert `subV2` to `let` and add future-root fallback: when tracking
     points at a missing `subscriptions_v2.id`, try
     `provider_subscriptions.subscription_v2_id` for the same
     `provider_subscription_id`; emit audit
     `bepaid.webhook.tracking_subscription_missing` and (on recovery)
     `bepaid.webhook.tracking_subscription_recovered_via_provider`;
     return HTTP 202 (not 404) on permanent miss;
   - after successful provider-managed subscription cycle (grant ok or
     REBILL handled, and STEP E payments upsert did not error) close the
     matching `payment_reconcile_queue` row: `status='materialized'`,
     `processed_at`, `processed_order_id`, `matched_order_id`,
     `matched_profile_id`, `matched_product_id`, `matched_tariff_id`,
     `last_error=null`. On grant skip/error the row is left untouched.
4. `supabase/functions/bepaid-fetch-transactions/index.ts` — delegate
   `parseTrackingId` to the shared SOT; recurring `subv2:*` payments are
   no longer silently dropped as `unknown`.

## Tests
- `_shared/bepaid-tracking-id.test.ts` — 8/8 PASS (`exit code 0`).
- `bepaid-webhook` test suite + `bepaid-fetch-transactions` typecheck —
  PASS (`exit code 0`).

## Deploy
- `bepaid-webhook` — deployed.
- `bepaid-fetch-transactions` — deployed.
- Not redeployed: `stripe-webhook`, `grant-access-for-order`,
  `public-checkout`, document/Telegram functions.

## Data repair (only Веронике, only queue)
Dry-run candidate set (5 rows):

| queue_id | bepaid_uid | order | tracking_id |
|----------|-----------|-------|-------------|
| c18cc9ec | 8d5f0c37 | REBILL-23a5fe7f-813 | subv2:b3fd405f… |
| 7b70ab75 | ae5f71ec | PAY-26-MLP8XY2S    | subv2:07d57d56… |
| 20c5aaf3 | 2d59344e | REBILL-3ef6feed-a9e | subv2:b3fd405f… |
| b975a8b0 | 283378d6 | PAY-26-MP5R5Z6S    | subv2:b3fd405f… |
| 01c4b47d | 6a508de5 | SUB-LINK-MQAM6G4O  | subv2:0396c3d9…:order:7a7f4595… |

UPDATE result (`returning`): all 5 rows now
`status='materialized'`, with `matched_order_id` = the existing
`payments_v2.order_id`, `matched_profile_id = 4e8834a5…`,
`matched_product_id = 11c9f1b8…`, `matched_tariff_id = 7c748940…`,
`last_error = null`. No `payments_v2`/`orders_v2`/`subscriptions_v2`/
`entitlements` rows touched.

## Verify after
| Entity | Field | Value |
|--------|-------|-------|
| `subscriptions_v2.0396c3d9…` | status / access_end_at / auto_renew | `active` / `2026-07-12 20:59:59+00` / `true` |
| `entitlements.a2bb0780…` (Gorbova Club) | status / expires_at | `active` / `2026-07-12 20:59:59+00` |
| `provider_subscriptions.sbs_411b4b1b3a9c96a4` | state / next_charge_at | `active` / `2026-07-12 08:53:12+00` |

Старые orphan/canceled `provider_subscriptions` Вероники не трогались;
текущая активная `sbs_411…` осталась `active`; следующий цикл
пойдёт по новому tracking `subv2:0396c3d9…:order:7a7f4595…`.

## STOP-guards observed
- dry-run rowcount = 5, все строки = Вероника + Club + реальный payment;
- ни одна строка не относится к чужому профилю/продукту/тарифу;
- `grant-access-for-order` не вызывался;
- `orders_v2.status` / `payments_v2.status` / `entitlements.expires_at` /
  `subscriptions_v2.access_*` — unchanged;
- webhooks Stripe/документы/Telegram — не передеплоены;
- если на следующем цикле bePaid снова пришлёт `subv2:{missing}` —
  webhook напишет `bepaid.webhook.tracking_subscription_missing`
  и попытается recover через `provider_subscriptions`; при невозможности
  вернёт HTTP 202 + manual review, без silent fail.

## DoD
- Причина задокументирована (orphan `subv2:b3fd…`).
- Текущая активная подписка `0396c3d9…` подтверждена до 2026-07-12.
- `bepaid-webhook` больше не оставляет успешный provider-managed cycle
  в `payment_reconcile_queue.pending`.
- `bepaid-fetch-transactions` понимает `subv2:*`.
- 5 исторических queue-строк Вероники закрыты как `materialized` с
  привязкой к существующим платежам.
- Никаких ручных правок access / subscriptions / entitlements /
  orders / payments вне canonical write-path.
- Тесты PASS, deploy выполнен только для двух bePaid функций.
