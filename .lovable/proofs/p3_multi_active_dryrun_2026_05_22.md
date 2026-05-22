# P3 multi_active — dry-run по тарифу «Подоходный налог ИП / стандарт» (0fb3db55)

Дата: 2026-05-22 (Minsk). Status: **dry-run only, без UPDATE.**

## Бизнес-правило (утверждено)
- offer `5dfc9ca5` — полная оплата 350 BYN.
- offer `7e9187ea` — рассрочка 390 BYN (2 платежа по 195 BYN).
- `paid_amount=350` → `proposed_offer_id=5dfc9ca5`, reason `full_payment_350`.
- `paid_amount=195` → `proposed_offer_id=7e9187ea`, reason `installment_195`.
- `paid_amount=0` (GIFT) → НЕ трогать, reason `gift_manual_review`.

## Cohort (11 заказов)

| # | order_number | created_at | email | name | paid_amount | proposed_offer_id | reason |
|---|---|---|---|---|---|---|---|
| 1 | PAY-26-MN7PE4R2 | 2025-12-30 | Veronika.krugol@yandex.by | Виктория Глуховская | 350.00 | 5dfc9ca5 | full_payment_350 |
| 2 | GIFT-26-MLQQ8J5Z | 2026-02-07 | 791067723@mail.ru | Татьяна Чёкчикова | 0.00 | — | gift_manual_review |
| 3 | PAY-26-MMUQAY2V | 2026-02-28 | li_liana@rambler.ru | Ольга Велич | 350.00 | 5dfc9ca5 | full_payment_350 |
| 4 | ORD-LINK-1773078892991 | 2026-03-09 | 791067723@mail.ru | Татьяна Чёкчикова | 195.00 | 7e9187ea | installment_195 |
| 5 | PAY-26-MMUQDEPD | 2026-03-16 | lana0407@tut.by | Светлана Дещеня | 350.00 | 5dfc9ca5 | full_payment_350 |
| 6 | PAY-26-MMUQOBC8 | 2026-03-16 | irkaguzarevich@mail.ru | Ирина Гузаревич | 350.00 | 5dfc9ca5 | full_payment_350 |
| 7 | PAY-26-MMUQJ1SZ | 2026-03-16 | vainqueur7natka@mail.ru | Наталья Киричко | 350.00 | 5dfc9ca5 | full_payment_350 |
| 8 | PAY-26-MMUQM4PF | 2026-03-16 | nastya.pahitonova@yandex.by | Анастасия Молоток | 350.00 | 5dfc9ca5 | full_payment_350 |
| 9 | PAY-26-MMUQGCEC | 2026-03-16 | 6214525@mail.ru | Ирина Данилюк | 350.00 | 5dfc9ca5 | full_payment_350 |
| 10 | ORD-BULK-1774594112563 | 2026-03-27 | rabchevskaya.buh@gmail.com | Юлия Рабчевская | 350.00 | 5dfc9ca5 | full_payment_350 |
| 11 | ORD-BULK-1774594112562 | 2026-03-27 | n.novikova109@gmail.com | Наталья Новикова | 350.00 | 5dfc9ca5 | full_payment_350 |

## Сводка
- `full_payment_350` → **9 заказов**, offer `5dfc9ca5`.
- `installment_195` → **1 заказ**, offer `7e9187ea`.
- `gift_manual_review` → **1 заказ** (GIFT-26-MLQQ8J5Z), НЕ трогаем.

## Execute (после approve)
```sql
-- Stage A: 9 × 350 BYN
UPDATE orders_v2 SET offer_id = '5dfc9ca5-...'::uuid,
  meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
    'offer_id_backfill_source','multi_active_amount_match_350',
    'offer_id_backfill_batch','multi_active_0fb3db55_2026_05_22',
    'offer_id_backfill_at', now())
WHERE id IN (...9 ids...) AND offer_id IS NULL AND tariff_id='0fb3db55-...';
-- expected rowcount: 9

-- Stage B: 1 × 195 BYN
UPDATE orders_v2 SET offer_id = '7e9187ea-...'::uuid,
  meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
    'offer_id_backfill_source','multi_active_amount_match_195',
    'offer_id_backfill_batch','multi_active_0fb3db55_2026_05_22',
    'offer_id_backfill_at', now())
WHERE id = '65ef18e5-4d2d-4712-a85c-a41a5a18f4cc' AND offer_id IS NULL;
-- expected rowcount: 1

-- GIFT (a0ec1f74-868d-4ec5-8f8e-e926605e3e54) — НЕ трогаем.
```

## Важно
Даже после backfill кнопка «Сформировать документ» останется скрыта по этим 10 заказам, пока в офферах `5dfc9ca5`/`7e9187ea` не настроены `document_scenarios`/`document_defaults`. Это ожидаемо. Текущая задача — корректно связать order → offer.

## Decision
Ожидаем approve на Stage A + Stage B. GIFT остаётся в backlog manual.
