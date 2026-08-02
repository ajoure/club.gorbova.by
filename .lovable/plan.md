# План: перепривязка group_payment_id двух addon child заказов (ORD-26-02836-A1/A2)

Только два JSON-ключа в `orders_v2.meta`. Никаких изменений платежей, заказов, групп, доступов, подписок, entitlement, ledger. Без кода, миграций, deploy и Publish. Без bank/bePaid void/refund.

## Подтверждённые факты (read-only, уже проверено)

Child заказы (оба `status=paid`, user `f32ff3d9…`):

| order_number | id | final_price | order_group_id | group_primary_order_id | group_payment_id |
|---|---|---|---|---|---|
| ORD-26-02836-A1 | `c7e73d97-6c49-4832-a3a1-a0f3cb600415` | 400.00 | `bbcac816…` | `4ffa5e3d…` | `80355c88…` (soft-deleted) |
| ORD-26-02836-A2 | `603b779a-814f-41eb-accd-e7442d11888f` | 250.00 | `bbcac816…` | `4ffa5e3d…` | `80355c88…` (soft-deleted) |

Прочие ключи meta у обоих: `deal_month`, `order_group_id`, `group_child_order`, `group_primary_order_id`, `exclude_separate_crm_deal` — не меняются.

Группа `bbcac816…`: `status=paid`, `primary_order_id=4ffa5e3d…`; состав `4ffa5e3d…`=primary, `603b779a…`=addon, `c7e73d97…`=addon.

Платежи parent order `4ffa5e3d…` (все user `f32ff3d9…`, 3300.00 BYN, `bank`, `succeeded`, `paid_at=2026-07-27 22:00:00+00`):

| payment | created_at | is_deleted | request_hash |
|---|---|---|---|
| `80355c88…` | 29.07 14:08 | **true** (17:31:08) | `533d6a2f…` |
| `e16c673e…` | 29.07 15:46 | **false** (единственный активный) | `533d6a2f…` — тот же |
| `2059c0b0…` | 29.07 17:29 | true (17:31:01) | `25eb1671…` |

Доказано: `e16c673e…` — единственный активный succeeded платёж того же parent order, того же user, той же суммы/валюты/`paid_at` и с тем же `request_hash`, что и удалённый `80355c88…`. Обе целевые строки — addon-члены группы.

## EXECUTE-план (по отдельному approve)

1. **Preflight (read-only), STOP при любом расхождении:**
   - `e16c673e…`: `is_deleted=false`, `status=succeeded`, `order_id=4ffa5e3d…`, `amount=3300.00 BYN`;
   - `80355c88…`: `is_deleted=true`;
   - у обоих child `meta->>'group_payment_id' = '80355c88-c012-458b-839e-5bc523e0e025'`;
   - роли addon и `order_groups.status='paid'` без изменений.

2. **CAS-обновление, ровно два отдельных statement, каждый expected rowcount = 1:**

```sql
UPDATE orders_v2
SET meta = jsonb_set(meta, '{group_payment_id}', '"e16c673e-737c-473d-911f-927d06c85a7d"'),
    updated_at = now()
WHERE id = '<child_id>'
  AND meta->>'order_group_id' = 'bbcac816-3a5b-45b1-939c-e17e898789d1'
  AND meta->>'group_primary_order_id' = '4ffa5e3d-f31e-49f5-84e5-e5974a167916'
  AND meta->>'group_payment_id' = '80355c88-c012-458b-839e-5bc523e0e025'
  AND meta->>'group_child_order' IS NOT NULL
  AND meta->>'exclude_separate_crm_deal' IS NOT NULL
  AND meta ? 'deal_month'
  AND status = 'paid'
  AND user_id = 'f32ff3d9-7411-49da-969a-da8451044351';
```
   `<child_id>` = `c7e73d97…`, затем `603b779a…`. Если rowcount ≠ 1 — откат этого statement и STOP.

3. **Read-back:**
   - `meta->>'group_payment_id'` = `e16c673e…` у обоих child; остальные ключи meta побайтно прежние;
   - RPC `admin_find_orders_without_payments`: INV-20 `actionable = 0`;
   - `admin-repair-missing-payments` `dry_run=true`: `no_real_payment = 4`, `repaired = 0`;
   - активных (`is_deleted=false`) payments_v2 у parent `4ffa5e3d…` — ровно 1 на 3300.00 BYN;
   - собственных payments_v2 у child по-прежнему 0; группа, доступы, подписки, entitlements и ledger не изменились.

## Вне scope

GitHub guard против повторной генерации дублей ручных платежей — отдельная задача, в этот execute не входит.
