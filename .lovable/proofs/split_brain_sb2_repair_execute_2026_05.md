# PATCH SB2 — Split-Brain Repair EXECUTE (2026-05-20)

Approve: dry-run `.lovable/proofs/split_brain_sb2_repair_dryrun_2026_05.md` + `/mnt/documents/split_brain_sb2_repair_plan_2026_05.csv`.
Execute порядок: pair 4 (DUAL) → verify → pair 1 (Belko) → verify → pairs 2/3/5.

## Результат

Все 5 пар закрыты. Affected rows на каждой паре = 3 UPDATE + 1 INSERT (audit). Rollback не понадобился.

| Pair | ps_relinked | canon.status | canon.access_end_at unchanged | canon.auto_renew | tech.status | tech.auto_renew | tech.superseded_by=canon | active_auto_renew (user,product,tariff) | audit |
|---|---|---|---|---|---|---|---|---|---|
| 1 belko `81ba18e6↔46194979` | ✓ | active | ✓ 2026-06-20 12:00:00Z | true | superseded | false | ✓ | 1 | ✓ |
| 2 780e478a `6c958e24↔eb3c44a4` | ✓ | active | ✓ 2026-06-19 12:00:00Z | true | superseded | false | ✓ | 1 | ✓ |
| 3 83bc38bc `baa4baf9↔cc56afbe` | ✓ | active | ✓ 2026-06-17 12:00:00Z | true | superseded | false | ✓ | 1 | ✓ |
| 4 3328ff3b DUAL `52884e7d↔f99611fc` | ✓ | active | ✓ 2026-06-16 12:00:00Z | true | superseded | false | ✓ | **1 (было 2)** | ✓ |
| 5 5f7d22c9 `28d7775b↔ca4f901f` | ✓ | active | ✓ 2026-06-27 12:00:00Z | true | superseded | false | ✓ | 1 | ✓ |

### Entitlements — без изменений

| user_id | ent_count | expires_at |
|---|---|---|
| 0012a7a4 (Belko) | 1 | 2026-06-20 12:00:00Z |
| 3328ff3b | 1 | 2026-06-16 12:00:00Z |
| 5f7d22c9 | 1 | 2026-06-27 12:00:00Z |
| 780e478a | 1 | 2026-06-19 12:00:00Z |
| 83bc38bc | 1 | 2026-06-17 12:00:00Z |

Все значения совпадают с before-snapshot. Никакой entitlement не трогался руками.

### Order execute

1. **Pair 4** (DUAL ACTIVE) — отдельная транзакция, verify PASS:
   - `active_ar_count`: 2 → **1**
   - `provider_subscriptions.ea2eea93` → canonical `52884e7d`
   - technical `f99611fc` → superseded/auto_renew=false
2. **Pair 1 Belko** — verify PASS.
3. **Pairs 2/3/5** — каждая отдельной транзакцией, verify PASS батчем.

### Pair 1 (Belko) — exact after snapshot

| Field | Canonical `81ba18e6` | Technical `46194979` |
|---|---|---|
| status | active (unchanged) | **superseded** |
| auto_renew | true (unchanged) | **false** |
| access_end_at | 2026-06-20 12:00:00Z (unchanged) | NULL (unchanged) |
| cancel_reason | — | `split_brain_provider_linkage_repair_2026_05` |
| meta.bepaid_subscription_id | **`sbs_96311287f13c6391`** | unchanged |
| meta.provider_subscription_id | **`4e201ec8-…`** | unchanged |
| meta.repaired_from_subv2_id | **`46194979-…`** | — |
| meta.superseded_by | — | **`81ba18e6-…`** |
| meta.superseded_reason | — | `split_brain_provider_linkage_repair_2026_05` |
| meta.repair_batch | `split_brain_repair_2026_05` | `split_brain_repair_2026_05` |

`provider_subscriptions.4e201ec8.subscription_v2_id` = `81ba18e6` ✓. Belko видит одну active provider-linked подписку.

### Pair 4 DUAL ACTIVE — устранён

Перед execute: 2 active+auto_renew подписки `(3328ff3b, 11c9f1b8, b018e9be)`. После — ровно 1 (`52884e7d`). `provider_subscriptions.ea2eea93` (`sbs_a6ad6a2004f4d0f8`) указывает на `52884e7d`. Технический `f99611fc` superseded, auto_renew=false. Следующий charge bePaid (2026-06-15) попадёт в canonical через GREATEST в bepaid-webhook.

### Audit

Все 5 записей зафиксированы:

```
SELECT meta->>'pair_id', created_at
FROM audit_logs
WHERE action='subscription.split_brain_repaired'
  AND meta->>'batch'='split_brain_repair_2026_05';
```

→ `1_belko`, `2_780e478a`, `3_83bc38bc`, `4_3328ff3b_DUAL_ACTIVE`, `5_5f7d22c9`.

## Hard guards — все соблюдены

- ✅ Каждая пара — отдельной транзакцией (5 separate DML calls).
- ✅ Все WHERE содержали строгие guard-условия (id + предыдущее значение state/status/auto_renew). Affected rows на каждом UPDATE = 1 (иначе audit INSERT не выполнился бы из-за WHERE ps_n=1 AND tech_n=1 AND can_n=1).
- ✅ canonical.access_end_at не менялся ни в одной паре.
- ✅ entitlements не трогались, count и expires_at идентичны before-snapshot.
- ✅ После репейра ровно 1 active+auto_renew по каждой паре `(user, product, tariff)`.
- ✅ provider API не вызывался.
- ✅ Telegram не трогался.
- ✅ GetCourse не трогался.
- ✅ zombie past_due вне 5 пар не трогались.

## Rollback (если понадобится ретроактивно)

Шаблон есть в `.lovable/proofs/split_brain_sb2_repair_dryrun_2026_05.md` (раздел «Универсальный ROLLBACK»). Параметры для каждой пары:

| pair | ps_id | canonical_id | technical_id | tech_status_before | tech_auto_renew_before |
|---|---|---|---|---|---|
| 1 | 4e201ec8-6f2e-4f60-89d6-21a3f94f7e72 | 81ba18e6-… | 46194979-… | past_due | true |
| 2 | 1d49b92c-10cd-433e-b653-a4bfaf2c4621 | 6c958e24-… | eb3c44a4-… | expired | true |
| 3 | 35dec14e-c6a5-4617-a681-029506b823bc | baa4baf9-… | cc56afbe-… | expired | false |
| 4 | ea2eea93-a208-44a4-9633-7b096e39feac | 52884e7d-… | f99611fc-… | active | true |
| 5 | 74934fae-ee73-47d1-85ea-20f253e08c92 | 28d7775b-… | ca4f901f-… | past_due | true |

Полные before-snapshot meta-объекты доступны через `audit_logs.meta->'before_snapshot'` (dry-run capture) и `subscriptions_v2.meta->'split_brain_repair_2026_05'` (added markers могут быть удалены через `meta - 'repair_batch' - 'superseded_by' - …`).

## DoD

- [x] Все 5 пар закрыты.
- [x] `provider_subscriptions.subscription_v2_id` указывает на canonical active subscription.
- [x] Technical подписки superseded + auto_renew=false + superseded_by/reason/batch в meta.
- [x] Canonical подписки получили `bepaid_subscription_id`, `provider_subscription_id`, `repaired_from_subv2_id`, `repair_batch` в meta. `status/access_end_at/auto_renew` не изменены.
- [x] Entitlements count/expiry не изменились.
- [x] Belko показывает одну активную provider-linked подписку.
- [x] DUAL ACTIVE (pair 4) устранён: 2 → 1 active+auto_renew.
- [x] Rollback не понадобился; шаблон + параметры приложены на случай ретроактивной необходимости.
- [x] Все 5 audit-записей `subscription.split_brain_repaired` зафиксированы с batch=`split_brain_repair_2026_05`.

**PATCH SB1 + SB2 — CLOSED.**
