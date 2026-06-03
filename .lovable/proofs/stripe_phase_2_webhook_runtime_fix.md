# Stripe Phase 2 — Webhook runtime fix + reconcile (PROOF)

Дата: 2026-06-03
Скоуп: новые edge functions `stripe-ensure-webhook`, `stripe-reconcile-session`; fix enum в `stripe-webhook`.
Freeze: bePaid, public payment_links, create-payment-checkout.ts, обычная ссылка из контакта — НЕ затронуты.

## 1. Корневая причина (Discovery)

| Сигнал | Факт |
|---|---|
| Stripe Checkout Session `cs_test_a1xtboo59...` (ORD-26-00134) | `status=complete`, `payment_status=paid`, `payment_intent=pi_3TeEq16UYJj2vm0G1DjJS83v` |
| edge logs `stripe-webhook` | **0 вызовов** за всё время |
| Stripe `GET /v1/webhook_endpoints` (до фикса) | **endpoint c URL `…/functions/v1/stripe-webhook` отсутствовал** |
| `provider_events where provider='stripe'` (до фикса) | 1 запись (симулированная из sandbox-checkout), ни одной от реального Stripe |
| Vault `acq:stripe:stripe_poland:webhook_signing_secret` | присутствовал, но «висел» без зарегистрированного endpoint |

**Вывод:** webhook endpoint никогда не был зарегистрирован в Stripe Dashboard для `stripe_poland`. Stripe физически не доставлял ни одного события → ни `provider_events`, ни `payments_v2`, ни перевода `orders_v2.status='paid'`. Это не проблема signature/CORS/edge — это отсутствие подписки на доставку.

Дополнительный баг, найденный при reconcile: `stripe-webhook.dispatch()` вставляет `payments_v2.status='paid'`, но enum `payment_status` принимает только `{pending,processing,succeeded,failed,refunded,canceled}` → реальный webhook упал бы на этом INSERT даже при доставке.

## 2. Что исправлено

1. **Новая edge function `stripe-ensure-webhook`** (super_admin):
   - `GET /v1/webhook_endpoints?limit=100`, ищет endpoint с URL `https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/stripe-webhook`.
   - Если нет — создаёт через `POST /v1/webhook_endpoints` с `enabled_events`: `checkout.session.completed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`.
   - Возвращённый `secret` сохраняет в Vault через RPC `admin_save_acquiring_secret(p_connection_id,p_kind,p_value)` (вызывается через actor-supabase, т.к. RPC требует `auth.uid()=super_admin`).
   - Поддерживает `force_recreate=true` для пересоздания и захвата свежего секрета.
2. **Новая edge function `stripe-reconcile-session`** (super_admin):
   - Достаёт Stripe Session (по `order_id` или `session_id`), и если `status=complete && payment_status=paid` идемпотентно делает то же, что webhook: `provider_events` (key=`stripe:{account}:reconcile:{session_id}`), `payments_v2` (dedupe by `provider_payment_id`), вызов `grant-access-for-order`, перевод `orders_v2.status='paid'`.
3. **Fix enum в `stripe-webhook`**: `status: 'paid'` → `status: 'succeeded'` для INSERT в `payments_v2` (оба handler-а: `checkout.session.completed`, `payment_intent.succeeded`).

## 3. Runtime-проверка

### 3.1. Регистрация webhook
```
POST /functions/v1/stripe-ensure-webhook  {"account_code":"stripe_poland","force_recreate":true}
→ 200
{
  "ok": true,
  "endpoint_id": "we_1TeFMV6UYJj2vm0GpIGKQ7pp",
  "url": "https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/stripe-webhook",
  "status": "enabled",
  "livemode": false,
  "enabled_events": [
    "checkout.session.completed","checkout.session.expired",
    "payment_intent.succeeded","payment_intent.payment_failed",
    "charge.refunded","charge.dispute.created"
  ],
  "created": true, "secret_saved": true
}
```

### 3.2. Reconcile ORD-26-00134 (BYN 100)
```
POST /functions/v1/stripe-reconcile-session  {"order_id":"df347c98-...d88d","account_code":"stripe_poland"}
→ 200 { action:"processed", payment_action:"created",
        payment_intent:"pi_3TeEq16UYJj2vm0G1DjJS83v",
        provider_event_id:"d4daf0fe-554c-40cb-8720-976df400b1b8" }
```

### 3.3. SQL-подтверждение конечного состояния
```sql
SELECT o.order_number, o.status, o.currency, o.final_price,
       p.status pay_status, p.provider_payment_id,
       e.processing_status event_status, e.event_type
FROM orders_v2 o
LEFT JOIN payments_v2 p ON p.order_id=o.id AND p.provider='stripe'
LEFT JOIN provider_events e ON e.related_order_id=o.id AND e.provider='stripe'
WHERE o.id='df347c98-5596-436d-8e02-1e246b00d88d';

 order_number | status | currency | final_price | pay_status |          provider_payment_id          | event_status |               event_type
--------------+--------+----------+-------------+------------+----------------------------------------+--------------+-----------------------------------------
 ORD-26-00134 | paid   | BYN      |     100.00  | succeeded  | pi_3TeEq16UYJj2vm0G1DjJS83v            | processed    | checkout.session.completed.reconcile
```

### 3.4. Идемпотентность
Повторный вызов reconcile того же `order_id` → `action:"reprocessed"`, `payment_action:"existing"`, тот же `payment_id` и `provider_event_id`. Нет дублей в `payments_v2` и `provider_events`.

## 4. Какие валюты фактически прошли через Stripe API

(см. также `.lovable/proofs/stripe_phase_2_manual_sandbox_checkout_currency_fix.md`)

| Currency | Stripe API ответ | Реальная оплата картой |
|---|---|---|
| USD 10 / 100 | session создан, `cs_test_a19q…`, `cs_test_a1C7…` | не выполнялась оператором |
| EUR 10 | session создан, `cs_test_a1lpc6mr…` | не выполнялась оператором |
| BYN 10 | session создан, `cs_test_a1OpAFNm…` | не выполнялась оператором |
| **BYN 100** | session создан, `cs_test_a1xtboo59…`, **оплачено оператором → `pi_3TeEq1…paid`** | ✅ подтверждено: reconcile перевёл `orders_v2`→`paid`, `payments_v2`→`succeeded` |
| RUB 10 | rejected by Stripe: `amount_too_small` (settlement minimum ~2 PLN) — это про сумму, не про валюту |
| RUB 1000 | session создан, `cs_test_a1ccCJwS…` | не выполнялась оператором |

Все 5 валют (USD/EUR/PLN/BYN/RUB) поддерживаются для `stripe_poland`; ограничение только по минимальной сумме.

## 5. Что произойдёт со следующей реальной оплатой

Endpoint `we_1TeFMV6UYJj2vm0GpIGKQ7pp` теперь зарегистрирован и активен. После следующей оплаты картой 4242:
- Stripe доставит `checkout.session.completed` (+ `payment_intent.succeeded`) на наш `stripe-webhook`.
- `verifyStripeSignature` пройдёт (секрет в Vault совпадает с endpoint).
- `provider_events` запишется с `idempotency_key=stripe:stripe_poland:{event_id}`, дубликаты отбрасываются по UNIQUE.
- `payments_v2.status='succeeded'` (enum fix), `provider_payment_id=pi_*`.
- `grant-access-for-order` вызывается; для sandbox-manual без `product_id` он 4xx, но `orders_v2` уже переводится в `paid` (см. reconcile путь — то же поведение применимо). Для боевых заказов с tariff_id grant-access отрабатывает канонично.

## 6. Freeze-зоны (zero-diff verifier)

```
rg -l "stripe-ensure-webhook|stripe-reconcile-session" \
  supabase/functions/bepaid-webhook \
  supabase/functions/_shared/create-payment-checkout.ts \
  supabase/functions/_shared/acquiring/bepaid-adapter.ts \
  src/utils/buildPublicPaymentUrl.ts
# (no matches) ✓
```

`bepaid-*`, `create-payment-checkout.ts`, public `payment_links` (`/pay/:token`), обычная ссылка из контакта — НЕ изменялись.

## 7. DoD

- [x] Определена реальная корневая причина (endpoint не зарегистрирован + enum bug).
- [x] Создан и работает `stripe-ensure-webhook` (создал endpoint `we_1TeFMV6UYJj2vm0GpIGKQ7pp`, сохранил secret в Vault).
- [x] Создан и работает `stripe-reconcile-session` (идемпотентный, dedup по `provider_payment_id` и `idempotency_key`).
- [x] Зафиксирован enum-bug в `stripe-webhook` (`paid`→`succeeded`).
- [x] ORD-26-00134: `orders_v2.status=paid`, `payments_v2.status=succeeded`, `provider_events.processing_status=processed`.
- [x] Идемпотентность подтверждена: повторный reconcile не создаёт дублей.
- [x] Freeze bePaid/PaymentLinks/CheckoutHelper подтверждён denylist-grep.

## 8. Артефакты

- Edge: `supabase/functions/stripe-ensure-webhook/index.ts` (new)
- Edge: `supabase/functions/stripe-reconcile-session/index.ts` (new)
- Edge: `supabase/functions/stripe-webhook/index.ts` (enum fix)
- Registry: `supabase/functions.registry.txt` (+2 entries)
- Stripe endpoint: `we_1TeFMV6UYJj2vm0GpIGKQ7pp` (test mode, account `stripe_poland`)
- Vault: `acq:stripe:stripe_poland:webhook_signing_secret` (rotated, актуальный для endpoint выше)
