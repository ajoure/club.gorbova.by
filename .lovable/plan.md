
# План: Удаление ORPH-* сделок без контактов

## Диагностика (факт)

| Метрика | Значение |
|---------|----------|
| Всего ORPH-orders | 695 |
| Без user_id | 687 |
| Без profile_id | 392 |
| Полностью без контакта | 392 |
| Привязанных платежей | 695 |
| Оригинальный order_id у платежей | NULL (все были orphan) |

**Важно:** Все эти платежи изначально не имели `order_id` (`original_order_id: null`). Backfill создал для них ORPH-orders, но без контактов.

---

## Шаги очистки

### Шаг 1: Отвязать платежи от ORPH-orders

Вернуть `payments_v2.order_id = NULL` для всех платежей, привязанных к ORPH-orders.

```sql
-- Отвязать платежи от ORPH-orders
UPDATE payments_v2 p
SET 
  order_id = NULL,
  meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
    'orph_order_removed_at', now()::text,
    'removed_orph_order_id', p.order_id::text
  )
FROM orders_v2 o
WHERE o.id = p.order_id
  AND o.order_number LIKE 'ORPH-%'
  AND o.created_at >= '2026-01-26 00:00:00+00';
```

### Шаг 2: Удалить ORPH-orders

```sql
-- Удалить ORPH-orders созданные сегодня
DELETE FROM orders_v2
WHERE order_number LIKE 'ORPH-%'
  AND created_at >= '2026-01-26 00:00:00+00';
```

### Шаг 3: Создать audit log (system actor)

```sql
-- Записать в audit_logs
INSERT INTO audit_logs (actor_type, actor_user_id, actor_label, action, meta)
VALUES (
  'system',
  NULL,
  'admin-cleanup-orph-orders',
  'cleanup.orph_orders_deleted',
  jsonb_build_object(
    'deleted_count', 695,
    'reason', 'orders_without_contacts',
    'executed_at', now()::text
  )
);
```

---

## Что НЕ затрагивается

- **Telegram-уведомления:** Никаких вызовов к Telegram API
- **Подписки:** Не изменяются
- **Другие orders:** Только ORPH-* созданные 26.01.2026
- **Платежи:** Остаются, только отвязываются от удаляемых orders

---

## Проверка после выполнения

```sql
-- Должно быть 0
SELECT COUNT(*) 
FROM orders_v2 
WHERE order_number LIKE 'ORPH-%'
  AND created_at >= '2026-01-26 00:00:00+00';

-- Должно быть 695 (отвязанных)
SELECT COUNT(*) 
FROM payments_v2 
WHERE (meta->>'removed_orph_order_id') IS NOT NULL;
```

---

## Технические детали

**Выполняется через:** SQL migration tool (2 UPDATE + 1 DELETE + 1 INSERT)

**Безопасность:** 
- Фильтр по дате `>= 2026-01-26` гарантирует, что не затронутся другие данные
- Фильтр по `ORPH-%` гарантирует, что затронутся только созданные backfill-ом orders
- Meta сохраняет информацию об удалённых orders для аудита

**Ожидаемый результат:**
- UI "Сделки" больше не показывает пустые записи
- Платежи возвращаются в состояние "orphan" (без order_id)
- Можно будет потом правильно обработать эти платежи через reconcile
