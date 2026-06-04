# Stripe Phase 3.1 — Stage 1: Pre-create Writer (PROOF v1)

**Status:** IMPLEMENTATION COMPLETE — awaiting runtime proof tests (G1–G9).
**Scope:** ТОЛЬКО pre-create writer. Webhook lifecycle, grant-access, orders/payments — НЕ затронуты.

---

## 1. Architectural Decision

**Создана НОВАЯ edge function `stripe-create-subscription-checkout`** (вариант A), а не subscription-ветка в существующем `stripe-create-checkout`.

**Обоснование:**
- `stripe-create-checkout` (mode=payment) жёстко требует существующий `orders_v2(provider='stripe', status='pending')` как вход. Stage 1 explicitly запрещает создавать orders/payments — реюз потребовал бы изменить контракт входа существующей функции.
- `stripe-create-checkout` пишет `crm_routing_snapshot`, `pipeline_id`, `pipeline_stage_id`, `meta.stripe.checkout_session_id` в `orders_v2` — это инфраструктура one-time платежа, неприменимая к pre-create писателю подписки (orders ещё не существует).
- Отдельная функция = чистый scope, простая обратимая cleanup-логика, легче audit.
- Параллель с bePaid: там тоже отдельные `bepaid-admin-create-subscription-link` / `bepaid-create-subscription-checkout` vs one-time `create-payment-checkout`.

---

## 2. Files Touched (Stage 1)

| Файл | Action |
|---|---|
| `supabase/functions/stripe-create-subscription-checkout/index.ts` | created (382 LOC) |
| `supabase/config.toml` | + `[functions.stripe-create-subscription-checkout] verify_jwt = true` |

**НЕ затронуто (по STOP-правилам):**
- `supabase/functions/stripe-webhook/index.ts`
- `supabase/functions/grant-access-for-order/index.ts`
- `supabase/functions/_shared/acquiring/stripe-adapter.ts`
- `supabase/functions/_shared/subscription-conflict.ts`
- `supabase/functions/admin-cleanup-stale-pending-subscriptions/index.ts` (расширение фильтра не понадобилось — pre-create уже пишет `provider_subscription_id = 'pending:{sub_v2_id}'`, попадает под существующий `LIKE 'pending:%'`)
- любые `bepaid-*` файлы

---

## 3. Contract

### Input
```ts
{
  user_id: uuid,
  product_id: uuid,
  tariff_id: uuid,
  tariff_offer_id: uuid,
  account_code?: string,         // default: resolveDefaultStripeAccount
  business_stream?: string|null, // override; иначе SOT resolver
  customer_email?: string,
  dry_run?: boolean,
}
```

### Pre-flight guards (в порядке выполнения)
1. `requireSuperAdmin` (verify_jwt=true)
2. body validation — обязательны user_id/product_id/tariff_id/tariff_offer_id
3. `resolveDefaultStripeAccount` + `acct.test_mode === true` (иначе 422 `stripe_account_not_test_mode`)
4. offer lookup + `is_active` + `tariff_id` match + `meta.stripe.price_id` присутствует
5. `resolveBusinessStream` (offer → product → override)
6. **`checkPendingCheckoutConflict`** → 409 `pending_conflict` при живом pending < 24h
7. **`checkSubscriptionConflict`** (active/trial provider-managed) → 409 `duplicate_subscription`
8. **past_due provider-managed guard** (расширение для подписочного Stripe Stage 1) — отдельный запрос: `subscriptions_v2.status='past_due'` + `provider_subscriptions.state IN ('active','past_due')` → 409 `duplicate_past_due_subscription`

### Pre-create writes (атомарно с rollback)
1. `INSERT subscriptions_v2 (status='pending', billing_type='provider_managed', auto_renew=false, meta.stripe={account_code, price_id, product_id, tariff_offer_id}, meta.business_stream, meta.lifecycle.stage='pending_pre_create')`
2. `INSERT provider_subscriptions (provider='stripe', state='pending', provider_subscription_id='pending:{subscription_v2_id}', subscription_v2_id, user_id, currency='BYN', meta.stripe={...})`
3. На FAIL шага 2 — `DELETE` subscriptions_v2 (rollback)

### Stripe API
1. `GET /v1/prices/{price_id}` — drift-check: `active`, `livemode=false`, `recurring` присутствует → 422 `price_drift_detected`
2. `POST /v1/checkout/sessions` с:
   - `mode=subscription`
   - `line_items[0][price]=price_id`, `quantity=1`
   - `client_reference_id=subscription_v2_id`
   - `metadata[*]` и `subscription_data[metadata][*]`: subscription_v2_id, provider_subscription_row_id, tariff_offer_id, product_id, tariff_id, account_code, business_stream, price_id
   - `Idempotency-Key: subv2:{subscription_v2_id}:create`
3. На FAIL — `rollbackPending` (удаляет обе pending-строки + audit `stripe.subscription_checkout.pre_create_rollback`)

### Post-create
- `UPDATE subscriptions_v2.meta.stripe.checkout_session_id`
- `UPDATE provider_subscriptions.meta.stripe.checkout_session_id`
- `INSERT audit_logs ('stripe.subscription_checkout.pre_create')`

### Response
```ts
{
  ok: true,
  mode: 'execute',
  subscription_v2_id,
  provider_subscription_row_id,
  checkout_session: { id, url, status, livemode, expires_at }
}
```

---

## 4. Cleanup Compatibility

`admin-cleanup-stale-pending-subscriptions` уже фильтрует:
```sql
provider='stripe' AND state='pending'
AND provider_subscription_id LIKE 'pending:%'
```
Pre-create писатель пишет `provider_subscription_id='pending:{sub_v2_id}'` → строки попадут в cleanup без модификаций функции.

В `subscriptions_v2.meta.lifecycle.stage='pending_pre_create'` маркер для диагностики; cleanup-функция переведёт `status='pending' → 'expired'` после 24h без изменений.

---

## 5. STOP-rules check

| STOP | Проверено |
|---|---|
| Stage 1 не меняет webhook | ✅ stripe-webhook не открывался для edit |
| Stage 1 не меняет grant-access-for-order | ✅ не импортируется |
| Stage 1 не создаёт orders/payments/entitlements | ✅ нет INSERT в orders_v2/payments_v2/entitlements/access_grant_ledger |
| Stage 1 не вызывает grant-access | ✅ нет fetch/invoke |
| Stage 1 не трогает bePaid | ✅ нет import bepaid-* |

---

## 6. Test Plan (G1–G9) — TODO runtime proof

| ID | Сценарий | Ожидание |
|---|---|---|
| G1 | dry_run валидного входа | 200 ok, plan preview, без INSERT |
| G2 | execute валидного входа | 200 ok, subscription_v2_id + cs_test_* URL, 2 pending row |
| G3 | повторный вызов того же user+product+tariff < 24h | 409 `pending_conflict` |
| G4 | вход с уже-active provider-managed подпиской | 409 `duplicate_subscription` |
| G5 | вход с past_due + provider state=active | 409 `duplicate_past_due_subscription` |
| G6 | invalid price_id в meta (drift) | 422 `price_drift_detected`, rollback, 0 pending rows |
| G7 | Stripe API 4xx (corrupt secret) | 502 `checkout_session_create_failed`, rollback |
| G8 | После execute: 0 orders_v2 / 0 payments_v2 / 0 entitlements | проверка SQL count |
| G9 | bePaid non-regression: 24h diff `provider='bepaid'` = 0 | SQL count |

Runtime proof выполнится отдельным вызовом (browser automation + DB asserts). После PASS → Stage 2 (webhook lifecycle).

---

## 7. Definition of Done Stage 1

- [x] Edge function создана и зарегистрирована в config.toml (verify_jwt=true)
- [x] checkPendingCheckoutConflict + checkSubscriptionConflict + past_due guard вызываются ДО Stripe API
- [x] pre-create subscriptions_v2 + provider_subscriptions с правильной meta
- [x] Stripe Checkout `mode=subscription` + полный metadata bag
- [x] Rollback pending rows при Stripe API fail
- [x] Cleanup-функция видит pending rows (через существующий фильтр)
- [x] НЕ затронуты: webhook, grant-access, orders/payments, bePaid
- [ ] Runtime proof G1–G9 = PASS (Stage 1.5)
- [ ] Memory обновлена после runtime proof
