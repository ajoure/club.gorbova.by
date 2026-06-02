# Discovery: business_stream classification

Дата: 2026-06-02. Цель — классифицировать каждый платёж по бизнес-потоку для аналитики и отчётности, даже когда несколько потоков обслуживаются одним Stripe-аккаунтом.

## 1. Перечень потоков (whitelist на старте)

| Код | Описание |
|---|---|
| `accounting_school` | Школа главного бухгалтера и связанные курсы |
| `consulting` | Индивидуальные консультации |
| `documents` | Платная генерация документов |
| `club` | Клубные подписки (recurring) |
| `marketplace` | Маркетплейс/сторонние товары (на будущее) |

Правила добавления нового потока: новый код в этом файле + миграция-комментарий + обновление дефолт-резолвера. Никакого CHECK constraint — text-поле для гибкости.

## 2. Приоритет источников определения `business_stream`

1. **`tariff_offers.meta.business_stream`** — explicit per-offer (highest).
2. **`products.meta.business_stream`** — fallback по продукту.
3. **`orders_v2.meta.business_stream`** — snapshot на момент заказа (обязательное поле для всех новых заказов после Фазы 1).
4. **Дефолт-резолвер по `product_id`** — hardcoded mapping в `_shared/business-stream-resolver.ts` на старте; миграция в БД — Фаза 3.

## 3. Маппинг существующих 18 продуктов (черновик — уточняется в Q5 open_questions v2)

| product_name | предложенный stream |
|---|---|
| Школа главного бухгалтера | `accounting_school` |
| Бухгалтер выходного дня | `accounting_school` |
| CB-1, CB20 | `accounting_school` |
| Идеология | `documents` |
| Закрытие года, Аудиты | `documents` |
| Клуб (Gorbova Club) | `club` |
| Консультации | `consulting` |
| (остальные) | TBD |

## 4. Связь с CRM
Источник: memory `product-pipeline-mapping-canon`. Каждый pipeline относится к одному `business_stream`. В Фазе 2 добавляется поле `crm_pipelines.business_stream` (nullable). Аналитика «Воронка × Поток» — Фаза 3.

## 5. Контракт metadata для Stripe

Stripe Checkout Session/PaymentIntent metadata ОБЯЗАН содержать (см. `stripe_metadata_contract_v1.md`):
- `business_stream`
- `account_code`
- `product_id`, `tariff_id`
- `order_id`
- `payment_link_id` (опционально)
- `contact_id` (опционально)
- `provider` = `stripe`

## 6. Аналитический ракурс (только проектирование)

- `/admin/payments/by-stream` — sum/count платежей по `business_stream` × период.
- `/admin/payments/by-account` — то же по `account_code`.
- `/admin/payments/cross-stream-anomalies` — заказы, где `tariff.meta.business_stream ≠ order.meta.business_stream` (для аудита).

## 7. Backfill существующих заказов

Backlog-итем: `backfill_orders_business_stream_v1`. Резолвит по product_id для всех `orders_v2 WHERE meta->>'business_stream' IS NULL`. Идемпотентно, audit `business_stream_backfill_v1`. НЕ делаем на этапе discovery.

## 8. DoD
- ✅ Whitelist потоков зафиксирован.
- ✅ Приоритет источников определён.
- ✅ Контракт metadata совпадает с `stripe_metadata_contract_v1.md`.
- ✅ Дефолт-маппинг 18 продуктов — черновик готов, финал в Q5.
