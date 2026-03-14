# PATCH-2 Execute Plan: Revoke 2 Orphan Grants

## Dry-run results (confirmed)


| Grant ID   | User       | Club | Status | end_at     | Other active grants            |
| ---------- | ---------- | ---- | ------ | ---------- | ------------------------------ |
| `5c8df81a` | `341e6f46` | BkB  | active | 2026-04-04 | 1 (`4f6a93f9`, end=2026-04-04) |
| `e3bb3bfd` | `6ed48afa` | GC   | active | NULL       | 1 (`18f32641`, end=2026-04-07) |


Both users retain access via their parallel grants after revoke.

## Migration file

**File:** `supabase/migrations/20260314094500_patch2_revoke_orphan_grants.sql`

**SQL (2 steps, atomic transaction):**

```sql
-- Step 1: Snapshot into audit_logs BEFORE mutation
INSERT INTO audit_logs (actor_user_id, action, target_user_id, meta)
SELECT 
  '00000000-0000-0000-0000-000000000000'::uuid,
  'data_repair.patch2_orphan_grant_revoke',
  g.user_id,
  jsonb_build_object(
    'grant_id', g.id,
    'club_id', g.club_id,
    'pre_status', g.status,
    'pre_end_at', g.end_at,
    'pre_meta', g.meta,
    'source', g.source,
    'source_id', g.source_id,
    'reason', 'orphan auto_subscription grant with NULL source_id; user has parallel active grant',
    'parallel_grant_verified', true
  )
FROM telegram_access_grants g
WHERE g.id IN (
  '5c8df81a-61a3-4222-bac6-cbdf969169ab',
  'e3bb3bfd-5ff7-408e-9b13-d7c48dce298a'
)
AND g.status = 'active'
AND g.source = 'auto_subscription'
AND g.source_id IS NULL;

-- Step 2: Revoke both grants
UPDATE telegram_access_grants
SET 
  status = 'revoked',
  revoked_at = NOW(),
  revoke_reason = 'PATCH-2: orphan auto_subscription grant (source_id=NULL), parallel active grant exists',
  meta = COALESCE(meta, '{}'::jsonb) || '{"patch": "PATCH-2", "revoked_by": "data_repair"}'::jsonb,
  updated_at = NOW()
WHERE id IN (
  '5c8df81a-61a3-4222-bac6-cbdf969169ab',
  'e3bb3bfd-5ff7-408e-9b13-d7c48dce298a'
)
AND status = 'active'
AND source = 'auto_subscription'
AND source_id IS NULL;
```

**Safety guards in WHERE clause:**

- `status = 'active'` -- won't touch if already revoked
- `source = 'auto_subscription'` -- confirms grant type
- `source_id IS NULL` -- confirms orphan status
- Expected affected rows: 2 (audit inserts) + 2 (grant updates)

## Post-check queries (after migration)

**1. Verify both grants are revoked:**

```sql
SELECT id, status, revoked_at, revoke_reason
FROM telegram_access_grants
WHERE id IN ('5c8df81a-61a3-4222-bac6-cbdf969169ab', 'e3bb3bfd-5ff7-408e-9b13-d7c48dce298a');
```

**2. Verify both users still have active access:**

```sql
SELECT g.user_id, g.club_id, g.id as remaining_grant_id, g.status, g.end_at::text
FROM telegram_access_grants g
WHERE g.user_id IN ('341e6f46-79dd-4920-b500-da78e3574aab', '6ed48afa-11bb-4169-a0d4-5f8d2fb0ee1f')
  AND g.status = 'active'
  AND (g.end_at IS NULL OR g.end_at > NOW());
```

**3. Verify audit trail:**

```sql
SELECT id, action, target_user_id, meta->>'grant_id' as grant_id, created_at
FROM audit_logs
WHERE action = 'data_repair.patch2_orphan_grant_revoke'
ORDER BY created_at DESC;
```

## Rollback (if needed)

```sql
UPDATE telegram_access_grants
SET status = 'active', revoked_at = NULL, revoke_reason = NULL,
    meta = meta - 'patch' - 'revoked_by', updated_at = NOW()
WHERE id IN ('5c8df81a-61a3-4222-bac6-cbdf969169ab', 'e3bb3bfd-5ff7-408e-9b13-d7c48dce298a');
```

## After PATCH-2: Closure summary


| PATCH   | Status                              |
| ------- | ----------------------------------- |
| PATCH-1 | Audit-only, no mutation (accepted)  |
| PATCH-2 | This migration -- pending execution |
| PATCH-3 | Executed and accepted               |
| PATCH-4 | Separate future scope               |


## PATCH-4 scope (separate, not mixed)

Hardcoded `product_id` refactor across 12 files. Will be planned as an isolated scope after current cleanup cycle closes. Requires its own dry-run, E2E verification of billing flows, and separate approval.

&nbsp;

Approve PATCH-2 execute with one required correction.

Execute is approved because:

- dry-run is provided

- parallel active grant is confirmed for both users

- post-check queries are provided

- rollback is provided

Required correction before execute:

do not use fake zero UUID as actor identity in audit log.

Use proper system actor logging according to our project rules:

- actor_type = 'system'

- actor_user_id = NULL

- actor_label = 'PATCH-2 data repair'

or the exact audit format already accepted in this project.

After execute, provide:

1. affected rows

2. post-check that both target grants are revoked

3. post-check that both users still retain valid access via remaining grants

4. audit log proof

5. short closure summary for PATCH-2

PATCH-1 remains audit-only.

PATCH-3 remains accepted as done.

PATCH-4 remains separate future scope.