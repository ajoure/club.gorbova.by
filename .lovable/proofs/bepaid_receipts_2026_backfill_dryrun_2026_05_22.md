# bePaid receipts 2026 — backfill dry-run (read-only)

Дата: 2026-05-22 (Minsk). Status: **dry-run only.** Ничего не обновлялось.

## Цель
Подтянуть недостающие `receipt_url` по успешным bePaid платежам за 2026 год через bePaid API `GET /transactions/{uid}`. Не менять amount/status/orders/subscriptions/access.

## Cohort

| метрика | value |
|---|---|
| total succeeded bePaid payments 2026 | **4 293** |
| already have receipt_url (col или provider_response) | 351 (8%) |
| **missing receipt_url** | **3 942 (92%)** |
| → with provider_payment_id (eligible for API call) | **3 941** |
| → without provider_payment_id (skip — manual) | 1 |

API rate-limit estimate (bePaid ≈ 30 RPS на shop):
- безопасный batch 50 RPS = ~80 секунд на 4k платежей при 1 шопе; реально с retry/backoff → **~3–5 минут на полный backfill**.
- batch size в edge function: **25 платежей / запуск**, sleep 200ms между API-вызовами; cron каждые 5 минут до полного выгребания.

## Sample 20 candidates (последние 24ч)
| payment_id | provider_payment_id | amount | created_at |
|---|---|---|---|
| 1d878657-… | 9efc93f2-… | 250 BYN | 2026-05-22 10:59 |
| 1ce9e083-… | d273c9aa-… | 100 BYN | 2026-05-22 10:45 |
| 10e7f986-… | fa6df34a-… | 150 BYN | 2026-05-22 09:56 |
| f1e3ca5d-… | 2a5f021c-… | 100 BYN | 2026-05-22 09:18 |
| d1488e3a-… | 983f6d10-… | 150 BYN | 2026-05-22 08:18 |
| be142fbe-… | 742fae8d-… | 55 BYN | 2026-05-22 08:01 |
| 72db241f-… | e6890588-… | 250 BYN | 2026-05-22 06:04 |
| bf2a0884-… | d3ed754f-… | 250 BYN | 2026-05-22 03:00 |
| a445febe-… | 65ede263-… | 100 BYN | 2026-05-21 20:30 |
| e58eea27-… | 113f7667-… | 100 BYN | 2026-05-21 20:30 |
| 9ad4505a-… | 0ab8af37-… | 250 BYN | 2026-05-21 19:15 |
| 29e0e3ac-… | 91faa10a-… | 150 BYN | 2026-05-21 15:45 |
| 19d7f5a3-… | 49d2ade5-… | 250 BYN | 2026-05-21 15:42 |
| 966c7931-… | 9057cff2-… | 250 BYN | 2026-05-21 09:45 |
| 9cd52772-… | 24b3f043-… | 55 BYN | 2026-05-21 08:39 |
| b7d5606b-… | 3126d712-… | 250 BYN | 2026-05-21 08:01 |
| 8ebc27af-… | 1e949383-… | 250 BYN | 2026-05-21 08:01 |
| d98bf350-… | 6c64db37-… | 150 BYN | 2026-05-21 07:28 |
| b697cac7-… | 351b168a-… | 250 BYN | 2026-05-21 06:45 |
| 9e5116d8-… | 8e6521f3-… | 250 BYN | 2026-05-21 06:01 |

## Execute план (отдельным патчем)

**Edge function:** `bepaid-receipts-backfill` (новый, P1).
**Cron job:** `bepaid-receipts-backfill-cron` каждые 5 минут (отдельный, не зацеплять в существующий `bepaid-receipts-cron`).

### Контракт
- **Filter:** `status='succeeded' AND provider IN ('bepaid','bepaid_subscription') AND receipt_url IS NULL AND provider_response->'transaction'->>'receipt_url' IS NULL AND provider_payment_id IS NOT NULL AND created_at >= '2026-01-01'`.
- **Batch:** 25 платежей за запуск, сортировка `created_at DESC`.
- **API:** `GET https://api.bepaid.by/transactions/{provider_payment_id}` с Basic Auth (существующие BEPAID_SHOP_ID/SECRET_KEY).
- **Rate-limit guard:** sleep 200ms между запросами; retry с exponential backoff на 429/5xx (3 попытки).
- **Idempotency:** в начале каждого батча перепроверять `receipt_url IS NULL` (race с webhook).
- **Update:** ТОЛЬКО `receipt_url`, `provider_response` (merge `transaction.receipt_url`), `meta.receipt_backfill_at`, `meta.receipt_backfill_source='bepaid_api_2026'`.
- **НЕ менять:** amount, status, order_id, subscription_id, customer_*, никакой логики доступа.
- **No-receipt-returned:** `meta.receipt_backfill_reason='bepaid_no_receipt_url'`, НЕ ошибка платежа.
- **Audit:** `action='payments.receipt_url_backfilled'`, `actor_type='system'`, `actor_id=null`, `payload={payment_id, provider_payment_id, source, receipt_url|null}`.
- **Failed/canceled/refunded** платежи **не трогаются**.

### Guards
1. Hard cap: max 500 успешных update за один запуск (защита от runaway).
2. Если за батч 5+ подряд 5xx от bePaid — abort и alert.
3. Pre-flight: count cohort, если 0 — exit gracefully.

## Decision
Ожидаем approve на:
1. создание edge function `bepaid-receipts-backfill`;
2. cron job каждые 5 минут;
3. expected backfill: ~3 941 платёж в течение ~14 часов (с учётом 25/5min = 300/час).
