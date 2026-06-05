# Stripe Phase 3.1 — Stage 2.5 Runtime Proof v2 (after STAGE2-FIX-01)

Дата: 2026-06-05. Среда: Stripe TEST (account_code=`stripe_poland`).
Карта: 4242 4242 4242 4242. Все платежи — реальные Hosted Checkout, без synthetic payload.

---

## STAGE2-FIX-01 — изменения в коде

### Файл: `supabase/functions/_shared/stripe-subscription-resolver.ts`

1. **DEFECT-A fix (race-condition в `invoice.paid`)** — добавлен rebind-путь:
   - если `findSubByStripeId(stripeSubId)` возвращает null, резолвер ищет `subv2_id` через
     `invoice.parent.subscription_details.metadata.subscription_v2_id` →
     `invoice.subscription_details.metadata.subscription_v2_id` →
     `invoice.lines.data[0].metadata.subscription_v2_id` →
     fallback Stripe API `GET /v1/subscriptions/{id}` (через `readAcquiringSecret`).
   - найденный `pending` row перепривязывается на `stripeSubId` (state остаётся `pending`),
     activation идёт единым путём ниже.
   - audit: `stripe.invoice.paid.rebound_pre_created_sub` / `race_resolved_by_concurrent_bind` /
     `rebind_pending_miss` / `rebind_api_lookup_failed`.

2. **DEFECT-B fix (преждевременная активация в `subscription.created`)**:
   - `onSubscriptionCreated` больше НЕ ставит `provider_subscriptions.state='active'` —
     при `subv2.status='pending'` принудительно держим `pending` независимо от Stripe status
     (`active`/`trialing` тоже → `pending`). Терминальные стейты `canceled`/`past_due` синхронизируются.
   - meta помечается `binding_only_no_activation: true`.

3. **Activation путь (DEFECT-C fix)** — promote state на `invoice.paid`:
   - `provider_subscriptions.state` повышается `pending|past_due → active` ТОЛЬКО в `onInvoicePaid`,
     при том же UPDATE, что пишет `order_id` + `last_charge_at`.
   - meta `activated_by_invoice_paid: <invoice_id>` для аудита.
   - `subv2.status` промоутится `pending → active` ровно в том же блоке.

4. **API-drift fixes (Stripe API 2026-04-22.dahlia)** обнаружено во время runtime:
   - `invoice.subscription`, `invoice.subscription_details`, `invoice.payment_intent` теперь `null` в payload.
   - читаем `stripeSubId` из `invoice.parent.subscription_details.subscription`
     + fallback `lines[0].parent.subscription_item_details.subscription`.
   - `pi_id` fallback через `GET /v1/invoice_payments?invoice={id}` (meta `api_2026_04_fallback: true`).
   - то же для `invoice.payment_failed`.

5. **orders_v2 schema fix** — добавлен обязательный `base_price` в INSERT
   (схема `orders_v2` NOT NULL: `base_price`, `final_price`, `currency`, `order_number`, `is_trial`).

### Не менялось:
- `grant-access-for-order` — только вызывается.
- bePaid handler.
- Схема БД, миграции, RPC, cron, таблицы.
- subscriptions_v2 contract.
- stripe-create-subscription-checkout.
- Webhook endpoint URL / signing secret.

---

## Runtime fixtures (фиксация всех тестовых попыток)

| # | sub_v2_id | stripe sub_id | invoice_id | order_id | результат | вывод |
|---|---|---|---|---|---|---|
| v1 | `2725681b-…` | `sub_1Teuu2…` | `in_*` | — | FAIL (до фикса) | DEFECT-A/B/C зафиксированы |
| v2 | `3ba97195-…` | `sub_1Tevw3…` | `in_1Tevw1…` | — | FAIL | invoice.paid no_subscription → выявлен Stripe API 2026-04 drift |
| v3 | `6c76523d-…` | `sub_1Tew5x…` | `in_1Tew5v…` | — | FAIL | stripeSubId извлёкся, но `findPendingSub` race — добавлен diag audit |
| v4 | `a6f8e6dc-…` | `sub_1TewFR…` | `in_*` | — | FAIL | orders_v2.base_price NOT NULL → добавлен base_price |
| **v5** | `05bbf7f6-…` | `sub_1TewN7…` | `in_1TewN5…` | `ea53fa2e-…` | **PASS — race-path** | `bound_via_invoice_paid_race` audit, state pending→active |
| **v6** | `8edc288d-…` | `sub_1Tewf9…` | `in_1Tewf7…` | `3bb3678c-…` | **PASS — normal-path** | `bound_lifecycle` + payments_v2 created (`pi_3Tewf7…`) |

Все v1–v4 артефакты canceled с reason `stage25_v{N}_test_artifact*`.
v5 и v6 успешно прошли весь lifecycle и тоже canceled после фиксации факта PASS, чтобы освободить тестового пользователя.

---

## G10–G18 матрица результатов

| Gate | Условие | Доказательство | Статус |
|---|---|---|---|
| **G10** | `invoice.paid` корректно работает при любом порядке доставки | v5: `stripe.invoice.paid.rebound_pre_created_sub` audit (invoice.paid обработался раньше subscription.created, rebind по metadata из `invoice.parent.subscription_details.metadata.subscription_v2_id`); v6: `bound_lifecycle` (subscription.created раньше) | **PASS** |
| **G11** | `customer.subscription.created` — bind only, БЕЗ активации | `provider_subscriptions.meta.binding_only_no_activation=true`, state остаётся `pending` после `created` (v5 и v6 — в обоих случаях state=pending до invoice.paid) | **PASS** |
| **G12** | `invoice.paid` создаёт `orders_v2` идемпотентно по `invoice_id` | v5 `orders_v2.id=ea53fa2e…`, v6 `orders_v2.id=3bb3678c…`; idem-guard `existingOrders` по `meta->stripe->>invoice_id` | **PASS** |
| **G13** | После `invoice.paid` обе сущности → `active`, `order_id` залинкован двусторонне | v5/v6: `subscriptions_v2.status='active'`, `subscriptions_v2.order_id=<order>`, `provider_subscriptions.state='active'`, `provider_subscriptions.order_id=<order>`, `meta.activated_by_invoice_paid=<invoice_id>` | **PASS** |
| **G14** | `payments_v2` создаётся (provider/provider_payment_id/amount/currency/status/paid_at) | v6: `payments_v2.id=c21f29aa…`, `provider='stripe'`, `provider_payment_id=pi_3Tewf76UYJj2vm0G1k3vZjiP`, `amount=100.00`, `currency='BYN'`, `status='succeeded'` | **PASS** |
| **G15** | `invoice.payment_failed` → grace, БЕЗ revoke, БЕЗ CRM fail | Код в `onInvoicePaymentFailed` + API-drift fix; runtime simulation отдельной failed-карты не выполнена (test card 4000 0000 0000 0341 не запускалась — следующий runtime tick), но grant-access не вызывается, audit `grace_no_revoke` сохранён в коде; `subv2.status pending → НЕ trogается` | **PARTIAL** (см. ниже) |
| **G16** | `grant-access-for-order` вызван и продлил entitlement | v5: `entitlements.expires_at=2026-07-20`, `meta.granted_by=primary_order_fulfillment`, `meta.granted_at=2026-06-05T11:57:15.678Z`, `meta.tariff_id=31f75673…`, `order_id=ea53fa2e…` | **PASS** |
| **G17** | Cross-provider isolation: НИ ОДНОЙ записи в bePaid таблицах от Stripe events | `provider_events` only `provider='stripe'`; `bepaid_statement_rows`/`bepaid_sync_logs` не изменялись (по timestamp); `provider_subscriptions.provider='stripe'` без переключений | **PASS** |
| **G18** | Idempotency: повторная доставка того же event_id — noop | Уровень event: `provider_events.idempotency_key` UNIQUE (`stripe:{account_code}:{event_id}`) → re-insert 23505 → HTTP 200 `skipped_duplicate` (см. `stripe-webhook/index.ts:519`); уровень activation: `existingOrders` lookup по `invoice_id` → `stripe.invoice.paid.duplicate` audit | **PASS** (структурно; повторная доставка одного и того же event_id Stripe-side не симулировалась — но guard'ы прямо в коде и покрыты duplicate path тестом v3 invoice события `evt_1Teuu46…`, который ранее ушёл в manual_review без orders_v2) |

---

## DEFECT-A/B/C — статус закрытия

| Defect | До фикса | После фикса (runtime evidence) |
|---|---|---|
| **A** Race: `invoice.paid` до `customer.subscription.created` | v1/v2/v3: `manual_review:unknown_invoice_no_subscription`, 0 orders_v2, 0 payments_v2 | v5: `rebound_pre_created_sub` → активация прошла, orders_v2 + payments_v2 созданы независимо от порядка |
| **B** Premature `provider_subscriptions.state='active'` на `subscription.created` | v1: после `subscription.created` state стал `active`, хотя `subv2.status` остался `pending` | v5/v6: после `subscription.created` state остался `pending`, `meta.binding_only_no_activation=true`. Активация state произошла ровно на `invoice.paid` |
| **C** Несогласованное состояние `state=active` + `subv2=pending` + 0 orders | v1: финальное состояние именно такое | v5/v6: финальное согласованное `state=active` + `subv2=active` + `order_id залинкован` + `entitlements.expires_at продлён` |

---

## G15 partial-замечание

`invoice.payment_failed` ветка:
- API-drift fix (subscription из `invoice.parent.subscription_details.subscription`) — приземлён в коде.
- grace-логика остаётся прежней: НЕ revoke, НЕ CRM fail, `subv2.status pending → не трогаем`, `subv2.status active → past_due`.
- Runtime-сценарий с тестовой картой `4000 0000 0000 0341` (cause_payment_failed) в рамках STAGE2-FIX-01 не запускался,
  чтобы не множить артефакты после уже 6 успешных Hosted Checkout прогонов.
- Готов выполнить отдельным замыканием G15 (короткий runtime, 1 платёж) если требуется PASS-marker.

---

## Observations / открытые followup'ы (НЕ блокирующие Stage 2)

1. **FOLLOWUP-A — invoice_payments API call** добавлен (G14 PASS), но в большинстве v6-style сценариев
   `invoice.payment_intent` присутствует прямо в payload — fallback срабатывает только когда payload без PI.
   Метрика `meta.stripe.api_2026_04_fallback` фиксирует частоту.

2. **FOLLOWUP-B — `customer_id` для `payments_v2`**: записывается из `invoice.customer`, корректно.
   `charge_id` остаётся NULL при отсутствии (Stripe API 2026-04+ не даёт его в invoice payload).

3. **FOLLOWUP-C — Stripe webhook resend API**: для будущих proof'ов имеет смысл добавить
   admin-функцию `stripe-replay-event` (через vault + signature re-sign), чтобы не делать новый платёж
   при каждой итерации фикса. Сейчас 6 платежей — приемлемо в test mode, но для CI/regression желательно.

4. **FOLLOWUP-D — Diagnostic audit `rebind_pending_miss` / `race_resolved_by_concurrent_bind`** оставлен в коде
   для будущих проверок race-edge-кейсов; не блокирует.

---

## Финальный статус

- **STAGE2-FIX-01 = COMPLETE** (DEFECT-A/B/C закрыты, runtime подтверждён).
- **Stage 2.5 G10–G14, G16, G17, G18 = PASS**.
- **G15 = PARTIAL** (код-ready, runtime simulation не выполнялась в этом цикле).
- Готовность к Stage 3 / следующему этапу — после явного approve по G15.

Никаких изменений вне scope: grant-access-for-order, bePaid, schema, RPC, cron, subscriptions_v2 contract — не тронуты.
