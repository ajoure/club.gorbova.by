# План: переиспользование продуктов

| Объект | Подтверждённое поле связи | Примечание |
|---|---|---|
| Продукт | `products_v2.id` | Есть `public_id`, `slug`, `primary_domain`, `status`, `is_active` |
| Тариф | `tariffs.id`, `tariffs.product_id` | Есть `public_id`, цены и период видимости |
| Предложение | `tariff_offers.id` через `orders_v2.offer_id` | Фактический DDL проверить live |
| Публичная страница | site pages/domain bindings | URL должен разрешаться существующим resolver, не собираться из slug вручную |
| Карточка продукта | `AdminProductDetailV2` | Добавить вкладку с allowlist/deep-link после freeze |

Правило комиссии хранит UUID и версию; название/slug — только snapshot/display.
