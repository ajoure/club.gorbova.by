# H3.x-c-provider-pull — read-only live bePaid status check

**Status:** closed (read-only diagnostic only)
**Pulled at:** `2026-05-16T18:57:52.090Z` (UTC)
**Source proof:** [`h3x_past_due_duplicate_subscriptions_classification_2026_05.md`](./h3x_past_due_duplicate_subscriptions_classification_2026_05.md)
**Tool used:** new edge function `bepaid-readonly-pull` (strictly read-only — no writes to `subscriptions_v2` / `provider_subscriptions` / `audit_logs` / Telegram; only GET to `https://api.bepaid.by/subscriptions/{sbs}`).

## Constraints honored

| guard | status |
|---|---|
| DML in `subscriptions_v2` | ✅ 0 |
| DML in `provider_subscriptions` | ✅ 0 |
| `audit_logs` INSERT | ✅ 0 (new edge function does not write audit) |
| Telegram side effects | ✅ 0 |
| `grant-access-for-order` invoked | ✅ 0 |
| `cancel-subscription` / sync / repair | ✅ 0 |
| migrations | ✅ 0 |
| `BEPAID_REBILL_MATERIALIZATION` changed | ✅ no (`dry_run`) |
| `mode=on` toggled | ✅ no |
| Existing `bepaid-get-subscription-details` invoked | ✅ no (would do autolink writes — avoided) |

## Scope (9 `sbs_*` IDs from H3.x-c per-pair Stage 1)

7 `provider_reconcile_needed` groups + 1 `manual_review` group (G34, two `sbs_*`).

| # | group | subv2_id | sbs_* |
|---|---|---|---|
| 1 | G04 | `517c30f3` | `sbs_c6e68d772064a5fe` |
| 2 | G09 | `beab8ace` | `sbs_686219e109cfccc1` |
| 3 | G13 | `3de11a1f` | `sbs_4cb14472e800f524` |
| 4 | G14 | `6107e6b5` | `sbs_23f8e27141ac2ebc` |
| 5 | G17 | `ed70daf1` | `sbs_8b65f96cbba62f0c` |
| 6 | G19 | `eb074bcc` | `sbs_b167a6fc7b17b93a` |
| 7 | G25 | `1e10acb7` | `sbs_50a3bd75a025455b` |
| 8 | G34a | `1efa3527` | `sbs_4f13f25943f4ccd6` |
| 9 | G34b | `2cef77ad` | `sbs_92b38efdebaeb110` |

## Per-sbs results (raw provider truth)

| # | sbs_* | http | state (normalized) | active_to | renew_at | last_payment | provider_created_at | verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | `sbs_c6e68d772064a5fe` | 200 | **`expired`** | null | null | null | 2026-04-21 21:24:58Z | `provider_expired` |
| 2 | `sbs_686219e109cfccc1` | 200 | **`expired`** | null | null | null | 2026-05-04 06:00:48Z | `provider_expired` |
| 3 | `sbs_4cb14472e800f524` | 200 | **`expired`** | null | null | null | 2026-04-25 16:43:12Z | `provider_expired` |
| 4 | `sbs_23f8e27141ac2ebc` | 200 | **`expired`** | null | null | null | 2026-05-15 06:00:50Z | `provider_expired` |
| 5 | `sbs_8b65f96cbba62f0c` | 200 | **`expired`** | null | null | null | 2026-05-04 06:01:16Z | `provider_expired` |
| 6 | `sbs_b167a6fc7b17b93a` | 200 | **`expired`** | null | null | null | 2026-04-17 13:45:47Z | `provider_expired` |
| 7 | `sbs_50a3bd75a025455b` | 200 | **`redirecting`** | null | null | null | 2026-05-16 06:00:22Z | `provider_redirecting_grace` |
| 8 | `sbs_4f13f25943f4ccd6` | 200 | **`expired`** | null | null | null | 2026-02-10 20:29:21Z | `provider_expired` |
| 9 | `sbs_92b38efdebaeb110` | 200 | **`expired`** | null | null | null | 2026-05-11 18:31:30Z | `provider_expired` |

All 9 `tracking_id` values match the expected `subv2:{local_sub_id}:order:{order_uuid}` pattern. No autolink ambiguity.

## Aggregate

| verdict | count | what it means |
|---|---|---|
| `provider_expired` | **8 / 9** | bePaid subscription is terminal. No active_to, no renew_at, no last_payment — provider charged nothing and the subscription was already aged out by bePaid. Safe for local cleanup. |
| `provider_redirecting_grace` | **1 / 9** | `sbs_50a3bd75a025455b` (G25, user `89a35c48`) — created today at 2026-05-16 06:00 (~13h before pull). Still inside the **48h grace window** per [INV-22 Desync Resolution](mem://commercial-logic/subscriptions/inv22-desync-resolution) memory. MUST NOT be cleaned up until 2026-05-18 06:00 UTC. |
| `provider_active` | 0 | — |
| `provider_canceled` (explicit) | 0 | — bePaid surfaces these as `expired` rather than distinct `canceled` for never-paid auto-expiry. |
| `provider_not_found` | 0 | — all 9 returned 200 |
| `provider_error` / `manual_review` | 0 | — no API errors |

## Cross-check vs H3.x-c per-pair classification

| H3.x-c verdict | H3.x-c-provider-pull resolution |
|---|---|
| `provider_reconcile_needed` ×7 | 7/7 confirmed `provider_expired` (G04, G09, G13, G14, G17, G19 confirmed; G25 → `provider_redirecting_grace`) |
| `manual_review` ×1 (G34) | both sbs_* expired (`sbs_4f13f25943f4ccd6` Feb 2026; `sbs_92b38efdebaeb110` May 2026). G34 promotes to `safe_cleanup_candidate` for local cleanup after grace check. |

Note on G25 reclassification: it was originally `provider_reconcile_needed`. Pull shows `redirecting`, not `expired` — must remain on hold until 2026-05-18 06:00 UTC.

## Recommended next-step bucketing for H3.x-d (not executed here)

| bucket | groups | sbs_* count | recommended local action |
|---|---|---|---|
| `local_cancel_provider_dead` | G04, G09, G13, G14, G17, G19, G34a, G34b | 8 | Per INV-22 SOT: local `subscriptions_v2` update → `status='canceled'`, `auto_renew=false`, `meta.cancel_reason='inv22_provider_dead_local_active_pastdue'`. Access NOT revoked (access_end_at is NULL anyway). Audit `inv22.local_terminate_after_provider_dead`. |
| `hold_redirecting_grace_48h` | G25 | 1 | Do nothing until 2026-05-18 06:00 UTC. Repeat read-only pull after grace. |

This bucketing is **proposed only**; execution requires a separate approve (H3.x-d plan).

## Open backlog (unchanged)

- `ISSUE-WEBHOOK-META-OVERWRITE` — unrelated to this cluster.
- `ISSUE-PS-STALE-NEXT-CHARGE` — confirmed same root pattern (provider expired, local row stuck past_due with auto_renew=true).
- `ISSUE-ABANDONED-SIGNUP-PAST-DUE` — root cause for the 43 `safe_cleanup_candidate` past_due rows; these 8 provider-expired rows are the auto-renew=true variant of the same abandoned-signup pathology.

## DoD

- [x] All 9 sbs_* pulled live from bePaid.
- [x] No DML, no migrations, no Telegram, no grant, no cancel/sync/repair.
- [x] Verdict assigned per `provider_active|expired|canceled|not_found|error|redirecting_grace|manual_review`.
- [x] Cross-checked against H3.x-c per-pair verdicts.
- [x] H3.x-d execute plan NOT prepared (per user instruction).

## Status board

- H3.x-b execute-A — closed
- H3.x-b execute-B — closed
- Active duplicate pairs — 0
- H3.x-c past_due classification — closed
- **H3.x-c-provider-pull — closed (this proof)**
- H3.x-d abandoned-signup cleanup — next (8 ready, 1 on 48h grace until 2026-05-18 06:00 UTC)
- H4 `mode=on` — still blocked
