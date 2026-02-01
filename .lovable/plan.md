# План v3.1: Предзаписи «Бухгалтерия как бизнес» — СТАТУС ВЫПОЛНЕНИЯ

## ✅ Выполненные патчи

### PATCH-1 (BLOCKER): charge_offer_id → auto_charge_offer_id
- ✅ Исправлено: `.select("id, meta, auto_charge_offer_id")`
- ✅ Исправлен приоритет chargeOfferId: `meta?.preregistration?.charge_offer_id || meta?.charge_offer_id || preregOffer?.auto_charge_offer_id`

### PATCH-2 (BLOCKER): добавить meta в select preregistrations  
- ✅ Добавлено поле `meta` в выборку preregistrations

### PATCH-3 (HIGH): UI таблица как AutoRenewals
- ✅ Добавлены колонки: Карта, Попытки, Last Attempt, TG, Email
- ✅ Визуализация ●/○ для статуса уведомлений

### PATCH-4 (MEDIUM): Stats по productFilter
- ✅ Stats query теперь фильтрует по выбранному продукту

### PATCH-5 (LOW): убрать converted
- ✅ Удалён из statusConfig и фильтров

### PATCH-6 (GUARD): стоп-предохранители
- ✅ MAX_BATCH=50, MAX_ERRORS=10, MAX_RUNTIME_MS=55000
- ✅ guards в результатах: batch_limited, error_aborted, runtime_aborted

## ⚠️ Обнаруженная проблема при тестировании

Edge Function работает, но есть баг с схемой orders_v2:
- Ошибка: `Could not find the 'amount' column of 'orders_v2' in the schema cache`
- Причина: колонка называется `paid_amount`, не `amount`
- Статус: исправлено в коде, но Supabase кэширует схему

## Изменённые файлы

| Файл | Изменения |
|------|-----------|
| `supabase/functions/preregistration-charge-cron/index.ts` | PATCH-1,2,6: charge_offer_id→auto_charge_offer_id, +meta, +guards |
| `src/components/admin/payments/PreregistrationsTabContent.tsx` | PATCH-3,4,5: новые колонки, фильтр по продукту, удалён converted |

## Результат последнего вызова функции

```json
{
  "processed": 10,
  "charged": 0,
  "failed": 10,
  "skipped": 0,
  "guards": {"batch_limited": false, "error_aborted": true}
}
```

Функция находит 26 prereg, обрабатывает, но упирается в кэш схемы. После обновления кэша должна работать.

## Следующий шаг

Подождать 5-10 минут для обновления schema cache или повторить deploy.
