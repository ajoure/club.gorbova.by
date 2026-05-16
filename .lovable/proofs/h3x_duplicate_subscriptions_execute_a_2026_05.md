# H3.x-b-execute-A — Local Duplicate Subscriptions Cleanup (Stage 1: dry-run only)

Дата: 2026-05-16 (Europe/Minsk)
batch_id (зарезервирован, ещё не записан): `H3X-B-EXECUTE-A-2026-05`
Режим: **read-only / dry-run**. Production DML = 0. Migrations = 0. Provider API = 0. Telegram = 0. Edge deploy = 0.

> Это approved data-repair план для duplicate subscriptions, а не `grant-access-for-order`.
> Canonical writer `grant-access-for-order` остаётся неизменным write-path для выдачи доступа при оплате.
> Здесь же — прямые UPDATE по `subscriptions_v2` и `entitlements` (только при будущем Stage 2 approve).
> Никаких backup-таблиц (это была бы migration). Rollback генерируется per-row из before-snapshot ниже.

---

## 0. Preflight STOP-checks

| guard | expected | actual | result |
|---|---|---|---|
| Global active duplicate-пар (`status='active'`, group by `user_id, product_id`, having count>1) | 7 | **7** | OK |
| Cluster A пары присутствуют (P1, P2, P3, P4, P6) | 5 | **5** | OK |
| `subscription_status` enum содержит `superseded` | yes | **yes** | OK |
| `superseded` is `TERMINAL_STATUSES` в `subscription-conflict.ts` | yes | **yes** (line 36) | OK |
| `BEPAID_REBILL_MATERIALIZATION` менялся в этой сессии | no | **no** | OK |
| `mode=on` для H3.x | off | **off** | OK |

Запрос preflight (count=7):

```sql
WITH active AS (
  SELECT id, user_id, product_id FROM subscriptions_v2 WHERE status='active'
), pairs AS (
  SELECT user_id, product_id FROM active GROUP BY user_id, product_id HAVING count(*) > 1
)
SELECT count(*) FROM pairs;
-- → 7
```

Если перед Stage 2 повторный preflight вернёт ≠ 7 — execute не запускается.

---

## 1. Scope (фиксация ID)

In-scope (Cluster A, 5 пар). Canonical selection — по chain из H3.x-b dry-run:
provider safety (active provider on side) > `GREATEST(access_end_at)` > `paid_orders_count` > `updated_at`.

| pair | user_id | product_id | tariff_id | canonical sub_id | duplicate sub_id | rationale |
|---|---|---|---|---|---|---|
| P1 | `1b68252b-62ca-4e99-b1fd-d07706ac134d` | `11c9f1b8…` (Gorbova Club) | `7c748940…` (BUSINESS) | `1a2352ab-0b12-4420-be70-af740f733fbf` (provider_managed, sbs_6b0372d7… active) | `ac57a221-2ac2-4faf-8ccb-aab7f45c5f8a` (mit, no provider) | provider safety |
| P2 | `3c6d812a-fc6e-48a5-b6e7-957ba9c05dac` | `11c9f1b8…` | `7c748940…` | `240f45e7-0097-4045-b32e-a17062d8e731` (provider_managed, sbs_82e25a80… active) | `bc5e6759-eecf-4548-b4cc-3603efdaa1b5` (mit, no provider) | provider safety |
| P3 | `7261e727-f6d4-4ccf-9c71-ba7ec49bcf6e` | `11c9f1b8…` | `7c748940…` | `4469a81d-2967-45a5-a7cc-4af9461b6e5e` (provider_managed, sbs_2f634e38… active) | `f7fda1d7-b5a0-4ea2-aaa0-3d61a5e7301e` (mit, no provider) | provider safety (race из B-1, один order `d1080bf5…`) |
| P4 | `44985cf1-9914-4447-ada7-53f37c2456f7` | `f833c846…` (Ценный бухгалтер · Строительство) | `cbc9a3a2…` (Стандарт) | `409ba350-ee1b-4558-953d-f3c9aca725f8` (mit, no provider, first by created_at) | `02a0d0a8-732c-4b80-8f47-3d8bd2ac35c6` (mit, no provider) | admin_grant double-click (Δ=9.8s); идентичный access |
| P6 | `84b60f85-a7d4-4eaf-b31d-666c96ebf79f` | `abee24cd…` (Ценный бухгалтер · Розничная торговля) | `0f5183d8…` (Стандарт) | `4c6d24db-631a-4824-83b0-02a66447ecf1` (mit, no provider, first by created_at) | `63fb86c0-934f-4325-93a8-5bf04a61c5aa` (mit, no provider) | admin_grant double-click (Δ=14.6s); идентичный access |

Out-of-scope (не трогаются Stage 2): P5 (`6b0e0451…`), P7 (`bb724225…`) → H3.x-b-execute-B (отдельный план).

Интерпретация STOP «active provider_subscription»: блокирует supersede **duplicate** строки, у которой есть active provider. У всех 5 duplicate в Cluster A — `provider_subs IS NULL` (см. §2). Canonical с active provider не трогается на стороне provider API (только локальный `access_end_at` GREATEST). STOP не срабатывает.

---

## 2. Before-snapshot (для rollback per-row)

Запрос-источник:

```sql
SELECT id, user_id, product_id, tariff_id, status, auto_renew, billing_type,
       access_end_at, next_charge_at, created_at, updated_at, meta
FROM subscriptions_v2 WHERE id IN (
  '1a2352ab-0b12-4420-be70-af740f733fbf','ac57a221-2ac2-4faf-8ccb-aab7f45c5f8a',
  '240f45e7-0097-4045-b32e-a17062d8e731','bc5e6759-eecf-4548-b4cc-3603efdaa1b5',
  '4469a81d-2967-45a5-a7cc-4af9461b6e5e','f7fda1d7-b5a0-4ea2-aaa0-3d61a5e7301e',
  '409ba350-ee1b-4558-953d-f3c9aca725f8','02a0d0a8-732c-4b80-8f47-3d8bd2ac35c6',
  '4c6d24db-631a-4824-83b0-02a66447ecf1','63fb86c0-934f-4325-93a8-5bf04a61c5aa'
);
```

### subscriptions_v2 (10 строк)

| sub_id | role | status | auto_renew | billing_type | access_end_at (UTC) | next_charge_at (UTC) | meta.initial_order_id | meta.checkout_order_id | meta.extended_by_orders | provider_subs row |
|---|---|---|---|---|---|---|---|---|---|---|
| `1a2352ab…` | P1 canonical | active | true | provider_managed | 2026-06-15 20:59:59 | 2026-06-15 20:59:59 | — | `0d192cc8…` | — | `sbs_6b0372d78b97a5f0` state=active |
| `ac57a221…` | P1 duplicate | active | true | mit | 2026-06-17 12:00:00 | 2026-06-17 12:00:00 | `d8b4e214…` | — | `[0d192cc8…]` | — |
| `240f45e7…` | P2 canonical | active | true | provider_managed | 2026-06-15 20:59:59 | 2026-06-15 20:59:59 | — | `baf5801c…` | — | `sbs_82e25a80f41d2ee0` state=active |
| `bc5e6759…` | P2 duplicate | active | true | mit | 2026-06-19 12:00:00 | 2026-06-19 12:00:00 | `e1b26ab9…` | — | `[baf5801c…]` | — |
| `4469a81d…` | P3 canonical | active | true | provider_managed | 2026-06-15 20:59:59 | 2026-06-15 20:59:59 | — | `d1080bf5…` | — | `sbs_2f634e38e892da31` state=active |
| `f7fda1d7…` | P3 duplicate | active | true | mit | 2026-06-16 12:00:00 | 2026-06-16 12:00:00 | `d1080bf5…` | — | — | — |
| `409ba350…` | P4 canonical | active | false | mit | 2026-05-15 21:00:00 | NULL | — | — | — | — |
| `02a0d0a8…` | P4 duplicate | active | false | mit | 2026-05-15 21:00:00 | NULL | — | — | — | — |
| `4c6d24db…` | P6 canonical | active | false | mit | 2026-05-23 21:00:00 | NULL | — | — | — | — |
| `63fb86c0…` | P6 duplicate | active | false | mit | 2026-05-23 21:00:00 | NULL | — | — | — | — |

Replay full meta JSON для rollback: см. §6 (генерируется из этого snapshot перед commit).

### entitlements (релевантные — по user_id+product_id+tariff_id)

| ent_id | user | product | meta.tariff_id | status | expires_at (UTC) | order_id | meta.source_subscription_v2_id |
|---|---|---|---|---|---|---|---|
| `2452715d-d22b-4006-aee9-e4eeaab72ff8` | P1 | `11c9f1b8` | `7c748940` | active | **2026-06-17 12:00:00** | `0d192cc8…` | — |
| `55a06e2c-012f-4ab1-a45c-2ddb1539d652` | P2 | `11c9f1b8` | `7c748940` | active | **2026-06-19 12:00:00** | `baf5801c…` | — |
| `934499af-4a57-4cb9-935e-5fc82294b215` | P3 | `11c9f1b8` | `7c748940` | active | **2026-06-16 12:00:00** | `d1080bf5…` | — |
| `e0468320-d5ee-41c0-bde6-def9a3bb6390` | P4 | `f833c846` | `cbc9a3a2` | active | **2026-05-27 20:59:59** | `574d81bc…` | — |
| `4cb373cb-c043-4ccc-b2d5-68d541d59249` | P6 | `abee24cd` | `0f5183d8` | active | **2026-05-28 20:59:59** | `7855af8a…` | — |

Прочие entitlements тех же user'ов по другим продуктам/тарифам — out-of-scope для Cluster A, не модифицируются.

### orders_v2 / payments_v2 / installment_payments / access_rules

- `bepaid_subscription_id` у любого order Cluster A пар: только canonical-side rebill (P1/P2/P3), duplicate-side нет.
- `installment_payments` со `status='pending'` по этим subs: **0** (подтверждено в H3.x-b dry-run §3).
- `access_rules` структурно не имеет колонки `subscription_v2_id` → ссылок на duplicate sub нет (n/a).
- P4/P6 — 3 admin_grant orders (`final_price=0.00`) на каждого user'а; ни один не связан с конкретной sub через `meta.subscription_v2_id`. Linkage только косвенная (по `tariff_id`).
- `telegram_access` для P1-P3 user'ов: `active_until = NULL` (см. H3.x-b dry-run §3) → не модифицируется. P4 (product `f833c846`) и P6 (product `abee24cd`) — не Telegram-resource, club_id отсутствует, telegram не релевантен.

---

## 3. Dry-run table (decision matrix)

| pair | canonical_id | duplicate_id | canonical.access_before | duplicate.access_before | new_access (GREATEST) | greatest_changed | entitlement_id | ent.expires_before | ent.expires_after | ent_changed | active provider on either side | risk | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 | `1a2352ab…` | `ac57a221…` | 2026-06-15 20:59:59 | 2026-06-17 12:00:00 | **2026-06-17 12:00:00** | yes (canonical UP, +1.5d) | `2452715d…` | 2026-06-17 12:00:00 | 2026-06-17 12:00:00 | no | canonical only (live rebill, не трогаем) | low | **ready_for_execute** |
| P2 | `240f45e7…` | `bc5e6759…` | 2026-06-15 20:59:59 | 2026-06-19 12:00:00 | **2026-06-19 12:00:00** | yes (canonical UP, +3.5d) | `55a06e2c…` | 2026-06-19 12:00:00 | 2026-06-19 12:00:00 | no | canonical only | low | **ready_for_execute** |
| P3 | `4469a81d…` | `f7fda1d7…` | 2026-06-15 20:59:59 | 2026-06-16 12:00:00 | **2026-06-16 12:00:00** | yes (canonical UP, +0.6d) | `934499af…` | 2026-06-16 12:00:00 | 2026-06-16 12:00:00 | no | canonical only | low | **ready_for_execute** |
| P4 | `409ba350…` | `02a0d0a8…` | 2026-05-15 21:00:00 | 2026-05-15 21:00:00 | 2026-05-15 21:00:00 | no | `e0468320…` | 2026-05-27 20:59:59 | 2026-05-27 20:59:59 | no | none | low | **ready_for_execute** |
| P6 | `4c6d24db…` | `63fb86c0…` | 2026-05-23 21:00:00 | 2026-05-23 21:00:00 | 2026-05-23 21:00:00 | no | `4cb373cb…` | 2026-05-28 20:59:59 | 2026-05-28 20:59:59 | no | none | low | **ready_for_execute** |

Все 5 пар = `ready_for_execute`. Снижения access_end_at не происходит ни на одной паре. Entitlements уже выровнены — alignment не требуется.

---

## 4. STOP-guards re-check (per-pair)

| guard | P1 | P2 | P3 | P4 | P6 |
|---|---|---|---|---|---|
| duplicate.provider_subs active/pending | clear | clear | clear | clear | clear |
| new_access_end_at < max(before) | clear | clear | clear | clear | clear |
| entitlement.expires_at_after < expires_at_before | clear | clear | clear | clear | clear |
| orders/payments ambiguous linkage | clear (admin/rebill known) | clear | clear (race source order известен) | clear (admin_grant freebies) | clear (admin_grant freebies) |
| `provider_subscription_id` differs both non-null | n/a (duplicate=null) | n/a | n/a | n/a | n/a |
| installment_payments.status='pending' | clear (0) | clear | clear | clear | clear |
| access_rules → duplicate_id | n/a (нет колонки) | n/a | n/a | n/a | n/a |
| out-of-scope pair pulled in | no | no | no | no | no |
| global count ≠ 7 | clear (preflight) | — | — | — | — |

Все STOP — clear. Никаких manual_review.

---

## 5. Planned SQL (Stage 2 only, после отдельного approve)

Будет выполняться в `psql` транзакцией `BEGIN; … COMMIT;` с rowcount guards и `RAISE EXCEPTION` при mismatch (полный откат до COMMIT). Edge function / RPC **не используются**.

Шаблон на одну пару (P1 как пример; остальные генерируются заменой ID):

```sql
BEGIN;

-- 5.1 supersede duplicate
WITH upd AS (
  UPDATE subscriptions_v2 s
  SET status = 'superseded',
      auto_renew = false,
      meta = COALESCE(s.meta, '{}'::jsonb) || jsonb_build_object(
        'superseded_by', '1a2352ab-0b12-4420-be70-af740f733fbf'::text,
        'superseded_reason', 'h3x_b_execute_a_local_duplicate_cleanup',
        'repair_batch', 'H3X-B-EXECUTE-A-2026-05'
      ),
      updated_at = now()
  WHERE s.id = 'ac57a221-2ac2-4faf-8ccb-aab7f45c5f8a'
    AND s.status = 'active'                                  -- optimistic guard
  RETURNING 1
)
SELECT CASE WHEN (SELECT count(*) FROM upd) <> 1
            THEN raise_exception('p1_supersede_rowcount_mismatch') END;

-- 5.2 canonical merge (GREATEST + extended_by_orders union)
WITH cur AS (
  SELECT s.access_end_at, COALESCE(s.meta->'extended_by_orders','[]'::jsonb) AS eb
  FROM subscriptions_v2 s WHERE s.id = '1a2352ab-0b12-4420-be70-af740f733fbf'
),
new_eb AS (
  SELECT jsonb_agg(DISTINCT x) AS arr
  FROM (
    SELECT jsonb_array_elements_text((SELECT eb FROM cur)) AS x
    UNION
    SELECT '0d192cc8-0da7-488d-a61f-f58b6ae8330b'  -- canonical.meta.checkout_order_id
    UNION
    SELECT '0d192cc8-0da7-488d-a61f-f58b6ae8330b'  -- duplicate.meta.extended_by_orders[0]
  ) t WHERE x IS NOT NULL
),
upd AS (
  UPDATE subscriptions_v2 s
  SET access_end_at = GREATEST(s.access_end_at, TIMESTAMPTZ '2026-06-17 12:00:00+00'),
      meta = COALESCE(s.meta,'{}'::jsonb) || jsonb_build_object(
        'extended_by_orders', (SELECT arr FROM new_eb),
        'merged_from', COALESCE(s.meta->'merged_from','[]'::jsonb) || jsonb_build_array('ac57a221-2ac2-4faf-8ccb-aab7f45c5f8a'),
        'repair_batch', 'H3X-B-EXECUTE-A-2026-05'
      ),
      updated_at = now()
  WHERE s.id = '1a2352ab-0b12-4420-be70-af740f733fbf'
    AND s.status = 'active'
  RETURNING 1
)
SELECT CASE WHEN (SELECT count(*) FROM upd) <> 1
            THEN raise_exception('p1_canonical_merge_rowcount_mismatch') END;

-- 5.3 entitlement alignment: НЕ нужен для P1 (expires_at уже = new_access). UPDATE skipped.

-- 5.4 audit (две строки на P1: supersede + merge; для пар с alignment добавится третья)
INSERT INTO audit_logs (actor_type, actor_user_id, target_user_id, action, meta) VALUES
('system', NULL, '1b68252b-62ca-4e99-b1fd-d07706ac134d',
 'repair.h3x_b_a.subscription_superseded',
 jsonb_build_object('batch_id','H3X-B-EXECUTE-A-2026-05','pair','P1',
   'canonical_id','1a2352ab-0b12-4420-be70-af740f733fbf',
   'duplicate_id','ac57a221-2ac2-4faf-8ccb-aab7f45c5f8a',
   'before', /* before-snapshot duplicate as jsonb */,
   'after',  /* after row as jsonb */,
   'rule','local_supersede_no_provider')),
('system', NULL, '1b68252b-62ca-4e99-b1fd-d07706ac134d',
 'repair.h3x_b_a.subscription_merged',
 jsonb_build_object('batch_id','H3X-B-EXECUTE-A-2026-05','pair','P1',
   'canonical_id','1a2352ab-0b12-4420-be70-af740f733fbf',
   'before_access_end_at','2026-06-15 20:59:59+00',
   'after_access_end_at', '2026-06-17 12:00:00+00',
   'rule','GREATEST(canonical,duplicate) + merge extended_by_orders'));

COMMIT;
```

Используется `actor_type='system'`, `actor_user_id=NULL`. (Поле `actor_label` опционально — если колонки нет в `audit_logs`, выносится в `meta.actor_label`.)

`raise_exception()` — wrapper-функция; если её нет, заменить на `PERFORM 1/(CASE WHEN cond THEN 1 ELSE 0 END)` либо использовать DO-блок:

```sql
DO $$ BEGIN IF (SELECT count(*) FROM upd_temp) <> expected THEN
  RAISE EXCEPTION 'rowcount mismatch'; END IF; END $$;
```

Точная форма зафиксируется в Stage 2 plan-payload.

`updated_at = now()` оставляем явно для трассируемости. (Если есть BEFORE UPDATE trigger, который уже устанавливает `updated_at`, эта строка идемпотентна.)

### Generalisation per pair

| pair | duplicate_id | canonical_id | canonical access UPDATE? | extended_by_orders to union | entitlement UPDATE? |
|---|---|---|---|---|---|
| P1 | `ac57a221…` | `1a2352ab…` | yes (06-15 → 06-17) | `{0d192cc8}` ∪ canonical (∅) | no |
| P2 | `bc5e6759…` | `240f45e7…` | yes (06-15 → 06-19) | `{baf5801c}` ∪ canonical (∅) | no |
| P3 | `f7fda1d7…` | `4469a81d…` | yes (06-15 → 06-16) | `{d1080bf5}` ∪ canonical (∅) (один и тот же order — race) | no |
| P4 | `02a0d0a8…` | `409ba350…` | no (identical) | duplicate has empty, canonical empty | no |
| P6 | `63fb86c0…` | `4c6d24db…` | no (identical) | duplicate has empty, canonical empty | no |

Итого Stage 2 ожидаемый DML:
- 5 × supersede UPDATE на `subscriptions_v2` (duplicate).
- 3 × canonical merge UPDATE на `subscriptions_v2` (P1/P2/P3); 2 × canonical meta-only UPDATE (P4/P6) — добавляют только `meta.merged_from` + `meta.repair_batch` (`access_end_at` не меняется).
- 0 × `entitlements` UPDATE (все выровнены).
- 8 × `audit_logs` INSERT (`subscription_superseded` × 5 + `subscription_merged` × 3 + `subscription_meta_merged` × 2 = 10 audit rows; финальная конфигурация зафиксируется перед Stage 2).

`telegram_access`, `provider_subscriptions`, `orders_v2`, `payments_v2`, `access_rules` — **0 изменений**.

---

## 6. Rollback SQL (генерируется из before-snapshot, §2)

Без backup-таблиц. Per-row UPDATE, идемпотентный (повторное применение тех же значений безвредно).

```sql
BEGIN;

-- P1 duplicate
UPDATE subscriptions_v2
SET status='active', auto_renew=true,
    meta = '<full before-snapshot meta JSON for ac57a221>'::jsonb,
    updated_at = now()
WHERE id = 'ac57a221-2ac2-4faf-8ccb-aab7f45c5f8a';

-- P1 canonical (access_end_at + meta)
UPDATE subscriptions_v2
SET access_end_at = TIMESTAMPTZ '2026-06-15 20:59:59+00',
    meta = '<full before-snapshot meta JSON for 1a2352ab>'::jsonb,
    updated_at = now()
WHERE id = '1a2352ab-0b12-4420-be70-af740f733fbf';

-- ... аналогично для P2/P3/P4/P6 (10 UPDATE total)

-- audit (НЕ удаляем, добавляем rollback-маркер)
INSERT INTO audit_logs (actor_type, action, meta)
SELECT 'system', 'repair.h3x_b_a.rolled_back',
       jsonb_build_object('batch_id','H3X-B-EXECUTE-A-2026-05','reason','<filled at rollback time>');

COMMIT;
```

`<full before-snapshot meta JSON>` — заполняется конкретными jsonb-значениями из выборки §2 в момент Stage 2 plan-payload подготовки (сразу перед execute, чтобы snapshot был свежим).

Provider state восстанавливать не требуется — provider API не вызывался.
Entitlements не модифицировались → rollback по `entitlements` не требуется.

---

## 7. Verify (для Stage 2 после execute)

1. `duplicate.status = 'superseded'`, `auto_renew=false`, `meta.superseded_by = canonical_id`, `meta.repair_batch='H3X-B-EXECUTE-A-2026-05'` — для всех 5 duplicate.
2. `canonical.access_end_at >= MAX(before.canonical, before.duplicate)` — для всех 5.
3. `canonical.meta.extended_by_orders` ⊇ union before (P1/P2/P3); `canonical.meta.merged_from` содержит duplicate_id (все 5).
4. Релевантные entitlements: `expires_at_after = expires_at_before` (alignment не выполнялся).
5. Diff = 0 по таблицам: `telegram_access`, `provider_subscriptions`, `orders_v2`, `payments_v2`, `access_rules`.
6. audit_logs: ожидаемое количество строк по `meta->>'batch_id'='H3X-B-EXECUTE-A-2026-05'` соответствует §5.
7. Re-run preflight `count(*) FROM duplicate_pairs`: было **7** → ожидается **2** (только P5, P7 Cluster B).

---

## 8. Rowcount expectations (Stage 2)

| guard | expected |
|---|---|
| UPDATE supersede `subscriptions_v2` (per pair) | 1 |
| UPDATE canonical `subscriptions_v2` (per pair) | 1 |
| UPDATE `entitlements` | 0 (alignment не нужен) |
| INSERT `audit_logs` (per pair) | 2 (P1/P2/P3) или 2 (P4/P6: superseded + meta_merged) |
| total subscriptions_v2 UPDATE | 10 |
| total entitlements UPDATE | 0 |
| total audit_logs INSERT | 10 |

При любом mismatch на любой паре — `RAISE EXCEPTION` → откат всей транзакции пары. Каждая пара — отдельный `BEGIN/COMMIT` (5 транзакций), чтобы сбой на одной не блокировал остальные.

---

## 9. Backlog (фиксируется отдельно, не в этом плане)

- **ISSUE-AG-DOUBLECLICK** — `admin_grant` нуждается в debounce/idempotency-ключе (источник P4, P6, частично P1-P3).
- **ISSUE-WEBHOOK-META-OVERWRITE** — bepaid-webhook должен апдейтить `meta.bepaid_subscription_id` / `extended_by_orders` только по matching `provider_subscription_id`, не по (user_id, product_id) wide-match (источник P5, P7 → Cluster B).

---

## 10. DoD (Stage 1)

- [x] Preflight COUNT=7 подтверждён.
- [x] 5 пар Cluster A зафиксированы по UUID.
- [x] Before-snapshot собран по 10 subscriptions_v2 + 5 entitlements + provider_subscriptions + orders.
- [x] Dry-run table заполнен; все 5 = `ready_for_execute`.
- [x] STOP-guards re-check: все clear.
- [x] Planned SQL описан для всех 5 пар.
- [x] Rollback SQL описан per-row из before-snapshot (без backup-таблиц).
- [x] Rowcount expectations описаны.
- [x] Production DML = 0. Migrations = 0. Provider API = 0. Telegram = 0. Audit insert = 0. Edge deploy = 0.
- [x] `BEPAID_REBILL_MATERIALIZATION = dry_run` не менялся.
- [x] `mode=on` не включался.
- [x] Cluster B (P5, P7) не тронут.

---

## 11. Что НЕ сделано (намеренно)

- Stage 2 execute (UPDATE/INSERT) — **не запускался**.
- Backup-таблицы (`*_repair_backup_*`) — **не создавались** (это была бы migration).
- Audit_logs INSERT — **не выполнен** (часть Stage 2).
- `telegram_access` — **не трогался**.
- `provider_subscriptions`, `orders_v2`, `payments_v2`, `access_rules` — **не трогались**.
- Cluster B (P5, P7) — **не анализировался в этом плане**.

## 12. Команда на следующий шаг

Ждать отдельного approve **`H3.x-b-execute-A: run Stage 2`**.

При approve:
1. Повторить preflight (COUNT=7 active duplicate-пар). Если ≠ 7 — STOP, не запускать.
2. Заполнить `<full before-snapshot meta JSON>` свежими значениями из live DB.
3. Выполнить 5 транзакций (по одной на пару) в порядке P4, P6, P3, P1, P2 (от низкорискового admin_manual к provider-canonical merge).
4. Прогнать Verify §7.
5. Зафиксировать результат в этом же proof в новой секции `## 13. Execute result`.
