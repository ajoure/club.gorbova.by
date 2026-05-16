# H3.x-b-execute-B — Stage 1 (read-only dry-run)

**Дата:** 2026-05-16
**Статус Stage 1:** ✅ closed (read-only, 0 DML, 0 migrations, 0 provider API, 0 telegram, 0 grant)
**Статус Stage 2:** ⏸ ожидает отдельный approve
**Batch tag (для будущего Stage 2):** `H3X-B-EXECUTE-B-2026-05`

Scope: только Cluster B (P5/P7), product `11c9f1b8-0355-4753-bd74-40b42aa53616` (Gorbova Club), tariff `7c748940-dcad-4c7c-a92e-76a2344622d3` (BUSINESS).

---

## 1. Read-only выполнено

- `subscriptions_v2` — 4 строки прочитаны (по 2 на пару).
- `provider_subscriptions` — все active/canceled записи по 4 subs.
- `entitlements` — обе записи по user_id+product_id.
- `orders_v2` — 4 связанных заказа.
- `installment_payments` — counter по subscription_id.
- `audit_logs` — последние 20 записей по обоим парам.
- `access_rules` — схема не содержит subscription-источника → ссылок на `subscription_v2_id` физически быть не может (`source` колонок нет).
- Глобальный счётчик активных duplicate-пар.

Нет ни одного UPDATE / INSERT / DELETE / migration / edge-function-invoke / provider-API-call / telegram-call.

---

## 2. Снимок состояния (before) — single source-of-truth

### Пара P5 — user `bb724225-9c79-4e87-a305-3d015bf3bbf8`

| поле | canonical | duplicate |
|---|---|---|
| subscription_v2 id | `56f8a606-c8ab-40e2-a58b-18dc29e009ce` | `98bc1c69-5fcd-4d94-a8f3-a0a6f556e0bb` |
| created_at | 2026-03-07 02:43:43+00 | 2026-04-06 11:48:43+00 |
| status | `active` | `active` |
| auto_renew | `true` | `true` |
| billing_type | `provider_managed` | `provider_managed` |
| access_end_at | **2026-06-05 20:59:59+00** | **2026-06-06 12:00:00+00** |
| next_charge_at | 2026-06-05 20:59:59+00 | 2026-06-06 12:00:00+00 |
| meta.bepaid_subscription_id | `sbs_f874f468f78734df` (реальная связь) | `sbs_f874f468f78734df` ⚠️ **загрязнено webhook overwrite** (реальная связь была `sbs_673a1877356f9556`) |
| meta.extended_by_orders | (отсутствует) | `[b0b9e34a-d59c-45dd-bbd7-28102f6f742e]` |
| provider_subscriptions row | `4b528bc8-…` → `sbs_f874f468f78734df`, **state=active**, next_charge=2026-06-05 02:43:38+00 | `7aaf77db-…` → `sbs_673a1877356f9556`, **state=canceled** (admin_cancel 2026-04-08 18:29:35+00) |
| entitlement | id `261f54e8-f43a-4986-83a1-adb8104c6cae`, expires_at **2026-06-06 12:00:00+00**, `meta.source_subscription_v2_id` = NULL | — |
| orders_v2 связанные | `b0b9e34a` (initial, paid, 250 BYN, 2026-03-06) | `0a726d24` (paid → **refunded**, 250 BYN, 2026-04-06; админ-отмена → возврат) |

### Пара P7 — user `6b0e0451-c01b-4cd9-8fc4-dd7e83fd5c65`

| поле | canonical | duplicate |
|---|---|---|
| subscription_v2 id | `eba308ca-d9f1-465d-beab-bad93b3c72a0` | `c30f04c3-3200-41f9-be09-e8bab09cad45` |
| created_at | 2026-03-09 09:27:10+00 | 2026-04-09 13:45:48+00 |
| status | `active` | `active` |
| auto_renew | `true` | `true` |
| billing_type | `provider_managed` | `provider_managed` |
| access_end_at | **2026-06-07 20:59:59+00** | **2026-06-08 12:00:00+00** |
| next_charge_at | 2026-06-07 20:59:59+00 | 2026-06-08 12:00:00+00 |
| meta.bepaid_subscription_id | `sbs_b5c5ea6a57413c72` (реальная связь) | `sbs_b5c5ea6a57413c72` ⚠️ **загрязнено webhook overwrite** (реальная связь была `sbs_0c978ba5afbef001`) |
| meta.extended_by_orders | (отсутствует) | `[6611441c-0bcf-45e7-85e6-46d11d6d5db3]` |
| provider_subscriptions row | `7bfd578e-…` → `sbs_b5c5ea6a57413c72`, **state=active**, next_charge=2026-05-08 09:27:07+00 (stale, см. backlog ISSUE-PS-STALE-NEXT-CHARGE) | `ab7cccca-…` → `sbs_0c978ba5afbef001`, **state=canceled** (admin_cancel 2026-04-10 12:54:40+00) |
| entitlement | id `b3488b00-13b0-40bb-b2a2-9f4d1c457524`, expires_at **2026-06-08 12:00:00+00**, `meta.source_subscription_v2_id` = NULL | — |
| orders_v2 связанные | `6611441c` (initial, paid, 250 BYN, 2026-03-09) | `fac49672` (**paid**, 250 BYN, 2026-04-09; провайдер отменён → возврата не было, плата получена) |

---

## 3. Планируемые дельты (Stage 2 — НЕ выполнено)

### P5

| цель | колонка/поле | before | after (план) | изменение |
|---|---|---|---|---|
| canonical `56f8a606` | `access_end_at` | 2026-06-05 20:59:59+00 | **2026-06-06 12:00:00+00** | GREATEST → +15h00m01s |
| canonical `56f8a606` | `meta.extended_by_orders` | (нет) | `[b0b9e34a-…]` | дедуп union |
| canonical `56f8a606` | `meta.merged_from` | (нет) | `[98bc1c69-…]` | append |
| canonical `56f8a606` | `meta.repair_batch` | (нет) | `H3X-B-EXECUTE-B-2026-05` | set |
| duplicate `98bc1c69` | `status` | `active` | `superseded` | terminal |
| duplicate `98bc1c69` | `auto_renew` | `true` | `false` | turn off |
| duplicate `98bc1c69` | `meta.superseded_by` | (нет) | `56f8a606-…` | set |
| duplicate `98bc1c69` | `meta.superseded_reason` | (нет) | `h3x_b_provider_managed_duplicate_no_active_provider` | set |
| duplicate `98bc1c69` | `meta.repair_batch` | (нет) | `H3X-B-EXECUTE-B-2026-05` | set |
| duplicate `98bc1c69` | `meta.original_bepaid_subscription_id` | (нет) | `sbs_673a1877356f9556` (из provider_subscriptions, для аудита) | set |
| entitlement `261f54e8` | `expires_at` | 2026-06-06 12:00:00+00 | 2026-06-06 12:00:00+00 | **no change** (GREATEST уже совпадает) |
| entitlement `261f54e8` | `meta.source_subscription_v2_id` | NULL | `56f8a606-…` | set (если значение меняется — иначе пропустить) |

### P7

| цель | колонка/поле | before | after (план) | изменение |
|---|---|---|---|---|
| canonical `eba308ca` | `access_end_at` | 2026-06-07 20:59:59+00 | **2026-06-08 12:00:00+00** | GREATEST → +15h00m01s |
| canonical `eba308ca` | `meta.extended_by_orders` | (нет) | `[6611441c-…]` | дедуп union |
| canonical `eba308ca` | `meta.merged_from` | (нет) | `[c30f04c3-…]` | append |
| canonical `eba308ca` | `meta.repair_batch` | (нет) | `H3X-B-EXECUTE-B-2026-05` | set |
| duplicate `c30f04c3` | `status` | `active` | `superseded` | terminal |
| duplicate `c30f04c3` | `auto_renew` | `true` | `false` | turn off |
| duplicate `c30f04c3` | `meta.superseded_by` | (нет) | `eba308ca-…` | set |
| duplicate `c30f04c3` | `meta.superseded_reason` | (нет) | `h3x_b_provider_managed_duplicate_no_active_provider` | set |
| duplicate `c30f04c3` | `meta.repair_batch` | (нет) | `H3X-B-EXECUTE-B-2026-05` | set |
| duplicate `c30f04c3` | `meta.original_bepaid_subscription_id` | (нет) | `sbs_0c978ba5afbef001` | set |
| entitlement `b3488b00` | `expires_at` | 2026-06-08 12:00:00+00 | 2026-06-08 12:00:00+00 | **no change** |
| entitlement `b3488b00` | `meta.source_subscription_v2_id` | NULL | `eba308ca-…` | set |

**Итого Stage 2:** 4 UPDATE в `subscriptions_v2`, 0–2 UPDATE в `entitlements` (только meta.source_subscription_v2_id), 4 INSERT в `audit_logs` (по 2 на пару, actor_type='system', repair_batch).

---

## 4. STOP-guards — проверка

| guard | P5 | P7 | вердикт |
|---|---|---|---|
| duplicate.provider_subscriptions.state ∈ ('active','pending') | ❌ canceled | ❌ canceled | ✅ pass |
| canonical.provider_subscriptions.state = 'active' | ✅ active | ✅ active | ✅ pass |
| new_canonical.access_end_at < canonical (before) | 06-06 > 06-05 | 06-08 > 06-07 | ✅ pass (только UP) |
| new_entitlement.expires_at < ent.expires_at (before) | 06-06 = 06-06 | 06-08 = 06-08 | ✅ pass |
| installment_payments.status='pending' на duplicate | 0 | 0 | ✅ pass |
| access_rules с subscription-источником | таблица не содержит subscription-ref колонок | — | ✅ pass |
| orders_v2 в статусе pending/processing на duplicate | 0a726d24 = `refunded` (terminal) | fac49672 = `paid` (terminal) | ✅ pass |
| global active(='active', auto_renew=true) duplicate count = 2 | 2 | — | ✅ pass |
| user_id / product_id / tariff_id одинаковы внутри пары | ✅ | ✅ | ✅ pass |
| sub.id ∈ whitelisted 4 UUID | ✅ | ✅ | ✅ pass |

**Дополнительный observability-флаг (не блокирует):**

- Глобальный счётчик с расширенным фильтром `status IN ('active','trial','past_due')` = **6** пар (2 active+active + 4 past_due+other). 4 past_due-пары были вне scope изначально (H3.x-b2 классификация работала по `status='active'`) и остаются вне scope этого плана. Канонический счётчик для H3.x-b остаётся = 2.

**Вердикт по парам:**

| пара | verdict |
|---|---|
| P5 (56f8a606 ↔ 98bc1c69) | ✅ **ready_for_execute** |
| P7 (eba308ca ↔ c30f04c3) | ✅ **ready_for_execute** |

---

## 5. Rollback SQL (из before-snapshot, без backup-таблиц)

Идемпотентно. Каждая команда возвращает в точности 1 строку. Если rowcount ≠ 1 → ROLLBACK всей транзакции.

```sql
-- ============ P5 rollback ============
-- canonical 56f8a606 — вернуть access_end_at и почистить repair-меты
UPDATE subscriptions_v2
SET access_end_at = '2026-06-05 20:59:59+00'::timestamptz,
    meta = (meta
            - 'extended_by_orders'      -- было: отсутствует
            - 'merged_from'
            - 'repair_batch')
WHERE id = '56f8a606-c8ab-40e2-a58b-18dc29e009ce'
  AND (meta->>'repair_batch') = 'H3X-B-EXECUTE-B-2026-05';

-- duplicate 98bc1c69 — вернуть active/auto_renew и почистить
UPDATE subscriptions_v2
SET status = 'active',
    auto_renew = true,
    meta = (meta
            - 'superseded_by'
            - 'superseded_reason'
            - 'repair_batch'
            - 'original_bepaid_subscription_id')
WHERE id = '98bc1c69-5fcd-4d94-a8f3-a0a6f556e0bb'
  AND (meta->>'repair_batch') = 'H3X-B-EXECUTE-B-2026-05'
  AND status = 'superseded';

-- entitlement 261f54e8 — откатить source_subscription_v2_id если ставили
UPDATE entitlements
SET meta = (meta - 'source_subscription_v2_id')
WHERE id = '261f54e8-f43a-4986-83a1-adb8104c6cae'
  AND meta->>'source_subscription_v2_id' = '56f8a606-c8ab-40e2-a58b-18dc29e009ce';

-- ============ P7 rollback ============
UPDATE subscriptions_v2
SET access_end_at = '2026-06-07 20:59:59+00'::timestamptz,
    meta = (meta
            - 'extended_by_orders'
            - 'merged_from'
            - 'repair_batch')
WHERE id = 'eba308ca-d9f1-465d-beab-bad93b3c72a0'
  AND (meta->>'repair_batch') = 'H3X-B-EXECUTE-B-2026-05';

UPDATE subscriptions_v2
SET status = 'active',
    auto_renew = true,
    meta = (meta
            - 'superseded_by'
            - 'superseded_reason'
            - 'repair_batch'
            - 'original_bepaid_subscription_id')
WHERE id = 'c30f04c3-3200-41f9-be09-e8bab09cad45'
  AND (meta->>'repair_batch') = 'H3X-B-EXECUTE-B-2026-05'
  AND status = 'superseded';

UPDATE entitlements
SET meta = (meta - 'source_subscription_v2_id')
WHERE id = 'b3488b00-13b0-40bb-b2a2-9f4d1c457524'
  AND meta->>'source_subscription_v2_id' = 'eba308ca-d9f1-465d-beab-bad93b3c72a0';

-- audit-маркер отката (отдельный INSERT, не часть rollback per se)
INSERT INTO audit_logs (actor_type, action, meta)
VALUES ('system', 'h3x_b_execute_b.rollback',
        jsonb_build_object('batch','H3X-B-EXECUTE-B-2026-05','reason','manual_rollback'));
```

---

## 6. Ожидаемый Stage 2 plan (без backup-таблиц)

Структурно идентичен Cluster A run Stage 2, **без** создания backup-таблиц. Снимок состояния хранится в этом proof + в каждом audit_logs.meta (`before` JSON-блок).

Псевдо-DML для одной пары (P5; для P7 — симметрично):

```sql
BEGIN;

-- ===== canonical UPDATE =====
WITH upd AS (
  UPDATE subscriptions_v2 s
  SET access_end_at = GREATEST(s.access_end_at, '2026-06-06 12:00:00+00'::timestamptz),
      meta = s.meta
        || jsonb_build_object(
             'extended_by_orders',
               COALESCE(s.meta->'extended_by_orders','[]'::jsonb)
                 || to_jsonb(ARRAY['b0b9e34a-d59c-45dd-bbd7-28102f6f742e']::text[]),
             'merged_from',
               COALESCE(s.meta->'merged_from','[]'::jsonb)
                 || to_jsonb(ARRAY['98bc1c69-5fcd-4d94-a8f3-a0a6f556e0bb']::text[]),
             'repair_batch','H3X-B-EXECUTE-B-2026-05'
           )
  WHERE s.id = '56f8a606-c8ab-40e2-a58b-18dc29e009ce'
    AND s.status = 'active'
    AND s.user_id = 'bb724225-9c79-4e87-a305-3d015bf3bbf8'
  RETURNING 1
)
SELECT CASE WHEN (SELECT COUNT(*) FROM upd) <> 1 THEN
  (SELECT 1/0) END;  -- rowcount guard

-- ===== duplicate UPDATE =====
WITH upd AS (
  UPDATE subscriptions_v2 s
  SET status = 'superseded',
      auto_renew = false,
      meta = s.meta || jsonb_build_object(
        'superseded_by','56f8a606-c8ab-40e2-a58b-18dc29e009ce',
        'superseded_reason','h3x_b_provider_managed_duplicate_no_active_provider',
        'repair_batch','H3X-B-EXECUTE-B-2026-05',
        'original_bepaid_subscription_id','sbs_673a1877356f9556'
      )
  WHERE s.id = '98bc1c69-5fcd-4d94-a8f3-a0a6f556e0bb'
    AND s.status = 'active'
    AND s.auto_renew = true
    AND s.user_id = 'bb724225-9c79-4e87-a305-3d015bf3bbf8'
  RETURNING 1
)
SELECT CASE WHEN (SELECT COUNT(*) FROM upd) <> 1 THEN (SELECT 1/0) END;

-- ===== audit logs =====
INSERT INTO audit_logs (actor_type, action, meta) VALUES
('system','subscription.canonical_extended',
  jsonb_build_object(
    'batch','H3X-B-EXECUTE-B-2026-05',
    'pair','P5',
    'subscription_v2_id','56f8a606-c8ab-40e2-a58b-18dc29e009ce',
    'before',jsonb_build_object('access_end_at','2026-06-05 20:59:59+00'),
    'after', jsonb_build_object('access_end_at','2026-06-06 12:00:00+00'),
    'merged_from','98bc1c69-5fcd-4d94-a8f3-a0a6f556e0bb'
  )),
('system','subscription.superseded',
  jsonb_build_object(
    'batch','H3X-B-EXECUTE-B-2026-05',
    'pair','P5',
    'subscription_v2_id','98bc1c69-5fcd-4d94-a8f3-a0a6f556e0bb',
    'before',jsonb_build_object('status','active','auto_renew',true,
                                'access_end_at','2026-06-06 12:00:00+00'),
    'after', jsonb_build_object('status','superseded','auto_renew',false),
    'superseded_by','56f8a606-c8ab-40e2-a58b-18dc29e009ce',
    'reason','h3x_b_provider_managed_duplicate_no_active_provider',
    'original_bepaid_subscription_id','sbs_673a1877356f9556'
  ));

COMMIT;
```

`entitlements.meta.source_subscription_v2_id` ставится отдельным условным UPDATE только если значение реально меняется (current IS DISTINCT FROM canonical_id). При совпадении — skip. Поле `expires_at` Stage 2 не трогает (текущее уже совпадает с `new_canonical.access_end_at`; если в момент Stage 2 окажется ниже — UPDATE через GREATEST, никогда не вниз).

Stage 2 **НЕ** включает: backup-таблицы, provider API, telegram, grant-access-for-order, изменения `orders_v2/payments_v2/provider_subscriptions/access_rules`, migrations, mode=on toggle.

---

## 7. DoD Stage 1 — итог

- [x] Production DML = 0
- [x] Migrations = 0
- [x] Backup tables created = 0
- [x] Provider API calls = 0
- [x] Telegram calls = 0
- [x] grant-access-for-order calls = 0
- [x] Edge function invocations = 0
- [x] Secrets changed = 0
- [x] BEPAID_REBILL_MATERIALIZATION = `dry_run` (не менялся)
- [x] mode=on disabled
- [x] Global active(='active') duplicate pairs пересчитан = 2 (только P5/P7)
- [x] Cluster A (P1–P4, P6) не упомянуты в планируемом DML и не затронуты
- [x] Полная snapshot-таблица по обоим парам
- [x] Все 10 STOP-guards отработаны
- [x] Vердикт по каждой паре: ready_for_execute
- [x] Rollback SQL приведён
- [x] Expected Stage 2 plan приведён (без backup-таблиц, с `meta.source_subscription_v2_id`)

---

## 8. Что дальше

- **Stage 2 (отдельный approve):** перевести P5/P7 duplicates в superseded + GREATEST canonical, согласно Section 3 и Section 6. Без backup-таблиц.
- **Не часть этого плана (backlog):**
  - `ISSUE-WEBHOOK-META-OVERWRITE` — webhook пишет `meta.bepaid_subscription_id` по слишком широкому match (user+product), вызывая cross-pollination внутри пары. Подтверждено на обоих pair (meta.bepaid_subscription_id дубликата = id канонической provider sub).
  - `ISSUE-PS-STALE-NEXT-CHARGE` — `provider_subscriptions` для canonical `eba308ca` имеет `next_charge_at=2026-05-08`, что не соответствует subscriptions_v2 (2026-06-07). Требуется таргетированный read-only pull через `bepaid-get-subscription-details` (отдельный approve).
  - `ISSUE-AG-DOUBLECLICK` — из Cluster A, остаётся открытым.
  - Past_due-кластер (4 пары) — отдельная классификация вне H3.x-b scope.

**Текущий статус:**

```
H3.x-b-execute-A       — closed
H3.x-b-execute-B / S1  — closed (этот файл)
H3.x-b-execute-B / S2  — ожидает отдельный approve
Active(='active') duplicate pairs — 2
H4 mode=on              — still blocked
```
