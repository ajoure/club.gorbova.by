# H3.x-c — past_due duplicate subscriptions classification (read-only)

**Status:** closed (read-only classification only)
**Mode:** `BEPAID_REBILL_MATERIALIZATION = dry_run`, `mode=on` disabled.
**DML:** 0. **Migrations:** 0. **Edge function calls:** 0. **Provider API calls:** 0. **Telegram:** 0. **audit_logs INSERT:** 0.

## Stage 0 — Discovery & Freeze

**snapshot_at = `2026-05-16 18:47:36.779067+00`** (UTC).
All Stage 1/2 SQL was evaluated against `subscriptions_v2` as of this snapshot. No row was written between snapshot and proof.

### Scope rule (deterministic filter)

Pairs/triples/n-tuples of `subscriptions_v2` where:
- same `(user_id, product_id, tariff_id)`,
- all members have `status ∈ ('active','trial','past_due')`,
- group size > 1,
- at least one member has `status='past_due'`.

### Discovery SQL

```sql
WITH grouped AS (
  SELECT user_id, product_id, tariff_id, COUNT(*) AS cnt,
         COUNT(*) FILTER (WHERE status='past_due') AS past_due_cnt
  FROM subscriptions_v2
  WHERE status IN ('active','trial','past_due')
  GROUP BY user_id, product_id, tariff_id
  HAVING COUNT(*) > 1
),
scope AS (SELECT * FROM grouped WHERE past_due_cnt >= 1)
SELECT s.*
FROM subscriptions_v2 s
JOIN scope USING (user_id, product_id, tariff_id)
WHERE s.status IN ('active','trial','past_due')
ORDER BY s.user_id, s.product_id, s.tariff_id, s.created_at;
```

### Frozen snapshot counts

- Groups in scope: **34**
- Subscriptions in scope: **82** (active: 30, trial: 0, past_due: 52)
- Group size distribution: size=2 → 24, size=3 → 8, size=5 → 2
- Distinct products: 3 (`11c9f1b8` Gorbova Club — 74 rows; `de36a695` — 6; `85046734` — 2)

### Past_due structural pattern

| metric | value |
|---|---|
| past_due total | 52 |
| past_due with `access_end_at IS NULL` | 52/52 |
| past_due with `extended_by_orders IS NULL` | 52/52 |
| past_due with `auto_renew=false` | 43/52 |
| past_due with `auto_renew=true` | 9/52 |
| past_due with top-level `meta.bepaid_subscription_id` present | 13/52 |

All 9 `auto_renew=true` past_due rows have `meta.bepaid_subscription_id` (`sbs_...`) — these are pre-created bePaid subscription rows from `public_link_subscription` / checkout flows where the webhook confirmation never arrived. They are **local_provider_state_stale_candidate** — cannot be resolved without a separate live provider pull (out of scope for this read-only task).

Note: the field rendered as `bepaid_sub_id=∅` in per-pair sections reflects the nested path `meta->'bepaid'->>'subscription_id'`. The actual key on these rows is top-level `meta.bepaid_subscription_id`. Both views are consistent with the 9-row classification above.

## STOP-guards — Cluster A/B re-appearance check

Canonical subscriptions from Cluster A/B (P1–P7) deliberately remain `status='active'` after H3.x-b — that is by design. Their **superseded duplicates** must NOT appear back in any `('active','trial','past_due')` row.

| Cluster A/B ID prefix | Role | Current status |
|---|---|---|
| `1a2352ab` | P1 canonical | active (in-scope as G11 sibling) — OK |
| `ac57a221` | P1 duplicate | not present in scope — OK |
| `240f45e7` | P2 canonical | active — OK |
| `bc5e6759` | P2 duplicate | not present — OK |
| `4469a81d` | P3 canonical | active (G21 sibling) — OK |
| `f7fda1d7` | P3 duplicate | not present — OK |
| `409ba350` | P4 canonical | active — OK |
| `02a0d0a8` | P4 duplicate | not present — OK |
| `4c6d24db` | P6 canonical | active — OK |
| `63fb86c0` | P6 duplicate | not present — OK |
| `56f8a606` | P5 canonical | active — OK |
| `98bc1c69` | P5 duplicate | not present — OK |
| `eba308ca` | P7 canonical | active — OK |
| `c30f04c3` | P7 duplicate | not present — OK |

**Result: no Cluster A/B duplicate re-appearance. Blocker-signal NOT raised.**

Cluster A/B canonicals **do** appear as siblings inside this past_due scope (G11: `1a2352ab`, G21: `4469a81d`). That is expected — they are healthy canonicals paired with new unrelated phantom past_due rows; their access_end_at is untouched and they are not eligible for any further action under this task.

## tariff_mismatch_pairs (backlog signal — out of scope)

Same `(user_id, product_id)` with different `tariff_id`, all members `status ∈ ('active','trial','past_due')`, at least one `past_due`. Excluded from per-pair analysis; surfaced only as backlog aggregate.

| user_id | product_id | total subs in scope | tariff_cnt | past_due_cnt |
|---|---|---|---|---|
| `05cd3754-d589-4d90-97d1-89ba2bee610b` | `11c9f1b8` | 9 | 3 | 8 |
| `0a15714f-0371-499f-84a0-1db67d1d4600` | `11c9f1b8` | 5 | 2 | 4 |
| `89a35c48-6ed9-4ccf-8f73-4690a47d510f` | `11c9f1b8` | 4 | 2 | 3 |
| `9267a27e-56e9-49ea-a6b5-3a2069840dcc` | `11c9f1b8` | 2 | 2 | 1 |

**Count: 4 users.** Reason excluded from H3.x-c per-pair classification: different `tariff_id` violates the canonical/duplicate equivalence used by `grant-access-for-order` extend logic ([memory: Extend ↔ Tariff Match Required](mem://commercial-logic/access/extend-tariff-match-required)). Needs separate read-only classification (whether user genuinely upgraded/downgraded tariffs vs. accidental dual-tariff signup).

## Stage 1 — Per-pair classification

Verdict vocabulary:
- **`safe_cleanup_candidate`** — phantom past_due (all NULL `access_end_at`/`extended_by_orders`/no bePaid), `auto_renew=false`. Canonical active sibling exists OR user has no live access on this tariff but past_due rows have no provider footprint. Safe to mark `status='abandoned_signup'` in a future H3.x-d execute round.
- **`provider_reconcile_needed`** — past_due with `auto_renew=true` and `meta.bepaid_subscription_id` set. Local state is a stale_candidate; must NOT be cleaned up until a separate read-only **live bePaid pull** confirms provider-side terminal state. This verdict authorizes ONLY a future provider read-only diagnostic, not repair/cancel/sync.
- **`manual_review`** — no active canonical AND past_due with `auto_renew=true`. Edge case; needs human decision.


### G01 — user=05cd3754-d589-4d90-97d1-89ba2bee610b
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `31f75673-a7ae-420a-b5ab-5906e34cbf84`
- total=3 active=1 past_due=2
- note: no active sibling on this tariff; superseded sibling 05800c2e/fb1c7f53 expired 2026-05-29; user has active 29d32ad4 on tariff 31f75673
- active sub:
  - `29d32ad4-0429-4472-9f58-1fd149caaf51` access_end_at=2026-08-07 22:24:19.479+00 auto_renew=f
- past_due subs:
  - `10c50c34-fbeb-417d-9a92-426ab024582f` created_at=2026-04-24 21:11:56 auto_renew=f bepaid_sub_id=∅ source=∅
  - `8a618a59-1643-48f3-852a-1f8f13a0d8bd` created_at=2026-04-26 10:36:36 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G02 — user=05cd3754-d589-4d90-97d1-89ba2bee610b
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `b276d8a5-8e5f-4876-9f99-36f818722d6c`
- total=5 active=0 past_due=5
- note: no active sibling on this tariff; superseded sibling 05800c2e/fb1c7f53 expired 2026-05-29; user has active 29d32ad4 on tariff 31f75673
- active sub:
- past_due subs:
  - `80dbdaf7-3fdf-4f6d-9241-fb5863e484aa` created_at=2026-04-14 13:44:06 auto_renew=f bepaid_sub_id=∅ source=∅
  - `a7720bea-900d-4ab4-9cb7-bb6f8e317886` created_at=2026-04-23 13:33:07 auto_renew=f bepaid_sub_id=∅ source=∅
  - `22eef922-8d21-414f-8f2b-ba29642c35a2` created_at=2026-04-23 13:34:50 auto_renew=f bepaid_sub_id=∅ source=∅
  - `2c6f3d35-068c-441a-858d-7e397caa5f67` created_at=2026-04-26 08:07:02 auto_renew=f bepaid_sub_id=∅ source=∅
  - `459fed52-59a7-4059-81ae-2fbc993b0dfe` created_at=2026-04-26 14:33:42 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: no active canonical, all past_due auto_renew=false, all NULL access/bepaid/ext

### G03 — user=05cd3754-d589-4d90-97d1-89ba2bee610b
- product_id: `de36a695-6b66-4547-bdb8-e64aa85eeabc`
- tariff_id: `56ce1995-6bf1-43dd-9211-63bc7e18d7e3`
- total=2 active=1 past_due=1
- note: no active sibling on this tariff; superseded sibling 05800c2e/fb1c7f53 expired 2026-05-29; user has active 29d32ad4 on tariff 31f75673
- active sub:
  - `28fe373e-31df-4573-8409-5dfdc28582df` access_end_at=2026-08-31 21:59:59+00 auto_renew=f
- past_due subs:
  - `00bae32c-9898-42ed-8231-d362cfb600a1` created_at=2026-04-28 15:24:38 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G04 — user=09f6350e-12da-4478-96d2-d67e247296f3
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `b276d8a5-8e5f-4876-9f99-36f818722d6c`
- total=2 active=1 past_due=1
- active sub:
  - `6afe0bbf-7383-4f9d-8f23-2293a711a435` access_end_at=2026-05-20 20:59:59+00 auto_renew=t
- past_due subs:
  - `517c30f3-6ac0-4436-a574-4c4b996b2951` created_at=2026-04-21 21:24:58 auto_renew=t bepaid_sub_id=∅ source=∅
- **verdict: `provider_reconcile_needed`**
- reason: past_due auto_renew=true with bepaid_subscription_id in meta — local stale candidate, requires live provider pull

### G05 — user=0a15714f-0371-499f-84a0-1db67d1d4600
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- total=3 active=1 past_due=2
- note: no active sibling on this tariff; user has active 884c8d9b on tariff 7c748940 (until 2026-05-23)
- active sub:
  - `884c8d9b-a430-4855-9643-09e4afbedc66` access_end_at=2026-05-23 20:59:59+00 auto_renew=t
- past_due subs:
  - `07865298-1fd4-4924-9c74-c169256b5ca8` created_at=2026-02-22 06:13:15 auto_renew=f bepaid_sub_id=∅ source=∅
  - `d0a16762-2f2f-42c7-b5d7-51677c8f0704` created_at=2026-02-22 06:16:05 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G06 — user=0a15714f-0371-499f-84a0-1db67d1d4600
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `b276d8a5-8e5f-4876-9f99-36f818722d6c`
- total=2 active=0 past_due=2
- note: no active sibling on this tariff; user has active 884c8d9b on tariff 7c748940 (until 2026-05-23)
- active sub:
- past_due subs:
  - `044ec6f6-0ccd-40b6-ae66-d3e488abe38e` created_at=2026-02-22 06:06:20 auto_renew=f bepaid_sub_id=∅ source=∅
  - `e4275cdf-d69c-421e-8313-33921818e1b5` created_at=2026-02-22 06:12:46 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: no active canonical, all past_due auto_renew=false, all NULL access/bepaid/ext

### G07 — user=13501260-add5-4970-9583-453c4ce8f0d6
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- total=3 active=1 past_due=2
- active sub:
  - `f03c8a71-dd45-4614-8c06-81a04ec81446` access_end_at=2026-06-04 12:00:00+00 auto_renew=t
- past_due subs:
  - `ba458d4c-431b-4576-8efc-ce2af853ebee` created_at=2026-04-28 10:13:14 auto_renew=f bepaid_sub_id=∅ source=∅
  - `14fc459a-7b59-4238-a07c-3f964ac9eb5f` created_at=2026-05-01 06:00:25 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G08 — user=1502c12e-bb49-4362-a6bf-2e3ed6109d29
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- total=2 active=1 past_due=1
- active sub:
  - `3234f5c3-291e-4cdc-bbcf-66282edabe0e` access_end_at=2026-05-28 12:00:00+00 auto_renew=f
- past_due subs:
  - `fb60326f-a284-4e70-8d4b-6c58d2a6c17c` created_at=2026-05-04 06:00:39 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G09 — user=1502c12e-bb49-4362-a6bf-2e3ed6109d29
- product_id: `de36a695-6b66-4547-bdb8-e64aa85eeabc`
- tariff_id: `0fb3db55-b6ba-44bf-8a0b-37bb040ab01a`
- total=2 active=1 past_due=1
- active sub:
  - `2c37061a-6679-4808-87f3-06122846e0f2` access_end_at=2026-08-31 21:59:59+00 auto_renew=f
- past_due subs:
  - `beab8ace-0fc3-4ad9-8f0e-755634d5e14d` created_at=2026-05-04 06:00:48 auto_renew=t bepaid_sub_id=∅ source=public_link_subscription
- **verdict: `provider_reconcile_needed`**
- reason: past_due auto_renew=true with bepaid_subscription_id in meta — local stale candidate, requires live provider pull

### G10 — user=192d7213-6fca-40fa-9a9d-12abaec9ab32
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `31f75673-a7ae-420a-b5ab-5906e34cbf84`
- total=2 active=1 past_due=1
- active sub:
  - `0b44857e-835d-474f-99c4-05dcf61c0f4d` access_end_at=2026-05-22 20:59:59+00 auto_renew=t
- past_due subs:
  - `823fb0c4-9b70-42e5-80ab-34fe2292490a` created_at=2026-03-23 10:33:18 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G11 — user=1b68252b-62ca-4e99-b1fd-d07706ac134d
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- total=2 active=1 past_due=1
- active sub:
  - `1a2352ab-0b12-4420-be70-af740f733fbf` access_end_at=2026-06-17 12:00:00+00 auto_renew=t
- past_due subs:
  - `d53ad2ed-73d1-4f6d-ada4-f08e047f183e` created_at=2026-05-15 10:00:10 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G12 — user=2fcd3996-29a9-4118-847c-36e61f618ca9
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- total=2 active=1 past_due=1
- active sub:
  - `37e00210-954d-4743-8c4a-a17844b5447a` access_end_at=2026-06-06 12:00:00+00 auto_renew=t
- past_due subs:
  - `f960fd92-782c-4fc0-be84-a8004afddca3` created_at=2026-05-03 06:00:30 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G13 — user=41bdb289-12d3-4ae4-94f6-8c5109ae8ee7
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- total=2 active=1 past_due=1
- active sub:
  - `9d897d4f-6e26-4bd7-a58c-4ce35e0437a0` access_end_at=2026-05-26 20:59:59+00 auto_renew=t
- past_due subs:
  - `3de11a1f-7e18-4882-8060-d14484bf9776` created_at=2026-04-25 16:43:12 auto_renew=t bepaid_sub_id=∅ source=∅
- **verdict: `provider_reconcile_needed`**
- reason: past_due auto_renew=true with bepaid_subscription_id in meta — local stale candidate, requires live provider pull

### G14 — user=5432fd69-c34b-44f7-a62d-6654fadf1956
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- total=2 active=1 past_due=1
- active sub:
  - `84f7a077-cbda-4cc4-98d2-18497c7dbfdb` access_end_at=2026-05-18 20:59:59+00 auto_renew=f
- past_due subs:
  - `6107e6b5-6661-4245-97c9-f196992e0490` created_at=2026-05-15 06:00:50 auto_renew=t bepaid_sub_id=∅ source=public_link_subscription
- **verdict: `provider_reconcile_needed`**
- reason: past_due auto_renew=true with bepaid_subscription_id in meta — local stale candidate, requires live provider pull

### G15 — user=56fb9a7c-4c9e-4018-bbc6-d52ac1a57bb6
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `b276d8a5-8e5f-4876-9f99-36f818722d6c`
- total=2 active=1 past_due=1
- active sub:
  - `95d8330b-c647-462b-814e-9fcebc159176` access_end_at=2026-06-05 12:00:00+00 auto_renew=t
- past_due subs:
  - `1187a872-03db-4a55-9146-bd28ab9c41a0` created_at=2026-05-02 06:00:21 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G16 — user=587a0856-d13c-4a89-8947-76a356227580
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- total=3 active=1 past_due=2
- active sub:
  - `d6ba02e7-5b79-42a1-be44-03631565b0ca` access_end_at=2026-05-26 20:59:59+00 auto_renew=t
- past_due subs:
  - `343455b5-2d08-41b4-b412-adf4d38ec722` created_at=2026-03-27 06:31:54 auto_renew=f bepaid_sub_id=∅ source=∅
  - `ffcc9af8-7a90-4a66-a10a-9427bf5a43ef` created_at=2026-03-27 06:37:12 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G17 — user=642345a3-9ec0-4e21-8c6d-f78f66ee38a3
- product_id: `de36a695-6b66-4547-bdb8-e64aa85eeabc`
- tariff_id: `0fb3db55-b6ba-44bf-8a0b-37bb040ab01a`
- total=2 active=1 past_due=1
- active sub:
  - `cfe5f680-ed31-4646-ba5a-741e5fc3902e` access_end_at=2026-08-31 21:59:59+00 auto_renew=f
- past_due subs:
  - `ed70daf1-b4e5-4f70-929b-50bee8fd6ff2` created_at=2026-05-04 06:01:16 auto_renew=t bepaid_sub_id=∅ source=public_link_subscription
- **verdict: `provider_reconcile_needed`**
- reason: past_due auto_renew=true with bepaid_subscription_id in meta — local stale candidate, requires live provider pull

### G18 — user=6552b327-db6c-44b2-93ec-ebbfe305f192
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `b276d8a5-8e5f-4876-9f99-36f818722d6c`
- total=2 active=1 past_due=1
- active sub:
  - `458c157c-1d0d-4ed2-abbf-85074403f553` access_end_at=2026-05-24 12:00:00+00 auto_renew=f
- past_due subs:
  - `2598dea1-71b5-460a-b0d9-ef245f7c9af5` created_at=2026-04-23 12:06:05 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G19 — user=69e504d3-703d-4562-b200-8ed20c52e7ab
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- total=2 active=1 past_due=1
- active sub:
  - `4a08ce6f-9327-498f-84e1-0c34e06d56c3` access_end_at=2026-05-17 20:59:59+00 auto_renew=t
- past_due subs:
  - `eb074bcc-6e18-4673-a18c-01f63c2dccb0` created_at=2026-04-17 13:45:47 auto_renew=t bepaid_sub_id=∅ source=∅
- **verdict: `provider_reconcile_needed`**
- reason: past_due auto_renew=true with bepaid_subscription_id in meta — local stale candidate, requires live provider pull

### G20 — user=6ae5cc6e-81f5-4920-bdf6-805eb700de12
- product_id: `85046734-2282-4ded-b0d3-8c66c8f5bc2b`
- tariff_id: `c5981337-242b-49e8-8c99-64ccf8fac13e`
- total=2 active=1 past_due=1
- active sub:
  - `a5c7b490-b587-4c71-b333-f9011cb350a6` access_end_at=2026-06-09 20:59:59+00 auto_renew=t
- past_due subs:
  - `99568894-1c47-40bb-a139-ee89a504ce94` created_at=2026-03-09 12:50:20 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G21 — user=7261e727-f6d4-4ccf-9c71-ba7ec49bcf6e
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- total=3 active=1 past_due=2
- active sub:
  - `4469a81d-2967-45a5-a7cc-4af9461b6e5e` access_end_at=2026-06-16 12:00:00+00 auto_renew=t
- past_due subs:
  - `2b797ce2-1333-4e64-9025-6958c6deda1f` created_at=2026-05-02 06:00:13 auto_renew=f bepaid_sub_id=∅ source=∅
  - `a9ce878b-b777-4b02-ad50-100742beaf50` created_at=2026-05-06 06:00:42 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G22 — user=80afcb07-3d07-40b8-aff7-c17e179e39f5
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `31f75673-a7ae-420a-b5ab-5906e34cbf84`
- total=2 active=1 past_due=1
- active sub:
  - `e4908f2f-f4c0-42bc-92d7-94ea6c3b22f1` access_end_at=2026-06-07 20:59:59+00 auto_renew=t
- past_due subs:
  - `1c2b025e-da89-4af8-8b99-8db1af6aad58` created_at=2026-05-06 10:00:06 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G23 — user=83bc38bc-2498-4760-b6fd-f0494055106c
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- total=2 active=1 past_due=1
- active sub:
  - `cc56afbe-a677-4988-8673-00d500f279d1` access_end_at=2026-05-17 20:59:59+00 auto_renew=t
- past_due subs:
  - `1703e977-64ba-44c7-a558-3980bb97aefe` created_at=2026-02-16 13:24:23 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G24 — user=84feb5b9-064b-4bfb-96ce-b3271e85e3a5
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- total=3 active=1 past_due=2
- active sub:
  - `01d7f3f9-50f1-4956-9a15-181895a1ca15` access_end_at=2026-06-03 20:59:59+00 auto_renew=t
- past_due subs:
  - `5c5e29a5-a338-4f5a-b65c-23176023499f` created_at=2026-03-05 08:00:21 auto_renew=f bepaid_sub_id=∅ source=∅
  - `0d6ab52e-cb28-45e4-b84e-6786c55e1c5e` created_at=2026-03-05 08:00:59 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G25 — user=89a35c48-6ed9-4ccf-8f73-4690a47d510f
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- total=3 active=1 past_due=2
- active sub:
  - `cb895328-6bd7-4aca-9015-69cb752b3624` access_end_at=2026-05-22 22:00:00+00 auto_renew=f
- past_due subs:
  - `39e15f02-3206-40f7-afbf-b05c9d96e9cc` created_at=2026-04-23 19:04:57 auto_renew=f bepaid_sub_id=∅ source=∅
  - `1e10acb7-3d65-46d4-a237-5a1e9ce4d947` created_at=2026-05-16 06:00:22 auto_renew=t bepaid_sub_id=∅ source=public_link_subscription
- **verdict: `provider_reconcile_needed`**
- reason: past_due auto_renew=true with bepaid_subscription_id in meta — local stale candidate, requires live provider pull

### G26 — user=9a970da3-0b7b-4d6a-bd83-a5ae71176d20
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `31f75673-a7ae-420a-b5ab-5906e34cbf84`
- total=2 active=0 past_due=2
- note: no active subscription anywhere; expired 154af3dd (2026-03-22); both past_due Feb 2026, auto_renew=false
- active sub:
- past_due subs:
  - `a5421c66-1ba7-4d44-84bb-da33530d0545` created_at=2026-02-15 16:09:33 auto_renew=f bepaid_sub_id=∅ source=∅
  - `c5c24b2f-aaa8-4edf-8098-18c58257ac13` created_at=2026-02-15 16:10:25 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: no active canonical, all past_due auto_renew=false, all NULL access/bepaid/ext

### G27 — user=a832c11e-1715-4646-bfcb-859fff931a0e
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- total=2 active=1 past_due=1
- active sub:
  - `28965857-e8ca-41ed-9c5f-87711e884716` access_end_at=2026-06-02 20:59:59+00 auto_renew=t
- past_due subs:
  - `08a7d0ba-b774-482e-849d-9fc98cdbd839` created_at=2026-04-30 11:37:02 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G28 — user=c2f16b77-b366-4e93-944b-a2793216193c
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- total=5 active=1 past_due=4
- active sub:
  - `91a49c14-85cf-4c4c-988b-988ffe6b1182` access_end_at=2026-05-23 20:59:59+00 auto_renew=t
- past_due subs:
  - `f7612756-d820-4e24-afc5-0318d4952d3a` created_at=2026-02-22 10:29:05 auto_renew=f bepaid_sub_id=∅ source=∅
  - `06bd349e-e8b8-4a8f-a729-ad2a7135bf00` created_at=2026-02-22 10:33:55 auto_renew=f bepaid_sub_id=∅ source=∅
  - `4e351f0d-8965-4503-a3dc-1bc5153923b3` created_at=2026-02-22 10:37:26 auto_renew=f bepaid_sub_id=∅ source=∅
  - `b793b852-a172-45d6-ba20-c2829819b6cb` created_at=2026-02-22 10:47:20 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G29 — user=c9e8dd78-b98d-4bf1-a275-041f60378fe9
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `b276d8a5-8e5f-4876-9f99-36f818722d6c`
- total=2 active=1 past_due=1
- active sub:
  - `2e36ba57-b38b-4f72-9a04-d98e9e3c7c49` access_end_at=2026-06-12 20:59:59+00 auto_renew=t
- past_due subs:
  - `9d214246-fa3a-413f-91af-c1365cd1b3b6` created_at=2026-05-08 08:17:15 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G30 — user=f0f0d5e1-2ddd-438e-9fae-4d15f912c2a2
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- total=2 active=1 past_due=1
- active sub:
  - `bf1380f3-0d7d-40a9-aadc-1af99b3e52fa` access_end_at=2026-06-02 20:59:59+00 auto_renew=t
- past_due subs:
  - `323aa8d6-b50d-41a1-84f1-654a35c94078` created_at=2026-04-03 18:47:09 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G31 — user=f32ff3d9-7411-49da-969a-da8451044351
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `b276d8a5-8e5f-4876-9f99-36f818722d6c`
- total=2 active=1 past_due=1
- active sub:
  - `085952d5-ef13-41c6-91e3-a49d431b5e7d` access_end_at=2026-05-29 20:59:59+00 auto_renew=t
- past_due subs:
  - `816019f4-b9eb-4f00-9d90-48c56d226224` created_at=2026-04-29 17:21:46 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G32 — user=f437c04e-6901-4be7-ba30-9397c0bcc9be
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- total=3 active=1 past_due=2
- active sub:
  - `dac29cf5-3ab3-4b8b-a889-7bcbf3139664` access_end_at=2026-07-12 12:00:00+00 auto_renew=t
- past_due subs:
  - `a29ee113-8904-440f-9e5d-562bdf5343fe` created_at=2026-05-13 04:19:49 auto_renew=f bepaid_sub_id=∅ source=∅
  - `ce23d405-f460-4664-bd61-c4e06ab1258a` created_at=2026-05-13 05:55:18 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G33 — user=f44409d7-6b34-4e88-bbe4-dd2416288c8a
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- total=2 active=1 past_due=1
- active sub:
  - `5a54f1ee-7cb1-499e-97ee-5bfdb5f2e65d` access_end_at=2026-06-04 12:00:00+00 auto_renew=f
- past_due subs:
  - `39c24966-e39e-4f50-8c00-61baaa7e593f` created_at=2026-05-01 06:00:29 auto_renew=f bepaid_sub_id=∅ source=∅
- **verdict: `safe_cleanup_candidate`**
- reason: phantom past_due (all NULL access/bepaid/ext, auto_renew=false) + active canonical sibling exists

### G34 — user=f7690c11-1e72-4c65-a525-26ddff89b28a
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id: `31f75673-a7ae-420a-b5ab-5906e34cbf84`
- total=2 active=0 past_due=2
- note: no active sibling on tariff 31f75673; has active f539f454 on tariff 56c35e86 (until 2026-05-31); past_due 2cef77ad May 2026 auto_renew=true
- active sub:
- past_due subs:
  - `1efa3527-8d05-43d2-9a54-8a70d800d478` created_at=2026-02-10 20:29:20 auto_renew=t bepaid_sub_id=∅ source=∅
  - `2cef77ad-38bd-444c-af07-204026e065bc` created_at=2026-05-11 18:31:29 auto_renew=t bepaid_sub_id=∅ source=∅
- **verdict: `manual_review`**
- reason: no active canonical + past_due with auto_renew=true


## Verdict distribution

- safe_cleanup_candidate: 26
- provider_reconcile_needed: 7
- manual_review: 1

## Stage 2 — Aggregates

### Verdict distribution (per group)

| verdict | groups | subs in scope | past_due subs covered |
|---|---|---|---|
| `safe_cleanup_candidate` | 26 | ~64 | 43 |
| `provider_reconcile_needed` | 7 | 14 | 8 (the auto_renew=true rows) |
| `manual_review` | 1 (G34) | 2 | 2 |
| **total** | **34** | **82** | **52** (past_due) |

(Subs-in-scope per verdict is approximate because some groups have >2 members; the per-pair sections above are authoritative.)

### Source distribution (past_due rows)

| source signal | count |
|---|---|
| `source: public_link_subscription` (pre-create checkout flow) | 4 (G09, G14, G17, G25 second past_due) |
| recurring snapshot with `pending_provider_managed:true` and no `source` field | 5 (G04, G13, G19, G34 ×2) |
| no `source`, no bePaid, plain abandoned signup | 43 |

### Product distribution (groups in scope)

| product_id | groups |
|---|---|
| `11c9f1b8-0355-4753-bd74-40b42aa53616` (Gorbova Club) | 30 |
| `de36a695-6b66-4547-bdb8-e64aa85eeabc` | 3 (G03, G09, G17) |
| `85046734-2282-4ded-b0d3-8c66c8f5bc2b` | 1 (G20) |

### Tariff distribution (past_due rows)

| tariff_id | past_due rows |
|---|---|
| `7c748940-dcad-4c7c-a92e-76a2344622d3` (Gorbova Club — BUSINESS) | 28 |
| `b276d8a5-8e5f-4876-9f99-36f818722d6c` (Gorbova Club — FULL) | 12 |
| `31f75673-a7ae-420a-b5ab-5906e34cbf84` (Gorbova Club — START) | 8 |
| `0fb3db55-b6ba-44bf-8a0b-37bb040ab01a` | 2 |
| `56ce1995-6bf1-43dd-9211-63bc7e18d7e3` | 1 |
| `c5981337-242b-49e8-8c99-64ccf8fac13e` | 1 |

### Backlog mapping

| backlog issue | relation to past_due cluster |
|---|---|
| `ISSUE-WEBHOOK-META-OVERWRITE` | Not the direct cause here — past_due rows are not webhook cross-pollination victims; they are abandoned-signup rows. Unrelated. |
| `ISSUE-PS-STALE-NEXT-CHARGE` | Indirect: the 7 `provider_reconcile_needed` groups exhibit the same stale-local-state pattern; live pull is the right remediation. |
| **new: `ISSUE-ABANDONED-SIGNUP-PAST-DUE`** | New backlog item — UI/checkout creates pre-payment `past_due` `subscriptions_v2` rows that are never cleaned up when payment is abandoned. 43+ rows of pure noise. Long-term fix: emit only after first successful provider charge OR sweep abandoned past_due after N hours. |
| **new: `ISSUE-TARIFF-MISMATCH-DUPLICATES`** | 4 users have parallel subscriptions for the same product on different tariffs (some past_due). Needs separate classification. |

## STOP-guards (read-only)

| # | guard | status |
|---|---|---|
| 1 | DML = 0 | ✅ |
| 2 | migrations = 0 | ✅ |
| 3 | edge function invocations = 0 | ✅ |
| 4 | provider (bePaid) API calls = 0 | ✅ |
| 5 | Telegram side effects = 0 | ✅ |
| 6 | `grant-access-for-order` not invoked | ✅ |
| 7 | `audit_logs` INSERT = 0 | ✅ |
| 8 | `mode=on` not toggled | ✅ |
| 9 | `BEPAID_REBILL_MATERIALIZATION` unchanged (`dry_run`) | ✅ |
| 10 | Cluster A/B duplicate re-appearance blocker | ✅ none |
| 11 | snapshot_at frozen and quoted | ✅ `2026-05-16 18:47:36.779067+00` |
| 12 | tariff_mismatch_pairs surfaced as aggregate only (no per-pair) | ✅ |
| 13 | provider stale claim phrased as `local_provider_state_stale_candidate`, not "provider stale" | ✅ |
| 14 | `provider_reconcile_needed` = authorizes only future read-only provider pull, not repair | ✅ |

## DoD

- [x] Stage 0 discovery & freeze with explicit `snapshot_at`.
- [x] Stage 1 per-pair classification for all 34 in-scope groups.
- [x] Stage 2 aggregates (verdicts, sources, products, tariffs, backlog mapping).
- [x] Cluster A/B exclusion confirmed; no blocker re-appearance.
- [x] tariff_mismatch_pairs surfaced as backlog signal only.
- [x] No DML, no migrations, no provider API, no Telegram, no audit INSERT.
- [x] No execute plan prepared (per user instruction).

## Next-step options (NOT executed, awaiting separate approve)

1. **H3.x-d** — execute round for 26 `safe_cleanup_candidate` groups: mark 43 phantom past_due rows as `status='abandoned_signup'` (or `superseded` with `meta.cleanup_reason='abandoned_signup_phantom'`). Same canonical-protection rules as H3.x-b (no access_end_at decrease — N/A here since past_due rows have NULL access_end_at). Requires separate approve.
2. **H3.x-c-provider-pull** — read-only live bePaid pull for the 7 `provider_reconcile_needed` groups + the G34 manual_review case (9 distinct `sbs_*`). Requires separate approve. Output: provider terminal state per `sbs_*`, no local DML.
3. **tariff_mismatch classification** — separate read-only round for the 4 backlog users.

H4 `mode=on` remains blocked.
