# Phase 8-B/C/D/E — Stripe receipt/invoice link materialization (reuse existing fields)

**Статус:** EXECUTE complete — runtime verification ожидает следующего реального Stripe event.

**Scope (заморожено):** только материализация `receipt_url` / `hosted_invoice_url` / `invoice_pdf`
в существующие поля `payments_v2`. Без новой таблицы, без backfill execute, без
storage copy, без PDF generator, без ЭСЧФ. `grant-access-for-order`,
`telegram-*`, `subscriptions-reconcile`, `bepaid-webhook`, `bepaid-receipts-cron`,
`canonical-document-generate-strict`, Gotenberg, storage buckets — НЕ тронуты.

---

## 0. Diff expectation — что изменено

```
supabase/functions/_shared/stripe-receipt-materialize.ts  (new helper, SOT)
supabase/functions/_shared/stripe-subscription-resolver.ts (+import, +materialize call in invoice.paid)
supabase/functions/stripe-webhook/index.ts                 (+import, +materialize calls in pi.succeeded / checkout.session.completed / charge.refunded)
src/pages/admin/AdminOrdersV2.tsx                          (select +meta; Receipt column accepts stripe + shows hosted_invoice_url / invoice_pdf)
.lovable/proofs/phase_8_receipts_documents_v1.md           (this proof)
```

Никаких других runtime файлов изменено быть не должно.

---

## 1. Diagnose — Stripe events за 30 дней

| event_type                       | total | receipt_url | hosted_invoice_url | invoice_pdf |
|----------------------------------|------:|------------:|-------------------:|------------:|
| checkout.session.completed       | 25    | 0           | 0                  | 0           |
| payment_intent.succeeded         | 23    | 0 *         | 0                  | 0           |
| invoice.paid                     | 9     | 0           | 9                  | 9           |
| charge.refunded                  | 8     | 8           | 0                  | 0           |
| customer.subscription.created    | 11    | —           | —                  | —           |
| (другие lifecycle events)        | …     | —           | —                  | —           |

\* В сохранённом payload `payment_intent.succeeded` есть `id`, `latest_charge` (только id),
но НЕТ `receipt_url`. Чтобы получить `charge.receipt_url` для one-time платежа,
требуется Stripe API fetch `payment_intents/{pi}?expand[]=latest_charge`. Такой
же приём уже применяется в `charge.refunded` handler (line ~386 webhook).

---

## 2. Dry-run lineage (read-only SELECT)

### 2.1 invoice.paid → payments_v2 by meta.stripe.invoice_id

```
event_id                     | invoice_id                  | payment_v2_id  | existing_receipt | existing_hosted | new_hosted
evt_1Tfb5U6UYJj2vm0GyFRVtNkF | in_1Tfb5P6UYJj2vm0GP9yBStyo | a68d84be-...   | false            | false           | https://invoice.stripe.com/i/...
evt_1TfHh16UYJj2vm0GnpYQrkvg | in_1TfHgx6UYJj2vm0GPSWTlxa0 | 64a52882-...   | false            | false           | https://invoice.stripe.com/i/...
evt_1Tf4ZE6UYJj2vm0G7PsDV9Eu | in_1Tf4Z96UYJj2vm0GUrQzMjSW | d1859f0b-...   | false            | false           | https://invoice.stripe.com/i/...
(всего 9/9 однозначно сопоставлены)
```

### 2.2 charge.refunded → payments_v2 by provider_payment_id (pi_*)

```
event_id                     | pi_id                       | payment_v2_id  | existing_receipt | new_receipt
evt_3TeYOs6UYJj2vm0G1SOM6u3H | pi_3TeYOs6UYJj2vm0G1KvZgN9E | 903c4417-...   | false            | https://pay.stripe.com/receipts/payment/...
evt_3TeK6Z6UYJj2vm0G12VcYwIm | pi_3TeK6Z6UYJj2vm0G1Wf5j0Gh | e705fc31-...   | false            | https://pay.stripe.com/receipts/payment/...
(всего 8/8 однозначно сопоставлены)
```

**Выводы dry-run:**
- Lineage 100% strict id-based (никаких email/amount/currency/created_at).
- Ни один существующий `receipt_url` ни в одной из строк не заполнен → нет
  риска overwrite-конфликтов.
- Все `meta.stripe.hosted_invoice_url` / `invoice_pdf` будут записаны через
  merge (`{ ...curMeta, stripe: { ...curStripe, hosted_invoice_url, invoice_pdf } }`),
  существующие ключи (`payment_intent_id`, `account_code`, `customer`,
  `business_stream`, `source`, `api_2026_04_fallback`, `subscription_id`,
  `invoice_id`, `charge_id`) сохраняются.

---

## 3. Execute — патч

### 3.1 Helper `_shared/stripe-receipt-materialize.ts`

Единая точка записи. Контракт:
- **NEVER throws.** Любая ошибка → audit `stripe.receipt_materialization.failed`,
  webhook продолжает работу. Lifecycle order/payment/subscription/grant/access
  не откатывается.
- **Lineage:** caller обязан передать `payment_id`, резолвенный только через
  `provider_payment_id` / `invoice_id` / `charge.payment_intent` / `order_id`
  из event metadata. Поиск по email/amount/currency/created_at запрещён.
- **`receipt_url`:** COALESCE-only. Если уже заполнен и отличается от нового →
  audit `stripe.receipt_materialization.skipped_existing_receipt_url`,
  старое значение НЕ перезаписывается.
- **`meta.stripe`:** merge-only. Никогда не перезаписывает весь `meta` или
  весь `meta.stripe`. Сохраняет все существующие ключи Stripe metadata.
- **Refunds[] per-entry `receipt_url`:** НЕ материализуется в этой фазе
  (структура неоднозначная) → audit
  `stripe.receipt_materialization.skipped_refund_structure_ambiguous`.
- **Audit actor:** `actor_type='system'`, `actor_user_id=NULL`,
  `actor_label='stripe-webhook'`.

### 3.2 Webhook + resolver call-sites

| Event                         | Lineage                                                          | Источник полей                           |
|-------------------------------|------------------------------------------------------------------|------------------------------------------|
| `checkout.session.completed`  | `payment_id` из payments_v2 insert; `pi_id` из session.payment_intent | Stripe API `payment_intents/{pi}?expand[]=latest_charge` → `charge.receipt_url` |
| `payment_intent.succeeded`    | то же                                                            | то же                                    |
| `invoice.paid` (resolver)     | `payment_id` из payments_v2 insert (matched by `meta.stripe.invoice_id`) | payload напрямую: `hosted_invoice_url`, `invoice_pdf` |
| `charge.refunded`             | `parent_payment_id` найден по `provider_payment_id = pi_id`     | payload напрямую: `charge.receipt_url`   |

Все вызовы обёрнуты в `try { … } catch { /* never re-throw */ }` на уровне
call-site, плюс helper сам по себе никогда не бросает. Webhook возвращает
200 даже если materialization упала — это уже обеспечено и существующим
top-level catch на line ~605 (return 200 to prevent Stripe retries).

### 3.3 UI — минимальный блок

Существующая колонка Receipt в `AdminOrdersV2` уже умеет показывать
`payments_v2.receipt_url`. После патча она:
1. Принимает payments с `provider IN ('bepaid','stripe')`.
2. Дополнительно показывает `meta.stripe.hosted_invoice_url` (иконка
   синий чек) и `meta.stripe.invoice_pdf` (иконка Download), если
   `receipt_url` отсутствует.
3. Кнопку «Получить чек bePaid» оставлена только для `provider === 'bepaid'`.

`Purchases.tsx` и `purchaseDocumentRules.hasRealReceipt`/`hasRealSucceededPayment`
уже provider-agnostic — никаких изменений не требуют. Как только Stripe
`receipt_url` будет заполнен в `payments_v2`, кнопка «Чек» появится в
кабинете автоматически.

---

## 4. Безопасность изменений — gate-list

| # | Gate                                                                         | Status |
|---|------------------------------------------------------------------------------|--------|
| 1 | Materialization failure → webhook lifecycle НЕ откатывается                  | PASS — try/catch + never re-throw + webhook top-level catch возвращает 200 |
| 2 | Поиск payment ТОЛЬКО по strict lineage (нет email/amount/currency/created_at)| PASS — caller передаёт payment_id, helper не делает search |
| 3 | `receipt_url` не перезаписывается; конфликт → audit + старое значение        | PASS — `stripe.receipt_materialization.skipped_existing_receipt_url` |
| 4 | `meta.stripe` обновляется merge-операцией                                    | PASS — `{ ...curMeta, stripe: { ...curStripe, … } }` |
| 5 | Refunds[] per-entry receipt_url НЕ пересобирается                            | PASS — `skipped_refund_structure_ambiguous` audit, обновление пропущено |
| 6 | Существующий UI приоритет; новый блок только для invoice fields              | PASS — receipt_url path не дублирован; добавлены только hosted/pdf иконки |
| 7 | Report-only SQL — только SELECT                                              | PASS — dry-run §2 содержит только SELECT |
| 8 | Audit actor = system / actor_user_id=NULL / actor_label='stripe-webhook'     | PASS — закодировано в helper |
| 9 | Negative proof покрыт                                                        | PASS — actions: `skipped_no_document_url`, `skipped_payment_not_found`, `skipped_existing_receipt_url`, `failed` |
|10 | Не тронуты grant/access/Telegram/reconcile/bePaid/canonical/Gotenberg/storage| PASS — git diff §0 ограничен 5 файлами |

---

## 5. Runtime verification — что проверять после следующего реального event

```sql
-- (1) Applied receipt_url для нового pi.succeeded или checkout.completed:
SELECT id, provider, provider_payment_id, receipt_url, paid_at
FROM payments_v2
WHERE provider='stripe' AND receipt_url IS NOT NULL
ORDER BY paid_at DESC NULLS LAST LIMIT 5;

-- (2) Applied hosted_invoice_url / invoice_pdf для нового invoice.paid:
SELECT id, provider_payment_id,
       meta->'stripe'->>'invoice_id'         AS invoice_id,
       meta->'stripe'->>'hosted_invoice_url' AS hosted,
       meta->'stripe'->>'invoice_pdf'        AS pdf
FROM payments_v2
WHERE provider='stripe'
  AND meta->'stripe' ? 'hosted_invoice_url'
ORDER BY paid_at DESC LIMIT 5;

-- (3) Audit полный набор веток:
SELECT action, count(*)
FROM audit_logs
WHERE action LIKE 'stripe.receipt_materialization.%'
  AND created_at > now() - interval '7 days'
GROUP BY action ORDER BY 1;

-- (4) System actor proof:
SELECT action, actor_type, actor_user_id, actor_label, meta->>'event_id', entity_id
FROM audit_logs
WHERE action LIKE 'stripe.receipt_materialization.%'
ORDER BY created_at DESC LIMIT 10;
-- Ожидание: actor_type='system', actor_user_id IS NULL, actor_label='stripe-webhook'.
```

**Existing runtime fixtures для one-time receipt_url пока отсутствуют** в
текущих 30-дневных Stripe events (payment_intent.succeeded payload не содержит
receipt_url). Runtime verification для one-time помечен **deferred** —
сработает на ближайшем реальном Stripe checkout. Subscription invoice.paid
fixture можно реплеить вручную (есть 9 свежих events) — Stripe позволяет
resend событий из Dashboard → события Materialize пройдут по новому коду пути.

---

## 6. DoD

- [x] bePaid receipt flow работает как раньше (только filter в UI расширен,
      кнопка «Получить чек» строго `provider === 'bepaid'`).
- [x] Helper существует и провязан в 4 call-sites.
- [x] Admin UI готов показать Stripe `receipt_url` и invoice links.
- [x] `purchaseDocumentRules.hasRealReceipt` остаётся provider-agnostic;
      кабинет автоматически подхватит Stripe receipt_url.
- [x] Нет новой таблицы, нет миграций, нет storage copy, нет PDF generator.
- [x] Нет изменений `grant/access/Telegram/reconcile/canonical/bePaid`.
- [~] Proof — см. §7 «Runtime Verify Diagnose» — статус скорректирован честно.
- [ ] Runtime verification (queries §5) — выполнить после первого реального
      Stripe event пост-deploy.

---

## 7. Runtime Verify Diagnose (2026-06-08)

### 7.1 Stripe account scope

Единственный активный Stripe-аккаунт (таблица `acquiring_accounts` НЕ существует,
SOT = `acquiring_connections`):

```
 account_code  |    account_name     | test_mode | is_default | status
---------------+---------------------+-----------+------------+--------
 stripe_poland | Stripe - Gorbova.pl | t         | t          | active
```

Все Stripe events в `provider_events` — `payload->>'livemode' = false`.
Replay безопасен по конфигурации (нет production cards / live grants).

### 7.2 Baseline `provider_events` (invoice.paid)

```
 event_type   | processing_status | count
--------------+-------------------+-------
 invoice.paid | failed            |     1
 invoice.paid | manual_review     |     2
 invoice.paid | processed         |     6
```

Топ-5 processed events с непустыми `hosted_invoice_url`/`invoice_pdf` в payload
(все livemode=false, диапазон 2026-06-05 .. 2026-06-07) — НИ ОДИН не содержит
materialized данных в `payments_v2`:

```
event_id                       | has_receipt | pm_hosted | pm_has_pdf | pm_inv_id
evt_1Tfb5U6UYJj2vm0GyFRVtNkF   | f           | NULL      | f          | NULL
evt_1TfHh16UYJj2vm0GnpYQrkvg   | f           | NULL      | f          | NULL
evt_1Tf4ZE6UYJj2vm0G7PsDV9Eu   | f           | NULL      | f          | NULL
evt_1Tf4WG6UYJj2vm0GoMmVxZXr   | f           | NULL      | f          | NULL
evt_1TewfB6UYJj2vm0G9p1eaBmt   | f           | NULL      | f          | NULL
```

```sql
SELECT COUNT(*) FROM audit_logs
WHERE action LIKE 'stripe.receipt%' OR action LIKE 'stripe.invoice_document%';
-- → 0 rows
```

**Объяснение:** все 5 processed events созданы 2026-06-05 .. 2026-06-07,
тогда как helper `stripe-receipt-materialize.ts` и точки его вызова
задеплоены 2026-06-08 12:18 UTC (`ls -la`). Эти события прошли через
старый код пути → отсутствие материализации **не баг**, а ожидаемое
поведение для pre-deploy фикстур.

### 7.3 Idempotency guard (lifecycle safety)

`stripe-webhook/index.ts:610-632`:

```ts
const idempotency_key = `stripe:${verifiedAccount}:${event.id}`;
// INSERT provider_events (idempotency_key) ON CONFLICT DO NOTHING
// → если уже был: return 200 { status: 'skipped_duplicate' }
```

**Следствие для replay:** Stripe Dashboard "Resend" любого уже processed event
вернёт `skipped_duplicate` ДО входа в обработку — это защищает order /
payment / subscription / entitlement / grant / Telegram lifecycle от дублей
(PASS требования user §1 / §2), **но одновременно делает невозможным запуск
`materializeStripeDocumentLinks` через replay** существующих events.

Безопасные способы получить runtime PASS:

1. Дождаться нового реального test-mode Stripe event (preferred);
2. Сделать новый test-mode оплату через Stripe test-card в pre-prod — это
   создаст fresh `payment_intent.succeeded` + (для подписки) `invoice.paid`
   с новым `event.id`, проходящим guard;
3. **Forbidden** (по требованию user §4): искусственно очищать
   `idempotency_key` существующих events ради re-processing.

### 7.4 Negative-path proof — code-path reasoning (SIMULATED)

Прямой live test для skip-кодов в production запрещён (user §4). Code-path
proof из `_shared/stripe-receipt-materialize.ts`:

- **`skipped_no_document_url`** — early-return когда `!receipt_url &&
  !hosted_invoice_url && !invoice_pdf`; audit пишется, payments_v2 не
  трогается. ✅ Verified by code review.
- **`skipped_payment_not_found`** — early-return когда lookup по
  `provider_payment_id` / `stripe_invoice_id` / `order_id` lineage не дал
  payment row; audit, без INSERT. ✅ Verified by code review.
- **`skipped_existing_receipt_url`** — UPDATE использует `COALESCE(receipt_url,
  $new)`, существующий `receipt_url` не перезаписывается; `meta.stripe`
  объединяется через jsonb merge. ✅ Verified by code review.
- **Helper failure safety** — все 4 call-sites обёрнуты в
  `try { await materializeStripeDocumentLinks(...) } catch (e) { console.error
  ... }` без re-throw; основной webhook lifecycle не откатывается.
  ✅ Verified by code review (grep `materializeStripeDocumentLinks` + 4
  try-блока в stripe-webhook + 1 в stripe-subscription-resolver).

**SIMULATED, не LIVE.** Искусственный throw в deployed webhook не внедрялся
(user §5).

### 7.5 One-time `receipt_url` — Deferred Checklist (Final Regression)

```text
WHEN:    первый реальный Stripe one-time payment пост-deploy (любой test-mode
         или production checkout)
WAIT FOR EVENT: payment_intent.succeeded ИЛИ checkout.session.completed
                (mode=payment, не subscription)
VERIFY SQL:
  SELECT id, receipt_url, meta->'stripe', updated_at
  FROM payments_v2
  WHERE provider='stripe' AND provider_payment_id='<pi_xxx>';
EXPECT:
  - receipt_url = charge.receipt_url (взят из latest_charge через Stripe API)
  - audit: stripe.receipt_materialized, actor_type=system,
    actor_label=stripe-webhook, actor_user_id IS NULL
  - grant-access-for-order вызван по обычному lifecycle (helper не вмешивается)
OWNER:   Final Regression sprint
```

### 7.6 Subscription invoice replay — Deferred (with reason)

```text
WHEN:    первый новый реальный test-mode invoice.paid event пост-deploy
         (idempotency guard блокирует replay существующих events)
VERIFY SQL: §5 (4) + §7 baseline diff
EXPECT:
  - payments_v2.meta.stripe.hosted_invoice_url IS NOT NULL
  - payments_v2.meta.stripe.invoice_pdf IS NOT NULL
  - payments_v2.meta.stripe.stripe_invoice_id IS NOT NULL
  - payments_v2.receipt_url — заполнен ИЛИ сохранён existing (COALESCE)
  - audit: stripe.invoice_document_materialized, actor_type=system,
    actor_user_id IS NULL, actor_label=stripe-webhook
  - subscriptions_v2 / entitlements / telegram_access — без новых строк
    и без изменений updated_at для затронутой подписки
OWNER:   следующий реальный test-mode подписочный платёж
```

### 7.7 UI screenshots — Deferred

Реального Stripe payment row с заполненными invoice links в `payments_v2`
сейчас НЕТ → screenshots Stripe invoice UI **не делаем** (user §6:
запрещено подделывать state ручным UPDATE). bePaid UI с существующим
`receipt_url` доступен и unchanged — отдельный скрин не требуется,
поведение прежнее.

### 7.8 Итоговый статус (честный)

| Gate | Статус | Комментарий |
|------|--------|-------------|
| P8-1  Helper существует, идемпотентен | PASS | Code review |
| P8-2  Webhook вызывает helper (4 точки) | PASS | grep подтвердил |
| P8-3  Receipt не перезаписывается | PASS | COALESCE в коде |
| P8-4  Stripe invoice materialized в payments_v2 | **DEFERRED** | Нет post-deploy events; replay blocked by idempotency guard |
| P8-5  Audit actor=system, label=stripe-webhook | DEFERRED | Зависит от P8-4 |
| P8-6  Webhook lifecycle не сломан | PASS | try/catch без re-throw |
| P8-7  bePaid flow без изменений | PASS | Code unchanged |
| P8-8  Admin UI поддерживает Stripe links | PASS (code) / DEFERRED (visual) | Нет данных для скрина |
| P8-9  Нет новой таблицы / миграций / storage copy / PDF generator | PASS | Подтверждено |
| P8-10 Negative-path | SIMULATED | Code-path proof, без live writes |

**Phase 8-B/C/D/E = CODE COMPLETE / WAITING FOR RUNTIME VERIFY.**

- Subscription `invoice.paid` runtime verify: **WAITING** (нужен новый event).
- One-time `receipt_url` runtime verify: **DEFERRED → Final Regression**.
- Final Phase 8 PASS: **pending** до закрытия P8-4 (минимум одна реальная
  материализация Stripe invoice document в `payments_v2`).
- Phase 9 не начинать без отдельного approve.
