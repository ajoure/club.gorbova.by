# Rollback strategy Gate A.1 v3.1a

## Общая позиция

Миграция Gate A.1 v3.1a — **CREATE OR REPLACE FUNCTION** и один controlled backfill. Схема таблиц не меняется. Rollback возможен без потерь данных.

## Rollback шагов

### R1. RPC-функции

Все затронутые RPC имеют версии в предыдущей миграции `20260710211434_*.sql` (Gate A.1 v3.1). Rollback = повторное применение старых `CREATE OR REPLACE FUNCTION` из v3.1:

- `rr_finalize_created_order`
- `rr_finalize_created_order_internal`
- `rr_reconcile_confirm_created`
- `rr_mark_upstream_unknown`
- `rr_mark_local_persist_failed`
- `rr_finalize_order_rejected`
- `rr_get_or_create_pending_order`

Новая функция `rr_is_safe_payment_url` — удаляется:

```sql
DROP FUNCTION IF EXISTS public.rr_is_safe_payment_url(text);
```

### R2. Controlled backfill

Backfill меняет только `meta.rr.upstream_call_state` у заказов, соответствующих узкому фильтру (`provider='rr' AND meta.flow='rr_installment' AND status='pending' AND upstream_call_state='started'`).

Перед backfill сохраняется:
- `legacy_backfill_before.txt` — `SELECT id, meta->'rr' FROM orders_v2 WHERE <filter>` (только затронутые id).

Rollback backfill = обратный `UPDATE`:

```sql
UPDATE public.orders_v2 o
   SET meta = jsonb_set(o.meta, '{rr,upstream_call_state}', to_jsonb('started'::text), true),
       updated_at = now()
  FROM (SELECT id FROM <legacy_backfill_before ids>) c
 WHERE o.id = c.id;
```

Rollback безопасен, потому что backfill не меняет `initiation_status`, `payment_url`, `status`, `amount`. Только один JSON-путь.

### R3. Edge

Deploy edge v3.1a — атомарный. Rollback = redeploy предыдущей версии из git (или Supabase deploy history). `RR_TEST_FAULT_MODE` в production никогда не устанавливался, поэтому дополнительных действий не требуется.

## Идемпотентность

Повторное применение миграции v3.1a безопасно:
- `CREATE OR REPLACE FUNCTION` — идемпотентно;
- `REVOKE ALL / GRANT` — идемпотентно;
- Controlled backfill в WITH-CTE фильтруется на `upstream_call_state='started'`; после первого применения ни один заказ не удовлетворяет фильтру → второй запуск = no-op.

## Артефакт rollback

`gate_a1_v3_1a/runtime_proof/rollback_strategy.md` (после применения) должен содержать:
- git SHA миграции v3.1;
- git SHA миграции v3.1a;
- команду rollback (DROP + повторное применение v3.1);
- список затронутых `order_id` (из `legacy_backfill_before.txt`);
- проверенную reverse-миграцию (dry run в preview).

## Что нельзя делать

- Не выполнять rollback в production без предварительного dry run в preview.
- Не удалять `provider_events`, созданные в результате v3.1a — они являются журналом; rollback их не касается.
- Не менять сигнатуры функций как часть rollback — только тела и права.
