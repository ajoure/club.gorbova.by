# PATCH SB2 — Split-Brain Repair Dry-Run (2026-05-20)

**Режим**: READ-ONLY DRY-RUN. **DML = 0**. Execute запрещён до отдельного approve.

Связан с: `.lovable/proofs/split_brain_sb1_provider_linked_resolver_2026_05.md`,
`mem://architecture/fulfillment/provider-linked-extend-priority`.

CSV: `/mnt/documents/split_brain_sb2_repair_plan_2026_05.csv`.

## Bias и правила

- `canonical` — subv2, который реально отображается в ЛК/Admin как active, привязан к paid order, имеет максимальный валидный `access_end_at` и НЕ должен снижать доступ.
- `technical` — subv2, на которую сейчас смотрит `provider_subscriptions` (обычно pre-create past_due, в одном кейсе — terminal expired, в одном — другой active дубль).
- Repair НЕ снижает доступ, НЕ трогает entitlements, НЕ изменяет canonical.access_end_at и canonical.auto_renew, НЕ зовёт provider API, НЕ трогает Telegram/GetCourse.

## Универсальный шаблон UPDATE (для каждой пары — отдельной транзакцией)

```sql
BEGIN;

-- 1) provider_subscriptions -> canonical subv2
UPDATE provider_subscriptions
SET    subscription_v2_id = :canonical_subv2_id,
       updated_at         = now(),
       meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
         'split_brain_repair_2026_05', jsonb_build_object(
           'previous_subscription_v2_id', :technical_subv2_id,
           'repaired_at', now(),
           'batch', 'split_brain_repair_2026_05'
         )
       )
WHERE  id                = :provider_subscriptions_row_id
  AND  subscription_v2_id = :technical_subv2_id     -- guard: только если ещё указывает на technical
  AND  state              IN ('active','pending');  -- guard

-- 2) technical subv2 -> superseded
UPDATE subscriptions_v2
SET    status        = 'superseded',
       auto_renew    = false,
       cancel_reason = 'split_brain_provider_linkage_repair_2026_05',
       updated_at    = now(),
       meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
         'superseded_by',     :canonical_subv2_id,
         'superseded_reason', 'split_brain_provider_linkage_repair_2026_05',
         'superseded_at',     now(),
         'repair_batch',      'split_brain_repair_2026_05',
         'provider_subscription_id_at_repair', :bepaid_subscription_id
       )
WHERE  id     = :technical_subv2_id
  AND  status IN ('past_due','expired','active')    -- не трогаем canceled/superseded/expired_reentry
  AND  id    <> :canonical_subv2_id;

-- 3) canonical subv2 -> обогатить meta (без изменения access_end_at / auto_renew / status)
UPDATE subscriptions_v2
SET    updated_at = now(),
       meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
         'bepaid_subscription_id',  :bepaid_subscription_id,
         'provider_subscription_id', :provider_subscriptions_row_id,
         'repaired_from_subv2_id',   :technical_subv2_id,
         'repair_batch',             'split_brain_repair_2026_05'
       )
WHERE  id     = :canonical_subv2_id
  AND  status = 'active';

-- 4) Audit
INSERT INTO audit_logs(action, actor, entity_type, entity_id, payload)
VALUES ('subscription.split_brain_repaired', 'system:split_brain_repair_2026_05',
        'subscription_v2', :canonical_subv2_id,
        jsonb_build_object(
          'pair_id', :pair_id,
          'canonical_subv2_id', :canonical_subv2_id,
          'technical_subv2_id', :technical_subv2_id,
          'provider_subscriptions_id', :provider_subscriptions_row_id,
          'bepaid_subscription_id', :bepaid_subscription_id,
          'before_snapshot', :before_snapshot_jsonb,
          'after_snapshot',  :after_snapshot_jsonb,
          'batch', 'split_brain_repair_2026_05'
        ));

-- Expected affected: 3 UPDATE + 1 INSERT. Если != -> ROLLBACK.
COMMIT;
```

## Универсальный ROLLBACK

```sql
BEGIN;

UPDATE provider_subscriptions
SET    subscription_v2_id = :technical_subv2_id,
       updated_at         = now(),
       meta               = meta - 'split_brain_repair_2026_05'
WHERE  id = :provider_subscriptions_row_id;

UPDATE subscriptions_v2
SET    status        = :technical_status_before,
       auto_renew    = :technical_auto_renew_before,
       cancel_reason = NULL,
       updated_at    = now(),
       meta          = :technical_meta_before  -- из before_snapshot
WHERE  id = :technical_subv2_id;

UPDATE subscriptions_v2
SET    updated_at = now(),
       meta       = :canonical_meta_before     -- из before_snapshot
WHERE  id = :canonical_subv2_id;

INSERT INTO audit_logs(action, actor, entity_type, entity_id, payload)
VALUES ('subscription.split_brain_repair_rolled_back',
        'system:split_brain_repair_2026_05',
        'subscription_v2', :canonical_subv2_id,
        jsonb_build_object('pair_id', :pair_id, 'reason', :reason));

COMMIT;
```

## STOP-guards (проверяются перед каждым UPDATE из шаблона)

Для каждой пары перед execute:

1. `provider_subscriptions.state` обязан быть `active` или `pending` — иначе SKIP, `manual_review_conflict`.
2. canonical.user_id == technical.user_id == provider_subscriptions.user_id; одинаковые product_id/tariff_id — иначе SKIP.
3. canonical.access_end_at IS NOT NULL и canonical.access_end_at >= technical.access_end_at (NULL technical считается -inf) — иначе `manual_review_access_reduction_risk`.
4. provider_subscriptions.provider_subscription_id не должен встречаться у другой active provider_subscriptions row, привязанной к иному active subv2 у другого пользователя — иначе `manual_review_conflict`.
5. В паре `(user_id, product_id, tariff_id)` НЕ более 2 строк со `status='active' AND auto_renew=true`. Если 3+ → manual_review.
6. Affected rows на каждом UPDATE == 1 (на provider_subscriptions, technical, canonical). Иначе ROLLBACK.
7. Любая entitlement у user/product, у которой `meta->>'subscription_v2_id' = technical_subv2_id` — НЕ чиним, `manual_review_entitlement_rebind_required`. (Проверено ниже — таких 0.)

---

## Pair 1 — Belko (CRITICAL, отдельный exact before/after)

| Field | Canonical `81ba18e6` | Technical `46194979` |
|---|---|---|
| user_id | 0012a7a4-1420-486c-b95e-e6ba5907ef93 | same |
| product_id | 11c9f1b8 (Gorbova Club) | same |
| tariff | BUSINESS `7c748940` | same |
| status | `active` | `past_due` |
| auto_renew | true | true |
| access_start_at | 2026-05-20 06:06:47.35Z | 2026-05-20 06:06:47.51Z |
| access_end_at | **2026-06-20 12:00:00Z** | **NULL** |
| next_charge_at | 2026-06-20 12:00:00Z | 2026-06-19 06:10:52Z |
| meta.bepaid_subscription_id | — | `sbs_96311287f13c6391` |
| tracking_id | — | `subv2:46194979…:order:59c6eb7d…` |

**provider_subscriptions row**: `4e201ec8-6f2e-4f60-89d6-21a3f94f7e72`,
state=`active`, sbs=`sbs_96311287f13c6391`, order_id=`59c6eb7d…`, next_charge=2026-06-19 06:10:52Z, subscription_v2_id → `46194979` (technical).

**Linked paid order**: `59c6eb7d…`, paid 2026-05-20 06:06:47Z, 250 BYN, `payment_flow=renewal_subscription`.

**Entitlement**: `9f609d99…`, order_id=`59c6eb7d…` (canonical order), expires_at=2026-06-20 12:00:00Z, status=active. **Не ссылается на technical subv2**. Не трогаем.

### After (планируемое состояние)

| Field | Canonical `81ba18e6` | Technical `46194979` |
|---|---|---|
| status | `active` (unchanged) | `superseded` |
| auto_renew | true (unchanged) | false |
| access_end_at | 2026-06-20 12:00:00Z (unchanged) | NULL (unchanged) |
| cancel_reason | — | `split_brain_provider_linkage_repair_2026_05` |
| meta.bepaid_subscription_id | `sbs_96311287f13c6391` (added) | unchanged |
| meta.provider_subscription_id | `4e201ec8…` (added) | unchanged |
| meta.repaired_from_subv2_id | `46194979` (added) | unchanged |
| meta.superseded_by | — | `81ba18e6` (added) |
| meta.superseded_reason | — | `split_brain_provider_linkage_repair_2026_05` (added) |
| meta.repair_batch | `split_brain_repair_2026_05` | `split_brain_repair_2026_05` |

**provider_subscriptions `4e201ec8`**: `subscription_v2_id` → `81ba18e6` (canonical).

**Access change**: нет. Entitlement: не трогаем. **Verdict: `ready_for_execute`**.

---

## Pair 4 — DUAL ACTIVE (3328ff3b) — отдельный risk analysis

Это **единственный кейс**, где `technical` тоже `active + auto_renew=true`. Один `sbs_a6ad6a2004f4d0f8` фактически висит на двух subv2 одновременно.

| Field | Canonical `52884e7d` | Technical `f99611fc` |
|---|---|---|
| status | `active` | **`active`** |
| auto_renew | true | **true** |
| access_end_at | 2026-06-16 12:00:00Z | 2026-06-15 20:59:59Z |
| next_charge_at | 2026-06-16 12:00:00Z | 2026-06-15 20:59:59Z |
| created_at | 2026-05-16 20:04:51Z (+2m спустя) | 2026-05-16 20:02:55Z (создан bePaid pre-create) |
| meta.bepaid_subscription_id | — | `sbs_a6ad6a2004f4d0f8` |
| paid order | `46ebbc4b…` (350 BYN, provider_managed_checkout) | (тот же) |
| entitlement | `92ac71ba…`, expires=2026-06-16 12:00:00Z → совпадает с canonical | — |

### Риски и решение

1. **Двойной charge не возникает**: bePaid у sbs_a6ad6a20 один → physically один charge будет. Опасность была только в UI/учётной системе.
2. **Видимость**: ЛК/Admin показывает canonical `52884e7d` (созданный позже, без provider_subscriptions linkage); webhook писал в `f99611fc`. После repair webhook будет писать в canonical → консистентность.
3. **Access reduction**: canonical.access_end_at (2026-06-16 12:00:00Z) > technical.access_end_at (2026-06-15 20:59:59Z) на 15h. Repair НЕ снижает canonical.access_end_at. ✓
4. **Webhook GREATEST guard**: следующий charge 2026-06-15 даст active_to ~2026-07-15. `bepaid-webhook` обновит canonical через GREATEST → access_end_at только увеличится. Совместимо с `mem://architecture/subscriptions/bepaid-active-to-overshoot-guard` (tolerance 1.5×30=45 дней, не превышается).
5. **STOP-guard #5** (≤2 active+auto_renew в паре `(user,product,tariff)`): ровно 2 — OK.
6. **STOP-guard #4** (sbs не у другого active user): sbs_a6ad6a2004f4d0f8 встречается только в одной строке provider_subscriptions → OK.

**Verdict: `ready_for_execute_with_risk_notice`** — execute допустим, но в approve message явно указать DUAL ACTIVE, рекомендуется выполнить ПЕРВЫМ и сразу проверить bePaid webhook → canonical после следующего charge.

---

## Pairs 2, 3, 5 — краткий вердикт

### Pair 2 — `780e478a` (BUSINESS)
- Technical `eb3c44a4`: status=`expired` (already terminal-ish), access_end=2026-05-19, auto_renew=true.
- Canonical `6c958e24`: active, access_end=2026-06-19 12:00:00Z, entitlement совпадает.
- provider sbs_ab176c1d active, последний charge 2026-05-19 → order `d9ee69ec` создан.
- **Verdict: `ready_for_execute`**. Note: meta technical уже фактически "погашен" статусом expired; superseded — корректная финализация.

### Pair 3 — `83bc38bc` (BUSINESS)
- Technical `cc56afbe`: expired, auto_renew=**false** (уже).
- Canonical `baa4baf9`: active, access_end=2026-06-17 12:00:00Z, entitlement совпадает.
- provider sbs_8ef1ed6a active, charge 2026-05-17 → order `ed41fd5a` создан.
- **Verdict: `ready_for_execute`**. UPDATE на technical.auto_renew=false — no-op, нормально.

### Pair 5 — `5f7d22c9` (FULL)
- Technical `ca4f901f`: past_due, NULL access_end_at, sbs_216c18c5, tracking_id корректный.
- Canonical `28d7775b`: active, **access_end_at=2026-06-27 12:00:00Z** (на 8 дней дальше provider.next_charge=2026-06-19).
- Entitlement `3063ce35` order=`1a5dc67a` (paid 150 BYN, renewal_subscription), expires=2026-06-27 — совпадает с canonical.
- **Risk**: после следующего charge 2026-06-19 webhook должен использовать GREATEST() — `mem://architecture/subscriptions/bepaid-active-to-overshoot-guard`: 30 дней × 1.5 = 45 → новый active_to (~2026-07-19) − canonical.access_end_at (2026-06-27) = 22 дня < 45 → guard НЕ срабатывает, GREATEST(2026-06-27, ~2026-07-19) = ~2026-07-19. Доступ только увеличивается. ✓
- **Verdict: `ready_for_execute`**.

---

## Сводный verdict

| Pair | Verdict |
|---|---|
| 1 (Belko) | `ready_for_execute` |
| 2 (780e478a) | `ready_for_execute` |
| 3 (83bc38bc) | `ready_for_execute` |
| 4 (3328ff3b DUAL) | `ready_for_execute_with_risk_notice` |
| 5 (5f7d22c9) | `ready_for_execute` |

`manual_review_access_reduction_risk`: 0
`manual_review_conflict`: 0
`manual_review_entitlement_rebind_required`: 0 (все entitlements ссылаются на canonical order_id, ни одна не имеет `meta->>subscription_v2_id = technical_id`).

## DoD SB2 dry-run

- [x] Все 5 пар проанализированы, для каждой подготовлен exact UPDATE/rollback.
- [x] Belko расписана отдельно (before/after таблица).
- [x] DUAL ACTIVE (`52884e7d ↔ f99611fc`) выделена с отдельным risk analysis.
- [x] STOP-guards и запреты (entitlements/access_end_at/Telegram/GetCourse/provider API) учтены в шаблоне.
- [x] Rollback SQL приложен.
- [x] CSV сформирован: `/mnt/documents/split_brain_sb2_repair_plan_2026_05.csv`.
- [x] **DML = 0**. Execute не запускался.

## Следующий шаг

Ожидаю отдельный approve на execute. Рекомендуемый порядок: pair 4 (DUAL, под наблюдением), затем 1 (Belko), затем 2/3/5 батчем.
