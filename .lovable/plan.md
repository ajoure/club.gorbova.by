

# План: Мульти-выбор продуктов и тарифов в фильтре аудитории рассылок

## Что делаем
Заменяем одиночный Select продукта на мульти-выбор с галочками (чекбоксами). Добавляем выбор тарифов — тоже с галочками. Можно выбрать несколько продуктов и несколько тарифов одновременно.

## Изменения

### 1. Фронтенд — BroadcastsTabContent.tsx (быстрая рассылка)
- Заменить `productId: string` → `productIds: string[]` и `tariffId: string` → `tariffIds: string[]` в интерфейсе фильтров
- Вместо `<Select>` для продукта — Popover с чекбоксами и списком продуктов
- Добавить блок тарифов: загружать тарифы для всех выбранных продуктов, показывать чекбоксами с группировкой по продукту
- Обновить логику подсчёта аудитории: фильтрация по массиву product_id и tariff_id через `.in()`
- Обновить отправку: передавать `productIds` и `tariffIds` массивами в edge function

### 2. Фронтенд — BroadcastSendDialog.tsx (отправка из шаблона)
- Аналогичные изменения: мульти-выбор продуктов и тарифов

### 3. Backend — telegram-mass-broadcast edge function
- Обновить интерфейс `BroadcastFilters`: `productId` → `productIds: string[]`, добавить `tariffIds: string[]`
- Фильтрация: если `productIds.length > 0` → `.in('product_id', productIds)`, аналогично для `tariffIds`
- Сохранить обратную совместимость со старым форматом (`productId` string) как fallback

### 4. Backend — email-mass-broadcast edge function
- Те же изменения фильтрации

### Файлы
| Файл | Действие |
|------|----------|
| `src/components/admin/communication/BroadcastsTabContent.tsx` | Мульти-выбор продуктов + тарифов |
| `src/components/admin/communication/BroadcastSendDialog.tsx` | Мульти-выбор продуктов + тарифов |
| `supabase/functions/telegram-mass-broadcast/index.ts` | Поддержка массивов productIds/tariffIds |
| `supabase/functions/email-mass-broadcast/index.ts` | Поддержка массивов productIds/tariffIds |

### UI поведение
- Кнопка «Продукт» → открывает попавер с чекбоксами всех активных продуктов
- При выборе продуктов появляется блок «Тариф» с чекбоксами тарифов выбранных продуктов
- Выбранные продукты/тарифы отображаются как badges рядом с фильтром
- Аудитория пересчитывается автоматически при изменении выбора

