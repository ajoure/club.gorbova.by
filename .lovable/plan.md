да, согласен.

Отправляй в таком виде.

Контрольные точки для следующего отчёта:

1. **Phase 8 FULL PASS** — только если закрыты оба сценария:
  - Stripe subscription `invoice.paid` → `hosted_invoice_url` / `invoice_pdf`;
  - Stripe one-time → `receipt_url`.
2. Если one-time не удалось проверить, но subscription прошёл:
  - статус только **Phase 8 = PASS with one-time receipt_url deferred to Final Regression**.
3. Если subscription invoice не материализовался:
  - статус остаётся **CODE COMPLETE / WAITING FOR RUNTIME VERIFY**.
4. Нельзя принимать отчет без:
  - SQL before/after;
  - audit `stripe.invoice_document_materialized`;
  - `actor_type='system'`, `actor_user_id=NULL`, `actor_label='stripe-webhook'`;
  - UI-скринов;
  - проверки отсутствия дублей order/payment/subscription/access/Telegram.
5. После закрытия Phase 8:
  - дальше **Phase 9 Reporting / admin visibility**;
  - затем **Phase 10 Final Regression**.
  - &nbsp;
  - План: Phase 8 Runtime Verify (вариант B, test-mode Stripe)

## 0. Scope freeze (read-only + один реальный test-payment)

Код, миграции, edge functions, UI — НЕ менять.

Не трогать: `grant-access-for-order`, `entitlements`, Telegram, `subscriptions-reconcile-*`, `bepaid-*`, `canonical-document-*`, Gotenberg, storage, PDF generator. Никаких ручных UPDATE для подделки результата.

Разрешено только:

- создать Stripe payment link через обычный admin flow;
- пройти Stripe test-mode checkout;
- дождаться webhook;
- читать SQL/audit;
- сделать UI скриншоты;
- обновить proof.

## 1. Test fixture

- Контакт: Федорчук Сергей / `7500084@gmail.com` (существующий superadmin).
- Продукт: **Gorbova Club**, тариф — любой доступный (берём первый активный recurring tariff_offer с Stripe-поддержкой).
- Provider: Stripe, account_code — соответствующий профилю club, currency по offer.

## 2. Diagnose (до создания ссылки)

Снять baseline:

```sql
-- последний Stripe payment для контакта
SELECT id, provider, provider_payment_id, order_id, receipt_url,
       meta->'stripe' AS stripe_meta, created_at, updated_at
FROM payments_v2
WHERE provider='stripe'
  AND meta->'stripe'->>'customer_email' = '7500084@gmail.com'
ORDER BY created_at DESC LIMIT 5;

-- активные club подписки контакта
SELECT id, status, tariff_id, access_end_at, meta->'stripe' AS stripe_meta, updated_at
FROM subscriptions_v2 s
JOIN profiles p ON p.id = s.user_id
WHERE p.email = '7500084@gmail.com'
ORDER BY updated_at DESC LIMIT 5;
```

Зафиксировать `before` snapshot в proof.

**Идемпотентность guard**: убедиться, что `provider_events_idem_unique` активен — replay не нужен, идёт новый event.

## 3. Тест A — Stripe subscription `invoice.paid` (основной)

1. Admin создаёт payment link на Gorbova Club (любой recurring tariff), provider=stripe.
2. Открыть public-link, ввести Stripe test card `4242 4242 4242 4242` (любая CVC/exp).
3. Дождаться webhook events:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `invoice.paid`

### Verify SQL (после оплаты)

```sql
SELECT id, provider, provider_payment_id, order_id, receipt_url,
       meta->'stripe'->>'hosted_invoice_url' AS hosted_invoice_url,
       meta->'stripe'->>'invoice_pdf'        AS invoice_pdf,
       meta->'stripe'->>'stripe_invoice_id'  AS stripe_invoice_id,
       updated_at
FROM payments_v2
WHERE provider='stripe'
ORDER BY updated_at DESC LIMIT 5;
```

Expect: `hosted_invoice_url` + `invoice_pdf` + `stripe_invoice_id` заполнены.

### Audit verify

```sql
SELECT action, actor_type, actor_user_id, actor_label, metadata, created_at
FROM audit_logs
WHERE action LIKE 'stripe.%materializ%'
   OR action LIKE 'stripe.%document%'
ORDER BY created_at DESC LIMIT 30;
```

Expect: `stripe.invoice_document_materialized`, `actor_type='system'`, `actor_user_id IS NULL`, `actor_label='stripe-webhook'`.

## 4. Тест B — One-time receipt_url (best-effort)

Если у Gorbova Club есть one-time оффер — пройти его тоже. Если нет — попытка через консультацию / Global Hub. Иначе зафиксировать честно:

> One-time receipt_url = DEFERRED to Final Regression (нет безопасного one-time оффера в этом запуске).

Verify тот же SQL: `receipt_url` должен заполниться из `charge.receipt_url`, audit — `stripe.receipt_materialized`.

## 5. Lifecycle safety verify

После оплаты проверить отсутствие регрессий:

```sql
-- дубли orders / payments / subs по новому Stripe id
SELECT order_id, COUNT(*) FROM payments_v2
WHERE provider='stripe' AND created_at > now() - interval '1 hour'
GROUP BY order_id HAVING COUNT(*)>1;

SELECT provider_payment_id, COUNT(*) FROM payments_v2
WHERE provider='stripe' AND created_at > now() - interval '1 hour'
GROUP BY provider_payment_id HAVING COUNT(*)>1;

-- grant ledger для контакта
SELECT action, source, created_at, metadata
FROM access_grant_ledger agl
JOIN profiles p ON p.id = agl.user_id
WHERE p.email='7500084@gmail.com'
ORDER BY created_at DESC LIMIT 20;

-- Telegram audit
SELECT action, created_at, metadata
FROM telegram_access_audit
WHERE created_at > now() - interval '1 hour'
  AND metadata::text LIKE '%7500084%'
ORDER BY created_at DESC LIMIT 20;
```

Expect: ровно по одной строке order/payment/subscription, единичный grant Club через канонический write-path, Telegram — auto-grant через `grant-access-for-order → telegram-grant-access` (без дублей). bePaid не задет.

## 6. UI screenshots (вложить в proof)

1. AdminOrdersV2 — Stripe subscription row с иконками online invoice + PDF.
2. AdminOrdersV2 — bePaid row с прежним receipt (regression baseline).
3. Stripe row без документа (если найдётся) — empty state.
4. Stripe row — кнопка «Получить чек bePaid» ОТСУТСТВУЕТ.

## 7. Proof update

Файл: `.lovable/proofs/phase_8_receipts_documents_v1.md`

Добавить Section 8 `Runtime Verify Execute`:

- test contact, test product, tariff_id, payment_link_id;
- Stripe checkout session id, payment_intent id, invoice id, subscription id;
- webhook event ids (`evt_*`);
- before/after SQL snapshots;
- audit rows (id + action + actor_*);
- lifecycle safety snapshots;
- 4 UI screenshots;
- финальная gate table с честным статусом.

## 8. Финальный статус (по результату)


| Сценарий                                                      | Статус Phase 8                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------------- |
| invoice.paid materialized + one-time receipt_url materialized | **FULL PASS**                                                     |
| invoice.paid materialized, one-time не пройден                | **PASS with one-time receipt_url deferred to Final Regression**   |
| invoice.paid не materialized                                  | **CODE COMPLETE / WAITING FOR RUNTIME VERIFY** (откат к diagnose) |


НЕ ставить FULL PASS, если one-time не подтверждён реальным charge.

## 9. После Phase 8

- Phase 9 Reporting / admin visibility — отдельный план после approve.
- Phase 10 Final Regression — bePaid + Stripe + access + CRM + Telegram + documents — отдельный план.

## DoD

- Реальный Stripe test-mode payment на `7500084@gmail.com` / Gorbova Club прошёл webhook.
- `payments_v2.meta.stripe.hosted_invoice_url` + `invoice_pdf` заполнены реальными значениями.
- Audit содержит `stripe.invoice_document_materialized` с system actor.
- Нет дублей order/payment/subscription, Telegram/bePaid без регрессий.
- 4 UI screenshots вложены.
- Proof обновлён, статус выставлен честно по таблице из §8.
- Никаких изменений в коде/миграциях/UI.