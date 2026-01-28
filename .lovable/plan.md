

# План: Исправление дат 59 сделок

## Задача
Обновить `created_at` у сделок в таблице `orders_v2`, чтобы дата соответствовала дате платежа (`paid_at`) из связанной записи в `payments_v2`.

## Что будет сделано

### SQL-миграция

```sql
-- Исправить даты сделок, где created_at не совпадает с paid_at платежа
UPDATE orders_v2 o
SET 
  created_at = p.paid_at,
  updated_at = now(),
  meta = COALESCE(o.meta, '{}'::jsonb) || jsonb_build_object(
    '_date_fixed_at', now()::text,
    '_old_created_at', o.created_at::text,
    '_fixed_by', '7500084@gmail.com'
  )
FROM payments_v2 p
WHERE p.order_id = o.id
  AND p.paid_at IS NOT NULL
  AND DATE(o.created_at) != DATE(p.paid_at);
```

## Что НЕ будет затронуто
- Подписки (`subscriptions_v2`) — даты доступа останутся без изменений
- Права доступа (`entitlements`) — не изменяются
- Платежи (`payments_v2`) — только читаем для получения правильной даты

## Результат
- 59 сделок получат правильную дату создания
- Старая дата сохранится в `meta._old_created_at` для аудита
- Фиксируется кто инициировал исправление

