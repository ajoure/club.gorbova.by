# PATCH-REFUND-SOT-RPC-RECOVERY-2026-05

## Корневая причина (доказательство)

Audit-цепочка `target_user=7329990d-8ed6-4cc5-91ca-b6b6a92cb087` (Виктория Маргалик), order `ORD-26-MODR5QFS` / `78248b8d-e6ae-4269-99fc-e8fc6e420827`:

| timestamp | action | meta |
|---|---|---|
| 2026-05-18 11:46:39 | `admin.subscription.refund_db_recording_failed` | `bepaid_refund_uid=6c64db37-f2a3-403c-b9c0-0749683f6b42`, `refund_amount=150`, `error="invalid input value for enum payment_status: \"\""` |
| 2026-05-18 11:47:32 | `admin.subscription.refund_skipped_already_refunded` | bePaid: `Payment has been refunded already` |

Источник ошибки локализован rollback-safe repro через `psql`:

```
ERROR:  invalid input value for enum payment_status: ""
LINE 1: lower(COALESCE(p.status,''))
                                ^
CONTEXT:  PL/pgSQL function record_refund_atomic(...) line 48
          during statement block local variable initialization
```

`p.status` — enum `payment_status`. Postgres инферит тип COALESCE по первому аргументу (enum), пытается скастовать `''` обратно в enum → invalid. Срабатывает на инициализации локальной DECLARE-переменной внутри `FOR p IN SELECT * FROM payments_v2 LOOP`.

Второй latent bug, всплывший после первого фикса:
```
ERROR:  column "status" is of type order_status but expression is of type text
CONTEXT:  UPDATE orders_v2 SET status = v_new_order_status
```

## Применённые фиксы

### Миграция (record_refund_atomic v3)

```sql
-- 1) cast enum -> text перед COALESCE
pstatus text := lower(COALESCE(p.status::text, ''));

-- 2) explicit cast text -> enum при UPDATE
UPDATE orders_v2 SET status = v_new_order_status::order_status, ...
```

### Verify через rollback-safe repro (post-fix)

```
BEGIN;
SELECT record_refund_atomic(...);
-- {"success": true, "paid_sum": 150.00, "idempotent": false,
--  "refund_status": "full", "new_order_status": "refunded",
--  "refund_payment_id": "...", "total_refunded_after": 150}
ROLLBACK;
```

### Recovery Виктории через admin-repair-refund-recording

```
POST /admin-repair-refund-recording {"audit_log_id":"40109f71-..."}
→ rpc_result: {success: true, idempotent: false, refund_status: "full",
               new_order_status: "refunded", refund_payment_id: "d98bf350-..."}
```

### Verify (post-recovery)

```sql
SELECT id, amount, status, transaction_type, provider_payment_id, refunded_amount
FROM payments_v2 WHERE order_id='78248b8d-e6ae-4269-99fc-e8fc6e420827';
-- c1f1a52b... | 150.00  | succeeded | Платеж | 3b64cd09... | 150
-- d98bf350... | -150.00 | refunded  | refund | 6c64db37... | 0

SELECT status, meta->>'refund_amount', meta->>'paid_sum', meta->>'refund_status'
FROM orders_v2 WHERE id='78248b8d-e6ae-4269-99fc-e8fc6e420827';
-- refunded | 150 | 150.00 | full
```

## Dry-run sweep остальных failed-кейсов

```
POST /admin-repair-refund-recording {"dry_run":true}
{
  "summary": {"total": 2, "already_repaired": 0, "can_repair": 2, "manual_review": 0},
  "candidates": [
    { audit_log_id: "40109f71-...", order: "ORD-26-MODR5QFS",
      user: "7329990d-...", amount: 150, can_repair: true },
    { audit_log_id: "2af73c3f-...", order: "SUB-26-MMOP3Z026XWH",
      user: "e748983f-...", amount: 250, can_repair: true }
  ]
}
```

Виктория обработана. Второй кейс (`SUB-26-MMOP3Z026XWH`, 250 BYN, 2026-05-14) — ждёт отдельного approve.

## Что осталось / risks

- `bepaid-process-refunds` — не верифицирован, что пишет refund-row через RPC, а не прямым INSERT. Открыть subtask **PATCH-REFUND-POLLING-SOT-ALIGNMENT** для проверки и (при необходимости) выравнивания на canonical write-path.
- По refund Виктории не выполнен access action (revoke/reduce/keep) — отдельное admin-решение, потому что доступ к Gorbova Club мог измениться после 18.05.
- По второму кейсу `SUB-26-MMOP3Z026XWH` (Алла Лосева, 250 BYN, 2026-05-14) — recovery не выполнен, ждёт approve.

## Замечание о bePaid webhook

По кейсу Виктории webhook refund-события не обнаружено в `audit_logs` и `payment_reconcile_queue`. Failure произошёл в synchronous admin path (RPC fall), а не в webhook-обработке. **Не делаю общего вывода** про политику bePaid по отправке webhook после merchant-initiated API refund — для этого нужен отдельный controlled test или документация bePaid.

## Anti-goals соблюдены

- ✅ Не создан polling-cron каждые 30 минут;
- ✅ Не созданы прямые INSERT в payments_v2 из UI/edge;
- ✅ Не выдуманы новые refund_uid (всегда original);
- ✅ Не выполнен access action автоматически при recovery;
- ✅ Не вызван bePaid API из recovery-функции;
- ✅ Не изменена схема `payments_v2` / `payment_status` enum;
- ✅ Sweep execute по остальным кейсам ждёт отдельного approve.

## DoD

- ✅ Источник `""` enum-cast локализован через rollback-safe repro (PG_EXCEPTION_CONTEXT приведён выше).
- ✅ Миграция применена, post-fix repro зелёный.
- ✅ Создана узкая super-admin-only функция `admin-repair-refund-recording` (dry_run + execute, без bePaid API).
- ✅ Ветка `bepaidAlreadyRefunded` в `subscription-admin-actions` теперь зовёт RPC только при доказанном refund_uid (из transaction.uid либо из original failed-audit).
- ✅ Recovery Виктории отработал: refund-row `d98bf350...`, parent.refunded_amount=150, order='refunded', audit `admin.subscription.refund_recovered_via_admin_repair`.
- ✅ Sweep dry-run выполнен: 2 кейса, 1 восстановлен, 1 ждёт approve.
- ✅ Memory `mem://architecture/payments/refund-canonical-write-path` обновлено.
- ⚠️ Sweep execute по второму кейсу — ждёт approve пользователя.
- ⚠️ Access action по Виктории — ждёт отдельного admin-решения.
- ⚠️ `bepaid-process-refunds` SOT-alignment — backlog item.
