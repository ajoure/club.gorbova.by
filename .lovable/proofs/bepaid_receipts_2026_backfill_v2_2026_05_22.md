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
