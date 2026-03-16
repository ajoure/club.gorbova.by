

# Plan: Admin Payment Link Access + RadioGroup Bug Fix

## Two issues to fix

### Issue 1: Permission gate too restrictive
**Line 1768** in `ContactDetailSheet.tsx` wraps both buttons ("Списать деньги" + "Ссылка на оплату") in a single `isSuperAdmin()` check. Regular admins already have `entitlements.manage` permission (confirmed in DB), and the edge function `admin-create-payment-link` checks for that permission — so the backend already allows it. Only the UI blocks regular admins.

**Fix**: Split the two buttons:
- "Списать деньги" — keep `isSuperAdmin()` only
- "Ссылка на оплату" — show for `isAdmin()` (i.e. admin OR super_admin)

Since `ContactDetailSheet` uses `usePermissions()`, we'll use `isAdmin()` from the same hook (which returns true for both `admin` and `super_admin` roles).

**File**: `src/components/admin/ContactDetailSheet.tsx` — lines 1767-1787

### Issue 2: RadioGroup toggle bug in payment type selection
**Lines 350-374** in `AdminPaymentLinkDialog.tsx`: Each radio option wrapper `div` has an `onClick={() => setPaymentType(...)}` handler. This conflicts with `RadioGroup`'s internal `onValueChange` — when clicking back to "one_time", both handlers fire but can race/conflict, preventing the switch.

**Fix**: Remove the `onClick` handlers from the wrapper `div`s. The `RadioGroup onValueChange` + `Label htmlFor` already handle the selection correctly. The wrapper divs should only provide visual styling, not duplicate click handling.

**File**: `src/components/admin/AdminPaymentLinkDialog.tsx` — lines 350-373

## Files changed

| File | Change |
|------|--------|
| `src/components/admin/ContactDetailSheet.tsx` | Split permission check: charge = super_admin, payment link = admin |
| `src/components/admin/AdminPaymentLinkDialog.tsx` | Remove duplicate `onClick` from RadioGroup wrapper divs |

## Not changed
- Edge function `admin-create-payment-link` — already uses `entitlements.manage`, no change needed
- TariffCard, checkout flow, pricing logic — untouched

