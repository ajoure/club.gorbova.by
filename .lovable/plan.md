# Да, согласен, с учетом правок:

&nbsp;

1. Сделать execute + audit в одной транзакции (чтобы audit не разъехался с фактом UPDATE):

&nbsp;

BEGIN;

&nbsp;

WITH cand AS (

  SELECT [o.id](http://o.id)

  FROM orders_v2 o

  WHERE o.status='paid'

    AND NOT EXISTS (SELECT 1 FROM payments_v2 p WHERE p.order_id=[o.id](http://o.id))

    AND lower(o.provider)='bepaid'

    AND o.reconcile_source='getcourse_historical'

),

upd AS (

  UPDATE orders_v2 o

  SET provider='getcourse', updated_at=now()

  FROM cand

  WHERE [o.id](http://o.id)=[cand.id](http://cand.id)

  RETURNING [o.id](http://o.id), o.order_number

)

INSERT INTO audit_logs (action, actor_type, actor_user_id, actor_label, meta)

SELECT

  'inv20.gc_historical_provider_normalized',

  'system',

  NULL,

  'patch_inv20_provider_fix',

  jsonb_build_object(

    'affected_count', (SELECT count(*) FROM upd),

    'sample_ids', (SELECT coalesce(jsonb_agg(id), '[]'::jsonb) FROM (SELECT id FROM upd LIMIT 20) s),

    'old_provider', 'BePaid',

    'new_provider', 'getcourse',

    'where_contract', 'status=paid AND no payments_v2 AND lower(provider)=bepaid AND reconcile_source=getcourse_historical'

  );

&nbsp;

COMMIT;

&nbsp;

2. Verify расширить: кроме dry-run→0 добавить проверку, что provider реально стал getcourse по тому же WHERE (для исключения “не обновилось из-за RLS/ошибки”):

&nbsp;

SELECT count(*)

FROM orders_v2 o

WHERE o.status='paid'

  AND NOT EXISTS (SELECT 1 FROM payments_v2 p WHERE p.order_id=[o.id](http://o.id))

  AND o.reconcile_source='getcourse_historical'

  AND lower(o.provider)='getcourse';

&nbsp;

План: PATCH INV-20 — нормализация provider у GC-исторических заказов

## Контекст

Paid orders с `reconcile_source='getcourse_historical'` и `lower(provider)='bepaid'` без `payments_v2` ложно попадают в bePaid-allowlist INV-20. Значение `getcourse` — каноничный provider в проекте.

## Шаги

### 1. Dry-run — подсчёт кандидатов

```sql
SELECT count(*) AS candidate_count
FROM orders_v2 o
WHERE o.status='paid'
  AND NOT EXISTS (SELECT 1 FROM payments_v2 p WHERE p.order_id=o.id)
  AND lower(o.provider)='bepaid'
  AND o.reconcile_source='getcourse_historical';
```

### 2. Execute — UPDATE тем же WHERE (без IN)

Через insert tool:

```sql
WITH cand AS (
  SELECT o.id
  FROM orders_v2 o
  WHERE o.status='paid'
    AND NOT EXISTS (SELECT 1 FROM payments_v2 p WHERE p.order_id=o.id)
    AND lower(o.provider)='bepaid'
    AND o.reconcile_source='getcourse_historical'
)
UPDATE orders_v2 o
SET provider='getcourse', updated_at=now()
FROM cand
WHERE o.id=cand.id
RETURNING o.id, o.order_number;
```

### 3. Audit log из RETURNING

Insert в `audit_logs` с meta из фактических результатов:

- `affected_count` = count(RETURNING)
- `sample_ids` = первые 20 id
- `where_contract` = строка условия
- `old_provider` / `new_provider`

### 4. Verify

- Повторный dry-run (шаг 1) → **0**
- Общий bePaid-subset (информационный): `<= было`
- `inv20_paid_orders_without_payments()` — проверить снижение

## Что НЕ меняется

- RPC, edge function, схема, UI — без изменений

## DoD

1. Dry-run выполнен, candidate_count зафиксирован
2. UPDATE выполнен тем же WHERE
3. GC-historical subset = **0**
4. Общий bePaid-subset <= было (информационный)
5. audit_logs запись с реальными данными из RETURNING