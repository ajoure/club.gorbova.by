# Архив устаревшего кода

Этот каталог содержит устаревший код, который был заменён новыми версиями.
Файлы сохранены для возможности быстрого восстановления при необходимости.

## Структура

### pages/
- `AdminProducts.tsx` - Legacy V1 продукты (заменён на AdminProductsV2)
- `AdminPayments.tsx` - Legacy V1 платежи (заменён на AdminPaymentsV2)
- `AdminUsers.tsx` - Legacy управление пользователями (заменён на AdminContacts)
- `Pricing.tsx` - Старая страница тарифов (заменена на /#pricing)

### hooks/
- `useSubscription.tsx` - Legacy хук подписок (работает с таблицей `subscriptions`)

## Таблицы базы данных

### Legacy (V1) таблицы:
- `products` → заменена на `products_v2`
- `orders` → заменена на `orders_v2`
- `subscriptions` → заменена на `subscriptions_v2`

### Актуальные (V2) таблицы:
- `products_v2` - Продукты с тарифами
- `tariffs` - Тарифные планы
- `tariff_offers` - Варианты покупки (trial, pay_now)
- `tariff_features` - Преимущества тарифов
- `orders_v2` - Заказы
- `payments_v2` - Платежи
- `subscriptions_v2` - Подписки

## Дата архивации
6 января 2026 года

## Примечания
- Edge functions по-прежнему содержат fallback на legacy таблицы для обратной совместимости
- Перед полным удалением legacy кода необходимо убедиться, что все данные мигрированы
