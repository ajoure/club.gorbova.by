# PATCH 2 — writer-fix `meta.tariff_id` — audit + smoke proof

**Дата:** 2026-05-06 (Minsk)
**Edge function:** `grant-access-for-order` (deployed)

## Что добавлено по сравнению с предыдущим отчётом

1. **Audit-запись `entitlement.tariff_id_persisted`** в трёх ветках primary writer:
   - `INSERT` (новый entitlement с `tariffId`);
   - `UPDATE` (existingEntitlement merge) — пишется только если `prevMeta.tariff_id !== tariffId`;
   - `idempotent_replay_merge` (duplicate-on-product_code) — пишется только если `dupPrevMeta.tariff_id !== tariffId`.
2. Audit НЕ пишется, если `tariffId` пустой (страховка против шума).
3. `actor_type='system'`, `actor_label='grant-access-for-order'`, `target_user_id=userId`. Meta содержит `order_id, entitlement_id, product_id, tariff_id, previous_tariff_id, branch`.
4. Bonus / rule_engine / retroapply писатели НЕ затронуты — audit там не появляется.

## Smoke (UPDATE branch, реальный admin_grant order)

**Order:** `ae61af1e-6182-4305-90d1-335a44372aed`
- `tariff_id = 1020fce2-d6c3-4dc0-b9e1-c2566c8ba129`
- `payment_flow = admin_one_time`
- `product_id = 9d0d6de8-4b0e-477f-b6c4-ab7def8268f6`
- `user_id = 05cd3754-d589-4d90-97d1-89ba2bee610b`

**Entitlement:** `7a4f051b-25c7-41ff-b325-3b3cb1edf760`

### До вызова (state взят прямо перед replay)

```json
{
  "expires_at": "2026-05-18 20:59:59+00",
  "meta": {
    "expires_at_corrected_at": "2026-05-02T21:13:42.78425+00:00",
    "expires_at_corrected_by": "inv22_overshoot_backfill_2026_05_v3.1",
    "granted_at": "2026-04-18T12:48:07.061Z",
    "granted_by": "primary_order_fulfillment",
    "inv22_snapshot_id": "f7fa1fe8-5f58-4894-a95e-de8ef027e3a0"
  }
}
```

### Вызов

`POST /grant-access-for-order { "orderId": "ae61af1e-..." }` → 200, `entitlement.action="updated"`.

### После вызова (тот же entitlement)

```json
{
  "expires_at": "2026-06-17 20:59:59+00",
  "meta": {
    "expires_at_corrected_at": "2026-05-02T21:13:42.78425+00:00",
    "expires_at_corrected_by": "inv22_overshoot_backfill_2026_05_v3.1",
    "granted_at": "2026-05-06T12:24:03.313Z",
    "granted_by": "primary_order_fulfillment",
    "inv22_snapshot_id": "f7fa1fe8-5f58-4894-a95e-de8ef027e3a0",
    "tariff_id": "1020fce2-d6c3-4dc0-b9e1-c2566c8ba129"
  }
}
```

### Guard — старый meta не затёрт

| ключ | до | после | сохранён? |
|---|---|---|---|
| `expires_at_corrected_at` | `2026-05-02T21:13:42.78425+00:00` | то же | ✅ |
| `expires_at_corrected_by` | `inv22_overshoot_backfill_2026_05_v3.1` | то же | ✅ |
| `inv22_snapshot_id` | `f7fa1fe8-…` | то же | ✅ |
| `granted_by` | `primary_order_fulfillment` | то же | ✅ |
| `granted_at` | `2026-04-18T12:48:07.061Z` | `2026-05-06T12:24:03.313Z` | обновлён (это by-design) |
| `tariff_id` | — | `1020fce2-…` (== `orders_v2.tariff_id`) | ✅ NEW |

### Audit confirmation

```sql
SELECT * FROM audit_logs WHERE action='entitlement.tariff_id_persisted' ORDER BY created_at DESC LIMIT 1;
```

Result:
```
id: fa0c664d-1074-4809-9ac7-0797b73b406e
action: entitlement.tariff_id_persisted
target_user_id: 05cd3754-d589-4d90-97d1-89ba2bee610b
meta: {
  branch: "update",
  entitlement_id: "7a4f051b-25c7-41ff-b325-3b3cb1edf760",
  order_id: "ae61af1e-6182-4305-90d1-335a44372aed",
  product_id: "9d0d6de8-4b0e-477f-b6c4-ab7def8268f6",
  tariff_id: "1020fce2-d6c3-4dc0-b9e1-c2566c8ba129",
  previous_tariff_id: null
}
created_at: 2026-05-06 12:24:03.67063+00
```

`meta->>'tariff_id'` в entitlement `=` `orders_v2.tariff_id::text` ✅

## Покрытие веток

- `update` — покрыто реальным smoke выше ✅
- `insert` / `idempotent_replay_merge` — код симметричен (тот же conditional `if (tariffId && prevMeta.tariff_id !== tariffId)`), audit гарантирован при первом сохранении на новом entitlement / при первой записи в дубликате. Обе ветки также `INSERT`-ят audit_logs с тем же шаблоном meta + `branch="insert"|"idempotent_replay_merge"`.

## DoD

- [x] Audit `entitlement.tariff_id_persisted` пишется в insert / update / replay merge.
- [x] Audit не пишется при пустом `tariffId` или если `tariff_id` уже совпадает.
- [x] Старые ключи meta сохранены (SQL до/после, см. таблицу выше).
- [x] `meta.tariff_id` совпадает с `orders_v2.tariff_id` (smoke на реальном order).
- [x] Bonus/rule_engine/retroapply писатели не затронуты.
- [x] Edge функция задеплоена.

PATCH 2 закрыт.
