

# PATCH 3 fix — Probable match normalization

## Problem
Tier 3 uses `ilike('full_name', normalizedName)` which only normalizes the input side. Dirty DB data (double spaces, trailing whitespace) won't match.

## Solution: Variant A
Query by `birth_date` only, then normalize and compare `full_name` in application code. This is the safest approach without DB-side functions.

## Change in `src/hooks/usePersonDuplicateCheck.ts`

**Lines ~141-170**: Replace the Tier 3 block:

1. Query `legal_details_persons` filtering only by `profile_id`, `birth_date`, and `excludePersonId`
2. For each returned row, normalize `full_name` using the same `normalizeName()` function
3. Compare normalized DB name with normalized input name (case-insensitive via `.toLowerCase()`)
4. Filter candidates in code

```typescript
// Tier 3: Probable match — query by birth_date, normalize full_name in code
if (input.full_name?.trim() && input.birth_date?.trim()) {
  const normalizedInputName = normalizeName(input.full_name).toLowerCase();

  const query = supabase
    .from('legal_details_persons')
    .select(SELECT_FIELDS)
    .eq('profile_id', profileId)
    .eq('birth_date', input.birth_date.trim());

  if (excludePersonId) {
    query.neq('id', excludePersonId);
  }

  const { data, error } = await query;
  if (error) throw error;

  if (data) {
    const matched = data.filter(row =>
      row.full_name && normalizeName(row.full_name).toLowerCase() === normalizedInputName
    );
    if (matched.length > 0) {
      // ... return probable match with matched candidates
    }
  }
}
```

## Update `docs/PATCH_3_ANTI_DUPLICATE_AND_REUSE.md`
Add proof block: Variant A chosen. Both input and DB-side `full_name` normalized via `normalizeName()` + `toLowerCase()` in application code. Covers double spaces, trailing whitespace, case differences.

## Files
- `src/hooks/usePersonDuplicateCheck.ts` — Tier 3 fix
- `docs/PATCH_3_ANTI_DUPLICATE_AND_REUSE.md` — proof addendum

## DoD
- Dirty DB data (extra spaces, case) matched correctly
- No DB-side function needed
- PATCH 3 closed

