
# План: 3 PATCHа — recovery linkedSubId, ID платежа, SQL-контроль

## Статус: ВЫПОЛНЕНО

## Единственный файл: `supabase/functions/bepaid-list-subscriptions/index.ts`
**Режим: PATCH-READ-ONLY** — никаких записей в БД.

---

## PATCH-1 (P0): Recovery `linkedSubId` через `order_id` — ВЫПОЛНЕНО

### Реализовано
- Helper `computeLinkage()` — единый расчёт linkedOrderId/linkedSubId (используется в pre-pass и `.map()`)
- Pre-pass: собирает `missingOrderIds` (active contour, linkedOrderId!=null, linkedSubId==null)
- Bulk query: `subscriptions_v2.select('id, order_id, user_id').in('order_id', missingOrderIds)`
- `orderIdToSv2`: Map<order_id → sv2.id>, только 1:1 (STOP-guard: >1 → ambiguous)
- Recovery в `.map()`: `linkedSubId = orderIdToSv2.get(linkedOrderId)` если active contour

### Результат
- `deal_link_mismatch_before=2`, `sub_recovered_via_order=0`, `deal_link_mismatch_after=2`
- Остаток 2 строки: bePaid подписки (`sbs_9482dac56fc8e66c` и 1 ещё), у которых есть `orders_v2.meta.bepaid_subscription_id` (→ linkedOrderId), но **нет subscriptions_v2 с этим order_id вообще**. Это не баг маппинга — это отсутствие sv2-записи для этих bePaid подписок. Recovery невозможен (нечего восстанавливать).
- `linked_before=141`, `linked_after=218`, `recovered=77` (через sv2→order chain, существовавший ранее)

### Stats добавлены
- `deal_link_mismatch_before`, `sub_recovered_via_order`, `deal_link_mismatch_after`, `ambiguous_order_to_sv2_count`

---

## PATCH-2 (P1): Fallback «ID платежа» из `raw_data` — ВЫПОЛНЕНО

### Реализовано
- Safe-extract из `provider_subscriptions.raw_data`:
  - Приоритет 1: `last_transaction_uid` / `last_transaction.uid`
  - Приоритет 2: `transactions[]` — только последняя по timestamp (`created_at`/`paid_at`/`processed_at`), никогда не `[0]` без timestamp
- `payment_id_source` в ответе: `'payments_v2.order_id'` | `'payments_v2.meta'` | `'provider_raw'` | `'none'`
- `provider_payment_id_raw` — что именно взято из raw (только если source=provider_raw)
- STOP-guard: fallback НЕ влияет на `is_linked_full`

---

## PATCH-3 (P1): SQL-контроль «остатка дыр» — ВЫПОЛНЕНО

### Stats добавлены (из уже загруженных данных)
- `ps_active_no_sv2=21` — provider_subscriptions активного контура без subscription_v2_id
- `sv2_pm_no_order=3` — subscriptions_v2 без order_id (из всех загруженных)
- `sv2_order_not_in_map=0` — алиас chain_only_unresolved

---

## Не затрагивается
- UI-компоненты, бейджи, фильтры
- Другие edge functions
- Схема БД, данные (никакого backfill)
