# Stage 6.C — Read-only preview: `payments_v2.provider='admin_test'` (8 строк)

Статус: READ-ONLY. Никакого DML. Только discovery + артефакты.

## 1. Инвентарь

- Всего строк с `provider='admin_test'`: **8** (совпадает с ожидаемым).
- CSV: `/mnt/documents/stage6c/admin_test_payments_v2.csv`
- SHA-256: `f1278dd7e7882eb94588f7b0d7d28f35d69054b424a2ba65ea17cb3ed5e728f0`
- Период: `2026-01-19 .. 2026-06-06`.
- Все 8 в `is_deleted = false`, `deleted_at IS NULL`.

## 2. Детерминированные fixture-признаки (все совпадают на 8/8)

| Признак | Значение | Count |
|---|---|---|
| `provider` | `admin_test` | 8 |
| `status` | `succeeded` | 8 |
| `origin` | `bepaid` | 8 |
| `meta.test_payment` | `true` (boolean) | 8 |
| `meta.test_payment_by` | `7500084@gmail.com` | 8 |
| `provider_payment_id` | NULL / пусто | 8 |
| `user_id` | `05cd3754-d589-4d90-97d1-89ba2bee610b` (fixture-суперадмин) | 8 |
| `currency` | `BYN` | 8 |

Дополнительно у части строк присутствует `meta.receipt_backfill_reason = 'no_uid_skipped'` — прямое доказательство того, что receipts backfill корректно распознал их как fixture без канонического uid.

## 3. Соответствие lineage функции `test-payment-complete`

Функция (до Stage 6.B tombstone, теперь 410 Gone) писала:
- `provider = 'admin_test'`,
- `meta.test_payment = true`,
- `meta.test_payment_by = <email актора>`,
- `provider_payment_id` не проставлялся.

Все 8 строк соответствуют этому lineage без исключений. Других writer-ов
`provider='admin_test'` в кодовой базе не найдено (rg по `src`, `supabase/functions`,
`supabase/migrations` — только исторические миграции и tombstone).

## 4. Кросс-связи (side effects)

### 4.1 orders_v2 (7 из 8 payment имеют order_id, 1 detached)

Все связанные заказы имеют префикс `order_number = ORD-TEST-*` — независимый
детерминированный fixture-маркер:

| payment_id | order_id | order_number | status | final_price |
|---|---|---|---|---|
| c1640bba | 42e9adc1 | ORD-TEST-ML3GATGK | paid | 250.00 |
| 7cf98263 | 99f7071c | ORD-TEST-ML80SUH9 | paid | 100.00 |
| e4a38b1c | bd936b5e | ORD-TEST-MOITL0IK | paid | 390.00 |
| b211c2b8 | 1e3c6a55 | ORD-TEST-MPF8NM2B | paid | 150.00 |
| 90fe6cd0 | 4e1df0cc | ORD-TEST-MPF8PW9G | paid | 100.00 |
| 38b920da | 779b4105 | ORD-TEST-MPFAPNTP | paid | 100.00 |
| 87aa9795 | 7676f283 | ORD-TEST-MQ2LKU48 | paid | 100.00 |

Detached: `8fee626c` — `order_id IS NULL`, но `meta.deleted_order_number =
'ORD-TEST-MKLDEPF1'` и `meta.detached_at`/`relinked_at` полностью описывают
происхождение. Отдельного «висячего» order-ID в базе больше нет.

### 4.2 subscriptions_v2 — 4 записи

| id | order_id | status |
|---|---|---|
| 28fe373e | bd936b5e | canceled |
| 54cb447b | 1e3c6a55 | superseded |
| ffcaddf7 | 4e1df0cc | canceled |
| 1a9b846d | 7676f283 | superseded |

Все либо `canceled`, либо `superseded` — активных подписок с fixture-lineage нет.

### 4.3 access_grant_ledger — 5 записей

Все 5: `source_event_type='webhook'`, `source_subject_type='order'`,
`source_subject_ref = order_id`. Есть 3 `grant/granted` и 2 `extend/extended`.
Прямых ссылок на `payments_v2.id` в ledger нет (ledger привязан к order-у, не к платежу).

### 4.4 generated_documents — **2 production-номера** ⚠️

| id | order_id | document_type | document_number | status |
|---|---|---|---|---|
| c75b14b6 | bd936b5e | invoice_act | **СА-26-00025** | generated |
| 0a9f3eaa | 779b4105 | invoice_act | **СА-26-00026** | generated |

Эти два fixture-заказа получили production-номера document sequence. Это НЕ
блокирует Stage 6.C preview, но критично для будущего DML: soft-archive платежей
и/или заказов не должен освобождать/переиспользовать эти номера, иначе будет
конфликт с реальной нумерацией. Ссылка: backlog
`stripe_test_fixture_marker_v1.md` (canonical fixture marker пока отсутствует —
поэтому production-номера у fixture-строк системно возможны).

### 4.5 entitlement_sources — **0 записей** (по `order_id` и по `source_ref = payment.id`).

### 4.6 audit_logs — **0 записей** с `entity_id ∈ {8 payments, 7 orders}`. Ledger-side следов действия суперадмина в `audit_logs` не осталось.

### 4.7 installment_payments, payment_tombstones — не проверялись целевой ссылкой (несовместимые типы/отсутствующие колонки); при построении DML preview пере-проверить схему на актуальную.

## 5. Соблюдение `payments_v2.is_deleted` reader-ами / агрегатами

### 5.1 Аудит фильтров

- `src/hooks/useUnifiedPayments.tsx:247-248` — client-side reader явно фильтрует
  `.eq("is_deleted", false)`.
- Все актуальные RPC (миграции `20260713*`, `20260712191323`):
  `WHERE ... AND is_deleted = false` для агрегатов сумм и `IF EXISTS(... AND
  is_deleted = true) THEN raise`.
- Комментарий на колонке (`20260712191323`): «Writers/readers must respect
  `is_deleted=false` unless explicitly showing tombstones».
- BEFORE UPDATE trigger в `20260713132151` покрывает `is_deleted, deleted_at,
  provider, provider_payment_id`.

Вывод: канонический финансовый контур уважает `is_deleted`.

### 5.2 Известные исключения (edge functions, не фильтруют явно)

Ниже — edge-functions, где `.from('payments_v2')` встречается без `is_deleted`
guard. Все они — административные / bepaid-reconciliation flow-ы, не входящие
в user-facing financial feed. Для Stage 6.C это фиксируется как inventory, но
НЕ блокирует soft-archive (при soft-archive этим функциям всё ещё нужно видеть
tombstones для reconcile/idempotency):

- admin-bepaid-reconcile-amounts, admin-bepaid-full-reconcile,
  admin-bepaid-backfill, admin-fix-uid-contract, admin-fix-payments-integrity,
  admin-fix-false-payments, admin-payment-documents-resolve,
  admin-backfill-2026-orders,
- bepaid-get-subscription-details, bepaid-report-import, bepaid-get-receipt,
  bepaid-get-payment-docs, bepaid-recover-payment, bepaid-fetch-transactions,
  bepaid-reconcile-file, bepaid-fetch-receipt, bepaid-receipts-sync,
  bepaid-docs-backfill, bepaid-receipts-cron, bepaid-receipts-backfill,
- canonical-document-generate-strict.

Все fixture-строки прошли этот backfill: `meta.receipt_backfill_reason =
'no_uid_skipped'` — reconciliation корректно останавливается на них по причине
отсутствия `provider_payment_id`, а не по флагу `is_deleted`. То есть даже без
явного `is_deleted`-фильтра эти функции не создадут вторичных side-effects.

## 6. Guarded DML preview (НЕ ВЫПОЛНЯЕТСЯ)

Скрипт-заготовка для будущего approve. Здесь — только текст,
БЕЗ фактического исполнения. Проверки идемпотентны и fail-closed по count.

```sql
-- guarded soft-archive preview for Stage 6.D (DO NOT RUN in 6.C)
BEGIN;

-- 1) invariant: expect exactly 8 fixture rows
DO $$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt
  FROM public.payments_v2
  WHERE provider = 'admin_test'
    AND status = 'succeeded'
    AND origin = 'bepaid'
    AND user_id = '05cd3754-d589-4d90-97d1-89ba2bee610b'
    AND (meta->>'test_payment')::boolean IS TRUE
    AND meta->>'test_payment_by' = '7500084@gmail.com'
    AND coalesce(nullif(provider_payment_id,''), NULL) IS NULL
    AND coalesce(is_deleted, false) = false;
  IF v_cnt <> 8 THEN
    RAISE EXCEPTION 'stage6c_fixture_count_mismatch: expected 8, got %', v_cnt;
  END IF;
END $$;

-- 2) preview payload (SELECT only — no UPDATE here)
SELECT id,
       'admin_test_fixture' AS stage6_archive_reason,
       jsonb_build_object(
         'stage6_archive_reason','admin_test_fixture',
         'stage6_archived_at', now(),
         'stage6_archive_source','test-payment-complete',
         'stage6_archive_evidence', jsonb_build_object(
            'test_payment', meta->'test_payment',
            'test_payment_by', meta->'test_payment_by',
            'provider_payment_id_null', true,
            'origin', origin
         )
       ) AS proposed_meta_patch
  FROM public.payments_v2
 WHERE provider = 'admin_test';

ROLLBACK;
```

## 7. Что НЕ сделано (по приказу — read-only)

- Не выполнялся `UPDATE payments_v2 SET is_deleted=true` и любой другой DML.
- Не трогали связанные `orders_v2`, `subscriptions_v2`, `access_grant_ledger`,
  `generated_documents`.
- `isTestPaymentLoading` в `PaymentDialog.tsx` и audit-комментарии в
  `AdminOrdersV2.tsx` / `PaymentDialog.tsx` не изменялись.
- Runtime-проверка 410 Gone на published tombstone `test-payment-complete` не
  проводилась (closeout-proof, не блокирует 6.C).

## 8. Открытые вопросы для Stage 6.D approve

1. Судьба **2 production-номеров** `СА-26-00025`, `СА-26-00026`: оставить как
   есть (номера уже потрачены) или планировать отдельный документарный cleanup?
2. Судьба **4 subscriptions_v2** (canceled/superseded): оставить лежать или
   помечать `meta.stage6_archive_reason` симметрично платежам?
3. Judgment call: `entitlement_sources` пусты — доступ этих fixture-заказов
   выдавался только через `access_grant_ledger` (5 записей). Оставить ledger
   как есть (append-only history) — предложение.

## 9. Артефакты

- CSV 8 строк: `/mnt/documents/stage6c/admin_test_payments_v2.csv`
  (sha256 `f1278dd7e7882eb94588f7b0d7d28f35d69054b424a2ba65ea17cb3ed5e728f0`)
- Discovery-report: этот файл.

**Stage 6.C read-only preview: DONE. Ожидает approve для 6.D.**
