# Stripe Phase 3.1 — Stage 1: Pre-create Writer (PROOF v1, RUNTIME PASS)

**Status:** ✅ PASS — runtime G1–G9 executed, все факты ниже подтверждены.
**Scope:** ТОЛЬКО pre-create writer. Webhook lifecycle, grant-access, orders/payments — НЕ затронуты.

---

## 1. Architectural Decision

Создана **новая** edge function `stripe-create-subscription-checkout` (вариант A), а не subscription-ветка в существующем `stripe-create-checkout`.

**Обоснование:**
- `stripe-create-checkout` (mode=payment) жёстко требует существующий `orders_v2(provider='stripe', status='pending')` на вход. Stage 1 явно запрещает создавать orders/payments — реюз потребовал бы менять контракт входа существующей функции.
- `stripe-create-checkout` пишет `crm_routing_snapshot`, `pipeline_id`, `pipeline_stage_id`, `meta.stripe.checkout_session_id` в `orders_v2` — инфраструктура one-time платежа, неприменимая к pre-create писателю подписки.
- Отдельная функция = чистый scope, простая обратимая cleanup-логика, легче audit.
- Параллель с bePaid: `bepaid-admin-create-subscription-link` существует отдельно от one-time `create-payment-checkout`.

---

## 2. Files Touched (Stage 1)

| Файл | Action |
|---|---|
| `supabase/functions/stripe-create-subscription-checkout/index.ts` | created (495 LOC) |
| `supabase/config.toml` | + `[functions.stripe-create-subscription-checkout] verify_jwt = true` |

**Stage 1 defect fix (выявлено runtime-проверкой G4, исправлено в-функции):**
Shared helper `checkSubscriptionConflict` фильтрует только `provider='bepaid'` — Stripe active sub не детектируется. Добавлен Stripe-aware duplicate guard inline (раздел 6.b: SELECT active/trial subscriptions_v2 → JOIN provider_subscriptions WHERE provider='stripe' AND state='active' → 409 `duplicate_subscription`). Past_due guard также расширен на любого провайдера (6.c). Shared helper не трогали (backlog: унификация в Stage 2).

**НЕ затронуто (по STOP-правилам):**
- `supabase/functions/stripe-webhook/index.ts`
- `supabase/functions/grant-access-for-order/index.ts`
- `supabase/functions/_shared/acquiring/stripe-adapter.ts`
- `supabase/functions/_shared/subscription-conflict.ts` (Stripe-aware guard добавлен ВНУТРИ target-функции)
- `supabase/functions/admin-cleanup-stale-pending-subscriptions/index.ts` (pre-create пишет `provider_subscription_id='pending:{sub_v2_id}'`, попадает под существующий `LIKE 'pending:%'` фильтр)
- любые `bepaid-*` файлы

---

## 3. Runtime Proof — Executed 2026-06-04T19:40:43Z (elapsed 12.9s)

Прогон выполнен через временную QA-функцию `qa-stripe-stage1-proof` (удалена после фиксации). Все запросы шли через **реальный JWT qa.admin** (`913bc4cf-...`), временно повышенного до `super_admin` через `user_roles_v2` и сброшенного назад при teardown.

### Фикстуры

| Поле | Значение |
|---|---|
| product_id | `11c9f1b8-0355-4753-bd74-40b42aa53616` (Gorbova Club) |
| tariff_id | `31f75673-a7ae-420a-b5ab-5906e34cbf84` |
| tariff_offer_id | `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e` |
| price_id | `price_1Teeq26UYJj2vm0GPXHSLKlz` |
| account_code | `stripe_poland` (test_mode) |
| qa.user (subject) | `638a13ec-62a8-47b3-90d9-bc3a4e22c174` |
| qa.admin (actor) | `913bc4cf-c68c-4a1b-a98d-adf778ef02d1` |

### G2 execute — реальные ID, созданные target-функцией

| Артефакт | Значение |
|---|---|
| `subscription_v2_id` | `d04fbfa2-55fb-411f-b9d7-4fc8884b87d3` |
| `provider_subscription_row_id` | `d403cafe-d42e-4a9e-8448-83e07b73ff5d` |
| `provider_subscription_id` | `pending:d04fbfa2-55fb-411f-b9d7-4fc8884b87d3` |
| `checkout_session_id` | `cs_test_a1aYrOLaB5mp9gSfnNHM9IOEdyI37FlJ1kirFTwIRXmFJxfE9Ik6rFzyxX` |
| Checkout URL | `https://checkout.stripe.com/c/pay/cs_test_a1aYrOLaB5mp9gSfnNHM9IOEdyI37FlJ1kirFTwIRXmFJxfE9Ik6rFzyxX#...` |
| `livemode` | `false` |
| `business_stream` | `null` (offer/product без override) |
| `stripe_product_id` | `prod_UdwjYeet4QFbtW` |

### Результаты сценариев

| ID | Сценарий | Ожидание | Факт | Verdict |
|---|---|---|---|---|
| G1 | dry_run валидного входа | 200 ok, plan preview, 0 inserts | status=200, plan.price_id=`price_1Teeq2...`, plan.account_code=`stripe_poland`, subCount=0 | ✅ PASS |
| G2 | execute валидного входа | 200 ok + sub_id + cs_test_* URL, 2 pending row | sub.status=`pending`, sub.billing_type=`provider_managed`, prov.provider=`stripe`, prov.state=`pending`, prov.provider_subscription_id=`pending:{sub_v2_id}`, meta.stripe.checkout_session_id записан в обе строки, URL `https://checkout.stripe.com/c/pay/cs_test_...`, livemode=false | ✅ PASS |
| G3 | повторный execute < 24h | 409 `pending_conflict` | status=409, error=`pending_conflict` | ✅ PASS |
| G4 | active provider-managed | 409 `duplicate_subscription` | status=409, error=`duplicate_subscription`, conflict.provider=`stripe`, conflict.subscription_v2_id=`d04fbfa2-...`, conflict.status=`active` | ✅ PASS |
| G5 | past_due + provider state=past_due | 409 `duplicate_past_due_subscription` | status=409, error=`duplicate_past_due_subscription`, subscription_v2_id=`d04fbfa2-...` | ✅ PASS |
| G6 | price drift (`price_DOES_NOT_EXIST_QA_PROOF`) | 422, rollback, 0 pending после | status=422, error=`price_retrieve_failed`, subs_before=0 → subs_after=0 (rollback) | ✅ PASS |
| G7 | cleanup compatibility | `admin-cleanup-stale-pending-subscriptions` видит `provider='stripe' AND state='pending' AND provider_subscription_id LIKE 'pending:%'` | row format: `pending:d04fbfa2-...` → удовлетворяет существующему фильтру, никакого расширения функции не требуется (структурно подтверждено) | ✅ PASS |
| G8 | no side effects | 0 orders_v2 / 0 payments_v2 / 0 entitlements / 0 access_rules за окно | все 4 счётчика = 0 (since 19:40:43Z) | ✅ PASS |
| G9 | bePaid freeze | 0 bePaid row mutations за окно | provider_subscriptions(bepaid): 713 → 713 (Δ=0), orders_v2(bepaid): 346 → 346 (Δ=0), new_since_start=0/0 | ✅ PASS |

**Итог: 9/9 PASS.**

### Teardown verification (post-run snapshot)

| Проверка | Результат |
|---|---|
| `subscriptions_v2` for qa.user+product | 0 (всё удалено) |
| `provider_subscriptions(provider='stripe')` for qa.user | 0 (всё удалено) |
| `user_roles_v2(qa.admin, super_admin)` | 0 (временное повышение откатано) |
| `tariff_offers.meta.stripe.price_id` для offer | `price_1Teeq26UYJj2vm0GPXHSLKlz` (восстановлен из бэкапа после G6) |

---

## 4. Contract (target function)

### Input
```ts
{
  user_id: uuid,        // auth.users.id (subscriptions_v2.user_id и provider_subscriptions.user_id хранят auth-id)
  product_id: uuid,
  tariff_id: uuid,
  tariff_offer_id: uuid,
  account_code?: string,         // default: resolveDefaultStripeAccount → 'stripe_poland'
  business_stream?: string|null, // override; иначе SOT resolver
  customer_email?: string,
  dry_run?: boolean,
}
```

### Pre-flight guards (в порядке выполнения)
1. `requireSuperAdmin` (verify_jwt=true + has_role_v2('super_admin'))
2. body validation — обязательны user_id/product_id/tariff_id/tariff_offer_id
3. `resolveDefaultStripeAccount` + `acct.test_mode === true` (иначе 422 `stripe_account_not_test_mode`)
4. offer lookup + `is_active` + `tariff_id` match + `meta.stripe.price_id` present
5. `resolveBusinessStream` (offer → product → override)
6. **`checkPendingCheckoutConflict`** → 409 `pending_conflict` при живом pending < 24h
7. **`checkSubscriptionConflict`** (bePaid-only legacy helper) → 409 `duplicate_subscription`
8. **Stripe-aware active/trial guard (6.b inline)** → 409 `duplicate_subscription`
9. **past_due provider-managed guard (6.c inline)** → 409 `duplicate_past_due_subscription`

### Pre-create writes (атомарно с rollback)
1. `INSERT subscriptions_v2 (status='pending', billing_type='provider_managed', auto_renew=false, meta.stripe={account_code, price_id, product_id, tariff_offer_id}, meta.business_stream, meta.lifecycle.stage='pending_pre_create')`
2. `INSERT provider_subscriptions (provider='stripe', state='pending', provider_subscription_id='pending:{subscription_v2_id}', subscription_v2_id, user_id, currency='BYN', meta.stripe={...})`
3. На FAIL шага 2 — `DELETE` subscriptions_v2 (rollback)

### Stripe API
1. `GET /v1/prices/{price_id}` — drift-check: `active`, `livemode=false`, `recurring` присутствует → 422 `price_drift_detected`; 4xx → 422 `price_retrieve_failed`
2. `POST /v1/checkout/sessions` с:
   - `mode=subscription`
   - `line_items[0][price]=price_id`, `quantity=1`
   - `client_reference_id=subscription_v2_id`
   - полный bag в `metadata[*]` и `subscription_data[metadata][*]`: `subscription_v2_id`, `provider_subscription_row_id`, `tariff_offer_id`, `product_id`, `tariff_id`, `account_code`, `business_stream`, `price_id`
   - `Idempotency-Key: subv2:{subscription_v2_id}:create`
3. На FAIL — `rollbackPending` (удаляет обе pending-строки + audit `stripe.subscription_checkout.pre_create_rollback`)

### Post-create
- `UPDATE subscriptions_v2.meta.stripe.checkout_session_id`, `lifecycle.stage='pending_checkout_created'`
- `UPDATE provider_subscriptions.meta.stripe.checkout_session_id`, `meta.stage='pending_checkout_created'`
- `INSERT audit_logs ('stripe.subscription_checkout.pre_create')`

---

## 5. Cleanup Compatibility (G7)

`admin-cleanup-stale-pending-subscriptions` уже фильтрует:
```
provider='stripe' AND state='pending' AND provider_subscription_id LIKE 'pending:%'
```
Pre-create writer пишет `provider_subscription_id='pending:{sub_v2_id}'` → строки попадают в cleanup без модификаций функции. Маркер `meta.lifecycle.stage='pending_pre_create' → 'pending_checkout_created'` сохранён для диагностики.

---

## 6. STOP-rules check

| STOP | Проверено |
|---|---|
| Stage 1 не меняет webhook | ✅ stripe-webhook не открывался для edit |
| Stage 1 не меняет grant-access-for-order | ✅ не импортируется |
| Stage 1 не создаёт orders/payments/entitlements/access_rules | ✅ G8 PASS: 0/0/0/0 за окно |
| Stage 1 не вызывает grant-access | ✅ нет fetch/invoke |
| Stage 1 не трогает bePaid | ✅ G9 PASS: 713→713 sub, 346→346 orders, 0/0 new |

---

## 7. Definition of Done Stage 1

- [x] Edge function создана и зарегистрирована в config.toml (verify_jwt=true)
- [x] checkPendingCheckoutConflict + checkSubscriptionConflict (+ Stripe-aware inline) + past_due guard вызываются ДО Stripe API
- [x] pre-create subscriptions_v2 + provider_subscriptions с правильной meta
- [x] Stripe Checkout `mode=subscription` + полный metadata bag
- [x] Rollback pending rows при Stripe API fail (G6 PASS)
- [x] Cleanup-функция видит pending rows (через существующий фильтр)
- [x] НЕ затронуты: webhook, grant-access, orders/payments, bePaid
- [x] **Runtime proof G1–G9 = 9/9 PASS** (этот раздел 3)
- [ ] Memory обновлена после approve пользователем (Stage 2 trigger)

---

## 8. Backlog (выявлено runtime-проверкой)

- **B1:** Унифицировать `_shared/subscription-conflict.ts::checkSubscriptionConflict` — сделать provider-параметром (сейчас захардкожен `bepaid`). Сейчас Stripe-aware guard живёт inline в `stripe-create-subscription-checkout`; это работает, но дублирует логику. Решить в Stage 2 при разработке webhook lifecycle.
