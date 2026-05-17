# ACCESS-FIX-1 — critical missing_primary_entitlement (DRY-RUN)

**Дата:** 2026-05-17
**Режим:** read-only. 0 DML, 0 invoke writer-функций.
**Source:** `.lovable/proofs/h5_access_consistency_audit_after_2026_05_17.csv` (severity=critical, gap_class=missing_primary_entitlement).

## Глобальные guards

| guard | status |
| --- | --- |
| CSV найден и прочитан | ✅ |
| строк severity=critical/missing_primary_entitlement = 6 | ✅ (6/6) |
| все 6 sub_id присутствуют в `subscriptions_v2` | ✅ |
| снапшот аудита не сдвинулся (контрольные access_end_at совпали) | ✅ |

## Сводка planned_action

| planned_action | count |
| --- | ---:|
| `grant_access_for_order_needed` | 5 |
| `manual_review_no_order_link` | 1 |
| `skip_already_fixed` | 0 |
| `manual_review_no_user` | 0 |
| `manual_review_tariff_mismatch` | 0 |
| `manual_review_do_not_grant_access` | 0 |
| **итого** | **6** |

## Row-карты

### Row 1 — alexasermyazhko@gmail.com → ЗАКРОЙ ГОД

- user_id: `f4dba33b-6afb-4360-a7ee-a94f58858ae2`
- profile_id: `f0a4fcda-d361-4e2f-bbf4-1b0f41b063dd`
- product: `73c29914-…` (ЗАКРОЙ ГОД, entitlement_mode=`subscription_based`)
- tariff: `56c35e86-…`
- subscription `405faf46-…`: status=active, access `2026-05-08 → 2026-05-31 21:00`, auto_renew=false, `order_id=2f1f60f1-…`
- source_order `2f1f60f1-…` (`PAY-26-MOUBZZ59`): status=paid, 900 BYN, refund=0, `meta.do_not_grant_access` отсутствует, `meta.run/rebill` отсутствуют, **tariff_match=true**
- payment `30127bdb-…`: succeeded, refunded_amount=0
- entitlement по (user×product): **отсутствует**
- access_rules expectation: есть `training_content`/`section_access` → primary entitlement обязателен
- **planned_action:** `grant_access_for_order_needed`
- stop_guard: none

### Row 2 — elena.platonova-fedyakova@yandex.ru → Gorbova Club

- user_id: `252e4b5c-…`, profile: `d7d9bee0-…`
- product `11c9f1b8-…` (Gorbova Club, `subscription_based`); tariff `31f75673-…`
- subscription `f2901cfc-…`: active, `2026-03-22 → 2026-05-21 20:59:59`, auto_renew=true, `order_id=716d986b-…`
- meta.initial_order_id=`b63ac7bf-…` (более ранний paid-заказ, тот же tariff)
- source_order (canonical = sub.order_id) `716d986b-…` (`ORD-26-MO8NWW5D`): paid 100 BYN, refund=0, no DNA, **tariff_match=true**
- payment `47cc18df-…`: succeeded, refunded=0
- entitlement по (user×product): `8a9e7bf7-…` **expired** 2026-04-22 (от старого заказа `b63ac7bf`); active entitlement отсутствует
- access_rules expectation: club + product_access + section + training → primary обязателен
- **planned_action:** `grant_access_for_order_needed` (writer создаёт новый entitlement на текущем `716d986b`)
- stop_guard: none. TG ok (1 present) — не трогаем (ACCESS-FIX-2).

### Row 3 — natapono2018@mail.ru → Gorbova Club

- user_id `9267a27e-…`, profile `ce9cf24f-…`
- product Gorbova Club, tariff `7c748940-…`
- subscription `08363441-…`: active, `2026-03-03 → 2026-05-30 20:59:59`, auto_renew=false, `order_id=c3a0e16c-…`
- source_order `c3a0e16c-…` (`ORD-26-MOL7LOLE`): paid 250 BYN, refund=0, no DNA, **tariff_match=true**
- payment `c98f1f3d-…`: succeeded, refunded=0
- entitlement (user×product): `70fef153-…` **expired** 2026-04-30, без `order_id` и без `meta.tariff_id` (legacy admin/migration); active отсутствует
- **planned_action:** `grant_access_for_order_needed`
- stop_guard: none

### Row 4 — trofimova.ulia@tut.by → Gorbova Club

- user_id `16bc061d-…`, profile `69504ff5-…`
- product Gorbova Club, tariff `7c748940-…`
- subscription `de75db3a-…`: active, `2026-04-19 → 2026-05-19 20:59:59`, auto_renew=true, `order_id=ea774d6c-…`, meta.origin_order_id=`ea774d6c-…`, meta.extended_by_orders=`[ea774d6c]`
- source_order `ea774d6c-…` (`SUB-26-MO5IUQ6K1UHL`): paid 250 BYN, refund=0, no DNA, **tariff_match=true**
- payment `d9b874db-…`: succeeded, refunded=0
- entitlement (user×product): `0e279a20-…` **expired** 2026-02-11 (привязан к тому же order_id, но истёк раньше текущего sub.access_end — рассинхрон)
- **planned_action:** `grant_access_for_order_needed` (writer должен переснять окно по текущей подписке/тарифу)
- stop_guard: none

### Row 5 — user `17b35d62-…` (no profile) → ЗАКРОЙ ГОД

- user_id `17b35d62-…`, profile_id `17b35d62-…` (= user_id, нет реального profile-row → warning `no_profile`)
- product ЗАКРОЙ ГОД, tariff `56c35e86-…`
- subscription `0c999415-…`: active, `2025-11-30 → 2026-05-31 21:59:59`, auto_renew=true, `order_id=0bb9ee3f-…`, meta.initial_order_id=`0bb9ee3f-…`, meta.extended_by_orders=`["7f396f99-cd1b-4305-b2de-d3776719a244"]`
- source_order `0bb9ee3f-…` (`PAY-26-MNARLAF7`): paid 330 BYN, refund=0, no DNA, **tariff_match=true**
- extension order `7f396f99-…`: paid 330 BYN, refund=0, no DNA, tariff_match=true (можно использовать как fallback, но canonical = sub.order_id)
- payments: оба succeeded, refunded=0
- entitlement (user×product): отсутствует
- **planned_action:** `grant_access_for_order_needed` через `orderId=0bb9ee3f`
- stop_guard: только warning `no_profile` (НЕ блокер). user_id валиден, writer принимает orderId.

### Row 6 — user `539ea1b3-…` (no profile) → Ценный бухгалтер | 2 ступень | 3 поток

- user_id `539ea1b3-…`, profile_id `539ea1b3-…` (= user_id, no profile)
- product `87a8870f-…`, tariff `34628d81-…`
- subscription `be19fa2e-…`: active, `2023-02-08 → 2026-08-30 23:59:59`, auto_renew=false, **order_id=NULL**, meta.{initial_order_id,checkout_order_id,origin_order_id,extended_by_orders} **все пусты**
- кандидат source_order по (user_id, product_id): `38e3dbde-…` (`MIG-CB2S-ROW-28`), paid 900 BYN, tariff_match=true, но meta содержит `is_ghost_grant=true`, `ghost_profile=true`, `_is_ghost_profile=true`, `non_mit_historical_active=true`, `source=cb2s_followup_final_8`. Это миграционный/ghost-grant, **не привязан к subscription**.
- payments_v2 по этому order: **нет** (миграционный заказ, платёж не записан)
- entitlement (user×product): отсутствует
- **planned_action:** `manual_review_no_order_link`
- stop_guard: `sub_has_no_order_reference` + кандидат — ghost migration grant без payments. Привязка subscription к этому order'у в рамках ACCESS-FIX-1 запрещена (canonical writer SOT требует subscription→order linkage). Решение — product owner (либо привязать MIG-order к subscription отдельной задачей, либо grant entitlement через выделенный admin path).

## Execute proposal (для следующего approve)

Если ACCESS-FIX-1 execute будет одобрен — выполнить **последовательно** (без параллели), capture результата каждого вызова:

```
POST /functions/v1/grant-access-for-order { orderId: 2f1f60f1-67ac-4682-b0a5-9279b519b67d, source: 'access_fix_1_missing_primary_entitlement_2026_05' }   # alexasermyazhko / ЗАКРОЙ ГОД
POST … { orderId: 716d986b-3709-4a38-a1fb-5e14ab2e3c5b, source: 'access_fix_1_…' }                                                                         # elena.platonova / Gorbova Club
POST … { orderId: c3a0e16c-323c-4933-b6e0-2aaf22a2a8d0, source: 'access_fix_1_…' }                                                                         # natapono2018 / Gorbova Club
POST … { orderId: ea774d6c-e2ec-4d46-b47a-c556d0be0b4f, source: 'access_fix_1_…' }                                                                         # trofimova.ulia / Gorbova Club
POST … { orderId: 0bb9ee3f-06da-4574-b195-ead71c57a310, source: 'access_fix_1_…' }                                                                         # user 17b35d62 / ЗАКРОЙ ГОД
```

Capture per call: `entitlement.action`, `entitlement.id`, `accessStartAt`, `accessEndAt`, `primary_entitlement_verified`, `subscription.action`.

Manual_review (вне ACCESS-FIX-1):
- subscription `be19fa2e-…` (user `539ea1b3-…`, продукт Ценный бухгалтер | 2 ступень | 3 поток) — `manual_review_no_order_link` / ghost migration grant.

## Запреты (соблюдены)

- 0 DML по `entitlements` / `subscriptions_v2` / `orders_v2` / `payments_v2` / `access_rules` / `telegram_*` / `provider_subscriptions`
- 0 вызовов `grant-access-for-order`, `telegram-*`, `bepaid-*`
- 0 H5 REBILL-операций
- 0 изменений secrets / mode / cron
- 9 Telegram-кейсов и 40 `Учет у ИП` НЕ затронуты

## Артефакты

- этот md
- `.lovable/proofs/access_fix_1_missing_primary_entitlement_dryrun_2026_05.csv`

## DoD

| critria | done |
|---|:---:|
| CSV прочитан, ровно 6 строк | ✅ |
| Row-карта по каждой строке | ✅ |
| `planned_action` из словаря | ✅ (5×grant_access_for_order_needed, 1×manual_review_no_order_link) |
| STOP-guards проверены | ✅ |
| Refund-guard per source_order/payment | ✅ (все 0) |
| DNA / H5 REBILL-guard | ✅ (нет совпадений) |
| access_rules expectation | ✅ (все 3 продукта `subscription_based` + есть active rules) |
| БД не менялась | ✅ |
| Остановка после dry-run, ожидание approve | ✅ |
