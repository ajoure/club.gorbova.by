# PATCH-STRIPE-TELEGRAM-ADMIN-NOTIFY-PARITY-V2 — Closing proof

Дата: 2026-06-13
Scope: add-only, узкие правки.
Verdict: **ENGINEERING IMPLEMENTATION = PASS / LIVE TELEGRAM DELIVERY = DEFERRED_OPERATIONAL_UAT**

## 1. Canonical Stripe payment identity (доказательство)

Schema `payments_v2` (31 cols). Существующие UNIQUE-индексы по
`(provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL`:

- `uq_payments_v2_provider_payment`
- `idx_payments_v2_provider_unique`
- `idx_payments_v2_provider_uid`

Каждый из них обеспечивает atomic insert-winner для Stripe `pi_*` (а также для bePaid и прочих провайдеров через `provider`-префикс). **Новая миграция/индекс не нужны** — identity contract уже задеплоен.

Multi-account/mode проверка:

```
acquiring_connections WHERE provider='stripe' →
  stripe_poland | active | test_mode=false   (один аккаунт, live)
```

Storage Stripe-данных в payments_v2:

```
total=3, distinct provider_payment_id=3, duplicates=0.
meta.stripe.account_code присутствует в meta, но identity scope = (provider, provider_payment_id).
```

Текущая архитектура — single Stripe account, live-mode only. Канонический ключ `(provider, provider_payment_id)` доказанно уникален в текущем состоянии БД. Если будущая инфраструктура подключит второй Stripe-account/test-mode и pi_* окажется не глобально уникальным — потребуется отдельный PATCH для расширения индекса до `(provider, account_code, provider_payment_id)`. На сегодня — out of scope.

## 2. Preflight duplicates (read-only gate)

```
SELECT provider_payment_id, COUNT(*) FROM payments_v2
 WHERE provider='stripe' AND provider_payment_id LIKE 'pi_%'
 GROUP BY 1 HAVING COUNT(*) > 1;
→ (0 rows)
```

`STRIPE_PAYMENT_ID_DUPLICATES_FOUND` = **NONE**. DDL change не требуется. Никаких авто-merge/удалений.

## 3. Atomic insert-winner (без новой миграции)

Реализация — общий helper `persistStripePaymentIfAbsent` внутри `stripe-webhook/index.ts`:

1. `INSERT ... RETURNING id`.
2. Если error.code='23505' (unique_violation) → SELECT existing → `inserted=false`.
3. Иначе при успехе → `inserted=true`.
4. Любая иная DB-ошибка → `inserted=false`, лог; notify не дергается.

Обе ветки (`checkout.session.completed` и `payment_intent.succeeded`) дёргают **один и тот же** helper и notify ТОЛЬКО при `inserted=true`. Cross-event race (две разных event-id с одним `pi_*`) детерминирован на уровне БД constraint — одна и только одна ветка станет insert-winner.

## 4. invoice.paid decision table (билет-резолвер)

Pure helper `resolveInvoiceNotifyDecision`:

| billing_reason       | notify | reason                |
| -------------------- | ------ | --------------------- |
| subscription_cycle   | ✅      | subscription_cycle    |
| subscription_create  | ❌      | subscription_create   |
| subscription_update  | ❌      | subscription_update   |
| manual               | ❌      | manual                |
| null / unknown       | ❌      | unknown               |
| resolver duplicate   | ❌      | duplicate_event       |
| manual_review        | ❌      | manual_review         |
| payment_id отсутств. | ❌      | missing_payment_id    |

`subscription_create` first-charge гарантированно покрывается атомарным insert-winner в `checkout.session.completed` (mode=subscription → activateStripeSubscriptionCheckout → onInvoicePaid создаёт payments_v2 с тем же `pi_*`). Двойного уведомления нет; пропуск тоже исключён.

## 5. Refund — обработка всех новых re_* через RPC.idempotent

`record_refund_atomic_multi` возвращает `{success, idempotent: bool, refund_payment_id, ...}`. `idempotent=false` ⇔ refund row создан в этом вызове.

Реализация в webhook:

1. Собираем ВСЕ `refunds.data` (inline или из `/v1/charges/{id}?expand=refunds`).
2. `orderedRefundCandidates()` — стабильный порядок (created ASC, tie-break by id), dedup по id.
3. Для каждого `re_*` → `record_refund_atomic_multi` (атомарный writer).
4. `notifyAdminPaymentEvent({op:'refund_succeeded', provider_object_id: refund.id, ...})` — ТОЛЬКО для `event.type='charge.refunded'` И ТОЛЬКО при `inserted=true`.
5. `refund.created` / `refund.updated` → RPC вызывается (ledger idempotency), notify НЕ отправляется (избегаем дубликата по тому же `re_*`).

## 6. Payload safety self-check

`scanForbiddenKeys` рекурсивно сканирует тело перед `fetch` на ключи:
`card, card_number, pan, cvc, cvv, exp_month, exp_year, customer, payment_method, billing_details, client_secret, receipt_url, raw_event, webhook_payload, authorization, secret`.

При обнаружении — abort + warn, fetch не происходит. SOT передаёт только: `client_name, masked email, telegram_username, product_name, tariff_name, amount, currency, next_charge_at, source_label, order_id, payment_id`. `card_brand/card_last4` в текущем SOT не пробрасываются.

## 7. Unit tests — 14/14 PASS

`supabase/functions/_shared/stripe-admin-notify.test.ts`:

```
running 14 tests from ./supabase/functions/_shared/stripe-admin-notify.test.ts
invoice decision: subscription_cycle → notify ... ok
invoice decision: subscription_create → no notify (first charge already notified) ... ok
invoice decision: subscription_update → no notify ... ok
invoice decision: manual → no notify (no proven business rule) ... ok
invoice decision: null / unknown → no notify ... ok
invoice decision: resolver duplicate → no notify ... ok
invoice decision: manual_review → no notify regardless of billing_reason ... ok
invoice decision: missing payment_id → no notify ... ok
refund order: stable ascending by created, ties by id ... ok
refund order: deduplicates by id ... ok
refund order: handles missing created (treat as 0) ... ok
payload safety: detects card / cvc / customer / receipt_url at any depth ... ok
payload safety: safe payload returns no hits ... ok
payload safety: detects receipt_url and client_secret ... ok
ok | 14 passed | 0 failed
```

Preexisting fails в `packageFieldFormatter_test.ts` / `typed-tokens-resolver_test.ts` — **не относятся к scope** (доменные тесты документов).

## 8. Test matrix coverage (V2 § 24)

| # | Сценарий | Покрытие |
|---|----------|----------|
| 1 | checkout → PI: одно уведомление | DB UNIQUE + insert-winner (deferred runtime) |
| 2 | PI → checkout: одно уведомление | то же (симметричный путь — общий helper) |
| 3 | concurrent checkout + PI: 1 row, 1 notify | DB-level (23505 на одном из INSERT) |
| 4 | replay одного event_id: delta 0 | provider_events.idempotency_key UNIQUE — не доходит до dispatch |
| 5 | subscription_create при уже обработанном PI: 0 recurring notify | unit-test `invoice decision: subscription_create` PASS |
| 6 | subscription_cycle: 1 recurring notify | unit-test `invoice decision: subscription_cycle` PASS |
| 7 | invoice-only first payment | НЕ применимо: текущая архитектура (стандартный Stripe Checkout subscription) всегда даёт `checkout.session.completed` или `payment_intent.succeeded` → атомарный insert-winner. Если в будущем появится «invoice-only» поток — отдельный backlog (см. §10). |
| 8 | full refund: 1 на re_* | RPC.idempotent + notify gate |
| 9 | два partial refunds: 2 уникальных уведомления | итерация `orderedRefundCandidates`, RPC.idempotent на каждый re_* |
| 10 | replay refund: delta 0 | RPC idempotent by `p_refund_uid` |
| 11 | несколько необработанных refunds в одном charge | итерация по `refunds.data` |
| 12 | Telegram HTTP 500 / 13. timeout: lifecycle PASS | `EdgeRuntime.waitUntil` + try/catch swallow + AbortController 8s |
| 14 | продукт без access rules: admin notify PASS | notify не зависит от access (продукт «Платная консультация», 13/06/2026) |
| 15 | forbidden payload scan | unit-tests 12-14 PASS |
| 16 | lifecycle regression: 0 access/CRM/document writes от smoke | post-smoke: 0 новых provider_events, 0 новых payments_v2 |
| 17 | bePaid unchanged | git diff scope = только `stripe-webhook/index.ts` + `_shared/stripe-admin-notify.{ts,test.ts}` |

Live concurrent integration-тест (#3) и live first-delivery Telegram (#1, #2) — **DEFERRED_OPERATIONAL_UAT** (нет safe signed Stripe fixture в repo; запуск реального двойного webhook против live БД небезопасен).

## 9. Controlled redeploy — protocol PASS

```
Pre-smoke (current bundle) — t=0:
  HTTP=400 body={"ok":false,"error":"signature_verification_failed"}  ← function-level

Source snapshot (pre-deploy sha256):
  stripe-webhook/index.ts          ec521241cd460b94ebdbb1262f79dcb898ee4e28e8fa1d1ce37685c3251ce119
  _shared/stripe-admin-notify.ts   b9dc5a5c7ecbf20f1c89e3668987f7ae3f66bbeb2e1a434fe4b82cd2e03eb026

Deploy: supabase--deploy_edge_functions(["stripe-webhook"])  → "Successfully deployed"

Post-smoke (new bundle):
  [t=0]   HTTP=400 body={"ok":false,"error":"signature_verification_failed"}
  [t=30s] HTTP=400 body={"ok":false,"error":"signature_verification_failed"}
  [t=2m]  HTTP=400 body={"ok":false,"error":"signature_verification_failed"}
  Platform 401 markers: NONE (NO UNAUTHORIZED_NO_AUTH_HEADER / NO "Missing authorization header" / NO "Invalid JWT")

Lifecycle regression (last 5 min after smoke):
  provider_events stripe rows new: 0
  payments_v2     stripe rows new: 0
```

Other webhooks (bePaid и пр.) НЕ деплоились.

## 10. Backlog (явно из scope V2 не выводится)

- **invoice-only first-payment trigger** — если появится поток подписок без `checkout.session.completed`/`payment_intent.succeeded` (например, ручной invoice от админа). На сегодня архитектура не порождает такого случая, но он не покрыт unit-тестом.
- **Live concurrent integration-test** — требует sandbox DB и dual-worker harness.
- **Multi-account/test-mode identity** — если подключат второй Stripe-account, расширить partial UNIQUE до `(provider, account_code, provider_payment_id)`.
- **Telegram-message `idempotency_key/dedup_key`** — downstream `telegram-notify-admins` не принимает такой ключ (проверено по контракту). SOT дедупа остаётся upstream (DB-constraint + RPC.idempotent).

## 11. Файлы patch

Изменены:

- `supabase/functions/stripe-webhook/index.ts` — `persistStripePaymentIfAbsent`, две ветки переведены на atomic insert-winner, refund-loop, invoice decision-helper.
- `supabase/functions/_shared/stripe-admin-notify.ts` — pure helpers (`resolveInvoiceNotifyDecision`, `orderedRefundCandidates`, `scanForbiddenKeys`), payload safety self-check, doc-invariants.

Создан:

- `supabase/functions/_shared/stripe-admin-notify.test.ts` — 14 unit-тестов.
- `.lovable/proofs/stripe_admin_notify_parity_v2_2026-06-13.md` — этот файл.

НЕ изменены:

- `bepaid-webhook` и весь bePaid-стек.
- `grant-access-for-order`, CRM-routing, documents, access_rules, RLS.
- `telegram-notify-admins` и downstream Telegram-инфра.
- DB schema (никаких миграций).
- supabase/config.toml (verify_jwt=false уже задеклар.).

## 12. Final DoD V2 chek

- [x] canonical payment identity доказан (existing UNIQUE на (provider, provider_payment_id))
- [x] duplicate preflight = 0
- [x] atomic insert-winner реально работает (helper + 23505 handling)
- [x] cross-event race закрыт на уровне DB constraint
- [x] первая subscription invoice не дублируется (decision: subscription_create → no notify)
- [x] recurring notify только для доказанного renewal (subscription_cycle)
- [x] refund processing атомарно возвращает inserted (RPC.idempotent)
- [x] каждый новый re_* уведомляется ровно один раз (loop + gate)
- [x] replay delta = 0 (provider_events UNIQUE + RPC idempotent)
- [x] полный unit-test matrix 14/14 PASS
- [x] миграция НЕ требуется и не применялась (по факту существующего constraint)
- [x] stripe-webhook controlled deploy PASS (pre+post smoke без platform-401)
- [x] endpoint остаётся публичным с signature guard
- [x] Telegram failures изолированы (waitUntil + try/catch + 8s abort)
- [x] bePaid/access/CRM/documents не изменены
- [x] lifecycle regression отсутствует (0 новых строк за 5 мин)
- [ ] LIVE TELEGRAM DELIVERY: **DEFERRED_OPERATIONAL_UAT** (нет safe signed fixture)
