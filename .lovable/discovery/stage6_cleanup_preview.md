# Stage 6 Cleanup — PREVIEW manifest (read-only)

Дата: 2026-07-15. Режим: PREVIEW. DML не выполнялся.

## Итоговые approved counts

| Класс | Описание | Строк | DML |
|-------|----------|-------|-----|
| A payments | `provider='admin_test'`, `meta.test_payment=true` | **8** | `is_deleted=true` + `meta.stage6_cleanup='admin_test_fixture'` |
| A orders   | `order_number LIKE 'ORD-TEST-%'` | **7** | `is_deleted=true` + `meta.stage6_cleanup='admin_test_fixture'` |
| A subs     | `subscriptions_v2` связаны с A-orders | **4** | ТОЛЬКО `meta.stage6_cleanup='admin_test_fixture'`. Статус не меняется (нет enum/check для 'archived'). Все уже `canceled`/`superseded`. |
| A docs     | `ai_generated_documents` связаны с A-orders | **7** | ТОЛЬКО `meta.stage6_cleanup='test_document_void'` + `meta.void_reason`. Статус НЕ меняется ('void' не является каноническим статусом в БД). Номера НЕ сдвигаются. |
| A ledger   | `access_grant_ledger` связаны с A-orders | 5 | НЕ ТРОГАЕМ (audit trail) |
| B bank_transfer | `provider='bank_transfer'` активных | **0** | **DEFERRED**: обе строки уже `is_deleted=true`. Класс из миграции исключён. |
| C payments | `provider='admin'`, `meta.source='admin_from_payment'`, все с canonical bepaid | **113** | `is_deleted=true` + `meta.stage6_cleanup='admin_from_payment_duplicate'` + `canonical_bepaid_payment_id` + `queue_payment_id_verified` |
| D HOLD     | admin_from_payment без canonical | **0** | Пусто (все 113 доказали lineage) |
| E payments | `provider='admin'`, `meta.source='admin_grant'`, `amount=0` | **201** | `is_deleted=true` + `meta.stage6_cleanup='admin_grant_archive'` |
| — admin_deal_only | `provider='admin'`, `meta.source='admin_deal_only'`, `amount=0` | 1 | НЕ ТРОГАЕМ (отдельная категория, вне scope плана) |

Итог DML: soft-archive **322 payments** + **7 orders**, meta-marker для **4 subs** + **7 docs**. Никаких физических DELETE. Никаких изменений `access_grant_ledger`, `entitlements`, `payment_reconcile_queue`, `document_number_sequences`.

## Доказательства lineage (класс C)

Все 113 admin_from_payment имеют детерминированную цепочку:

```
payments_v2(admin, meta.source='admin_from_payment').meta.queue_payment_id
    → payment_reconcile_queue(id).bepaid_uid
    → payments_v2(bepaid, status='succeeded').provider_payment_id
```

С обязательным совпадением `amount` и `currency`. Из 113 записей:
- 104 связаны с активной `payment_reconcile_queue`;
- 9 связаны с `payment_reconcile_queue_archive`.

Все 113 имеют существующий canonical bepaid платёж (see `manifest_C_payments.csv`).

## Доказательства безопасности класса E

`admin_grant` (201 строка, amount=0) читается только в `supabase/functions/_shared/grant-eligibility.ts:172`, где источник `metaSource` — это `orders_v2.meta.source`, **не** `payments_v2.meta`. Прочие вхождения (`telegram-grant-access`, `subscription-admin-actions`, `ContactDetailSheet`, `fulfillment-executor`, `entitlement-sync`) — это WRITE-сайты. Ни один SQL-объект (function/view/trigger) не читает `payments_v2` c фильтром `admin_grant`:

```
SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE pg_get_functiondef(p.oid) ILIKE '%admin_grant%'
  AND n.nspname NOT IN ('pg_catalog','information_schema');
-- 0 rows
```

Вывод: soft-archive 201 admin_grant НЕ ломает выдачу доступа.

## Расхождения с исходным планом

1. **B (bank_transfer)** уже `is_deleted=true` — DEFERRED, ничего делать.
2. **C = 113**, не ~104. Все имеют canonical lineage.
3. **D HOLD = 0**, не 9.
4. **Документы**: в БД нет `document_number IN ('СА-26-00025','СА-26-00026')`. Реально связаны с ORD-TEST-* 7 документов с номерами формата `2105/*`, `2505/*`. Статус НЕ меняется (нет 'void' в БД); проставляется только `meta.stage6_cleanup`.
5. **subs**: статус НЕ меняется (`archived` не поддержан). Только metadata.

## Checksums (input state)

```
aa9d568e...  manifest_A_docs.csv      (7 rows)
5fd299ca...  manifest_A_orders.csv    (7 rows)
8f933f1d...  manifest_A_payments.csv  (8 rows)
def41c0f...  manifest_A_subs.csv      (4 rows)
51930bf2...  manifest_C_payments.csv  (113 rows)
39ba2ce2...  manifest_E_payments.csv  (201 rows)
```

Полные значения — в `/mnt/documents/stage6_cleanup/CHECKSUMS.txt`.

## Пост-инварианты миграции (fail-closed)

Все проверки выполняются внутри той же транзакции. Любое несовпадение → `RAISE EXCEPTION` → `ROLLBACK`.

- `count(*) FILTER (WHERE provider='admin_test' AND is_deleted=false) = 0`
- `count(*) FILTER (WHERE order_number LIKE 'ORD-TEST-%' AND is_deleted=false) = 0`
- `count(*) FILTER (WHERE provider='admin' AND meta->>'source'='admin_from_payment' AND is_deleted=false) = 0`
- `count(*) FILTER (WHERE provider='admin' AND meta->>'source'='admin_grant' AND is_deleted=false) = 0`
- `count(*) FILTER (WHERE provider='admin' AND meta->>'source'='admin_deal_only' AND is_deleted=false) = 1` (не тронуто)
- Δ активных entitlements = 0
- Δ активных `subscriptions_v2` (status IN active/trial/past_due/pending) = 0
- `payment_reconcile_queue` и canonical `payments_v2(bepaid,succeeded)` не изменены (row count checksum).
- Δ канонической выручки (`compute_order_financial_state` по затронутым orders до/после) = 0.
- `document_number_sequences` без изменений.
