# Stage 6 Cleanup — финальный отчёт

Дата: 2026-07-15. Статус: **PASS**. Все изменения выполнены одной транзакцией, без физического DELETE, с fail-closed пост-инвариантами.

## Итог

```
STAGE 6 CLEANUP PATCH : PASS
  A admin_test soft-archive       : 8 payments, 7 orders soft-deleted;
                                    4 subs + 7 docs — только metadata marker
  B bank_transfer S4R1            : DEFERRED (обе строки уже is_deleted=true до патча)
  C admin_from_payment duplicate  : 113 payments soft-archived (все с canonical bepaid)
  D admin_from_payment HOLD       : 0 (класс пуст — все 113 доказали lineage)
  E admin_grant archive           : 201 payments soft-archived
  test-payment-complete           : REMOVED (edge-функция + локальный код)
  UI audit comments               : REMOVED (isTestPaymentLoading, Stage 6.B комментарии)
STAGE 6                           : CLOSED
SPRINT                            : FULLY CLOSED
```

Итого DML в одной транзакции: **322 payments soft-archived** + **7 orders soft-archived** + **11 metadata-only markers** (4 subs + 7 docs). Всё сверено пост-инвариантами.

## Пост-инварианты (VERIFY, после COMMIT)

| Проверка | Ожидалось | Фактически |
|----------|-----------|------------|
| `payments_v2 provider='admin_test' AND is_deleted=false` | 0 | **0** |
| `payments_v2 provider='admin' AND meta.source='admin_from_payment' AND is_deleted=false` | 0 | **0** |
| `payments_v2 provider='admin' AND meta.source='admin_grant' AND is_deleted=false` | 0 | **0** |
| `payments_v2 provider='admin' AND meta.source='admin_deal_only' AND is_deleted=false` | 1 (untouched) | **1** |
| `orders_v2 order_number LIKE 'ORD-TEST-%' AND is_deleted=false` | 0 | **0** |
| `payments_v2 meta.stage6_cleanup='admin_test_fixture'` | 8 | **8** |
| `payments_v2 meta.stage6_cleanup='admin_from_payment_duplicate'` | 113 | **113** |
| `payments_v2 meta.stage6_cleanup='admin_grant_archive'` | 201 | **201** |
| `ai_generated_documents meta.stage6_cleanup='test_document_void'` | 7 | **7** |
| `subscriptions_v2 meta.stage6_cleanup='admin_test_fixture'` | 4 | **4** |
| Canonical bepaid succeeded sum (rev untouched) | unchanged | **1 052 936.23** |
| `payment_reconcile_queue` md5 checksum | unchanged | **unchanged** |
| Canonical bepaid rows md5 checksum | unchanged | **unchanged** |
| Stage 6.G триггер активен | ON | **`trg_payments_v2_provider_whitelist` = O (enabled)** |

## Что НЕ было тронуто

- `access_grant_ledger` (audit trail — 5 записей ORD-TEST-*, 24-колоночная таблица не изменена).
- `entitlements` — не изменены; проверено, что `grant-eligibility.ts` читает `orders_v2.meta.source`, а не `payments_v2`.
- `payment_reconcile_queue` — md5-checksum до и после совпадает.
- Canonical bePaid платежи — md5-checksum до и после совпадает.
- `document_number_sequences` — не откатывались, номера СА-* / 2105/* / 2505/* сохранены (документы получили только метку `void_reason` в `meta`, статус не менялся).
- 1 строка `admin/admin_deal_only` (amount=0) — вне scope патча.
- 9 строк admin_from_payment с queue-ссылкой в архиве оказались не отдельным HOLD-классом: manifest доказал полный canonical lineage для всех 113. HOLD = 0.
- Stage 6.G провайдер-триггер и whitelist — без изменений.

## Отличия от исходного плана (доказанные PREVIEW)

1. **B (bank_transfer)** уже был soft-archived до патча — исключён.
2. **C = 113**, не ~104: все имеют строгую цепочку `admin_from_payment.meta.queue_payment_id → payment_reconcile_queue.bepaid_uid → payments_v2(bepaid,succeeded).provider_payment_id` с совпадением amount/currency.
3. **D HOLD = 0**.
4. **Документы**: в БД нет `СА-26-00025 / СА-26-00026`. Реально связаны 7 документов формата `2105/*` и `2505/*`. Статус не меняется — только `meta.stage6_cleanup='test_document_void'` + `void_reason='admin_test_fixture'`.
5. **subs**: `subscriptions_v2` не имеет enum/CHECK для 'archived'. Статус не менялся; только `meta`.
6. **admin_deal_only (1 строка)** — новая под-категория, обнаружена в PREVIEW. Вне scope, оставлена как есть.

## Артефакты

- `/mnt/documents/stage6_cleanup/manifest_A_payments.csv` (8 rows, sha256 8f933f1d…)
- `/mnt/documents/stage6_cleanup/manifest_A_orders.csv` (7 rows, sha256 5fd299ca…)
- `/mnt/documents/stage6_cleanup/manifest_A_subs.csv` (4 rows, sha256 def41c0f…)
- `/mnt/documents/stage6_cleanup/manifest_A_docs.csv` (7 rows, sha256 aa9d568e…)
- `/mnt/documents/stage6_cleanup/manifest_C_payments.csv` (113 rows, sha256 51930bf2…)
- `/mnt/documents/stage6_cleanup/manifest_E_payments.csv` (201 rows, sha256 39ba2ce2…)
- `/mnt/documents/stage6_cleanup/CHECKSUMS.txt`
- `/mnt/documents/stage6_cleanup/migration.sql` (41 185 байт, применённая версия)
- `.lovable/discovery/stage6_cleanup_preview.md` — PREVIEW-документ
- `.lovable/discovery/stage6_cleanup_final.md` — этот отчёт
- Supabase-миграция `20260715…_stage6_cleanup_consolidated` — применена.

## Инженерные инварианты, оставшиеся активными

- **DB-инвариант Stage 6.G** — триггер `trg_payments_v2_provider_whitelist` активен, whitelist `{bepaid,stripe,rr,bank}`.
- **Runtime-инвариант Stage 6.B** — edge-функция `test-payment-complete` физически удалена; на любой запрос платформа отвечает 404.
- **UI-инвариант Stage 6.B** — все хвосты (`isTestPaymentLoading`, Stage 6.B комментарии) вычищены из `PaymentDialog.tsx` и `AdminOrdersV2.tsx`.
- **Financial-инвариант Stage 6.F** — canonical revenue не изменилась (`compute_order_financial_state` использует whitelist, soft-archived admin-строки исключаются автоматически по `is_deleted=true`).

## Backlog (нечего дальше делать по этому спринту)

Пусто. Единственная явно оставленная строка — `admin/admin_deal_only` (amount=0), которая никак не влияет на выручку и на выдачу доступа. Она сохранена как исторический маркер; при возникновении отдельной задачи может быть обработана независимо.
