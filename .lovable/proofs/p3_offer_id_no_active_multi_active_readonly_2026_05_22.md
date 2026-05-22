# P3 — no-active / multi-active read-only proof

Дата: 2026-05-22 (Minsk)
Status: **read-only**. Никаких UPDATE/DELETE. Тарифы и офферы не модифицируются.

Cohort: paid orders без `offer_id`, у которых количество active tariff_offers ≠ 1.

## Сводка по тарифам

| bucket | tariff_id | orders | active | total | first_order | last_order |
|---|---|---|---|---|---|---|
| **multi_active** | 0fb3db55-b6ba-44bf-8a0b-37bb040ab01a | 11 | 2 | 2 | 2025-12-30 | 2026-03-27 |
| no_active | 5d598dae-4933-47a6-9af9-c0e05940ea9e | 90 | 0 | 1 | 2026-03-29 | 2026-03-29 |
| no_active | 34628d81-91f7-4261-a231-ad1e118d71df | 21 | 0 | 1 | 2026-03-29 | 2026-03-29 |
| no_active | 2c84e74c-f4de-4cff-ad98-b4e1b2f53f93 | 17 | 0 | 1 | 2024-05-14 | 2026-05-06 |
| no_active | c31bf65f-52db-45f4-81c1-9fbbe8ac835a | 17 | 0 | 0 | 2024-05-14 | 2026-05-06 |
| no_active | 0f5183d8-a610-416e-8d48-45eb47fba075 | 17 | 0 | 0 | 2024-05-14 | 2026-05-06 |
| no_active | cbc9a3a2-c677-472a-8ede-a0571f38f8e9 | 15 | 0 | 0 | 2024-05-14 | 2026-05-06 |
| no_active | c12acda3-6ff7-4f46-ba25-ae3552857c30 | 15 | 0 | 0 | 2024-05-14 | 2026-05-16 |
| no_active | 7f69656c-8fa2-4abf-b423-452d3d435bbc | 15 | 0 | 0 | 2024-05-14 | 2026-05-06 |
| no_active | 2d75337a-434a-4a23-8576-4f47f882ab0a | 13 | 0 | 0 | 2024-05-14 | 2026-05-06 |
| no_active | aa699e38-f62e-4402-9328-4aaa38486c09 | 6 | 0 | 0 | 2026-04-05 | 2026-04-23 |
| no_active | 56ce1995-6bf1-43dd-9211-63bc7e18d7e3 | 1 | 0 | 2 | 2026-04-28 | 2026-04-28 |
| no_active | 4248dadf-0981-4b33-955d-b6215b278a39 | 1 | 0 | 0 | 2026-04-24 | 2026-04-24 |

Итого: **228 no_active** + **11 multi_active** = 239 заказов.

## UI-эффект сейчас (PATCH-A)
- helper `resolveOfferForOrder`: offer не резолвится → `source='none'`.
- «Сформировать документ» → нет кнопки (`canGenerateDocument` blocked, `document_not_enabled_for_offer` либо `offer_unresolved`).
- «Чек» зависит только от `receipt_url` платежа, на него этот блок не влияет.

## Buckets

### no_active (228 orders, 12 тарифов)
Подтипы:
1. `total_offers=0` (8 тарифов, ~109 заказов): у тарифа никогда не было офферов. Возможно legacy historical_import. Требуется бизнес-решение: создать архивный «historical» offer или оставить как есть (кнопки документов остаются скрытыми — это корректно, документы по таким заказам не оформлялись).
2. `total_offers=1, active=0` (3 тарифа, ~128 заказов): был один offer, потом деактивирован. Безопасный fallback — взять этот единственный (in)active offer. Но против правил Этапа 1 (`is_active=true`), нужен явный approve.
3. `total_offers>1, active=0` (1 тариф, 1 заказ): несколько неактивных офферов. Manual.

### multi_active (11 orders, 1 тариф `0fb3db55`)
2 активных оффера одновременно. Нужен либо canonical-маркер (`meta.is_default=true` в `tariff_offers.meta`), либо ручной выбор по дате/сумме заказа. До этого backfill blocked.

## Decision
- Этап 1 закрыт как execute.
- no_active / multi_active **не трогаются** этим спринтом.
- Создаётся backlog для бизнес-решения:
  - правило выбора canonical offer при `multi_active>1` (предложение: добавить `meta.is_default=true` в tariff_offers, отдать UI селектор админу);
  - правило для legacy `total_offers=0` (создать «historical_archived» offer без документов или закрыть как acceptable дрейф);
  - правило для `total_offers=1, active=false` (разрешить backfill на inactive offer при наличии явного флага).

Backlog: `.lovable/backlog/offer_id_backfill_residual_no_active_multi_active.md` (создать при следующем подходе).
