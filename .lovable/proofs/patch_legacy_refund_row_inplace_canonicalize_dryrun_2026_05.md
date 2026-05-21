# PATCH-LEGACY-REFUND-ROW-INPLACE-CANONICALIZE-2026-05 — DRY-RUN

**Дата:** 2026-05-21  
**Тип:** controlled in-place legacy data repair (вариант 4)  
**Статус:** DRY-RUN, execute НЕ выполнен, ждём approve.

## Затронутый пользователь

- **ФИО:** Лариса Конобеева
- **email:** lori-30@tut.by
- **user_id:** `e748983f-8409-49b6-b5f5-88a7c95920b0`

## Scope

Ровно одна строка: `payments_v2.id = 49825c85-07e5-4493-b086-f3cfd79b2545`.

## Verification матрица (7/7 пройдено)

| # | Условие | Ожидалось | Факт в БД | OK |
|---|---|---|---|---|
| 1 | provider_payment_id | `6e4a67ff-f71a-4edd-9d63-89c16b44b9bf` | `6e4a67ff-f71a-4edd-9d63-89c16b44b9bf` | ✅ |
| 2 | order_id | `09058c05-3dff-4e26-a152-b568fa6da1a5` (REBILL Ларисы) | `09058c05-…` | ✅ |
| 3 | meta.parent_payment_id | `7a64cd04-3d08-4c9f-a81b-d50b7383edf6` | `7a64cd04-…` | ✅ |
| 4 | parent payment `7a64cd04` refunded_amount | `250` | `250.00` | ✅ |
| 5 | order `09058c05` status | `refunded` | `refunded` (meta.refunded_in_full=true, meta.refund_payment_id=49825c85) | ✅ |
| 6 | SUB order `11adac7b` (март, мартовский SUB Ларисы) | не трогать | будет нетронут | ✅ |
| 7 | вторая canonical refund-row с этим provider_payment_id | отсутствует | в БД ровно одна строка с provider_payment_id=6e4a67ff (legacy `49825c85`) | ✅ |

Все 7 условий выполнены. Финансовая картина уже корректна — legacy-row просто не canonical-формата.

## Текущее состояние строки (BEFORE)

```
id                  : 49825c85-07e5-4493-b086-f3cfd79b2545
order_id            : 09058c05-3dff-4e26-a152-b568fa6da1a5
provider_payment_id : 6e4a67ff-f71a-4edd-9d63-89c16b44b9bf
amount              : 250.00            ← legacy: положительный
transaction_type    : 'Возврат средств' ← legacy enum-строка
status              : 'succeeded'       ← legacy для возврата
refunded_amount     : 0
meta.parent_payment_id     : 7a64cd04-3d08-4c9f-a81b-d50b7383edf6
meta.parent_payment_uid    : e2eedd12-f1dc-4af4-8d3a-feae6956b39c
meta.auto_linked           : true
meta.repair_batch          : DEAL-LINKAGE-LORI-30-2026-05
created_at          : 2026-05-14 17:07:04.191779+00
```

## Planned UPDATE (AFTER, в одной транзакции)

```sql
UPDATE payments_v2
SET
  amount = -250,
  transaction_type = 'refund',
  status = 'refunded',
  meta = meta || jsonb_build_object(
    'legacy_canonicalized', true,
    'legacy_original_amount', 250,
    'legacy_original_transaction_type', 'Возврат средств',
    'legacy_original_status', 'succeeded',
    'canonicalized_batch', 'patch_legacy_refund_row_inplace_2026_05',
    'canonicalized_at', now()
  ),
  updated_at = now()
WHERE id = '49825c85-07e5-4493-b086-f3cfd79b2545';
```

Audit:
```sql
INSERT INTO audit_logs(action, actor_type, actor_label, meta)
VALUES (
  'legacy_refund_row_canonicalized_inplace',
  'system',
  'patch_legacy_refund_row_inplace_2026_05',
  jsonb_build_object(
    'payment_id','49825c85-07e5-4493-b086-f3cfd79b2545',
    'order_id','09058c05-3dff-4e26-a152-b568fa6da1a5',
    'provider_payment_id','6e4a67ff-f71a-4edd-9d63-89c16b44b9bf',
    'parent_payment_id','7a64cd04-3d08-4c9f-a81b-d50b7383edf6',
    'user_id','e748983f-8409-49b6-b5f5-88a7c95920b0',
    'user_full_name','Лариса Конобеева',
    'user_email','lori-30@tut.by',
    'change','amount +250→-250; transaction_type Возврат средств→refund; status succeeded→refunded',
    'mode','cosmetic_inplace_no_aggregate_change'
  )
);
```

## Anti-goals (запрещено)

- ❌ менять `order_id`
- ❌ менять `meta.parent_payment_id` / `meta.parent_payment_uid`
- ❌ менять parent payment `7a64cd04` (его `refunded_amount` уже корректный — 250)
- ❌ трогать `orders_v2` (статус `09058c05` уже `refunded`)
- ❌ трогать SUB order `11adac7b-3f31-4267-b8e2-da54bba4b57c` (март, Лариса)
- ❌ вызывать bePaid API
- ❌ трогать access / entitlements / subscriptions_v2
- ❌ трогать Telegram
- ❌ создавать новую строку в `payments_v2`
- ❌ менять unique constraints / индексы
- ❌ массовый sweep (другие legacy-rows — отдельный backlog)

## Rollback SQL

```sql
UPDATE payments_v2
SET
  amount = 250,
  transaction_type = 'Возврат средств',
  status = 'succeeded',
  meta = meta - 'legacy_canonicalized'
              - 'legacy_original_amount'
              - 'legacy_original_transaction_type'
              - 'legacy_original_status'
              - 'canonicalized_batch'
              - 'canonicalized_at',
  updated_at = now()
WHERE id = '49825c85-07e5-4493-b086-f3cfd79b2545'
  AND (meta->>'canonicalized_batch') = 'patch_legacy_refund_row_inplace_2026_05';
```

## Финансовая инвариантность (что НЕ изменится)

- parent `7a64cd04` (REBILL Ларисы, 13.05): `refunded_amount=250` — как было.
- order `09058c05` (REBILL-7a64cd04-3d0, Лариса): `status='refunded'` — как было.
- SUB order `11adac7b` (март, Лариса): не трогается, refunded_amount по нему остаётся 0.
- bePaid: не вызывается.
- Доступ Ларисы: не трогается (по правилу — восстановленные refund-записи не меняют access).

## Следующий шаг

Жду approve `execute`. После approve:
1. Выполнить UPDATE + audit одной транзакцией.
2. Re-verify: amount=-250, transaction_type='refund', status='refunded', meta.legacy_canonicalized=true; parent.refunded_amount по-прежнему 250; order по-прежнему refunded.
3. Обновить этот файл секцией EXECUTE RESULT.
