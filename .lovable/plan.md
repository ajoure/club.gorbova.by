

# INV-SITE-1 — Final Approved Plan (Ready for Implementation)

All corrections already incorporated in the previous iteration. No changes needed — this is the implementation-ready version.

## Summary of changes to `supabase/functions/nightly-system-health/index.ts`

### 1. Add to INVARIANT_TRANSLATIONS (after line 161)
```typescript
'INV-SITE-1': {
  title: 'Невалидные опубликованные страницы',
  explain: 'Опубликованные страницы с пустыми или невалидными блоками (без id/type/version)',
  action: 'Снять с публикации или исправить блоки',
  urlPath: '/admin/sites',
},
```

### 2. Add INV-SITE-1 query block (after line 318, before ignored-checks filtering)
- Query `site_pages` where `status = 'published'`
- On **query error**: create `HealthCheckResult` with `passed: false` and error description
- On success: filter violations (null/undefined/non-array/empty blocks, or blocks missing id/type/version)
- Push result to `invariantsResult.invariants`, update summary counters

### 3. Add CHECK_KEY_CATEGORY map (before save loop, line ~347)
```typescript
const CHECK_KEY_CATEGORY: Record<string, string> = {
  'INV-SITE-1': 'content',
};
```
Category resolution: `CHECK_KEY_CATEGORY[checkKey]` first, existing text-based fallback for legacy checks.

### 4. Update category resolution in save loop
Map-first lookup, then existing text fallback for backward compatibility.

## Files
| File | Change |
|---|---|
| `supabase/functions/nightly-system-health/index.ts` | 4 localized edits as described above |

## Implementation order
1. INVARIANT_TRANSLATIONS entry
2. INV-SITE-1 query + error handling block
3. CHECK_KEY_CATEGORY map + category resolution update
4. Deploy via `supabase--deploy_edge_functions`
5. Verify via `supabase--edge_function_logs`

