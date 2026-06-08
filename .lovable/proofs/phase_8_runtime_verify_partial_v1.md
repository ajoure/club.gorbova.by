# Phase 8 Runtime Verify — PARTIAL PASS

Дата: 2026-06-08
Контакт: Сергей Федорчук (`7500084@gmail.com`)
Контракт: only diagnose + read SQL/audit; код не менялся.

## 1. Статус

```
Phase 8 Runtime Verify   = PARTIAL PASS
One-time receipt_url     = PASS
Subscription invoice.*   = NOT VERIFIED (blocker открыт)
Phase 8 final PASS       = NO
```

| Блок | Статус |
|------|--------|
| Phase 8-B/C/D/E code | CODE COMPLETE |
| One-time receipt_url | PASS |
| Subscription invoice.paid materialization | NOT VERIFIED |
| Stripe recurring checkout mode | BLOCKER |
| Phase 8 final PASS | NO |
| Phase 9 | НЕ начинать |

## 2. Test fixture (factual)

| Поле | Значение |
|------|----------|
| payment_link_id | `9a21a2b6-b987-4421-81af-c55c3dfe6ea8` |
| link.payment_type | **`one_time`** ← корень проблемы |
| product_id (Gorbova Club) | `11c9f1b8-0355-4753-bd74-40b42aa53616` |
| tariff_id (CHAT) | `31f75673-a7ae-420a-b5ab-5906e34cbf84` |
| offer_id (CHAT pay_now) | `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e` |
| offer.meta.recurring.is_recurring | **`true`** (recurring SOT) |
| offer.stripe.price_id | `price_1Teeq26UYJj2vm0GPXHSLKlz` (recurring monthly) |
| provider | stripe, mode=fixed, explicit |
| account_code | `stripe_poland` |
| currency | EUR, amount 10000 (100.00 EUR) |
| order_id | `1aca4eb8-d61d-4e27-9f67-daa08dc792a7` |
| order.meta.payment_flow | **`public_one_time`** |
| payment_intent | `pi_3Tg8Fx6UYJj2vm0G0CzE8YAY` |

## 3. One-time receipt_url — PASS

`payments_v2` row:

```
provider=stripe, status=succeeded, amount=100.00 EUR
receipt_url IS NOT NULL  ← PASS
hosted_invoice_url = NULL (one-time PI, ожидаемо)
invoice_pdf        = NULL (one-time PI, ожидаемо)
stripe_invoice_id  = NULL (one-time PI, ожидаемо)
```

Audit (`actor_type='system'`, `actor_user_id IS NULL`, `actor_label='stripe-webhook'`):

```
2026-06-08 18:50:49.463415+00  stripe.receipt_materialization.applied
2026-06-08 18:51:09.005225+00  stripe.receipt_materialization.skipped_existing_receipt_url  (idempotency OK)
```

→ Helper `stripe-receipt-materialize.ts` работает, идемпотентность по второму webhook — подтверждена.

## 4. Subscription invoice.* — NOT VERIFIED

Не получено ни одного post-deploy события `invoice.paid`. Все исторические `stripe.invoice.paid.activated` — до 2026-06-08 12:18 UTC (deploy Phase 8-B/C), поэтому invoice-документы в них ещё не материализуются и тест не закрывают.

Причина: тестовая ссылка ушла как `mode=payment` (one-time PI) вместо `mode=subscription`.

## 5. BLOCKER — recurring offer → one-time PI

### Корневая причина

`admin-create-public-link/index.ts:97,109` принимает `payment_type` из UI body как source of truth и **не проверяет** `offer.meta.recurring.is_recurring`. UI `AdminPaymentLinkDialog.tsx` для CHAT отправил `payment_type='one_time'`, sentinel это записал в `payment_links.payment_type='one_time'`.

Дальше `create-payment-checkout.ts` / `create-stripe-checkout.ts` берут `link.payment_type='one_time'` и идут в ветку Stripe Checkout `mode='payment'` (создание PaymentIntent), а не `mode='subscription'`.

В итоге:
- Stripe не создаёт subscription;
- `invoice.paid` не приходит;
- `hosted_invoice_url` / `invoice_pdf` / `stripe_invoice_id` остаются пустыми.

### Конфликт с памятью

Это нарушает Core rule **Product Type SOT**: recurring vs one-time определяется ТОЛЬКО через `tariff_offers.meta.recurring.is_recurring`, а не UI-toggle.

### Короткий план fix (Diagnose-only — реализация после approve)

Scope: только `admin-create-public-link/index.ts` + (опционально) UI `AdminPaymentLinkDialog.tsx`.
НЕ трогать: bePaid, grant-access, telegram, receipts helper, canonical-document-*, storage, migrations.

1. В `admin-create-public-link` после резолва `offerIsRecurring`:
   - если `offerIsRecurring === true` и `provider === 'stripe'` и не installment → форсить `payment_type = 'subscription'`;
   - audit `payment_link.payment_type_promoted_recurring` (system actor).
2. Для `bepaid` логика остаётся прежней (там первый платёж всегда one-time checkout, sub создаётся отдельно).
3. UI `AdminPaymentLinkDialog`: для Stripe + recurring offer — toggle «Тип платежа» disabled с подсказкой «Тариф recurring → автоматически subscription». bePaid — без изменений.
4. Verify: повторить тест на CHAT, ожидать `checkout.session.completed.mode='subscription'`, `invoice.paid`, заполнение invoice-полей.

## 6. Lifecycle safety (regression check, без изменений)

- payments_v2: 1 строка по order_id, без дублей по `provider_payment_id`.
- orders_v2: статус `paid`, корректный final_price/currency.
- access_grant_ledger: одна канонический grant Club через `grant-access-for-order`.
- telegram_access_audit: auto-grant прошёл один раз через canonical write-path.
- bePaid таблицы — не задеты.

## 7. UI screenshots

DEFERRED: автоматический браузер вернул Lovable login (preview требует developer login `123456` в той же сессии, что недоступно из batch-tool). Скрины делает user side вручную после approve fix. Не блокирует решение по статусу: SQL/audit-доказательства полные.

## 8. Out-of-scope fixes (отдельным PATCH)

Три фикса, прошедших вне freeze Phase 8 Runtime Verify, вынесены в отдельный proof — см. `.lovable/proofs/stripe_runtime_followup_fixes_v1.md` (создаётся отдельно):

A. Stripe `success_url` / `cancel_url` в `acquiring_connections` → `/purchases?payment=processing`.
B. Telegram DM product/tariff names в `grant-access-for-order` (файл был во freeze — нужен явный regression proof).
C. UI «Иностранная карта» — устранён disabled-on-mount в `AdminPaymentLinkDialog`.

## 9. DoD текущей итерации

- [x] One-time receipt_url подтверждён реальным Stripe webhook + audit.
- [x] Subscription invoice материализация — диагностирована причина (recurring → mode=payment).
- [x] Blocker оформлен с корневой причиной и коротким планом fix.
- [ ] Subscription invoice runtime verify — ОТКРЫТ, ждёт fix + повторный тест.
- [ ] Phase 9 — не начинать.
