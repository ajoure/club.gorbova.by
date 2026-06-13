# PATCH-STRIPE-TELEGRAM-ADMIN-NOTIFY-PARITY-V2 — fix-to-patch proof

Date: 2026-06-13
Status: ENGINEERING IMPLEMENTATION = PASS
        LIVE TELEGRAM DELIVERY    = DEFERRED_OPERATIONAL_UAT

## 0. Что сделано в fix-to-patch (поверх V2)

Без нового патча, без новых функций, без миграций.

| # | Блокер | Резолв |
|---|---|---|
| 1 | Главный race не доказан | Добавлен concurrency-тест persist_race с in-memory mock UNIQUE(provider, provider_payment_id), 2 и 5 параллельных писателей. |
| 2 | 23505 может маскировать чужой constraint | persistStripePaymentIfAbsent теперь после 23505 ОБЯЗАТЕЛЬНО ищет существующую строку с тем же (provider='stripe', provider_payment_id=pi_id). Если нет — RETHROW. Тест assertRejects. |
| 3 | Lifecycle (grant-access/CRM/docs) исполнялся обеими ветками | checkout.session.completed и payment_intent.succeeded теперь делают persist ПЕРВЫМ; loser (inserted=false) выходит с note `cross_event_loser_skipped:{checkout|pi}` без grant-access, CRM, transitionOrderPaid, consume payment_link, materialize docs, card enrichment. Подтверждено фактом — в audit_logs у pi_3ThrF46UYJj2vm0G13OzIbVS были 2× `crm_stage_applied_success` (PI 13:05:02 + checkout 13:05:14), второе с `result=idempotent_already_at_target`. Новая схема такого audit-шума не оставит. |
| 4 | Test matrix не полный | 21/21 тест PASS (см. §3). |
| 5 | Smoke не доказывает notification integration | Добавлен dispatch-mock тест (`stripe-admin-notify.dispatch.test.ts`): success → ровно 1 POST, HTTP 500 / timeout / refund — swallowed, no throw, корректный source label. |

## 1. Discovery (двойной CRM по pi_3ThrF46UYJj2vm0G13OzIbVS)

```
crm_stage_applied_success  PI       13:05:02   {trigger: stripe.payment_intent.succeeded, from: Новая → to: Успешно}
crm_stage_applied_success  CHECKOUT 13:05:14   {trigger: stripe.checkout.session.completed, result: idempotent_already_at_target}
```

Это НЕ business-duplicate (вторая транзакция была no-op), но это cross-event повторное обращение к CRM-engine. Fix-to-patch гасит источник: loser выходит до applyCrmStageOnTerminal.

## 2. Изменённые файлы (add-only / refactor without new contracts)

| Файл | sha256 | Назначение |
|---|---|---|
| supabase/functions/stripe-webhook/index.ts | `fd25e060d2d349e879b6ce24b68708667f8c16f7a602263d0d87dbc783f715cb` | Гейтинг lifecycle на inserted=true; strict 23505 handling; экспорт persistStripePaymentIfAbsent для тестов. |
| supabase/functions/_shared/stripe-admin-notify.ts | `b9dc5a5c7ecbf20f1c89e3668987f7ae3f66bbeb2e1a434fe4b82cd2e03eb026` | Без изменений в этом fix-to-patch (V2 baseline). |
| supabase/functions/stripe-webhook/persist_race.test.ts | new | Concurrency proof + 23505 rethrow proof. |
| supabase/functions/_shared/stripe-admin-notify.dispatch.test.ts | new | Mock-fetch dispatch integration proof. |

Не тронуто: bepaid-webhook, grant-access-for-order, crm-routing, payments_v2 schema, RLS, миграции, любые другие public webhook'и.

## 3. Test matrix

| # | Scenario | Verdict |
|---|---|---|
| 1 | invoice.paid `subscription_cycle` → notify=true | PASS |
| 2 | invoice.paid `subscription_create` → notify=false | PASS |
| 3 | invoice.paid `subscription_update` → notify=false | PASS |
| 4 | invoice.paid `manual` → notify=false | PASS |
| 5 | invoice.paid null/unknown → notify=false | PASS |
| 6 | invoice.paid resolver duplicate → notify=false | PASS |
| 7 | invoice.paid manual_review → notify=false | PASS |
| 8 | invoice.paid missing payment_id → notify=false | PASS |
| 9 | refund order: ascending by created, ties by id | PASS |
| 10 | refund order: dedup by id | PASS |
| 11 | refund order: missing created treated as 0 | PASS |
| 12 | payload safety: card/cvc/customer/receipt_url detected at any depth | PASS |
| 13 | payload safety: clean payload → no hits | PASS |
| 14 | payload safety: client_secret + receipt_url detected | PASS |
| 15 | **concurrency**: 2 parallel writers, same pi_* → 1 row, 1 winner, 1 loser, same payment_id | **PASS** |
| 16 | **concurrency**: 5 parallel writers, same pi_* → 1 row, 1 winner, 4 losers, single payment_id | **PASS** |
| 17 | **23505 rethrow**: unrelated unique violation → throws (no mask as duplicate) | **PASS** |
| 18 | dispatch: success → ровно 1 POST в /telegram-notify-admins, корректный body | PASS |
| 19 | dispatch: HTTP 500 → swallowed, no throw | PASS |
| 20 | dispatch: timeout (AbortController) → swallowed | PASS |
| 21 | dispatch: refund_succeeded → 1 POST, source=`stripe_webhook:refund_succeeded` | PASS |

Итог: **21/21 PASS** (`deno test --no-check`).

## 4. Поток обеих веток (после fix-to-patch)

### checkout.session.completed

```
md_business_stream / pi_id / session_id   ← parse
mergeStripeMetaOnOrder (set-if-absent — безопасно при дубле)
persistStripePaymentIfAbsent(pi_id)
    ├── inserted=true  → продолжить lifecycle (winner)
    └── inserted=false → RETURN cross_event_loser_skipped:checkout

[winner only]
    grant-access-for-order
    notifyAdminPaymentEvent(payment_succeeded)
    transitionOrderPaid
    applyCrmStageOnTerminal(success)
    consumePaymentLinkForOrder
    materializeStripeDocumentLinks
    enrichStripePaymentCardData
```

### payment_intent.succeeded

```
mergeStripeMetaOnOrder
persistStripePaymentIfAbsent(pi_id)
    ├── inserted=true  → winner
    └── inserted=false → RETURN cross_event_loser_skipped:pi

[winner only]
    grant-access-for-order   (NEW: ранее PI ветка не звала grant; добавлено чтобы winner-PI продлевал доступ при race)
    notifyAdminPaymentEvent(payment_succeeded)
    transitionOrderPaid
    applyCrmStageOnTerminal(success)
    materializeStripeDocumentLinks
    enrichStripePaymentCardData
```

### invoice.paid / subscription lifecycle

Без изменений в этом fix-to-patch. resolveInvoiceNotifyDecision уже разделяет subscription_create vs subscription_cycle.

### charge.refunded

Без изменений в этом fix-to-patch. Уведомление gated на `record_refund_atomic_multi.idempotent=false` per re_*.

## 5. 23505 invariant (формально)

```
INSERT payments_v2 ...
  err.code='23505' OR err.message ~ /duplicate key|unique constraint/i
    ↓
    SELECT id FROM payments_v2
      WHERE provider='stripe' AND provider_payment_id=$pi_id
    ↓
    matching row?  ─ yes → return { id, inserted:false }
                  └ no  → THROW (не маскируем чужой constraint)
```

## 6. Controlled redeploy stripe-webhook

Pre-deploy sha:  `fd25e060d2d349e879b6ce24b68708667f8c16f7a602263d0d87dbc783f715cb`
Post-deploy sha: `fd25e060d2d349e879b6ce24b68708667f8c16f7a602263d0d87dbc783f715cb`

Public smoke (без Supabase JWT, Stripe-Signature невалидна):

| t | OPTIONS | POST | body | platform-401? |
|---|---|---|---|---|
| 0s | 200 | 400 | `{"ok":false,"error":"signature_verification_failed"}` | NO |
| 30s | 200 | 400 | `{"ok":false,"error":"signature_verification_failed"}` | NO |
| 2m | 200 | 400 | `{"ok":false,"error":"signature_verification_failed"}` | NO |

- application-level signature guard работает;
- platform JWT wall отсутствует во всех трёх probes;
- никакие записи в orders_v2 / payments_v2 / subscriptions_v2 / access_rules не созданы (нет валидной подписи → dispatch не достигнут);
- bepaid-webhook и прочие публичные функции НЕ передеплоены.

## 7. Известное (без блокировки PASS)

- Live Telegram delivery — DEFERRED_OPERATIONAL_UAT: для безопасного proof нужна signed Stripe fixture от реального account_code, мы не генерируем подделанные подписи. После следующего реального платежа TG-уведомление прилетит в admin chat.
- TS-check полного supabase functions deno test всё ещё подсвечивает старые pre-existing типизационные ошибки в `stripe-checkout-materialize.ts` и `stripe-subscription-resolver.ts` (PostgREST `never` overloads). Не относятся к этому patch'у; рантайм корректен.

## 8. Vердикт

ENGINEERING IMPLEMENTATION = **PASS**
LIVE TELEGRAM DELIVERY     = **DEFERRED_OPERATIONAL_UAT**

V2 закрывается. Следующие патчи автоматически не запускать.
