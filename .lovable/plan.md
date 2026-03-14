Да, согласен, с учетом правок:

&nbsp;

1. **PATCH-STAT-1 можно approve на execute.**
  Dry-run уже достаточный:
  &nbsp;
  - root-cause найден,
  - impact по БкБ и GC посчитан,
  - STOP-guard пройден,
  - policy по entitlement.product_id IS NULL зафиксирована,
  - affected flows перечислены.
  &nbsp;
2. **Перед execute в следующем сообщении он должен показать только короткий pre-execute блок:**
  &nbsp;
  - exact migration filename для has_valid_access_for_club
  - exact migration filename для get_club_member_summary
  - exact path _shared/accessValidation.ts
  - список 7 edge functions на redeploy
  &nbsp;
3. **После этого выполнять одним циклом:**
  &nbsp;
  - SQL fix has_valid_access_for_club
  - SQL fix get_club_member_summary
  - _shared/accessValidation.ts
  - redeploy 7 edge functions
  &nbsp;
4. **Обязательный post-check после execute:**
  &nbsp;
  - parity table БкБ
  - parity table GC
  - 20 sample rows для Не вошли в БкБ после фикса
  - 20 sample rows для Удалённые в БкБ после фикса
  - proof, что phantom 97 исчезли
  - proof, что реальные club-scoped users не потерялись
  &nbsp;
5. **Отдельно зафиксируй правило:**
  &nbsp;
  - entitlement без product_id не даёт club access
  - fallback по product_code запрещён без отдельного PATCH
  &nbsp;
6. **PATCH-4 пока не запускать.**
  Сначала полностью закрыть PATCH-STAT-1 и убедиться, что статистика и вкладки стали правильными.

&nbsp;

&nbsp;

Вот текст, который можно ему отправить:

```
Approve PATCH-STAT-1 for execute.

Dry-run package is accepted.

Before execute, provide a short pre-execute block with:
1. exact migration filename for `has_valid_access_for_club`
2. exact migration filename for `get_club_member_summary`
3. exact file path for `_shared/accessValidation.ts`
4. exact list of 7 edge functions to redeploy

Then execute in one cycle:
- SQL fix for `has_valid_access_for_club`
- SQL fix for `get_club_member_summary`
- `_shared/accessValidation.ts` update
- redeploy all affected edge functions

Mandatory post-check after execute:
1. parity table for BkB
2. parity table for GC
3. 20 sample rows for BkB `not_joined`
4. 20 sample rows for BkB `removed`
5. proof that the phantom 97 are gone
6. proof that no real club-scoped users lost valid access

Policy confirmed:
- entitlement without `product_id` does NOT grant club access
- no fallback by `product_code` without separate approval

PATCH-4 stays blocked until PATCH-STAT-1 is fully executed and verified.
```

&nbsp;

# PATCH-STAT-1: Club Counters / Tabs Mismatch — Dry-Run Proof Package

## Confirmed Root Cause

The function `has_valid_access_for_club` (latest version from migration `20260313203302`) has a regression in step 2 (entitlements). An earlier migration (`20260313195559`) correctly scoped entitlements via `product_club_mappings`, but the later migration **overwrote it** with an unscoped check:

```sql
-- CURRENT (BROKEN — migration 20260313203302, step 2):
IF EXISTS (
  SELECT 1 FROM entitlements e
  WHERE e.user_id = p_user_id
    AND e.status = 'active'
    AND (e.expires_at IS NULL OR e.expires_at > NOW())
) THEN RETURN true; END IF;
```

No `club_id` or `product_id` filtering. Any active entitlement grants access to ANY club.

The same bug exists in `supabase/functions/_shared/accessValidation.ts` — steps 1 (subscriptions) and 2 (entitlements) have no club scoping even when `clubId` is passed.

---

## Dry-Run Impact Report

### BkB (Бухгалтерия как бизнес) — `4f8f9d8f`

```text
Metric               | BEFORE fix | AFTER fix | Delta
---------------------|------------|-----------|------
В клубе              | 30         | 30        | 0
С доступом           | 127        | 30        | -97 (false positives removed)
Не вошли             | 97         | 0         | -97 (all were phantom)
Нарушители           | 0          | 0         | 0
Удалённые            | 4          | 4         | 0
Relevant scope       | 46         | 46        | 0
```

**97 users losing "access"** — ALL are false positives. Every single one has:

- `has_club_subscription = false`
- `has_club_grant = false`
- `has_club_manual = false`
- `has_any_entitlement = true` (for GC product `club`, not BkB product `buh_business`)

**STOP-guard check: PASSED.** Zero users with real BkB club-scoped access are affected.

**Anti-contradiction fix:** 1 removed user (`1@ajoure.by`) currently shows `has_active_access=true` (from leaked entitlement). After fix: `fixed_access=false`. Anti-contradiction resolved.

### GC (Gorbova Club) — `fa547c41`

```text
Metric               | BEFORE fix | AFTER fix | Delta
---------------------|------------|-----------|------
В клубе              | 156        | 156       | 0
С доступом           | 162        | 162       | 0
Не вошли             | 6          | 6         | 0
Нарушители           | 0          | 0         | 0
Удалённые            | 41         | 41        | 0
Relevant scope       | 200        | 200       | 0
```

**No change for GC.** The 3 users with `only_from_unscoped_entitlement` have `product_code='club'` which maps to GC via `product_club_mappings` — so they retain access through the fixed club-scoped check.

### Entitlements with NULL product_id

3 entitlements exist with `product_id = NULL` (all `product_code = 'buh_business'`). Per the fixed logic using `product_id` JOIN, they will NOT match. But checking their users:

- All 3 users have other access sources (subscriptions/grants) for BkB, so no access loss.

**Policy (explicit):** Entitlement without `product_id` does NOT grant club access. No fallback by `product_code` without separate approval.

---

## Exact Changes (3 files, synchronized)

### Fix 1: SQL function `has_valid_access_for_club`

Replace step 2 (entitlements) — currently lines 173-182 in the function:

```sql
-- BEFORE (BROKEN):
IF EXISTS (
  SELECT 1 FROM entitlements e
  WHERE e.user_id = p_user_id
    AND e.status = 'active'
    AND (e.expires_at IS NULL OR e.expires_at > NOW())
) THEN RETURN true; END IF;

-- AFTER (FIXED):
IF EXISTS (
  SELECT 1 FROM entitlements e
  JOIN product_club_mappings pcm
    ON pcm.product_id = e.product_id
    AND pcm.is_active = true
    AND pcm.club_id = p_club_id
  WHERE e.user_id = p_user_id
    AND e.status = 'active'
    AND (e.expires_at IS NULL OR e.expires_at > NOW())
) THEN RETURN true; END IF;
```

Full function will be re-created via `CREATE OR REPLACE FUNCTION` migration.

### Fix 2: `supabase/functions/_shared/accessValidation.ts`

**Both `hasValidAccess` and `hasValidAccessBatch**`, steps 1 (subscriptions) and 2 (entitlements) — add club scoping when `clubId` is provided:

**Step 1 (subscriptions) — when clubId is provided:**

```typescript
// Get club-mapped product IDs first
const { data: mappings } = await supabase
  .from('product_club_mappings')
  .select('product_id')
  .eq('club_id', clubId)
  .eq('is_active', true);
const clubProductIds = (mappings || []).map(m => m.product_id);

// Then filter subscriptions by club products
query.in('product_id', clubProductIds);
```

**Step 2 (entitlements) — when clubId is provided:**

```typescript
// Same clubProductIds from step 1 (cached)
// Filter entitlements by product_id in club products
query.in('product_id', clubProductIds);
// This naturally excludes entitlements with NULL product_id
```

**When clubId is NOT provided** — behavior unchanged (global access check for non-club contexts like billing guards).

### Fix 3: `get_club_member_summary` — scope alignment

After Fix 1, the summary RPC already produces correct numbers because it reads from `v_club_members_enriched` which calls the fixed `has_valid_access_for_club`. The parity forecast confirms all counters match after Fix 1.

**However**, there remains a structural mismatch: the summary counts ALL non-orphaned rows (642 for BkB), while the list shows only `relevant` scope (46 rows). This only matters if a future bug introduces phantom users — the counter would count them but the list wouldn't show them.

**Proposed fix:** Add `relevant` scope filter to the summary RPC WHERE clause:

```sql
-- Add after: WHERE v.club_id = p_club_id
AND NOT COALESCE(v.is_orphaned, false)
AND (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false))
```

This ensures: **top cards, tab counters, badge counts, empty states** all derive from the same backend scope as the member list. Single source of truth.

---

## Affected Flows / Screens (Impact Analysis)


| Flow                    | File                               | Uses                                 | clubId passed? | Impact                                           |
| ----------------------- | ---------------------------------- | ------------------------------------ | -------------- | ------------------------------------------------ |
| Club stats cards        | SQL view `v_club_members_enriched` | `has_valid_access_for_club`          | Yes (implicit) | Fixed by Fix 1                                   |
| Club member list        | RPC `get_club_members_enriched`    | same view                            | Yes            | Fixed by Fix 1                                   |
| Club summary counters   | RPC `get_club_member_summary`      | same view                            | Yes            | Fixed by Fix 1 + Fix 3                           |
| Access queue processing | `telegram-process-access-queue`    | `hasValidAccess(_, _, club_id)`      | Yes            | Fixed by Fix 2                                   |
| Kick violators          | `telegram-kick-violators`          | `hasValidAccessBatch(_, _, club.id)` | Yes            | Fixed by Fix 2                                   |
| Check expired           | `telegram-check-expired`           | `hasValidAccess(_, _, club_id)`      | Yes            | Fixed by Fix 2                                   |
| Grant access            | `telegram-grant-access`            | `hasValidAccess(_, _, cid)`          | Yes            | Fixed by Fix 2                                   |
| Cron sync               | `telegram-cron-sync`               | `hasValidAccessBatch(_, _, club.id)` | Yes            | Fixed by Fix 2                                   |
| Reinvite ghosts         | `telegram-reinvite-ghosts`         | `hasValidAccessBatch(_, _, club.id)` | Yes            | Fixed by Fix 2                                   |
| Club members admin      | `telegram-club-members`            | `hasValidAccessBatch(_, _, club_id)` | Yes            | Fixed by Fix 2                                   |
| Subscriptions reconcile | `subscriptions-reconcile`          | **Local copy** (no import)           | **No clubId**  | Not affected (global check, correct for billing) |


All 7 edge functions that import from `_shared/accessValidation.ts` pass `clubId`. After Fix 2, all will use club-scoped logic. The `subscriptions-reconcile` function has its own local implementation without club scope — this is correct for billing reconciliation (global access check).

**Result:** SQL, Edge Functions, and UI will all use the same club-scoped access rule after this patch.

---

## Execution Plan

1. **Migration:** `CREATE OR REPLACE FUNCTION has_valid_access_for_club` with club-scoped entitlement check
2. **Migration (same):** `CREATE OR REPLACE FUNCTION get_club_member_summary` with relevant-scope filter
3. **Code:** Update `_shared/accessValidation.ts` — add club-scoped subscription and entitlement checks
4. **Deploy:** 7 edge functions that import from `_shared/accessValidation.ts`
5. **Post-check:** Parity table verification (summary RPC vs list length vs SQL direct)

---

## Post-Fix Parity Forecast (BkB)

```text
Metric          | Summary RPC | List filter | SQL direct | Status
----------------|-------------|-------------|------------|--------
В клубе         | 30          | 30          | 30         | OK
С доступом      | 30          | 30          | 30         | OK
Не вошли        | 0           | 0           | 0          | OK
Нарушители      | 0           | 0           | 0          | OK
Удалённые       | 4           | 4           | 4          | OK
```

## Post-Fix Parity Forecast (GC)

```text
Metric          | Summary RPC | List filter | SQL direct | Status
----------------|-------------|-------------|------------|--------
В клубе         | 156         | 156         | 156        | OK
С доступом      | 162         | 162         | 162        | OK
Не вошли        | 6           | 6           | 6          | OK
Нарушители      | 0           | 0           | 0          | OK
Удалённые       | 41          | 41          | 41         | OK
```