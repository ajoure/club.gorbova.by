# Recurring Repair — Execute (минимальный scope, вариант A)

Дата: 2026-05-04 (Europe/Minsk)
batch_id: `recurring_repair_2026_05_20260504_140202`

Patch lineage: `patch-12.1-stale-local-recovery`, `patch-12.2-skip-stale-guard`
Источник: `.lovable/proofs/recurring_repair_2026_05_dryrun_A.md`

---

## Scope

5 пользователей × 3 сущности = **15 UPDATE**.

| # | name | sub_id | ent_id | tg_id | club_id | source_order | source_payment | target (EOD Minsk) |
|---|---|---|---|---|---|---|---|---|
| 1 | Екатерина Королёва | 9f67beb4… | 7c8bc1a3… | a7202186… | fa547c41… | 23657631… | eb548686… | 2026-06-03 20:59:59+00 |
| 2 | Шидловская Ольга | b72233dd… | 80361311… | 1f061a65… | fa547c41… | 6d9b7bdb… | b6322606… | 2026-06-03 20:59:59+00 |
| 3 | Татьяна Чистякова | be5dca0d… | eb4e0ff6… | 798592a1… | fa547c41… | 3c0bc1e1… | a3737a29… | 2026-06-02 20:59:59+00 |
| 4 | Ангелина Залевская | 4616c3ed… | d3c3e069… | 1faa5a46… | fa547c41… | 9b1ffb49… | 58d1d641… | 2026-05-31 20:59:59+00 |
| 5 | Марина Киреева | 9cff47a2… | c8457528… | 36365883… | fa547c41… | 849198d4… | b358d540… | 2026-05-30 20:59:59+00 |

---

## Rowcount guards (все совпали → транзакция закоммичена)

| guard | expected | actual |
|---|---|---|
| backup subscriptions | 5 | **5** |
| backup entitlements | 5 | **5** |
| backup telegram_access | 5 | **5** |
| update subscriptions | 5 | **5** |
| update entitlements | 5 | **5** |
| update telegram_access | 5 | **5** |
| audit rows | 15 | **15** |
| distinct actions | 3 | **3** |

Любой mismatch → `RAISE EXCEPTION` → полный откат транзакции (ни одна строка не залилась бы).

---

## Verify (прямые SELECT после Execute)

| name | sub.status | sub.access_end_at | sub_ok | ent.status | ent.expires_at | ent_ok | tg.active_until | state_chat | state_channel | tg_ok |
|---|---|---|---|---|---|---|---|---|---|---|
| Екатерина Королёва | active | 2026-06-03 20:59:59 | ✅ | active | 2026-06-03 20:59:59 | ✅ | 2026-06-03 20:59:59 | pending | pending | ✅ |
| Шидловская Ольга | active | 2026-06-03 20:59:59 | ✅ | active | 2026-06-03 20:59:59 | ✅ | 2026-06-03 20:59:59 | pending | pending | ✅ |
| Татьяна Чистякова | active | 2026-06-02 20:59:59 | ✅ | active | 2026-06-02 20:59:59 | ✅ | 2026-06-02 20:59:59 | pending | pending | ✅ |
| Ангелина Залевская | active | 2026-05-31 20:59:59 | ✅ | active | 2026-05-31 20:59:59 | ✅ | 2026-05-31 20:59:59 | pending | pending | ✅ |
| Марина Киреева | active | 2026-05-30 20:59:59 | ✅ | active | 2026-05-30 20:59:59 | ✅ | 2026-05-30 20:59:59 | pending | pending | ✅ |

DoD по чек-листу пользователя:

1. ✅ Все 5 пользователей теперь bucket A (корректно).
2. ✅ `subscriptions_v2.access_end_at >= expected_min_end_eod_minsk`.
3. ✅ `entitlements.expires_at >= expected_min_end_eod_minsk`.
4. ✅ `telegram_access.active_until >= expected_min_end_eod_minsk`.
5. ✅ `subscription.status = active`.
6. ✅ `entitlement.status = active`.
7. ✅ `state_chat / state_channel` не изменились (`pending` / `pending` — как до).
8. ✅ backup rows = 15 по batch_id (5 + 5 + 5).
9. ✅ audit rows = 15 по batch_id (3 distinct actions × 5).
10. ✅ Duplicate / disputed / manual_review строки **не изменены** (Монич, Глушкова, Ананевич, Данилюк, Новикова, Босак, Хрущёва, Самец, Иванченко — вне scope).

---

## Audit format (пример meta)

```json
{
  "batch_id": "recurring_repair_2026_05_20260504_140202",
  "source_order_id": "...",
  "source_payment_id": "...",
  "user_id": "...",
  "product_id": "11c9f1b8-0355-4753-bd74-40b42aa53616",
  "tariff_id": "7c748940-dcad-4c7c-a92e-76a2344622d3",
  "expected_min_end_eod_minsk": "2026-06-03T20:59:59+00:00",
  "before": {"id": "...", "status": "expired", "access_end_at": "2026-02-12T20:59:59+00:00"},
  "after":  {"id": "...", "status": "active",  "access_end_at": "2026-06-03T20:59:59+00:00"},
  "rule": "GREATEST(current, expected_min_end)",
  "repair_bucket": "auto_repair",
  "patch_lineage": ["patch-12.1-stale-local-recovery","patch-12.2-skip-stale-guard"]
}
```

actor: `actor_type='system'`, `actor_user_id=NULL`, `actor_label='recurring-repair-2026-05'`.

Actions:
- `repair.recurring_2026_05.subscription_extended` × 5
- `repair.recurring_2026_05.entitlement_extended` × 5
- `repair.recurring_2026_05.telegram_access_extended` × 5

---

## Backup tables (для отката)

- `public.subscriptions_v2_repair_backup_2026_05` (5 rows, batch_id=above)
- `public.entitlements_repair_backup_2026_05` (5 rows)
- `public.telegram_access_repair_backup_2026_05` (5 rows)

RLS включён, deny-policy для authenticated. Доступ только service_role.

Идемпотентный rollback (если потребуется):
```sql
UPDATE subscriptions_v2 s
SET access_end_at = b.access_end_at, next_charge_at = b.next_charge_at, status = b.status, meta = b.meta
FROM subscriptions_v2_repair_backup_2026_05 b
WHERE s.id = b.sub_id AND b.batch_id = 'recurring_repair_2026_05_20260504_140202';
-- аналогично для entitlements / telegram_access (active_until)
```

---

## Что НЕ делалось (запреты соблюдены)

- ❌ duplicate_subscription bucket (6 пользователей) — не тронут, остаётся в follow-up
- ❌ disputed cases (Хрущёва, Самец, Иванченко) — не тронуты
- ❌ staff — не тронуты (в когорте 0)
- ❌ state_chat / state_channel — не менялись
- ❌ telegram-grant / telegram-revoke — не вызывались
- ❌ webhook replay — не выполнялся
- ❌ grant-access-for-order — не вызывался
- ❌ orders_v2 / payments_v2 — не менялись

---

## Next steps (только при отдельном approve)

- Follow-up #1: ручной review canonical sub_id для 6 duplicate_subscription → расширение auto_repair с 5 до 11.
- Follow-up #2: nightly мониторинг `bepaid.webhook.stale_local_end_recovered` + `grant-access-for-order.skip_blocked_stale_access` → подтверждение, что новые случаи закрываются причиной (patch 12.1+12.2), а не repair.
