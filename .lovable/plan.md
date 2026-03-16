

# Fix: Consent modal blocks access when session token expires

## Root Cause

The user's session JWT has expired but AuthContext still has the user object from cache. This creates a deadlock:

1. **AuthContext** reports `user` as present (from cached/stale session)
2. **Supabase client** sends requests with the **anon key** instead of the user's JWT (visible in network logs - Bearer token = anon key)
3. **Profile query** returns `[]` because RLS policy `user_id = auth.uid()` fails (auth.uid() is null for anon)
4. `needsConsentUpdate` evaluates `undefined !== "v2026-01-07"` = **true** → modal opens
5. **Consent INSERT** fails with RLS violation (anon role can't insert with non-null user_id)
6. User is **trapped**: modal blocks all navigation, save fails, can't close modal

The profile in the database already has `consent_version: v2026-01-07` (confirmed via direct SQL query). The modal should NOT be showing at all - it's a false positive caused by a stale session.

## Fix

In `src/hooks/useConsent.tsx`, update `needsConsentUpdate` logic:

- If profile query returns `null` (no data) but user exists, this likely means a session issue, not missing consent
- Add check: `needsConsentUpdate` should only be true when `profileConsent` is **not null** AND version differs
- When `profileConsent` is null (fetch returned empty), don't block the user with a consent modal

```
// Current (broken):
const needsConsentUpdate = 
  !!user && 
  !!currentPolicy && 
  profileConsent !== undefined &&
  profileConsent?.consent_version !== currentPolicy.version;

// Fixed:
const needsConsentUpdate = 
  !!user && 
  !!currentPolicy && 
  profileConsent !== undefined &&
  profileConsent !== null &&           // <-- don't trigger if profile fetch failed
  profileConsent.consent_version !== currentPolicy.version;
```

This single-line change means: if the profile query returns nothing (session issue, RLS blocking, or no profile), don't show the blocking consent modal. The user can proceed, and when their session refreshes, the correct consent status will be fetched.

## Scope

| File | Change |
|------|--------|
| `src/hooks/useConsent.tsx` L103-107 | Add `profileConsent !== null` check |

No SQL, no RPC, no migration changes.

