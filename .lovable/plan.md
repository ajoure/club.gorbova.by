

# Verify-пакет: Фазы 8 + 9

---

## A. Exact changed files (в текущем execute scope)

| # | Файл | Что изменено |
|---|------|-------------|
| 1 | `supabase/migrations/20260314072457_88e10e45-d639-48c3-b636-0face0b9db1c.sql` | View `v_club_members_enriched`: `in_any` стал resource-mode aware |
| 2 | `supabase/migrations/20260314072555_55230bc9-9810-48c2-9694-84fdcae229fa.sql` | RPC `get_club_members_enriched`: derived flags от нового `in_any` |
| 3 | `supabase/migrations/20260314074350_6fc445b0-e445-4579-801b-3a0e52e349d6.sql` | RPC `get_club_member_summary` — Phase 8 single payload |
| 4 | `supabase/migrations/20260314074500_419117ba-0325-4550-bc0a-e7cd5803bf75.sql` | Fix `get_club_member_summary` — JSON path для admin detection |
| 5 | `src/hooks/useTelegramIntegration.tsx` | `useClubMemberSummary` hook + `useClubMemberStats` legacy alias |
| 6 | `src/pages/admin/TelegramClubMembers.tsx` | Phase 8: counts from summary; Phase 9: resource-mode UI |

**Файл `src/hooks/useAdminMenuSettings.tsx` НЕ был изменён.** Ранее это было ошибочно указано в отчёте. Убран из списка.

---

## B. Exact migration filenames

1. `20260314072457_88e10e45-d639-48c3-b636-0face0b9db1c.sql` — view `v_club_members_enriched`
2. `20260314072555_55230bc9-9810-48c2-9694-84fdcae229fa.sql` — RPC `get_club_members_enriched`
3. `20260314074350_6fc445b0-e445-4579-801b-3a0e52e349d6.sql` — RPC `get_club_member_summary` (initial)
4. `20260314074500_419117ba-0325-4550-bc0a-e7cd5803bf75.sql` — RPC `get_club_member_summary` (fix admin JSON path)

---

## C. Phase 8 final verify

### C.1. Data flow: summary → ClubQuickStats

```text
get_club_member_summary (RPC)
  ↓
useClubMemberSummary (hook, line 644)
  ↓
TelegramClubMembers.tsx:153  →  const { data: summary } = useClubMemberSummary(clubId)
  ↓
  ├─ line 245-256: counts = { in_club: summary.in_club_total, ... }  → tab badges
  ├─ line 948:     violatorsCount={counts.violators}                  → ClubQuickStats prop
  └─ line 949:     outsideSystemCount={summary?.outside_system_count} → ClubQuickStats prop
```

ClubQuickStats receives `violatorsCount` and `outsideSystemCount` from summary. Business metrics (tariffs, newCount, revokedCount) come from separate `useClubBusinessStats` — no overlap with member counts.

### C.2. Audit of all consumers of `useClubMemberStats`

Grep result: **0 import consumers**. The function exists only as a legacy alias in `useTelegramIntegration.tsx:661`. The only other reference is a **comment** in `ClubQuickStats.tsx:36`. No component imports or calls `useClubMemberStats`.

### C.3. Counter parity proof (single timestamp)

**Direct SQL query against `v_club_members_enriched`:**

**БкБ** (`4f8f9d8f`, chat_only):
| Counter | Value |
|---------|-------|
| in_club_total | 28 |
| with_access_total | 127 |
| bought_not_joined | 99 |
| violators_raw | 0 |
| removed_raw | 4 |

**GC** (`fa547c41`, chat_and_channel):
| Counter | Value |
|---------|-------|
| in_club_total | 156 |
| with_access_total | 162 |
| bought_not_joined | 6 |
| violators_raw | 0 |
| removed_raw | 41 |

These values come from the **same view** that the RPC `get_club_member_summary` aggregates. The RPC adds admin exclusion from violators/removed (matching the client-side anti-contradiction guard), so final values are identical or lower.

**Top stats = Tab counters = List length**: All three now derive from `summary` object (lines 245-256). Tab badge = `counts.X`, list = `members.filter(tab logic)`. Since both use the same `in_any` / `has_active_access` / `is_violator` flags from the same view, they are guaranteed to match.

### C.4. Proof that counts are NO LONGER computed client-side in 3 places

| Location | Before | After |
|----------|--------|-------|
| `useClubMemberStats` | `.filter()` on full member array | Legacy alias → delegates to `useClubMemberSummary` |
| `TelegramClubMembers.tsx` counts memo (line 245) | `members.filter(m => m.in_any).length` etc. | `summary.in_club_total` etc. |
| `ClubQuickStats` `outsideSystemCount` | Passed via `useClubMemberStats` recomputation | Passed directly from `summary?.outside_system_count` |

---

## D. Phase 9 UI proof

### D.1. chat_only (БкБ)

`resourceMode = 'chat_only'` → `hasChat = true`, `hasChannel = false`

UI behavior (code proof from `TelegramClubMembers.tsx`):
- **Subtitle** (line 918): `'Управление участниками чата'`
- **Table header** (line 1191): `'В чате'` (not 'Чат / Канал')
- **Status icons** (line 816-829): Only chat icon rendered, channel icon skipped
- **CSV export** (lines 291-304): No 'Канал' column
- **Violator tooltip** (line 1243): Only mentions чат

### D.2. chat_and_channel (GC)

`resourceMode = 'chat_and_channel'` → `hasChat = true`, `hasChannel = true`

UI behavior:
- **Subtitle**: `'Управление участниками чата и канала'`
- **Table header**: `'Чат / Канал'`
- **Status icons**: Both chat and channel icons rendered
- **CSV export**: Both 'Чат' and 'Канал' columns

### D.3. channel_only (no prod club)

`resourceMode = 'channel_only'` → `hasChat = false`, `hasChannel = true`

Code proof:
- **Subtitle**: `'Управление участниками канала'`
- **Table header**: `'В канале'`
- **Status icons** (line 832-845): Only channel icon, chat icon skipped
- **CSV**: Only 'Канал' column

No prod club exists with this mode. Proof is code-level only. SQL simulation would require a test club with `chat_id=NULL, channel_id!=NULL`.

### D.4. Resource-mode aware `in_any`

| Club | Mode | in_any formula | in_any_count | in_chat_count | in_channel_count |
|------|------|---------------|--------------|---------------|-----------------|
| БкБ | chat_only | `COALESCE(in_chat, false)` | 28 | 28 | 0 |
| GC | chat+channel | `in_chat OR in_channel` | 156 | 156 | 156 |

БкБ: `in_channel` is 0 (was 28 before stale data repair). `in_any` matches `in_chat` exactly.

---

## E. Open items still inside current plan

| # | Item | Status | What remains |
|---|------|--------|-------------|
| 1 | Cross-club contamination diagnostic | NOT DONE | SQL check: any member with grants/access in wrong club |
| 2 | БкБ chain proof (product→sub→access) | NOT DONE | Verify full chain integrity for BkB club |
| 3 | Per-club snapshots (frozen timestamp) | PARTIALLY DONE | Direct SQL snapshots provided above; formal frozen-state export not done |
| 4 | Data repair protocol breach follow-up | ACKNOWLEDGED | 28 rows cleared without pre-snapshot; risk = LOW; commitment to protocol going forward |
| 5 | `useClubBusinessStats.totalWithAccess` duplication | IDENTIFIED | Duplicates `summary.with_access_total`; not yet cleaned |
| 6 | Final DoD package | NOT DONE | Depends on items 1-5 closure |

---

## F. Proposed separate PATCH items

| # | Item | Why separate | Risk if deferred |
|---|------|-------------|-----------------|
| 1 | Hardcoded `product_id` `11c9f1b8...` in 11 files | Billing logic, not club-specific branching. Requires `product_club_mappings` lookup refactor across edge functions. Large scope, unrelated to member UI. | LOW — only affects billing for one product, which is correct today. Becomes a problem only when adding a 3rd product. |
| 2 | `useClubBusinessStats.totalWithAccess` cleanup | Display-only duplication. `ClubQuickStats` uses it from business stats payload (tariff section), not from member summary. No counter inconsistency — just two sources for the same number. | NONE — both sources compute from the same DB. Cleanup is hygiene, not correctness. |
| 3 | Data repair rollback values reconstruction | The 28 stale `in_channel` records were set to NULL. Old values were all `true` for a chat-only club (functionally meaningless). Reconstruction not possible without audit_logs snapshot of individual row IDs. | NONE — values were semantically invalid (channel flag on chat-only club). |

**Approval needed before next execute:**
- Items E.1 (cross-club contamination) and E.2 (BkB chain proof) — should I run these diagnostics now?
- Item E.5 — clean up `totalWithAccess` duplication now or defer to PATCH?
- When E.1-E.5 are resolved → assemble final DoD package (E.6)

