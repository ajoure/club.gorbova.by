# План: FIX UID CONTRACT + Полная синхронизация bePaid

## Жёсткие правила исполнения
1. Ничего не ломать и не трогать лишнее. Минимальный diff.
2. Add-only где возможно. Любые исправления данных — только через dry_run→execute.
3. STOP-guards обязательны (лимиты, батчи, таймауты, idempotency).
4. Никаких silent-skip при импорте/синке: каждое пропущенное событие должно быть видно.
5. DoD только по фактам: SQL + audit_logs + UI-скрины из 7500084@gmail.com.
6. No-PII в логах.
7. Никаких эвристик матчинга UID по сумме/времени.

---

## PATCH-0 (BLOCKER): Канонический UID-контракт ✅ DONE

**Контракт**: `payments_v2.provider_payment_id` = строго `bePaid.transaction.uid` для `provider='bepaid'`.

**Реализация**: Edge Function `admin-fix-uid-contract/index.ts`

**Источники UID (ТОЛЬКО)**:
1. `provider_response->>'uid'` (если `provider_response` не null)
2. `bepaid_statement_rows.uid` через exact-match по `tracking_id` (только уникальные)

**ЗАПРЕЩЕНО**: Эвристики amount+paid_at, "похожий" tracking_id.

**Что делает**:
- Если найден UID и он != текущего `provider_payment_id`:
  - `meta.legacy_provider_payment_id` = старое значение
  - `provider_payment_id` = новый uid
- Если UID не найден: `meta.needs_manual_uid_fix = true`

**Режимы**: `dry_run`, `limit`, `batch_size`  
**STOP**: если `found_uid_rate < 50%` в execute mode

**DoD-0**:
```sql
SELECT count(*) FROM payments_v2
WHERE provider='bepaid'
  AND provider_response IS NOT NULL
  AND provider_payment_id <> (provider_response->>'uid');
-- Ожидание: 0
```

---

## PATCH-1 (BLOCKER): Repair Mismatch Orders ✅ DONE

**Edge Function**: `admin-repair-mismatch-orders/index.ts`

**Phase 1 (dry_run/execute)**:
- Найти `orders_v2.status='paid'` где:
  - Нет связанного платежа `succeeded`
  - Или платеж `status IN ('processing','failed','pending')`
  - Или `provider_payment_id IS NULL`

**Действие**:
- `orders_v2.status = 'pending'`
- `orders_v2.meta.needs_review = true`
- `orders_v2.meta.review_reason = 'payment_status_mismatch'`

**ЗАПРЕТ**: НЕ трогать entitlements/subscriptions/telegram_access/deals.

**DoD-1**:
```sql
SELECT count(*) FROM orders_v2 o
JOIN payments_v2 p ON p.order_id = o.id
WHERE o.status='paid' AND p.status <> 'succeeded';
-- Ожидание: 0
```

---

## PATCH-2 (BLOCKER): Reconcile Statement-First ✅ DONE

**Файл**: `bepaid-sync-orchestrator/index.ts`

**Изменения**:
1. Убраны exclusion counts как "фейк-успех" — всегда 0
2. Новая стратегия `statement_first`: если bePaid API недоступен, сравниваем `bepaid_statement_rows` vs `payments_v2`
3. Добавлены поля: `statement_count`, `db_count`, `missing_in_db`, `missing_uids_sample`

**DoD-2**:
- В Sync UI dry-run есть `missing_uids_sample` если есть расхождения
- `excluded_import_count = 0`

---

## PATCH-3: UI показывает ВСЁ ✅ DONE

**Изменения**:
1. `useUnifiedPayments.tsx` — убран `.not("paid_at", "is", null)`, расширен origin filter
2. `PaymentsTabContent.tsx` — default `status = 'all'`, добавлен pill "В обработке"
3. `SyncRunDialog.tsx`:
   - Показывает `missing_uids_sample` (первые 50)
   - Показывает statement reconcile stats (statement_count, db_count, missing_in_db)
   - Badge для strategy = 'Statement'

**DoD-3**:
- `/admin/payments` при `status=all` показывает полный объём
- Вкладка "В обработке" видна и работает

---

## Порядок выполнения

1. ✅ PATCH-0: FIX UID CONTRACT (dry_run → execute)
2. ✅ PATCH-2: Reconcile statement-first + убрать exclusions
3. ✅ PATCH-3: UI "всё"
4. ✅ PATCH-1: Repair mismatch orders (dry_run → execute)

---

## DoD (Обязательные пруфы)

### DoD-0: UID Contract Fixed
```sql
SELECT count(*) FROM payments_v2 
WHERE provider='bepaid' 
  AND provider_response IS NOT NULL 
  AND provider_payment_id <> (provider_response->>'uid');
-- Должно быть 0
```

### DoD-1: Mismatch Orders Repaired  
```sql
SELECT count(*) FROM orders_v2 o 
JOIN payments_v2 p ON p.order_id = o.id 
WHERE o.status='paid' AND p.status <> 'succeeded';
-- Должно быть 0
```

### DoD-2: Sync показывает missing_uids
- Запустить Sync dry-run
- В отчёте есть `missing_uids_sample`
- `excluded_import_count = 0`

### DoD-3: UI показывает все транзакции
- Скриншот `/admin/payments` с "Все статусы"
- Есть вкладка "В обработке"

### DoD-4: Audit Logs
```sql
SELECT action, actor_label, meta->>'repaired_count', created_at 
FROM audit_logs 
WHERE action LIKE '%uid_contract%' OR action LIKE '%mismatch%'
ORDER BY created_at DESC LIMIT 10;
```

---

## Созданные/изменённые файлы

| Файл | Патч | Статус |
|------|------|--------|
| `supabase/functions/admin-fix-uid-contract/index.ts` | PATCH-0 | ✅ СОЗДАН |
| `supabase/functions/admin-repair-mismatch-orders/index.ts` | PATCH-1 | ✅ СОЗДАН |
| `supabase/functions/bepaid-sync-orchestrator/index.ts` | PATCH-2 | ✅ ИЗМЕНЁН |
| `src/components/admin/payments/SyncRunDialog.tsx` | PATCH-3 | ✅ ИЗМЕНЁН |
| `src/hooks/useUnifiedPayments.tsx` | PATCH-3 | ✅ (ранее) |
| `src/components/admin/payments/PaymentsTabContent.tsx` | PATCH-3 | ✅ (ранее) |

---

## Следующие шаги

1. **Запустить PATCH-0** (dry_run=true) через вызов Edge Function
2. **Проверить результат** — если `found_uid_rate >= 50%`, запустить execute
3. **Запустить PATCH-1** (dry_run=true) — посмотреть список mismatch orders
4. **Проверить Sync** — должен показывать statement_first + missing_uids
5. **Проверить UI** — все транзакции видны, вкладка "В обработке" работает
