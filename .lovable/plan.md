# да, согласен, с учетом правок:

&nbsp;

1. **payments_v2 upsert (PATCH 2.E):** зафиксировать в ТЗ, что для попадания в карточку контакта нужно заполнять **profile_id** (через [profiles.id](http://profiles.id) по user_id) + provider_payment_id + status (succeeded|failed|refunded) + paid_at. Без profile_id платежи не появятся в ContactPaymentsTab.
2. **ContactPaymentsTab фильтры (PATCH 6):** применить правку **во всех 5 местах**: ['succeeded','refunded'] → ['succeeded','refunded','failed']. Никаких paid/pending/processing, если их реально нет в payments_v2.
3. **bepaid truth-map (PATCH 2.A / PATCH 3):** закрепить приоритет:
  &nbsp;
  - truthNextCharge = renew_at || next_billing_at || null
  - truthAccessEnd = active_to || valid_till || null
    И **access_end_at** считать **только** от truthAccessEnd через endOfDayWarsaw(). +accessDays — только fallback с audit_logs bepaid.webhook.fallback_access_days_used.
  &nbsp;
4. **Grace 72h + billing-day protection (PATCH 4):** явно ограничить secondary-check:
  &nbsp;
  - billing_type='provider_managed'
  - использовать константу BILLING_DAY_PROTECTION_HOURS = 12
  - писать audit_logs access.validation.billing_day_protected при срабатывании.
  &nbsp;
5. **Критичный путь “бывший участник” (PATCH 5):** обязательный приоритет фикса:
  &nbsp;
  - telegram-revoke-access заменить inline-check на shared hasValidAccess (иначе будут преждевременные was_club_member=true и кики).
  - subscriptions-reconcile заменить local hasValidAccess на shared import.
  &nbsp;
6. **markAsExpiredReentry (PATCH 5C/5D):** перед установкой was_club_member=true добавить guard через shared hasValidAccess. Если доступ валиден (grace/billing-day) — **не помечать**.
7. **Sync button/auto-sync (PATCH 7):** добавить STOP-guards:
  &nbsp;
  - авто-sync максимум 3 за открытие + Set дедуп по provider_subscription_id
  - авто-sync только для provider='bepaid' и state in (failed_attempt|past_due|failed) или next_charge_at IS NULL или snapshot старше 10 минут.
  &nbsp;

&nbsp;

&nbsp;

Verified Corrections to the Plan

## 9. Confirmed Facts (replacing assumptions)

### 9.1 ContactPaymentsTab.tsx — actual statuses

**Confirmed**: `payments_v2.status` uses `succeeded` (not `paid`) and `failed`. The webhook writes `status: 'succeeded'` and `status: 'failed'`.

**Confirmed**: There are exactly **5 places** (lines 81, 121, 137, 148, 169) with `.in('status', ['succeeded', 'refunded'])`. All hide `failed` payments.

**Fix**: Change all 5 to `.in('status', ['succeeded', 'refunded', 'failed'])`. This shows failed payment attempts in the contact card. No `pending`/`processing` needed — the webhook writes final statuses only.

**DoD**: list the 5 lines changed and confirm `failed` payments appear in contact card after sync upsert.

### 9.2 `subscription-grace-reminders` / `subscription-charge` — confirmed behavior

**Confirmed**: Both have identical `markAsExpiredReentry()` functions that:

- Set `profiles.was_club_member = true`
- Set `club_exit_at`, `club_exit_reason = 'grace_period_expired'`
- Set `subscriptions_v2.grace_period_status = 'expired_reentry'`

They do NOT directly kick from Telegram or revoke access. They mark the profile for reentry pricing.

**Confirmed**: `telegram-revoke-access` (line 568-573) ALSO sets `was_club_member = true` independently, with its own inline access check (lines 244-277) that has NO grace period.

**Fix priority**:

1. `telegram-revoke-access` lines 244-277: replace inline 3-query check with `import { hasValidAccess } from '../_shared/accessValidation.ts'`. This is where grace 72h + billing-day protection must apply.
2. `subscriptions-reconcile` lines 22-69: replace local `hasValidAccess` with shared import. Currently lacks grace window.
3. `subscription-grace-reminders` `markAsExpiredReentry` (line 210-247): add guard — call shared `hasValidAccess` before marking `was_club_member=true`. If still valid (e.g., bePaid renewed during grace) → skip marking.
4. `subscription-charge` `markAsExpiredReentry` (line 478-524): same guard.

---

## 10. Billing-day protection — scoped and parameterized

### 10.1 Scope restriction

The billing-day secondary check in `accessValidation.ts` must filter:

```
.eq('billing_type', 'provider_managed')
```

This prevents accidental extension for manual/trial/MIT subscriptions.

### 10.2 Constant + audit

```typescript
const BILLING_DAY_PROTECTION_HOURS = 12;
```

When billing-day protection grants access, log to `audit_logs`:

- action: `access.validation.billing_day_protected`
- meta: `{ user_id, subscription_id, next_charge_at, now, window_hours: 12 }`

---

## 11. UI truth source for next_charge_at

For bePaid SBS in ContactDetailSheet subscription row:

- Priority: `provider_subscriptions.next_charge_at` (already synced from API)
- Fallback: `subscriptions_v2.next_charge_at`
- If both null: show "не синхронизировано" + sync button

This is already the pattern in current code (confirmed from memory). No code change needed — just ensure sync populates `provider_subscriptions.next_charge_at`.

---

## 12. Sync must always call bePaid API

`bepaid-get-subscription-details` already always calls `https://api.bepaid.by/subscriptions/{id}` (line 93-100). If API fails, it returns error response (line 104-113). No "DB-only success" path exists.

Add: if API returns non-OK, insert audit_log `bepaid.sync_failed` with `{ subscription_id, status, error }` before returning error to UI.

---

## 13. Payment ↔ Contact linkage

### 13.1 Required fields for upsert

When upserting `last_transaction` into `payments_v2`:

- `profile_id` (resolved from `user_id` via profiles table — ContactPaymentsTab queries by `profile_id`)
- `provider_payment_id` = `last_transaction.uid`
- `provider` = `'bepaid'`
- `paid_at` = `last_transaction.created_at`
- `amount` (in cents → divide by 100 or keep consistent with existing convention)
- `currency`
- `status`: `successful → 'succeeded'`, `failed/failed_attempt/declined → 'failed'`
- `order_id` (from provider_subscriptions meta if available)

**Critical**: must set `profile_id`, not just `user_id`, otherwise ContactPaymentsTab won't find it (queries by `profile_id`).

### 13.2 DoD

After sync → payment record appears in contact card "Платежи" tab (including failed).

---

## 14. Deal date bug — diagnostic protocol

Before any fix, execute this checklist:

1. Find where "дата сделки" is displayed in ContactDetailSheet — identify component and field source (`deal.deal_date`? `order.created_at`? derived?)
2. Find the queryKey used to fetch this data
3. After editing deal_date via EditDealDialog, check if the correct queryKey is invalidated
4. Check if any server-side trigger/function overwrites `deal_date` silently

Only then apply fix. Do NOT assume the cause.

---

## 15. STOP-guard: no kick/reentry-mark for active SBS

Add to `accessValidation.ts` billing-day check: subscription states `['active', 'pending', 'past_due', 'failed_attempt']` (if stored in subscriptions_v2.status). This is already covered by the `in('status', ['active', 'trial', 'past_due'])` filter in the subscription query + grace + billing-day window.

The `telegram-revoke-access` fix (item 9.2 above) is the critical path — it's the only place that both kicks AND marks `was_club_member=true` without shared access check.

---

## 16. Final DoD — 3 provable artifacts

1. **Screenshot**: contact card showing `next_charge_at` matching bePaid + correct `access_end_at`
2. **Audit logs**: `bepaid.subscription.sync_dates` entries + `access.validation.billing_day_protected` (if triggered)
3. **Payment in contact**: `failed` payment visible in "Платежи" tab after sync

---

## Updated Files Summary


| File                                       | Change                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `_shared/timezone.ts`                      | Add `endOfDayWarsaw()`                                                                           |
| `_shared/accessValidation.ts`              | Grace 72h (subscriptions only) + billing-day protection (provider_managed only, constant, audit) |
| `bepaid-get-subscription-details/index.ts` | Truth field map, propagate to subscriptions_v2, upsert last_transaction with profile_id, audit   |
| `bepaid-webhook/index.ts`                  | Replace +accessDays with truth fields (2 paths), fallback with audit                             |
| `subscriptions-reconcile/index.ts`         | Replace local hasValidAccess with shared import                                                  |
| `telegram-revoke-access/index.ts`          | Replace inline access check (lines 244-277) with shared hasValidAccess                           |
| `subscription-grace-reminders/index.ts`    | Add hasValidAccess guard before markAsExpiredReentry                                             |
| `subscription-charge/index.ts`             | Add hasValidAccess guard before markAsExpiredReentry                                             |
| `ContactDetailSheet.tsx`                   | Sync button + auto-sync (max 3, Set-based dedup)                                                 |
| `ContactPaymentsTab.tsx`                   | Change 5 filters from `['succeeded','refunded']` to `['succeeded','refunded','failed']`          |


## Deploy List (confirmed by grep)

Functions importing `_shared/accessValidation.ts`:

1. `telegram-process-access-queue`
2. `telegram-kick-violators`
3. `telegram-grant-access`
4. `telegram-cron-sync`
5. `telegram-club-members`
6. `telegram-reinvite-ghosts`
7. `telegram-check-expired`

Functions directly changed:
8. `bepaid-get-subscription-details`
9. `bepaid-webhook`
10. `subscriptions-reconcile` (new import)
11. `telegram-revoke-access` (new import)
12. `subscription-grace-reminders` (new import)
13. `subscription-charge` (new import)