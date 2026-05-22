# bePaid receipts 2026 backfill — execute proof (2026-05-22, Minsk)

Status: **DEPLOYED, BUT NOT SCHEDULED.** Cron намеренно не создан до устранения блокера на стороне API.

## Что сделано
1. Создана edge function `bepaid-receipts-2026-backfill-cron`
   (`supabase/functions/bepaid-receipts-2026-backfill-cron/index.ts`).
2. Контракт строго соответствует утверждённому:
   - scope: `origin IN ('bepaid','bepaid_subscription') AND status='succeeded'
     AND receipt_url IS NULL AND provider_payment_id IS NOT NULL
     AND created_at >= '2026-01-01'`;
   - batch=25, sleep 200ms, hard cap 500/run;
   - порядок ASC (старые первые — у них выше шанс наличия чека);
   - fill-only update + race-guard `.is('receipt_url', null)`;
   - меняются только `payments_v2.receipt_url`, `provider_response.transaction.receipt_url`,
     `meta.receipt_backfill_*`;
   - `payments.receipt_url_backfilled`, `batch_id=bepaid_receipts_2026_backfill`;
   - failed/canceled/refunded не входят в выборку.

## Проверка после двух тестовых запусков

| run | processed | filled | no_receipt | aborted |
|---|---|---|---|---|
| #1 (newest DESC, до фикса) | 5 | 0 | 0 | bepaid_5xx_streak (ложный) |
| #2 (oldest ASC, после фикса) | 25 | 0 | 25 | — (нормальный exit batch<limit?) |

`filled=0` на 25 старейших платежах. Логи `bepaid-receipts-2026-backfill-cron`:

```
WARN [receipt-fetch] gateway returned 400:
  {"response":{"message":"'Content-type' HEADER is not allowed for GET request."}}
WARN [receipt-fetch] beyag returned 404:
  {"message":"Couldn't find Transaction","errors":{"system":"Record not found"}}
```

## Найденные блокеры на стороне API/общего хелпера

1. **Баг shared helper** `supabase/functions/_shared/bepaid-receipt-fetch.ts`:
   GET-запрос на `gateway.bepaid.by` отправляется с `Content-Type: application/json`,
   а bePaid gateway это запрещает → 400. Endpoint всегда падает.
   → Нужно: убрать `Content-Type` из GET-headers (отдельный safe-fix).
2. **beyag возвращает 404 для январских 2026 платежей** (amount=1.00 BYN, выглядят как
   auth-probes/initiate). Возможно, эти `provider_payment_id` относятся к старому/тестовому
   шопу или к транзакциям, которые bePaid не отдаёт по beyag.
   → Нужно: на репрезентативной выборке (не 1 BYN, минимум один уже-известный платёж
   с готовым `receipt_url`) проверить, какой endpoint реально возвращает receipt,
   и для каких когорт API в принципе бесполезен.

## Решение
- Cron-job в `pg_cron` **не создаём**, чтобы не накапливать
  `meta.receipt_backfill_reason='bepaid_endpoint_not_found'` без реального эффекта.
- Function задеплоена и доступна для ручного тестирования (admin → POST).
- После фикса Content-Type в `_shared/bepaid-receipt-fetch.ts` и валидации beyag на
  известных good-платежах → можно включить cron одной строкой через
  `cron.schedule(...)`.

## Что НЕ менялось
- 0 платежей получили новый `receipt_url`;
- 0 правок по amount/status/order_id/subscriptions/entitlements;
- 25 строк в `payments_v2` получили только `meta.receipt_backfill_reason`,
  `meta.receipt_backfill_batch`, `meta.receipt_backfill_at` (technical markers).

## Backlog (отдельной задачей)
- [ ] Fix `_shared/bepaid-receipt-fetch.ts`: убрать `Content-Type` из GET headers.
- [ ] Валидировать beyag на 10 known-good платежах 2026 (с уже привязанным receipt_url).
- [ ] Если beyag не отдаёт ретроактивно — рассмотреть `bepaid-fetch-transactions`/CSV-импорт.
- [ ] Только после этого: `cron.schedule('bepaid-receipts-2026-backfill','*/5 * * * *', ...)`.
