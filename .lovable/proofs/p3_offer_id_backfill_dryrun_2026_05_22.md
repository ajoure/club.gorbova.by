# P3 — offer_id backfill dry-run для /purchases

Дата: 2026-05-22 (Minsk)
Status: **dry-run only**, никаких UPDATE не выполнялось.

## Зачем
PATCH-A правил «Сформировать»/«Чек» в /purchases требует резолва `offer_id`. Текущий fallback резолвит «1 активный оффер тарифа» runtime, но если в `orders_v2.offer_id IS NULL`, в журнале и в логике документов идёт `offer_unresolved` (409). Бэкфил безопасно проставит `offer_id` там, где он однозначен.

## Cohort

Фильтр:
```sql
status='paid' AND offer_id IS NULL AND tariff_id IS NOT NULL
  AND COALESCE((meta->>'is_synthetic')::bool,false) = false
```

| метрика | value |
|---|---|
| total paid orders без offer_id (с tariff_id) | **2 909** |
| distinct users | ~220 |
| safe: ровно 1 active offer у tariff_id | **2 670** |
| no active offer у tariff | 228 |
| multiple active offers у tariff (нужен manual) | 11 |

Дополнительно: 127 paid orders без `tariff_id` вообще — не входят в backfill.

## Предлагаемый план execute (НЕ выполняется в этом proof)

Этап 1 — **safe backfill (2 670 rows)** только там, где у тарифа РОВНО 1 `is_active=true` offer и `created_at` order попадает в active-окно оффера:
```sql
UPDATE orders_v2 o
SET offer_id = sub.offer_id,
    meta = o.meta || jsonb_build_object(
      'offer_id_backfill_source','single_active_offer',
      'offer_id_backfill_batch','offer_id_backfill_2026_05_22'
    )
FROM (
  SELECT o.id AS order_id, off.id AS offer_id
  FROM orders_v2 o
  JOIN tariff_offers off ON off.tariff_id = o.tariff_id AND off.is_active=true
  WHERE o.status='paid' AND o.offer_id IS NULL AND o.tariff_id IS NOT NULL
    AND COALESCE((o.meta->>'is_synthetic')::bool,false)=false
  GROUP BY o.id, off.id
  HAVING COUNT(*) OVER (PARTITION BY o.id) = 1  -- safeguard
) sub
WHERE o.id = sub.order_id;
-- expected rowcount: ~2 670 ± precise count to be confirmed before execute
+ audit_logs (action=order.offer_id_backfill, actor_type=system)
```

Этап 2 — **228 no-active-offer** + **11 multiple-active**: оставить, проработать вручную (отдельный backlog: возможно нужно archive/active toggle оффера или прицельный resolve через snapshot).

## Guards перед execute
1. Повторно получить точный rowcount через `SELECT COUNT(*)` с теми же условиями.
2. Проверить, что в Этапе 1 нет orders с уже непустым `meta.offer_id_backfill_*`.
3. Сохранить backup в `.lovable/proofs/offer_id_backfill_backup_2026_05_22.json` (id + tariff_id + новый offer_id) перед UPDATE.

## Decision
Ждём approve на Этап 1 (~2 670 rows). Этап 2 — отдельный sweep.
