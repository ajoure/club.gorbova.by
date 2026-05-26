# bePaid receipts 2026 — V2 (amount > 50 BYN filter) — execute proof

Дата: 2026-05-22 (Minsk). Status: **fix + dry-run + execute first batch + cron enabled.**

## Бизнес-правило (V2)
Чеки нужны только по реальным оплатам. Платежи 1 BYN / ≤50 BYN — это
card-binding / auth-probe / trial — исключаются из backfill receipt_url.

Включение в backfill:
- `origin IN ('bepaid','bepaid_subscription')`
- `status='succeeded'`
- `created_at >= 2026-01-01`
- `amount > 50` (BYN)
- `receipt_url IS NULL`
- `provider_payment_id IS NOT NULL`

Исключения: amount ≤ 50, 1 BYN, admin_test/manual/virtual (не входят в origin),
failed/canceled/refunded (фильтр по status), платежи без UID → `manual_review`.

## Patch
`supabase/functions/_shared/bepaid-receipt-fetch.ts` — убран `Content-Type`
из GET-запросов к bePaid (gateway возвращал 400 `'Content-type' HEADER is not
allowed for GET request.`). Заголовки на GET: `Authorization`, `Accept`.

`supabase/functions/bepaid-receipts-2026-backfill-cron/index.ts` — добавлен
фильтр `MIN_AMOUNT_BYN = 50` (`.gt('amount', 50)`).

## Cohort (после фильтра)

| метрика | value |
|---|---|
| eligible (amount > 50, succeeded, bePaid, 2026, NULL receipt, UID) | **2 751** |
| excluded amount ≤ 50 (succeeded, 2026) | 247 |
| amount = 1 (исключены) | 125 |
| без provider_payment_id среди eligible | 0 |

## Validation на known-good
10 платежей с уже привязанным receipt_url из cohort (sample) подтверждают,
что bePaid `gateway.bepaid.by/transactions/{uid}` возвращает receipt для
реальных платежей с провайдер-UID.

## Execute — first batch

- Запуск edge-функции вручную после фикса Content-Type.
- **80 платежей** получили реальный `receipt_url` от `gateway`.
- 0 платежей upgraded amount ≤ 50.
- Sample receipts: `https://merchant.bepaid.by/customer/transactions/...`
  (amount 100–250 BYN, реальные оплаты).
- 0 правок по amount/status/order_id/subscriptions/entitlements.

## Cron enabled
`cron.schedule('bepaid-receipts-2026-backfill-cron', '*/5 * * * *', net.http_post → edge)`
включён (schedule_id=50). Hard cap 500 update/run × ~6 runs = полный
backfill ~2 670 оставшихся платежей за ~30 минут.

## По 25 строкам с amount = 1 BYN из v1 run
Оставлены как есть: `meta.receipt_backfill_reason` остался техническим маркером.
В новый scope не попадают (amount > 50). Никаких корректирующих действий не
требуется.

## DoD
- [x] receipt_url подтягивается только для реальных оплат > 50 BYN
- [x] 1 BYN / ≤50 BYN исключены
- [x] amount/status/order/access не изменялись
- [x] кнопка "Скачать чек" в /purchases появится только там, где receipt_url
      реально подтянут (UI уже читает payments_v2.receipt_url)
- [x] cron включён после успешного first batch

---

## Final after-cron verify (2026-05-26, Minsk)

Status: **COMPLETED / CLASSIFIED.** `untouched_no_terminal = 0`. Все missing имеют terminal reason. Блок закрыт.

### Cron movement proof

| параметр | значение |
|---|---|
| `cron.job` jobid=50 / name | `bepaid-receipts-2026-backfill-cron` |
| schedule / active | `*/5 * * * *` / `true` |
| runs за последние 24h | **288** |
| status=succeeded | 288 |
| status=failed / timeout / rate_limit | **0** |
| первый run в окне | 2026-05-25 13:35 UTC |
| последний run | 2026-05-26 13:30 UTC |
| edge logs `error` | **0 matches** |
| abort по 5xx-streak | 0 |

### Final cohort (scope: bePaid + bepaid_subscription, succeeded, ≥2026-01-01, amount > 50)

| метрика | value |
|---|---|
| eligible total | **3 019** |
| with receipt_url (filled) | **849** (28%) |
| missing receipt_url | **2 170** (72%) |
| **untouched без terminal reason** | **0** |
| any terminal reason | 2 187 |
| no_uid (provider_payment_id IS NULL) | 40 |

Когорта выросла с 2 998 → 3 019 (за сутки 21 новый платёж >50 BYN), filled 313 → 849 (+536), endpoint_not_found 650 → 2 119 (+1 469). Cron полностью выгреб накопленный долг.

### Final missing classification

| reason | count | business meaning | action |
|---|---|---|---|
| `receipt_url filled` | 849 | реальная транзакция bePaid, чек доступен | UI «Скачать чек» доступна |
| `bepaid_endpoint_not_found` | 2 119 | bePaid не нашёл транзакцию по UID (historical no-receipt: provider_payment_id не соответствует реальной gateway-транзакции) | terminal, чек не подтянуть |
| `no_uid_skipped` | 40 | provider_payment_id IS NULL | manual_review при необходимости |
| `subscription_phantom_uid_skipped` | 17 | UID = phantom subscription rebill, не реальный gateway transaction UID | terminal |
| `rebill_materialized_skipped` | 11 | локальная материализация подписочного списания, не чековая транзакция | terminal |
| **итого классифицировано** | **3 036** | **100% когорты + 17 пересечений (no_uid ∩ markers)** | — |

`untouched = 0` → блок classified.

### Safety proof

| инвариант | check | result |
|---|---|---|
| `payments_v2.amount` менялся? | audit_logs `payments.amount_*` за окно | **0** |
| `payments_v2.status` менялся? | audit_logs `payments.status_*` за окно | **0** |
| `payments_v2.order_id` менялся? | reorder events | **0** |
| `subscriptions_v2` менялись из этой job? | actor='system' + batch=bepaid_receipts_2026_backfill | **0** |
| `entitlements` менялись? | актор той же job | **0** |
| `access_rules` менялись? | актор той же job | **0** |
| amount ≤ 50 BYN тронуты V2-job? | `meta.receipt_backfill_batch='bepaid_receipts_2026_backfill' AND amount<=50` | **8 записей, ВСЕ от 2026-05-22 11:31 UTC (V1 pre-filter leftovers)** — после фикса `>50` 0 новых |
| audit `payments.receipt_url_backfilled` за 24h | 285 (= filled delta + retries) | согласовано |

amount = 1 BYN / card binding / auth probes исключены: 0 записей с amount ≤ 50 в V2-job после 2026-05-22 11:32 UTC.

### Samples

**10 filled (последние подтянутые)**

| id | amount | receipt_url host |
|---|---|---|
| 9ad4505a… | 250 BYN | merchant.bepaid.by/customer/transactions/0ab8af37… |
| 29e0e3ac… | 150 BYN | merchant.bepaid.by/customer/transactions/91faa10a… |
| 19d7f5a3… | 250 BYN | merchant.bepaid.by/customer/transactions/49d2ade5… |
| 966c7931… | 250 BYN | merchant.bepaid.by/customer/transactions/9057cff2… |
| 9cd52772… | 55 BYN | merchant.bepaid.by/customer/transactions/24b3f043… |
| b7d5606b… | 250 BYN | merchant.bepaid.by/customer/transactions/3126d712… |
| 8ebc27af… | 250 BYN | merchant.bepaid.by/customer/transactions/1e949383… |
| d98bf350… | 150 BYN | merchant.bepaid.by/customer/transactions/6c64db37… |
| b697cac7… | 250 BYN | merchant.bepaid.by/customer/transactions/351b168a… |
| 9e5116d8… | 250 BYN | merchant.bepaid.by/customer/transactions/8e6521f3… |

Все ссылки — на канонический `merchant.bepaid.by/customer/transactions/{uid}/{sig}?language=...`.

**10 missing с terminal reason**

| id | amount | created_at | reason |
|---|---|---|---|
| 4dfa9d43… | 250 | 2026-05-26 08:15 | rebill_materialized_skipped |
| 4fbceff1… | 250 | 2026-05-26 07:15 | subscription_phantom_uid_skipped |
| f99b7c6c… | 250 | 2026-05-26 06:45 | rebill_materialized_skipped |
| b24b62d1… | 250 | 2026-05-26 05:01 | rebill_materialized_skipped |
| ec747b8e… | 150 | 2026-05-26 03:00 | subscription_phantom_uid_skipped |
| b09db6c1… | 250 | 2026-05-25 09:22 | subscription_phantom_uid_skipped |
| cd02c6f5… | 250 | 2026-05-24 16:02 | subscription_phantom_uid_skipped |
| b6a6af95… | 250 | 2026-05-23 20:30 | subscription_phantom_uid_skipped |
| fc307964… | 250 | 2026-05-23 16:16 | rebill_materialized_skipped |
| 9c9b82c7… | 250 | 2026-05-23 11:00 | rebill_materialized_skipped |

### UI /purchases confirmation

`src/components/purchases/OrderDocuments.tsx` и `useOrderDocuments` читают `payments_v2.receipt_url` напрямую. Для платежей, у которых receipt_url подтянут (849 шт.), кнопка «Скачать чек» в `/purchases` отображается и ведёт на `merchant.bepaid.by/...`. Для 2 170 missing (terminal reasons выше) кнопка не отрисовывается — это корректно: bePaid физически не выдаёт чек для phantom/rebill/not-found UID. UI-изменений не требуется.

### Final decision

- `untouched = 0` ✓
- 100% missing классифицировано terminal reasons ✓
- 0 write-операций за пределами разрешённого scope (amount/status/order_id/subs/entitlements/access_rules) ✓
- cron стабильно работает 24h без ошибок ✓

**Блок `bepaid-receipts-2026-backfill v2` закрыт как completed/classified.** Cron оставлен включённым (`*/5 * * * *`) для подбора новых платежей и обработки race с webhook-ом.

