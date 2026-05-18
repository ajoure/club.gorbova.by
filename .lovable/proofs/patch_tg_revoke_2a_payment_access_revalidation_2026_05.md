# PATCH-TG-REVOKE-2A — Payment/access revalidation (read-only proof)

**Snapshot:** `2026-05-18T13:00:00+00:00`
**Режим:** READ-ONLY. 0 DML. 0 Telegram API. 0 grant-access-for-order. Execute не запускался.
**Scope:** 13 строк из `/mnt/documents/telegram_revoke_candidates_verified_2026_05.csv`.

## 1. Главный вывод

Из 13 кандидатов на revoke **6 имеют активный paid order**, окно доступа которого покрывает snapshot — их **запрещено банить**. Они уходят в DATA repair (`PATCH-DATA-REPAIR-MISSING-ENT`).

Реальное число подтверждённых revoke = **5**, плюс **2 manual_review**.

Это подтверждает blocker-case Екатерины Белозор и доказывает: оригинальная логика (ent/sub NULL → revoke) — недостаточна. SOT для определения revoke = **active entitlement OR active subscription OR active paid-order window**.

## 2. SOT-источники access_days (строго, без дефолтов)

1. `tariffs.access_days` по `orders_v2.tariff_id`
2. `orders_v2.purchase_snapshot.access_days`
3. `subscriptions_v2.access_end_at` (если есть)
4. `entitlements.expires_at` (если есть)

«30 дней по умолчанию» **не используется**. Если ни один источник не дал access_days и есть valid payment → `manual_review_access_days_unresolved`. В текущей выборке таких 0 (все 11 кандидатов с paid orders имеют `tariff.access_days=30` через `tariffs` SOT).

## 3. Mapping club → продукт (SOT)

Из `access_rules` (`grant_target_type='club'`, `is_active=true`):

| club | продукты, открывающие доступ |
|---|---|
| Gorbova Club (`fa547c41`) | `11c9f1b8` *Gorbova Club* (любой тариф) + `9d0d6de8` *Платная консультация* **только** `tariff_id=c1b4bb88` |
| Бухгалтерия как бизнес (`4f8f9d8f`) | `85046734` *Бухгалтерия как бизнес* (любой тариф) |

Для Бухгалтерии channel **не проверялся** (group-only клуб).

## 4. Валидность payment (per-order)

Payment считается валидным, если:
- `payments_v2.status = 'succeeded'` (единственное pass-значение enum)
- `amount > 0`
- `COALESCE(refunded_amount, 0) < amount` — refund проверяется строго по конкретному платежу/заказу

## 5. Расчёт окна

`expected_access_until = MAX(valid payment.paid_at per same product+tariff) + tariff.access_days`.

Extend-логика применяется только при совпадении `user × product_id × tariff_id`. Конфликт тарифов → `manual_review_refund_or_conflict` (в текущей выборке — 0, у всех 11 paid-order кандидатов distinct_tariffs ≤ 1).

## 6. Итоговая таблица по 13 кандидатам

| # | Customer | club | paid orders | valid pmts | last paid_at | expected_until | active ent | active sub | verdict |
|---|---|---|---:|---:|---|---|:---:|:---:|---|
| 1 | Юлия Станкевич | Gorbova | 3 | 3 | 2026-03-10 18:00 | **2026-04-09** | — | — | `revoke_confirmed` |
| 2 | Ирина Гаринова | Gorbova | 0 | 0 | — | — | — | — | `revoke_confirmed` |
| 3 | Сергей Федорчук | Бухгалтерия | 0 | 0 | — | — | — | — | `revoke_confirmed` |
| 4 | **Наталья Морозевич (F3)** | Gorbova | 13 | 13 | 2026-04-16 14:45 | **2026-05-16** | — | — | `revoke_confirmed` |
| 5 | Ирина Протасевич | Gorbova | 1 | 1 | 2026-01-26 20:36 | **2026-02-25** | — | — | `revoke_confirmed` |
| 6 | **Екатерина Белозор** | Gorbova | 20 | 20 | **2026-04-22 18:00** | **2026-05-22 18:00** ✅ | — | — | **`missing_platform_access_but_paid_order_exists`** |
| 7 | Екатерина Юролайть | Gorbova | 24 | 24 | 2026-04-22 09:54 | **2026-05-22 09:54** ✅ | — | — | `missing_platform_access_but_paid_order_exists` |
| 8 | Елена Краковская | Gorbova | 13 | 13 | 2026-04-24 19:00 | **2026-05-24 19:00** ✅ | — | — | `missing_platform_access_but_paid_order_exists` |
| 9 | Любовь Пилецкая | Gorbova | 18 | 18 | 2026-04-24 09:30 | **2026-05-24 09:30** ✅ | — | — | `missing_platform_access_but_paid_order_exists` |
| 10 | Марина Босак | Gorbova | 12 | 12 | 2026-04-28 07:15 | **2026-05-28 07:15** ✅ | — | — | `missing_platform_access_but_paid_order_exists` |
| 11 | Марта Леоненко | Gorbova | 21 | 21 | 2026-04-27 06:45 | **2026-05-27 06:45** ✅ | — | — | `missing_platform_access_but_paid_order_exists` |
| 12 | Алима Ассистент | Gorbova | 1 (GIFT) | 0 (amount=0) | — | окно истекло (gift 2026-01-20, +30d=2026-02-19) | — | — | `manual_review` (assistant-аккаунт, GIFT) |
| 13 | Катерина Горбова | Gorbova | 0 | 0 | — | — | — | — | `manual_review` (founder, admin-grant вне orders_v2) |

## 7. Контрольный кейс — Екатерина Белозор (blocker)

- **email:** `zapponka1@gmail.com`
- **club:** Gorbova Club (`fa547c41`)
- **product:** `11c9f1b8` Gorbova Club, **tariff:** `7c748940` BUSINESS, `access_days = 30`
- **paid orders по продукту:** 20 шт., все BUSINESS 250 BYN, все `payments_v2.status='succeeded'`, refunds=0
- **последняя оплата (valid):** `2026-04-22 18:00:36+00` (заказ-ссылка из cab. админки на 250 BYN — совпадает с показанным скрином 22.04.2026)
- **expected_access_until = 2026-04-22 18:00 + 30d = `2026-05-22 18:00:36+00`** > snapshot `2026-05-18 13:00+00` → **ДОСТУП АКТИВЕН**
- active entitlement: **отсутствует**
- active subscription_v2: **отсутствует**

**Причина попадания в revoke:** прежний резолвер искал только `entitlement` и `subscription`, не учитывая прямое окно от paid order. У Белозор entitlement не создан (DATA bug fulfillment-цепочки), хотя 20 успешных оплат BUSINESS-тарифа покрывают доступ непрерывно с ноября 2025.

**Новый verdict:** `missing_platform_access_but_paid_order_exists` → **revoke ЗАПРЕЩЁН** → backlog `PATCH-DATA-REPAIR-MISSING-ENT`.

## 8. Итоговые числа

| категория | N |
|---|---:|
| `revoke_confirmed` | **5** |
| `missing_platform_access_but_paid_order_exists` (→ DATA repair, **не банить**) | **6** |
| `access_active_by_paid_order_window` (purely active, ent/sub есть) | 0 |
| `manual_review_refund_or_conflict` / иное manual | **2** |
| **Σ** | **13** |

Список `revoke_confirmed` (5): Юлия Станкевич, Ирина Гаринова, Сергей Федорчук, **Наталья Морозевич (F3 ✅)**, Ирина Протасевич.

Список для DATA repair (6): Екатерина Белозор, Екатерина Юролайть, Елена Краковская, Любовь Пилецкая, Марина Босак, Марта Леоненко.

Manual review (2): Алима Ассистент (assistant + GIFT), Катерина Горбова (founder).

## 9. Source trace по каждому кандидату

Полный per-order трейс (20 BUSINESS orders Белозор, 24 Юролайть, и т.д., итого 126 строк paid orders) — в `/mnt/documents/patch_tg_revoke_2a_revalidated_candidates_2026_05.csv` со столбцами:
`customer, email, club_name, order_number, product_id, product_name, tariff_id, tariff_name, tariff_access_days, final_price, paid_amount, currency, deal_date, order_created_at, last_paid_at_valid, last_paid_at_any, refunded_amount, expected_access_until`.

## 10. Запреты — соблюдены

- 0 INSERT в `telegram_access_queue`
- 0 вызовов Telegram API
- 0 вызовов provider/bePaid API
- 0 вызовов `grant-access-for-order`
- 0 DML
- 0 изменений `subscriptions_v2` / `entitlements` / `access_rules` / `telegram_club_members`
- 0 изменений secrets / mode

## 11. DoD

| критерий | статус |
|---|:---:|
| Для всех 13 кандидатов собраны paid orders | ✅ |
| Для каждого рассчитан expected access window (без 30-day default) | ✅ |
| Каждый получил новый verdict из 4 категорий | ✅ |
| Белозор разобрана отдельным блоком с расчётом | ✅ |
| Сумма категорий = 13 | ✅ (5+6+0+2) |
| Получены 4 итоговых числа: revoke / repair / active / manual | ✅ |
| Refund проверяется строго по конкретному payment/order | ✅ |
| Бухгалтерия — channel не учитывался | ✅ |
| Execute не запускался | ✅ |

## 12. Следующие шаги (требуют отдельных approve)

1. **PATCH-DATA-REPAIR-MISSING-ENT** (6 человек) — read-only dry-run + execute через canonical `grant-access-for-order` по последним paid orders. Это первая очередь, потому что у людей есть оплаченный, но «технически невидимый» доступ.
2. **PATCH-TG-REVOKE-2 (revised)** — execute revoke по очищенному списку из 5 строк (вместо 133/13). После завершения #1.
3. **Manual review** для Алима Ассистент и Катерина Горбова — решение оператора (founder/assistant — admin grant vs revoke).
4. PATCH-TG-REINVITE-1 (5 строк) и PATCH-UI-RESOLVER-F1-F2 — остаются в очереди, не блокируются.

## 13. Artifacts

- `.lovable/proofs/patch_tg_revoke_2a_payment_access_revalidation_2026_05.md` (этот файл)
- `/mnt/documents/patch_tg_revoke_2a_revalidated_candidates_2026_05.csv` (126 строк per-order detail)
