# P3 residual — no_active 228 + multi_active 11 (human names, final status)

Дата: 2026-05-22 (Minsk). Status: **read-only.** Бизнес-решения зафиксированы.

## 1. no_active (228 orders, 12 тарифов) — `leave_as_historical_no_offer_backfill`

Все эти заказы — исторические покупки старых продуктов/модулей ЦБ 1 ступень 2.0, старых потоков ЦБ 2 ступень и legacy «Подоходный налог ИП / 2 этапа». По ним:
- **НЕ нужна** кнопка «Сформировать документ»;
- **НЕ восстанавливаем** офферы;
- **НЕ проставляем** `offer_id`;
- доступ к контенту продолжает работать через entitlements / access_rules / историческую логику и не зависит от `offer_id`.

| product_name | tariff_name | tariff_id | orders | бизнес-решение |
|---|---|---|---|---|
| Ценный бухгалтер \| 2 ступень \| 3 поток \| | Премиум | 5d598dae-… | 90 | leave_as_historical |
| Ценный бухгалтер \| 2 ступень \| 3 поток \| | Стандарт | 34628d81-… | 21 | leave_as_historical |
| Ценный бухгалтер \| 1 ступень 2.0 \| Модуль: Грузо- и пассажироперевозки | Стандарт | 2c84e74c-… | 17 | leave_as_historical |
| Ценный бухгалтер \| 1 ступень 2.0 \| Модуль: Общепит | Стандартный | c31bf65f-… | 17 | leave_as_historical |
| Ценный бухгалтер \| 1 ступень 2.0 \| Модуль: Розничная торговля | Стандарт | 0f5183d8-… | 17 | leave_as_historical |
| Ценный бухгалтер \| 1 ступень 2.0 \| Модуль: Строительство | Стандарт | cbc9a3a2-… | 15 | leave_as_historical |
| Ценный бухгалтер \| 1 ступень 2.0 \| Модуль: Производство | Стандарт | c12acda3-… | 15 | leave_as_historical |
| Ценный бухгалтер \| 1 ступень 2.0 \| Модуль: ПВТ | Вид деятельности: ПВТ | 7f69656c-… | 15 | leave_as_historical |
| Ценный бухгалтер \| 1 ступень 2.0 \| Модуль: Маркетплейсы | Стандарт | 2d75337a-… | 13 | leave_as_historical |
| Тестовый продукт для админов | Стандарт | aa699e38-… | 6 | leave_as_historical (test) |
| Подоходный налог ИП | 2 этапа | 56ce1995-… | 1 | leave_as_historical |
| Ценный бухгалтер \| 1 ступень 2.0 \| Модуль: Предзапись | Стандартный | 4248dadf-… | 1 | leave_as_historical |

**Итог по no_active:** 228 заказов, статус **`leave_as_historical_no_offer_backfill`**. Никаких UPDATE по этой когорте не планируется. Backfill закрыт.

## 2. multi_active (11 orders, тариф 0fb3db55) — `amount_based_backfill_approved`

Продукт: **Подоходный налог ИП**, тариф: **стандарт**.

Бизнес-решение по офферам:
- `5dfc9ca5` — полная оплата **350 BYN**.
- `7e9187ea` — рассрочка **390 BYN** (2 платежа × 195 BYN).

Distribution:
- **9 × 350 BYN** → backfill offer `5dfc9ca5` (full_payment_350).
- **1 × 195 BYN** (Татьяна Чёкчикова, ORD-LINK-1773078892991) → backfill offer `7e9187ea` (installment_195).
- **1 × 0 BYN GIFT** (GIFT-26-MLQQ8J5Z) → `gift_manual_review`, НЕ трогаем автоматически.

Подробный dry-run: `.lovable/proofs/p3_multi_active_dryrun_2026_05_22.md`.

**Note:** даже после backfill `offer_id` по этим 10 кнопка «Сформировать документ» останется скрыта, пока в `5dfc9ca5`/`7e9187ea` не настроены `document_scenarios`. Это ожидаемо.

## Финальные статусы P3 residual

| cohort | orders | status | действие |
|---|---|---|---|
| no_active | 228 | `leave_as_historical_no_offer_backfill` | — |
| multi_active (350) | 9 | `ready_for_execute` | UPDATE offer_id=5dfc9ca5 |
| multi_active (195) | 1 | `ready_for_execute` | UPDATE offer_id=7e9187ea |
| multi_active (GIFT) | 1 | `gift_manual_review` | manual, в backlog |
