
# План: Фикс импорта/материализации платежей (PATCH 2026+)

## Статус: В ПРОЦЕССЕ

---

## PATCH-1: admin-materialize-queue-payments (BLOCKER) ✅ DONE

**Файл:** `supabase/functions/admin-materialize-queue-payments/index.ts`

**Изменения:**
- ❌ Было: `stableUid = item.bepaid_uid || item.tracking_id || item.id`
- ✅ Стало: `stableUid = item.bepaid_uid || null`
- Если нет `bepaid_uid`:
  - НЕ создаём `payments_v2`
  - Помечаем queue item `status='needs_uid'`
  - Audit: `payment.queue_item_missing_bepaid_uid` (system actor)

---

## PATCH-2: Импорт (уже корректно)

- `provider_payment_id` = UID операции (transaction.uid)
- `meta.tracking_id` = Tracking ID
- Tracking ID никогда не используется для идемпотентности

---

## PATCH-3: admin-purge-payments-by-uid ✅ DONE

**Файл:** `supabase/functions/admin-purge-payments-by-uid/index.ts`

**Функционал:**
- Вход: `provider_payment_ids[]` или `import_batch_id` или `purge_tracking_as_uid: true`
- `dry_run: true` (по умолчанию) — показывает что будет удалено
- `dry_run: false` — удаляет платежи
- Требует `super_admin`
- Audit: `payment.purge_dry_run` / `payment.purge_executed`

---

## PATCH-4: subscription-charge fix (2026+) ✅ DONE

**Файл:** `supabase/functions/subscription-charge/index.ts`

**Изменения:**
- ✅ Используем `updatedPayment.status` вместо `payment.status`
- ✅ Добавлен guard `is2026Plus` (paid_at >= 2026-01-01)
- Renewal order создаётся только для 2026+

---

## PATCH-5: admin-backfill-2026-orders ✅ DONE

**Файл:** `supabase/functions/admin-backfill-2026-orders/index.ts`

**Функционал:**
- Scope: `payments_v2` where:
  - `paid_at >= 2026-01-01`
  - `status = 'succeeded'`
  - `amount > 0`
  - `profile_id IS NOT NULL`
  - `provider_payment_id IS NOT NULL`
  - `order_id IS NULL`
- Создаёт order, линкует payment
- Если product/tariff не найден → `needs_mapping` в meta
- Audit: `subscription.renewal_backfill_2026`

---

## DoD SQL Queries

```sql
-- 1) Нет payment 2026+ где provider_payment_id = meta.tracking_id
SELECT COUNT(*) FROM payments_v2
WHERE paid_at >= '2026-01-01' 
  AND (meta->>'tracking_id') IS NOT NULL
  AND provider_payment_id = (meta->>'tracking_id');

-- 2) Нет orphan payments 2026+ с контактом
SELECT COUNT(*) FROM payments_v2
WHERE paid_at >= '2026-01-01' 
  AND status = 'succeeded' 
  AND amount > 0
  AND profile_id IS NOT NULL 
  AND order_id IS NULL;

-- 3) SYSTEM ACTOR proof
SELECT action, COUNT(*) FROM audit_logs
WHERE actor_type = 'system' 
  AND actor_user_id IS NULL
  AND action IN (
    'payment.queue_item_missing_bepaid_uid',
    'payment.purge_executed',
    'subscription.renewal_order_created',
    'subscription.renewal_backfill_2026'
  )
GROUP BY action;
```

---

## Файлы изменены

| Файл | Изменение |
|------|-----------|
| `supabase/functions/admin-materialize-queue-payments/index.ts` | Убран fallback на tracking_id |
| `supabase/functions/subscription-charge/index.ts` | Исправлен status check + 2026 guard |
| `supabase/functions/admin-purge-payments-by-uid/index.ts` | **НОВЫЙ** — purge tool |
| `supabase/functions/admin-backfill-2026-orders/index.ts` | **НОВЫЙ** — backfill 2026+ |
| `supabase/config.toml` | Добавлены конфиги для новых функций |
