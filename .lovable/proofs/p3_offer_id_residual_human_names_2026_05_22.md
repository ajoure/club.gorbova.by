# P3 residual cohort — human-readable proof + bePaid receipt audit

Дата: 2026-05-22 (Minsk)
Статус: **read-only**. Никаких UPDATE / DELETE / INSERT. Тарифы, офферы, заказы, платежи не модифицируются.

Cohort: `orders_v2.status='paid' AND offer_id IS NULL AND tariff_id IS NOT NULL AND meta.is_synthetic<>true`, для которых `tariff_offers.is_active=true count ≠ 1`.

Итого: **228 no_active** (12 тарифов) + **11 multi_active** (1 тариф) = 239 заказов.

---

## 1. no_active — 228 заказов / 12 тарифов

Все продукты живут в `products_v2` (не `products`). Названия восстановлены.

| product_id | product_name | tariff_id | tariff_name | orders | total_offers | active_offers | last_paid | вывод |
|---|---|---|---|---:|---:|---:|---|---|
| 87a8870f | Ценный бухгалтер 2 ступень 3 поток | 5d598dae | Премиум | **90** | 1 | 0 | 2026-03-29 | **manual review**: 1 inactive offer (1990 BYN, 28.03.2026 → деактивирован) — кандидат на восстановление historical offer |
| 87a8870f | Ценный бухгалтер 2 ступень 3 поток | 34628d81 | Стандарт | **21** | 1 | 0 | 2026-03-29 | **manual review**: 1 inactive offer (900 BYN, 28.03.2026 → деактивирован) — кандидат на восстановление historical offer |
| 64d9f812 | ЦБ 1ст 2.0 / модуль Грузоперевозки | 2c84e74c | Стандарт | 17 | 1 | 0 | 2026-05-06 | **manual review**: 1 inactive offer (500 BYN) — кандидат на восстановление |
| abee24cd | ЦБ 1ст 2.0 / модуль Розничная торговля | 0f5183d8 | Стандарт | 17 | 0 | 0 | 2026-05-06 | **оставить как есть**: офферов никогда не было, legacy historical_import |
| 9187db54 | ЦБ 1ст 2.0 / модуль Общепит | c31bf65f | Стандартный | 17 | 0 | 0 | 2026-05-06 | **оставить как есть**: legacy historical_import |
| 99f1f156 | ЦБ 1ст 2.0 / модуль ПВТ | 7f69656c | Вид деятельности: ПВТ | 15 | 0 | 0 | 2026-05-06 | **оставить как есть**: legacy historical_import |
| f833c846 | ЦБ 1ст 2.0 / модуль Строительство | cbc9a3a2 | Стандарт | 15 | 0 | 0 | 2026-05-06 | **оставить как есть**: legacy historical_import |
| 064dd768 | ЦБ 1ст 2.0 / модуль Производство | c12acda3 | Стандарт | 15 | 0 | 0 | 2026-05-16 | **оставить как есть**: legacy historical_import |
| d7effaf4 | ЦБ 1ст 2.0 / модуль Маркетплейсы | 2d75337a | Стандарт | 13 | 0 | 0 | 2026-05-06 | **оставить как есть**: legacy historical_import |
| 50ac58f2 | Тестовый продукт для админов | aa699e38 | Стандарт | 6 | 0 | 0 | 2026-04-23 | **нормально**: тестовый продукт, кнопка документа корректно скрыта |
| 11309c6a | ЦБ 1ст 2.0 / модуль Предзапись | 4248dadf | Стандартный | 1 | 0 | 0 | 2026-04-24 | **оставить как есть**: legacy |
| de36a695 | Подоходный налог ИП | 56ce1995 | 2 этапа | 1 | 2 | 0 | 2026-04-28 | **manual review**: 2 inactive offer (390 BYN, рассрочка/полная) деактивированы 29.04 |

### Сводный вывод по no_active
- **«Восстановить historical offer»** — кандидаты: **5 тарифов / 130 заказов** (87a8870f Премиум/Стандарт 2 ступень 3 поток, 64d9f812 Грузоперевозки, 56ce1995 Подоходный 2 этапа). По всем них inactive offer существует, его суммы совпадают с paid_amount заказов. Решение бизнеса: реактивировать offer на 1 тик, прогнать backfill, снова деактивировать.
- **«Оставить как есть»** — **7 тарифов / 92 заказа** (legacy модули ЦБ 1ст 2.0, тестовый продукт, предзапись): офферов в системе никогда не было, продажи шли через legacy historical_import. Кнопка «Сформировать документ» корректно скрыта, никакие документы по этим заказам не оформлялись. Backfill бесполезен.
- Автоматический backfill **не предлагается** ни по одной группе — только по explicit business approval.

---

## 2. multi_active — 11 заказов / tariff `0fb3db55` (Подоходный налог ИП / «стандарт»)

### Доступные активные офферы

| offer_id | button_label | offer_type | amount | requires_card_tokenization | document_scenarios | document_defaults |
|---|---|---|---:|:-:|---|---|
| `5dfc9ca5-f601-4cf2-95ab-f0a3511f91cc` | Оплатить полную стоимость | pay_now | **350.00 BYN** | false | — | — |
| `7e9187ea-9b7d-48ed-b6d4-9ebf6284e8ae` | Оплатить в рассрочку | pay_now (installment) | 390.00 BYN | true | — | — |

Ни на одном из офферов нет `document_scenarios` / `document_defaults`. **Даже после ручного backfill offer_id кнопка «Сформировать документ» останется скрытой** до тех пор, пока бизнес не настроит шаблон документа на оффере.

### 11 заказов (для ручной классификации)

| # | order_id | order_number | created_at | profile.full_name | email | paid_amount | вероятный canonical offer |
|---:|---|---|---|---|---|---:|---|
| 1 | da83a233 | PAY-26-MN7PE4R2 | 2025-12-30 19:58 | Круголь Вероника | Veronika.krugol@yandex.by | 350.00 | `5dfc9ca5` (полная 350) |
| 2 | a0ec1f74 | GIFT-26-MLQQ8J5Z | 2026-02-07 23:00 | Татьяна Чёкчикова | 791067723@mail.ru | **0.00** (GIFT) | manual: gift, скорее всего `5dfc9ca5` номинал |
| 3 | f8f17976 | PAY-26-MMUQAY2V | 2026-02-28 18:48 | Ольга Велич | li_liana@rambler.ru | 350.00 | `5dfc9ca5` |
| 4 | 65ef18e5 | ORD-LINK-1773078892991 | 2026-03-09 17:54 | Татьяна Чёкчикова | 791067723@mail.ru | **195.00** (частичный/линк) | manual: не совпадает ни с одним offer; вероятно `5dfc9ca5` со скидкой по public_link |
| 5 | df2d8eda | PAY-26-MMUQDEPD | 2026-03-16 21:00 | Светлана Дещеня | lana0407@tut.by | 350.00 | `5dfc9ca5` |
| 6 | 43c34b9a | PAY-26-MMUQOBC8 | 2026-03-16 21:00 | Ирина Гузаревич | irkaguzarevich@mail.ru | 350.00 | `5dfc9ca5` |
| 7 | c86771cf | PAY-26-MMUQJ1SZ | 2026-03-16 21:00 | Наталья Киричко | vainqueur7natka@mail.ru | 350.00 | `5dfc9ca5` |
| 8 | e4839a02 | PAY-26-MMUQM4PF | 2026-03-16 21:00 | Анастасия Молоток | nastya.pahitonova@yandex.by | 350.00 | `5dfc9ca5` |
| 9 | f87bce7c | PAY-26-MMUQGCEC | 2026-03-16 21:00 | Ирина Данилюк | 6214525@mail.ru | 350.00 | `5dfc9ca5` |
| 10 | 603e3336 | ORD-BULK-1774594112563 | 2026-03-27 06:49 | Юлия Рабчевская | rabchevskaya.buh@gmail.com | 350.00 | `5dfc9ca5` |
| 11 | a6067599 | ORD-BULK-1774594112562 | 2026-03-27 06:49 | Наталья Новикова | n.novikova109@gmail.com | 350.00 | `5dfc9ca5` |

### Рекомендация по multi_active
- **8 заказов** (350 BYN, ровно как у offer `5dfc9ca5`) — однозначно canonical = `5dfc9ca5`. Manual decision.
- **1 заказ** (gift 0 BYN) — manual: пометить `5dfc9ca5` как номинал.
- **2 заказа** Чёкчиковой/Рабчевской через ORD-LINK/ORD-BULK с суммами 195 / 350 — manual: проверить public_link и сказать, какой offer привязать.
- Альтернатива (системная): добавить `meta.is_default=true` на `5dfc9ca5`, тогда резолвер сможет автоматически разрулить multi_active. **Это решение бизнеса, не выполняется этим спринтом.**

---

## 3. Сводные рекомендации

| bucket | заказов | действие |
|---|---:|---|
| no_active → legacy historical_import (нет офферов вообще) | 92 | **оставить как есть**, кнопка корректно скрыта |
| no_active → есть 1 inactive offer с матчем суммы | 130 | **manual review**: бизнес-решение о реактивации historical offer |
| multi_active → 1 tariff `0fb3db55` | 11 | **manual decision required**: список 11 клиентов выше; либо назначить offer_id вручную, либо проставить `meta.is_default=true` |

Никакие изменения по этим 239 заказам в рамках текущего спринта **не выполняются**.

---

## 4. Проверка «Сформировать документ» — статус после P3 Этап 1

- Helper `src/lib/documents/purchaseDocumentRules.ts::getOrderOfferId` приоритет column `offer_id` уже включён.
- 2670 заказов получили `offer_id`; для них «Сформировать документ» работает при условии `document_scenarios`/`document_defaults` на оффере.
- 228 no_active + 11 multi_active — кнопка скрыта корректно (`source='none'` → `offer_unresolved`).
- Регресса для других заказов не выявлено (rowcount audit = 2670, mismatches = 0).

---

## 5. bePaid receipts — отдельный audit за 2026

User-request: «по некоторым сделкам невозможно привязать чек, хотя это все карточные платежи через bePaid».

### Сводка по `payments_v2` за 2026

| метрика | значение |
|---|---:|
| `status='succeeded' AND provider='bepaid' AND created_at >= 2026-01-01` | **4290** |
| `receipt_url` (column) непустой | 304 |
| `provider_response.transaction.receipt_url` непустой | 301 |
| **БЕЗ receipt_url ни в column, ни в provider_response** | **3940** |
| из них: есть `provider_payment_id` (bePaid uid) | 3939 |
| из них: есть `provider_response` payload | 490 |
| из них: внутри payload есть `transaction.uid` | 223 |

### Вывод
- ~91 % успешных bePaid платежей за 2026 (3940 из 4290) **не имеют receipt_url**. Кнопка «Чек» в `/purchases` корректно не появляется (зависит только от `getValidReceiptUrl`).
- У 3939 из 3940 есть `provider_payment_id` (bePaid UID) — этого достаточно, чтобы дотянуть `receipt_url` через bePaid API `GET /transactions/{uid}`.
- Эта проблема **системная** и не связана с P3 backfill offer_id. Нужна отдельная edge function-задача: `bepaid-receipts-backfill` (пройтись по 3939 транзакциям, вытянуть `transaction.receipt_url`, записать в `payments_v2.receipt_url` + meta-маркер).

### Предлагаемый план (НЕ выполняется этим спринтом)
1. Dry-run: пройти первые 50 транзакций через bePaid API, проверить наличие `receipt_url` в ответе и валидность.
2. Если успех ≥ 95% — batch-фоновая job 200/min, audit log на каждую запись.
3. Идемпотентность: только если `receipt_url IS NULL`, race-guard, meta marker `bepaid_receipt_backfill_batch=<id>`.
4. Регрессионный verify: после прогона показать (а) сколько `receipt_url` стало непустым, (б) сколько паттернов не вернули receipt (rejected/voided/etc).

Backlog файл: `.lovable/backlog/bepaid_receipts_2026_backfill.md` (создать при следующем подходе после одобрения).
