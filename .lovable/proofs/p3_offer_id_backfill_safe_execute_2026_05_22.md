# P3 Этап 1 — execute proof (safe backfill)

Дата: 2026-05-22 (Minsk)
Batch: `p3_offer_id_backfill_safe_2026_05_22`
Audit: `action=orders.offer_id_backfill` · `actor_type=system` · `actor_label=p3_offer_id_backfill_safe_2026_05_22`

## Правила
Обновлено `orders_v2.offer_id` ТОЛЬКО там, где:
- `status='paid'`
- `offer_id IS NULL` (с race-guard `AND o.offer_id IS NULL` внутри UPDATE)
- `tariff_id IS NOT NULL`
- `meta->>'is_synthetic'` не = true
- у `tariff_id` ровно **1** `tariff_offers.is_active=true`
- `offer_id` берётся как этот единственный active offer того же тарифа

Не тронуто: `payments_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, `tariff_offers`, `document_scenarios`, `meta.document_data`, суммы/статусы заказов.

## Rowcount guard

| метрика | expected | actual |
|---|---|---|
| pre-execute safe-группа | 2670 | 2670 |
| UPDATE rowcount (через batch marker в meta) | 2670 | **2670** |
| audit.meta.count | 2670 | **2670** |
| post-execute остаточная safe-группа | 0 | **0** |
| `still_null` в batch (race) | 0 | **0** |
| `offer.tariff_id != order.tariff_id` mismatches | 0 | **0** |

## Sample 10 (random, все match_ok=true)

| order_id | tariff_id | offer_id | offer.tariff_id | is_active |
|---|---|---|---|---|
| e345cb0c | b276d8a5 | c5781abf | b276d8a5 | ✓ |
| 63a8c8a3 | 7c748940 | bc0f7a90 | 7c748940 | ✓ |
| 4be72b97 | 7c748940 | bc0f7a90 | 7c748940 | ✓ |
| c6e7e543 | 7c748940 | bc0f7a90 | 7c748940 | ✓ |
| 790f4213 | 56c35e86 | 53f05940 | 56c35e86 | ✓ |
| 47cd7319 | 7c748940 | bc0f7a90 | 7c748940 | ✓ |
| deafe70f | 7c748940 | bc0f7a90 | 7c748940 | ✓ |
| 4ce6fbb5 | b276d8a5 | c5781abf | b276d8a5 | ✓ |
| 06b224ab | 7c748940 | bc0f7a90 | 7c748940 | ✓ |
| bffa059e | 7c748940 | bc0f7a90 | 7c748940 | ✓ |

## Helper getOrderOfferId — поведение

Helper `src/lib/documents/purchaseDocumentRules.ts::getOrderOfferId`:
```
order.offer_id ?? meta.offer_id ?? meta.crm_routing_snapshot.offer_id ?? meta.document_data._provenance.offer_id
```
Column `offer_id` имеет приоритет над любыми meta-fallback. После этого backfill для 2670 заказов helper будет возвращать значение колонки, а резолв через «1 active offer» runtime больше не вызывается.

## Rollback (точечный)
```sql
UPDATE orders_v2 o
SET offer_id = NULL,
    meta = o.meta - 'offer_id_backfill_source' - 'offer_id_backfill_batch' - 'offer_id_backfill_at'
WHERE o.meta->>'offer_id_backfill_batch' = 'p3_offer_id_backfill_safe_2026_05_22';
-- expected rowcount: 2670
```

## Закрытие
Этап 1 закрыт. Переход к read-only анализу no_active (228) и multi_active (11) — `.lovable/proofs/p3_offer_id_no_active_multi_active_readonly_2026_05_22.md`.
