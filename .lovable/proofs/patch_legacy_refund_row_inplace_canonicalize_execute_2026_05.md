# PATCH-LEGACY-REFUND-ROW-INPLACE-CANONICALIZE-2026-05 — EXECUTE RESULT

**Дата execute:** 2026-05-21  
**Тип:** controlled in-place legacy data repair (вариант 4)  
**Статус:** ✅ EXECUTED, verify пройден 10/10.

## Затронутый пользователь

- **ФИО:** Лариса Конобеева
- **email:** lori-30@tut.by
- **user_id:** `e748983f-8409-49b6-b5f5-88a7c95920b0`

## Выполненный SQL (одна транзакция)

```sql
WITH upd AS (
  UPDATE payments_v2
  SET
    amount = -250,
    transaction_type = 'refund',
    status = 'refunded',
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'legacy_canonicalized', true,
      'legacy_original_amount', 250,
      'legacy_original_transaction_type', 'Возврат средств',
      'legacy_original_status', 'succeeded',
      'canonicalized_batch', 'patch_legacy_refund_row_inplace_2026_05',
      'canonicalized_at', now()
    ),
    updated_at = now()
  WHERE id = '49825c85-07e5-4493-b086-f3cfd79b2545'
    AND transaction_type = 'Возврат средств'
    AND amount = 250
  RETURNING id
)
INSERT INTO audit_logs(action, actor_type, actor_label, meta)
SELECT 'legacy_refund_row_canonicalized_inplace', 'system',
       'patch_legacy_refund_row_inplace_2026_05',
       jsonb_build_object(...) FROM upd;
```

Двойной guard в WHERE (`transaction_type='Возврат средств' AND amount=250`) гарантировал идемпотентность: повторный запуск не сработает.

## Verify (10/10 ✅)

| # | Проверка | Ожидалось | Факт | OK |
|---|---|---|---|---|
| 1 | `payments_v2.49825c85.amount` | `-250` | `-250` | ✅ |
| 2 | `transaction_type` | `refund` | `refund` | ✅ |
| 3 | `status` | `refunded` | `refunded` | ✅ |
| 4 | `order_id` не изменился | `09058c05-…` | `09058c05-…` | ✅ |
| 5 | `meta.parent_payment_id` не изменился | `7a64cd04-…` | `7a64cd04-…` | ✅ |
| 6 | parent `7a64cd04.refunded_amount` | `250` | `250` | ✅ |
| 7 | order `09058c05.status` | `refunded` | `refunded` | ✅ |
| 8 | SUB `11adac7b` не изменился | `paid` | `paid` | ✅ |
| 9 | audit-запись создана | 1 | 1 (`legacy_refund_row_canonicalized_inplace` / `patch_legacy_refund_row_inplace_2026_05`) | ✅ |
| 10 | rollback SQL приложен | да | см. ниже | ✅ |

`meta.legacy_canonicalized=true`, `meta.canonicalized_batch=patch_legacy_refund_row_inplace_2026_05` — подтверждены в БД.

## Что НЕ было затронуто (подтверждено)

- ❌ `order_id` не менялся
- ❌ `meta.parent_payment_id` / `meta.parent_payment_uid` не менялись
- ❌ parent payment `7a64cd04` не менялся (`refunded_amount=250` как было)
- ❌ `orders_v2` не менялся (`09058c05.status=refunded` как было, SUB `11adac7b.status=paid` как было)
- ❌ bePaid API не вызывался
- ❌ access / entitlements / subscriptions_v2 / Telegram — не трогались
- ❌ Новых строк в `payments_v2` не создавалось
- ❌ Никаких sweep / массовых апдейтов

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

## Финансовая инвариантность (подтверждена)

- parent `7a64cd04` (REBILL Ларисы, 13.05.2026): `refunded_amount=250` — без изменений.
- order `09058c05` (REBILL-7a64cd04-3d0, Лариса): `status='refunded'` — без изменений.
- SUB order `11adac7b` (март, Лариса): не трогался, `status=paid`.
- Доступ Ларисы: не трогался.

## Итог

Legacy refund-row Ларисы Конобеевой приведена к canonical-формату in-place. Финансовые агрегаты и доступы не изменились. Idempotency-guard включён, rollback SQL готов.
