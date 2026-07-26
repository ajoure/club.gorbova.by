# Order 4169b48a — Completion Diagnosis (READ-ONLY)

Scope: order `4169b48a-650b-46a3-8fb7-4cc958998f6a` only. No writes performed. Timestamps UTC unless noted.

## 1. Source of truth — expected access window

| Layer | Value | Source |
|---|---|---|
| Product `11c9f1b8…` (`Gorbova Club`) | `meta.access_window_rule = calendar_month` | `products_v2` |
| Tariff `b276d8a5…` (`FULL`) | `access_days = 30` | `tariffs` |
| Offer `c5781abf…` (`pay_now`, non-trial) | `trial_days = NULL`, `auto_charge_after_trial = false`, `auto_charge_offer_id = NULL`, `meta.recurring = { is_recurring: true, billing_period_days: 30, grace_hours: 72, timezone: Europe/Minsk }` | `tariff_offers` |
| Access rules (tariff-scoped, tariff_id = b276d8a5) | 2 rules only: `training_content` (partial, `match_purchase_month = true`) + `section_access` (База знаний). None override duration (`duration_days = NULL`). | `access_rules` |
| Order | `created_at = 2026-01-11 19:40:13Z`, `status = paid`, `is_trial = false`, `final_price = 1.00 BYN` | `orders_v2` |

Expected canonical window for a **single paid order** on this offer under `calendar_month`:

    access_start_at = order.created_at              = 2026-01-11 19:40:13Z
    access_end_at   = access_start + 1 calendar month, rounded to 12:00Z
                                                    = 2026-02-11 12:00:00Z

There is **no rule** that would extend a single-order window to July.

## 2. Actual rows — what grant-access-for-order wrote

### 2.1 `access_grant_ledger` `e881146c…`

| Field | Value |
|---|---|
| status | `granted` |
| reason_code | `paid_order` |
| result.access_start | `2026-01-11T19:40:13Z` ✅ matches order |
| result.access_end | `2026-02-11T12:00:00Z` ✅ matches expected |
| result.window_days | 30 |
| result.source_window_rule | `calendar_month` |
| post_check.entitlement | `pass / created` (ref `7f172140…`) |
| post_check.subscription | `pass / created` (ref `1645dc78…`) |
| post_check.telegram | `pass / pending_downstream` |

Ledger is internally correct — it declares end 2026-02-11.

### 2.2 `entitlements` `7f172140…`

| Field | Value |
|---|---|
| product_code | `club` |
| status | `active` |
| expires_at | `2026-02-11 12:00:00Z` ✅ matches ledger + canonical rule |
| order_id | 4169b48a… |
| user_id | 59b381b0… (auth) |
| profile_id | ba7dc65f… |

Entitlement is **correct**.

### 2.3 `subscriptions_v2` `1645dc78…`

| Field | Value |
|---|---|
| status | `active` |
| access_start_at | `2026-01-11 19:40:13Z` ✅ |
| access_end_at | **`2026-07-25 13:15:25.491Z`** ❌ 164 days beyond canonical end |
| next_charge_at | `2026-07-25 13:15:25.491Z` (equal to access_end) |
| is_trial | false |
| auto_renew | false |
| billing_type | `mit` |
| meta.granted_at | `2026-07-23 13:15:25.491Z` (execution time) |
| meta.recurring_snapshot.billing_period_days | 30 |

Subscription `access_end_at` = `meta.granted_at + 48h`. It does **not** equal:

- canonical `access_start + 30d` (2026-02-10)
- canonical calendar-month (2026-02-11)
- any forward-rolled 30-day period from `access_start` (…07-10 or 08-09)
- any calendar-month roll from `access_start` (…07-11 or 08-11)
- grace_hours (72h)

The number is a bug in the subscription writer path inside `grant-access-for-order`: for a paid non-trial recurring offer where `order.created_at` is deep in the past, it extended the subscription window to a synthetic `now + ~48h` instead of honouring the ledger-computed `access_end` (`2026-02-11 12:00Z`) that was written in the same call.

Which date is wrong: **subscription `access_end_at` (and consequently `next_charge_at`) is wrong**. Entitlement, ledger, order and product/tariff/offer settings are consistent with each other and with the calendar-month rule.

## 3. Telegram downstream — incomplete

Related to `user_id = 59b381b0…`, `product = Gorbova Club`, telegram `club_id = fa547c41-3a84-4c4f-904a-427332a0506e` (from access_rule `1a271ea0…`).

| Table | Row | Comment |
|---|---|---|
| `telegram_access` | `237e362e…` | `state_chat = pending`, `state_channel = pending`, `active_until = NULL`, `invites_pending = true`, `updated_at = 2026-07-23 13:15:28Z` |
| `telegram_access_queue` | **0 rows** for this user | No job enqueued |
| `telegram_access_grants` | **0 rows** for this user | No grant record |
| `profiles.telegram_user_id` | `NULL` | User has not linked Telegram |

Ledger `post_check.telegram = pass / pending_downstream` records that the primary path succeeded and downstream provisioning is deferred, but no queue/grant row exists to drive it. The stub row in `telegram_access` also lacks `active_until` — even after the user links Telegram there is nothing to bound the grant to `2026-02-11 12:00Z`.

## 4. GetCourse applicability

- Product `11c9f1b8…` is `Gorbova Club` (`meta.access_window_rule = calendar_month`, business stream = club per historical convention).
- Offer meta has no `getcourse` block; only `getcourse_offer_id` on `tariff_offers` is null.
- The order carries `gc_next_retry_at = NULL`.
- Ledger `post_check` has no GetCourse entry (only target_resolution / subscription / entitlement / ledger_row / telegram), i.e. the fulfillment path did not classify GetCourse as `required` for this product/offer.

Conclusion: **GetCourse enrollment does not apply** to this product/offer/email. No GetCourse action is needed.

## 5. Historical context (not part of this order, informational)

Same user has a second order `775c8a97…` (offer `c5781abf`, `final_price = 150.00 BYN`, `status = refunded`) with two `succeeded` `payments_v2` rows totalling 300 BYN on 2026-01-16/17. That order was refunded and has zero rows in `subscriptions_v2` / `entitlements`. It does not extend the current window, and — crucially — does not justify the July `access_end_at` on subscription `1645dc78…`.

## 6. Narrow safe actions for a fully consistent completion

All items are minimal, single-row, idempotent, and reversible.

1. **Correct the subscription window** — bring `subscriptions_v2.1645dc78…` in line with the ledger and entitlement:
   - `access_end_at = 2026-02-11 12:00:00Z`
   - `next_charge_at = NULL` (offer non-trial, `auto_charge_after_trial = false`, `auto_renew = false` already)
   - `status = 'expired'` (access_end is in the past)
   - `updated_at = now()`
   - Append `meta.consistency_repair = { at: <ts>, by: 'manual/order_4169b48a_diagnosis', prev_access_end: '2026-07-25T13:15:25.491Z', prev_next_charge: '2026-07-25T13:15:25.491Z', reason: 'align_with_ledger_calendar_month' }`.
2. **Bound the Telegram stub** — update `telegram_access.237e362e…` to `active_until = 2026-02-11 12:00:00Z`; leave `state_chat/state_channel = pending` and `invites_pending = true` (user still unlinked). Since the historical window is already expired, no queue insert is required; if policy demands an explicit revoke, enqueue a single `telegram_access_queue` `revoke` job with `subscription_id = 1645dc78…` scoped to `club_id = fa547c41…`.
3. **Audit log** — one `audit_logs` row `action = 'subscription.consistency_repair'` referencing subscription id, order id, prev/new access_end, and the ledger id `e881146c…` as source of truth.
4. **No changes needed** to: `entitlements.7f172140…`, `access_grant_ledger.e881146c…`, `orders_v2.4169b48a…`, `payments_v2.45c6006c…`, `products_v2` / `tariffs` / `tariff_offers` / `access_rules`, or GetCourse.
5. **Follow-up (out of scope for this order, flag only)** — file a defect against `grant-access-for-order`: the subscription writer must consume `result.access_end` from the same ledger computation rather than recomputing `now + ~48h` for historical paid orders. Add a regression check that `subscriptions_v2.access_end_at ≡ access_grant_ledger.result.access_end` on `paid_order` grants.

## 7. Stop-guards before any write

- Re-assert `entitlements.7f172140….expires_at = 2026-02-11 12:00:00Z` and `access_grant_ledger.e881146c….result.access_end = 2026-02-11T12:00:00Z` immediately before the update.
- Re-assert subscription still has `access_end_at = 2026-07-25 13:15:25.491Z` and `auto_renew = false` (no interleaved change).
- Abort if any other `subscriptions_v2` / `entitlements` row for `user_id = 59b381b0…` + `product_id = 11c9f1b8…` appears.
- Abort if any new `payments_v2.succeeded` row for this user+product appears after 2026-01-17.

No writes have been performed as part of this diagnosis.
