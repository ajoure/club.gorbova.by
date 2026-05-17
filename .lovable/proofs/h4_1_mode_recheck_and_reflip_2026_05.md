# H4.1-recheck — Mode mismatch diagnose & re-flip 2026-05

## Stage 0 — Read-only snapshot

**snapshot_at_utc:** `2026-05-17T07:56:24.026722Z`
**flipped_at_utc (H4.1):** `2026-05-16T21:03:50.442Z`
**window_since_flip:** ~10h 52m

### 0.1 — Все `bepaid.rebill.%` audit за 14 дней

| action | meta.mode | count | first_at (UTC) | last_at (UTC) |
|---|---|---|---|---|
| `bepaid.rebill.decision_audit` | `dry_run` | 1 | 2026-05-16 16:31:05 | 2026-05-16 16:31:05 |
| `bepaid.rebill.dry_run` | `dry_run` | 2 | 2026-05-16 06:45:46 | 2026-05-16 16:31:05 |

**После `flipped_at` (21:03:50 UTC) — `bepaid.rebill.%` событий = 0.** Все три события относятся к окну ДО flip.

### 0.2 — Succeeded payments после flipped_at

| payment_id | paid_at (UTC) | order_number | order_created | age_at_payment | is_rebill | flow |
|---|---|---|---|---|---|---|
| `489f08eb-2541-4bd3-9ad2-18e9aa99e45a` | 2026-05-17 06:15:39 | `SUB-26-MMVMU7XAIA3D` | 2026-03-18 06:00:34 | **60 days** | `NULL` | `provider_managed_checkout` |

**Glued to old order:** payment приклеен к сделке возрастом 60 дней. Новый `REBILL-…` order НЕ создан. `meta.is_rebill` НЕ выставлен.

### 0.3 — Audit chain для платежа `489f08eb` (window 06:14–06:20 UTC)

| time | action | значимое из meta |
|---|---|---|
| 06:15:41.204 | `grant-access-for-order.skip_blocked_stale_access` | existing_subscription_id=25773bd6, patch=patch-12.2-skip-stale-guard |
| 06:15:41.696 | `grant-access-for-order.extend.duplicate_ignored` | existing_extended_by_orders=[22efc628…] |
| 06:15:55.897 | `document_data.snapshot_created` | order_paid_at=2026-03-18 (старая дата!) |
| 06:15:56.889 | `gc_sync_failed` | source=provider_managed_subscription |
| 06:15:56.929 | `bepaid.subscription.processed` | event=activated, state=active |

**Ни одного `bepaid.rebill.*` события в chain нет.**

### 0.4 — Вывод Stage 0

Дисиптчер REBILL-материализации в `bepaid-webhook/index.ts:2527` входит в ветку только если `rebillMode !== 'off'`. Если `rebillMode === 'off'`, audit `bepaid.rebill.*` НЕ записывается вообще.

Факт: после `flipped_at` пришёл реальный recurring succeeded payment (`489f08eb`), для которого:
1. не создан `REBILL-…` order;
2. payment склеен со старой родительской сделкой (`SUB-26-…`, age 60d);
3. полный audit chain прошёл по legacy-пути (`bepaid.subscription.processed`, `grant-access-for-order.*`);
4. ни одного `bepaid.rebill.*` события не записано.

**Verdict Stage 0:** runtime effectively `off`. Secret `BEPAID_REBILL_MATERIALIZATION` либо физически содержит значение, отличное от `on` (наиболее вероятная причина — H-A), либо edge-runtime читает старое значение (H-B, маловероятно через 10+ часов).

### 0.5 — Ожидаемый DML на Stage 2

- `secrets--update_secret(['BEPAID_REBILL_MATERIALIZATION'])` → `on` (ровно эта строка, lowercase, без пробелов/кавычек).
- Прочих secrets не трогаем.
- Ручной DML в БД = 0.
- Runtime DML от live REBILL после reflip — РАЗРЕШЁН и является предметом Stage 3 verify.

---

## Stage 1 — (объединён с Stage 0 по правке пользователя)

Variant A (10-минутное ожидание) не нужен — у нас уже есть жёсткий факт: payment `489f08eb` после flip пошёл по legacy-пути без `bepaid.rebill.*` audit. Этого достаточно, чтобы перейти к reflip.

**Awaiting user approval to proceed to Stage 2 (secrets--update_secret).**

---

## Stage 2 — Re-flip (pending approval)

_Pending. Будет заполнено после approve и выполнения `secrets--update_secret`._

- `reflipped_at_utc`: _tbd_
- secret list (имена): _tbd_

## Stage 3 — Verify runtime mode = on (pending)

_Pending. Триггер: первый recurring succeeded payment после `reflipped_at_utc`._

Ожидаемые сигналы PASS:
- audit `bepaid.rebill.materialized` с `meta.mode='on'`;
- новый `orders_v2.order_number LIKE 'REBILL-%'`;
- `payments_v2.order_id` указывает на новый REBILL-order;
- `subscriptions_v2.access_end_at` НЕ уменьшилось.

Если за 24h после reflip нет recurring трафика → статус `enabled_awaiting_first_rebill`.

## Stage 4 — Rollback triggers (pending)

- `bepaid.rebill.dispatcher_error` > 0 за 1h после reflip;
- `bepaid.rebill.conflict_uid` > 0;
- `subscriptions_v2.access_end_at` regression;
- 5xx bepaid-webhook вырос относительно baseline;
- **Новый recurring succeeded payment после reflip снова склеился со старым order и нет `bepaid.rebill.materialized`** → rollback secret → `dry_run`, incident proof.

## Verdict

_Pending Stage 3._
