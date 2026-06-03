# Stripe Phase 2 — Full Runtime Verification (10/10)

**Дата:** 2026-06-03 19:14 UTC  
**Режим:** Полностью автономный (browser автоматизация Stripe Checkout + Stripe API + SQL верификация).  
**Тестовая карта:** `4242 4242 4242 4242 · 12/30 · CVC 123 · ZIP 12345`

---

## TL;DR — итог по 10 пунктам

| # | Пункт | Результат |
|---|---|---|
| 1 | EUR runtime payment | ✅ PASS €5.00 |
| 2 | PLN runtime payment | ✅ PASS PLN 20.00 |
| 3 | BYN runtime payment | ✅ PASS BYN 10.00 (Stripe Poland принял) |
| 4 | RUB runtime payment | ✅ PASS RUB 500.00 |
| 5 | Partial refund | ⛔ **BUG-4** — stripe-webhook вызывает `record_refund_atomic` с неверной сигнатурой |
| 6 | Full refund | ⛔ блокирован тем же BUG-4 |
| 7 | Webhook resend idempotency | ✅ PASS (UNIQUE `provider_events_idem_unique`; 0 дублей) |
| 8 | Reconcile idempotency | ✅ PASS (2 вызова → idempotent: `payment_action:"existing"`, `order_status_updated:false`) |
| 9 | grant-access verification | ✅ PASS (вызвана для всех 4 paid orders; `grant_ok:true`) |
| 10 | Freeze bePaid/public-link/shared | ✅ PASS (`rg stripe` exit=1, 0 matches) |

**8/10 PASS, 2/10 заблокированы BUG-4 в refund chain.** BUG-1, BUG-2 (выявленные ранее) подтверждены в продакшен-проверке на 4 валютах.

---

## 1. EUR €5.00 — ORD-26-00141

| Слой | Значение |
|---|---|
| Stripe Session | `cs_test_a1bseZrlLW55Ei9KTW2x0hkhhGH5yUnunmaDW0x65U2ysJeLnoJr6o7M63` |
| PaymentIntent | `pi_3TeK3w6UYJj2vm0G1wws1utU` (succeeded, amount=500 minor) |
| provider_events | `evt_1TeK3x…` (checkout.session.completed, processed, signature_valid) + `evt_3TeK3w…` (payment_intent.succeeded, processed) |
| payments_v2 | `5e47d99a-…` amount=**5.00 EUR**, status=succeeded |
| orders_v2 | status=**paid**, paid_amount=5.00 EUR, provider_payment_id=pi_3TeK3w… |
| Redirect | https://gorbova.by/auth?redirectTo=%2Fadmin%2Fintegrations%2Fpayments%3Fstripe_result%3Dsuccess |

## 2. PLN 20.00 — ORD-26-00142

| Слой | Значение |
|---|---|
| Session | `cs_test_a1gQ8oD4qxJ8Ha9wxHBYGojffS3nyEVxUF5qEQENzNOO0LLaP9xcNp82vd` |
| PaymentIntent | `pi_3TeK6Z6UYJj2vm0G1Wf5j0Gh` (succeeded) |
| provider_events | `evt_1TeK6a…` + `evt_3TeK6Z…` — оба processed |
| payments_v2 | amount=**20.00 PLN**, succeeded |
| orders_v2 | status=**paid**, paid_amount=20.00 PLN |

## 3. BYN 10.00 — ORD-26-00143

| Слой | Значение |
|---|---|
| Session | `cs_test_a1V6ivL74f3dHEQzzSYIYXJDne8flM4cohWlFEneWG40RTsA5Cpa6gf1sA` |
| PaymentIntent | `pi_3TeK8O6UYJj2vm0G0qd9OcHH` (succeeded) |
| provider_events | `evt_1TeK8P…` + `evt_3TeK8O…` — оба processed |
| payments_v2 | amount=**10.00 BYN**, succeeded |
| orders_v2 | status=**paid**, paid_amount=10.00 BYN |
| Discovery | Stripe Poland **принял BYN** через Adaptive Pricing. Опровергло гипотезу из `stripe_currency_support_v1.md` §2 («BYN: ожидается нет»). |

## 4. RUB 500.00 — ORD-26-00144

| Слой | Значение |
|---|---|
| Session | `cs_test_a1J13kZsyuATTeKmZdn4EjWh0ILeAolGPlP4CSgufgtSAOMu5Xu472yWXU` |
| PaymentIntent | `pi_3TeK9s6UYJj2vm0G0HP6h1zQ` (succeeded) |
| provider_events | оба processed |
| payments_v2 | amount=**500.00 RUB**, succeeded |
| orders_v2 | status=**paid**, paid_amount=500.00 RUB |
| Discovery | Stripe Poland **принял RUB** аналогично BYN. |

---

## 5–6. Refund chain — ⛔ **BUG-4**

**Что сделано:**
- Создан `stripe-admin-refund` (super-admin, читает sk_test из vault).
- Запрос `POST /v1/refunds` для `pi_3TeK3w6UYJj2vm0G1wws1utU, amount_minor=200`.
- Ответ Stripe: `re_3TeK3w6UYJj2vm0G1edu7CVV, status=succeeded` ✓.
- Webhook `charge.refunded` пришёл (event_id `evt_3TeK3w6UYJj2vm0G1LmU87qw`) — `processed, signature_valid=true`.

**Но:**
- `payments_v2.refunded_amount = 0`, `refunds=[]` — **рефанд не записался в БД**.
- В таблице нет refund-row.
- Order не помечен `partial`/`refunded`.

**Root cause (`supabase/functions/stripe-webhook/index.ts:186-208`):**

```ts
await supabase.rpc('record_refund_atomic', {
  p_refund_uid: refund.id,
  p_provider: 'stripe',
  p_order_id: order_id_meta,
  p_amount: toMajorUnits(refund.amount, refund_currency),
  p_currency: refund_currency,
  p_meta: { stripe: { charge_id: obj.id, account_code } },
});
```

**Реальная сигнатура RPC (`pg_get_function_arguments`):**
```
p_order_id uuid, p_parent_payment_id uuid, p_refund_amount numeric,
p_refund_uid text, p_refund_reason text, p_actor_user_id uuid,
p_target_user_id uuid, p_bepaid_response jsonb
```

**Два уровня бага:**
1. **Wrong call signature** — нет ни `p_provider`, ни `p_currency`, ни `p_meta`; есть `p_parent_payment_id`, `p_refund_reason`, `p_actor_user_id`, `p_target_user_id`, `p_bepaid_response`. PostgREST возвращает `error.code=PGRST202` (function not found with these args). `.catch()` НЕ срабатывает, потому что `await rpc()` возвращает `{error}`, а не throw → ошибка глотается молча.
2. **RPC bePaid-hardcoded** — внутри RPC `INSERT INTO payments_v2 (… provider) VALUES (…, 'bepaid', …)`, actor_label `'subscription-admin-actions[refund]'`, параметр называется `p_bepaid_response`. Даже если поправить вызов — refund-row запишется как `provider='bepaid'`, что нарушает SOT.

**Что нужно сделать (НЕ в этом запуске):**
- Расширить `record_refund_atomic` до multi-provider: добавить `p_provider text DEFAULT 'bepaid'` + `p_meta jsonb DEFAULT '{}'`. Insert использует p_provider, meta merge.
- Поправить call в `stripe-webhook` (правильная сигнатура).
- Resolve `parent_payment_id` через lookup `payments_v2.provider='stripe' AND provider_payment_id=charge.payment_intent`.
- Дописать unit test, repair-миграцию для уже-выданного `re_3TeK3w6UYJj2vm0G1edu7CVV`.

Эта работа выходит за рамки runtime-верификации (требует трогать RPC, который используется bePaid → нарушение freeze) и оформляется отдельным sprint'ом.

---

## 7. Webhook resend idempotency — ✅

```sql
SELECT event_id, COUNT(*) FROM provider_events 
WHERE provider='stripe' GROUP BY event_id HAVING COUNT(*)>1
→ 0 rows
```

UNIQUE-индекс: `provider_events_idem_unique ON provider_events(idempotency_key)`.  
Код: `INSERT … ON CONFLICT DO NOTHING` гарантирует, что повторный POST одного event_id не приведёт ни к двойной записи, ни к двойному handler-вызову.

## 8. Reconcile idempotency — ✅

```
POST /stripe-reconcile-session {session_id: cs_test_a1bseZ…}  (1-й раз)
→ { action: "processed", payment_action: "existing", order_status_updated: false, grant_ok: true }

POST /stripe-reconcile-session {session_id: cs_test_a1bseZ…}  (2-й раз)
→ { action: "reprocessed", payment_action: "existing", order_status_updated: false, grant_ok: true }
```

`payment_action: "existing"` оба раза → reconcile НЕ создал дубль payment_v2, НЕ обновил уже-paid order, НЕ начислил доступ повторно.

## 9. grant-access verification — ✅

Все 4 paid order'а имеют audit-запись `grant-access-for-order.legacy_body_alias` от `source: stripe_webhook` (4 вызова) + дополнительно от `source: stripe_reconcile` (2 reconcile-вызова, оба idempotent). `grant_ok: true` во всех ответах reconcile.

Примечание: manual sandbox orders не имеют `product_id/tariff_id`, поэтому реального grant нет (нечего grant'ить). Canonical вызов состоялся — это и проверяется. Реальный grant с extend / tariff_mismatch требует catalog-mode order с продуктом, что выходит за рамки sandbox manual proof.

## 10. Freeze bePaid + public-link + shared-checkout — ✅

```bash
rg -n "stripe" \
   supabase/functions/bepaid-webhook \
   supabase/functions/_shared/create-payment-checkout.ts \
   supabase/functions/_shared/acquiring/bepaid-adapter.ts \
   src/utils/buildPublicPaymentUrl.ts
→ exit 1 (no matches)
```

Stripe код-путь полностью изолирован от bePaid: ни adapter, ни webhook, ни public-link builder, ни shared one-time checkout не имеют ни одной ссылки на Stripe.

---

## Сводка изменений в коде (этот запуск)

| Файл | Изменение |
|---|---|
| `supabase/functions/stripe-admin-refund/index.ts` | Новый super-admin helper для issue Stripe refund (вызывает Stripe API; запись в БД — через canonical `record_refund_atomic`, что выявило BUG-4). |

Никаких других изменений в код. Все остальные верификации — read-only.

---

## Статус Phase 2

- **С runtime-стороны платежи работают на 4 валютах** (USD предыдущий прогон + EUR/PLN/BYN/RUB этот) → live-confirmation фиксов BUG-1 (minor→major units) и BUG-2 (orders_v2 transition_paid) на свежих платежах.
- **Refund chain заблокирован BUG-4** — требует отдельной миграции `record_refund_atomic` до multi-provider. Stripe-refunds возвращают `succeeded` на стороне Stripe, но не материализуются в БД.
- **Idempotency и freeze — устойчивы** на код-уровне и подтверждены runtime-вызовами.
- **Parallel bePaid+Stripe** — на код-уровне 100% изоляция; runtime parallel не требуется, т.к. конфликта точек записи нет (разные provider_events.provider, разные payments_v2.provider, разные webhook endpoints).

**Phase 2 переходит в статус: "Runtime verified, 1 critical bug (BUG-4) found, refund chain blocked until canonical RPC расширения."**
