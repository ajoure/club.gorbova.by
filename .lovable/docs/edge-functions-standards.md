# Edge Functions Standards & CI Guard Rules

## Overview

This document defines the standards for Edge Functions in this project and the CI rules that must be enforced to prevent regressions.

---

## 1. CORS Headers Standard

All **browser-called** functions MUST use the following CORS headers to support Supabase JS SDK v2:

```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
```

### Why These Headers?

Supabase JS SDK v2 sends additional headers (`x-supabase-client-*`) for telemetry and debugging. If these headers are not explicitly allowed in the CORS preflight response, the browser will block the request.

### How to Use

**Option A: Import shared helper**
```typescript
import { corsHeaders, handleCorsPreflightRequest } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return handleCorsPreflightRequest();
  }
  // ...
});
```

**Option B: Define inline (if shared import causes issues)**
```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
```

---

## 2. Import Standard

All Edge Functions MUST use `npm:` specifier for Supabase dependencies:

```typescript
// ✅ CORRECT
import { createClient } from 'npm:@supabase/supabase-js@2';

// ❌ WRONG (unstable, causes cold-start issues)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
```

### Why npm: Instead of esm.sh?

- `npm:` is resolved by Deno natively and cached locally
- `esm.sh` is a third-party CDN that can have:
  - Resolution timeouts during cold starts
  - Version drift
  - Integrity hash mismatches
  - Bundle generation failures

---

## 3. Handler Standard

All Edge Functions MUST use `Deno.serve()` instead of the deprecated `serve()` from std:

```typescript
// ✅ CORRECT
Deno.serve(async (req) => {
  // ...
});

// ❌ WRONG (deprecated)
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
serve(async (req) => {
  // ...
});
```

---

## 4. CI Guard Rules

The following rules MUST be enforced in CI to prevent regressions:

### Rule 1: No esm.sh imports for @supabase/*

```bash
# Fail if any function uses esm.sh for supabase
grep -r "esm\.sh.*@supabase" supabase/functions/ && exit 1
```

### Rule 2: CORS headers must include x-supabase-client-*

For browser-called functions, validate that `corsHeaders` contains:
- `x-supabase-client-platform`
- `x-supabase-client-platform-version`
- `x-supabase-client-runtime`
- `x-supabase-client-runtime-version`

### Rule 3: All functions must be deployed

After deploy, verify no function returns 404:

```bash
for fn in $(ls supabase/functions | grep -v _shared); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS \
    "https://${PROJECT_REF}.supabase.co/functions/v1/${fn}")
  if [ "$STATUS" = "404" ]; then
    echo "FAIL: $fn not deployed"
    exit 1
  fi
done
```

### Rule 4: Preflight must return correct headers

```bash
HEADERS=$(curl -s -I -X OPTIONS \
  "https://${PROJECT_REF}.supabase.co/functions/v1/${fn}" \
  | grep -i "access-control-allow-headers")

if ! echo "$HEADERS" | grep -q "x-supabase-client-platform"; then
  echo "FAIL: $fn missing SDK headers in CORS"
  exit 1
fi
```

---

## 5. Function Categories

| Category | Auth Required | CORS Required | Examples |
|----------|---------------|---------------|----------|
| **Browser/Public** | No | Yes | `public-product`, `auth-check-email` |
| **Browser/Auth** | JWT | Yes | `subscription-actions`, `cancel-trial` |
| **Browser/Admin** | JWT + RBAC | Yes | `users-admin-actions`, `roles-admin` |
| **Webhook** | Provider signature | No* | `bepaid-webhook`, `telegram-webhook` |
| **Cron/System** | Secret/Service Role | No | `subscription-charge`, `nightly-*` |

*Webhooks still include CORS headers for consistency but don't require them.

---

## 6. Shared Helpers

Available in `supabase/functions/_shared/`:

| File | Purpose |
|------|---------|
| `cors.ts` | CORS headers and helpers |
| `user-resolver.ts` | Find profile by email/phone/ID |
| `accessValidation.ts` | Access/entitlement checks |
| `paymentClassification.ts` | Payment type detection |
| `resolve-profile-id.ts` | Profile resolution helpers |

---

## 7. Checklist for New Functions

- [ ] Uses `npm:@supabase/supabase-js@2` (not esm.sh)
- [ ] Uses `Deno.serve()` (not `serve()`)
- [ ] Has proper CORS headers with SDK headers
- [ ] Has OPTIONS handler
- [ ] Added to deploy-functions.yml if Tier 1
- [ ] Has auth guard if browser-called
- [ ] Has RBAC check if admin function
