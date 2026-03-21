

# PATCH 3.2.7D fix — Remove UUID fallback from UI token generation

## Problem

In `src/lib/tokens/tokenRegistry.ts` line 95, there's a UUID fallback:
```typescript
tokenString: f.public_id ? `{{cf.legal_details.${f.public_id}}}` : `{{cf.legal_details.${f.id}}}`
```

This violates the ID-driven standard: UI must never generate UUID-based tokens. The hook (`useLegalDetailsFields.ts` line 45) already handles this correctly — returns empty string when no `public_id`.

## Changes

### 1. `src/lib/tokens/tokenRegistry.ts` — line 95

Remove UUID fallback. If no `public_id`, skip the field entirely (filter it out):

```typescript
return data
  .filter((f) => !!f.public_id)
  .map((f) => ({
    key: f.id,
    label: f.label,
    tokenString: `{{cf.legal_details.${f.public_id}}}`,
    group: "legal_details" as const,
    badge: DATA_TYPE_BADGES[f.data_type] ?? f.data_type,
    searchKeywords: `${f.label} ${f.key} реквизиты legal ${f.public_id}`,
  }));
```

Fields without `public_id` won't appear in token picker at all — no disabled state needed since trigger always assigns `public_id` on INSERT.

### 2. Update `.lovable/plan.md`

Record this fix.

## Not changing

- `useLegalDetailsFields.ts` — already correct (empty string for missing `public_id`)
- `token-resolver.ts` — UUID compatibility layer stays in resolver only
- No other files affected

## DoD

- Zero UUID-based tokens generated in UI layer
- UUID compatibility only in resolver (for legacy templates)
- Token picker shows only `public_id`-based tokens
- Build clean

