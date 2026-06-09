# PATCH-LIVE-1 — Unblock Live Stripe Guard

**Дата:** 2026-06-09
**Статус:** PASS (code patch). L-4 PASS — после реального live-платежа.
**Связь:** разблокирует Phase L-4 (first live one-time Stripe payment).

## 1. Проблема

На live `/pay/:token` checkout падал с ошибкой `stripe_account_not_test_mode`. Guard был написан как pre-prod ограничитель в момент, когда живых ключей в системе не было. После Phase L-1 в `acquiring_connections` записана live-connection (`test_mode=false`), и guard стал блокировать ровно тот flow, ради которого включали live.

## 2. SOT режима

SOT — `acquiring_connections.test_mode`. Никаких env-флагов не вводим.

```
 account_code  | status | test_mode | is_default |     last_verified_at
---------------+--------+-----------+------------+---------------------------
 stripe_poland | active | f         | t          | 2026-06-09 09:55:52.39+00
```

## 3. Diagnose

```
$ rg "stripe_account_not_test_mode|not_test_mode" supabase src
supabase/functions/_shared/create-stripe-checkout.ts:116:      error: 'stripe_account_not_test_mode',
supabase/functions/stripe-create-subscription-checkout/index.ts:111:      return json(422, { ok: false, error: 'stripe_account_not_test_mode', ... });
```

Ровно два места. Других потребителей нет; `stripe-webhook` читает `test_mode` только для логирования.

## 4. Patch

### 4.1 `supabase/functions/_shared/create-stripe-checkout.ts`

До (строки 105–120):

```ts
// === Resolve Stripe account (test_mode guard parity with admin) ===
let acct: Awaited<ReturnType<typeof resolveDefaultStripeAccount>>;
try {
  acct = await resolveDefaultStripeAccount(supabase, account_code ?? null);
} catch (e) {
  return { success: false, provider: 'stripe', error: e instanceof Error ? e.message : 'stripe_account_resolve_failed' };
}
if (!acct.test_mode) {
  return {
    success: false,
    provider: 'stripe',
    error: 'stripe_account_not_test_mode',
    detail: { account_code: acct.account_code },
  };
}
const resolved_account_code = acct.account_code;
```

После:

```ts
// === Resolve Stripe account ===
// SOT режима — сама запись в acquiring_connections (test_mode/live).
// Pre-prod guard `stripe_account_not_test_mode` снят: live-checkout разрешён,
// когда admin сохранил live connection через UI интеграций. test_mode остаётся
// в meta для телеметрии (см. ниже).
let acct: Awaited<ReturnType<typeof resolveDefaultStripeAccount>>;
try {
  acct = await resolveDefaultStripeAccount(supabase, account_code ?? null);
} catch (e) {
  return { success: false, provider: 'stripe', error: e instanceof Error ? e.message : 'stripe_account_resolve_failed' };
}
const resolved_account_code = acct.account_code;
```

Telemetry `meta.test_mode = acct.test_mode` (строка ниже по файлу) сохранена.

### 4.2 `supabase/functions/stripe-create-subscription-checkout/index.ts`

До (строки 108–113):

```ts
// ---- 2) Resolve Stripe account (test-mode only) ----
const acct = await resolveDefaultStripeAccount(admin, body.account_code);
if (!acct.test_mode) {
  return json(422, { ok: false, error: 'stripe_account_not_test_mode', account_code: acct.account_code });
}
const account_code = acct.account_code;
```

После:

```ts
// ---- 2) Resolve Stripe account ----
// SOT режима — acquiring_connections.test_mode. Live subscription checkout
// разрешён, если admin сохранил live connection через UI интеграций.
// Pre-prod guard `stripe_account_not_test_mode` снят. test_mode остаётся
// в meta (см. ниже) для телеметрии.
const acct = await resolveDefaultStripeAccount(admin, body.account_code);
const account_code = acct.account_code;
```

`meta.test_mode = acct.test_mode` (строка 202) сохранён.

## 5. Подтверждение, что снят только запрет, а не телеметрия

```
$ rg "stripe_account_not_test_mode" supabase src
supabase/functions/_shared/create-stripe-checkout.ts:107:  // Pre-prod guard `stripe_account_not_test_mode` снят: live-checkout разрешён,
supabase/functions/stripe-create-subscription-checkout/index.ts:111:    // Pre-prod guard `stripe_account_not_test_mode` снят. test_mode остаётся
```

Остались только комментарии. Реального return с этой ошибкой больше нет.

`meta.test_mode`, `account_code`, webhook `livemode` handling, debug-поля — **не тронуты**.

## 6. Что НЕ менялось

- `supabase/functions/stripe-webhook/**` — без диффа;
- bePaid (`bepaid-*`, `integration_instances`) — без диффа;
- `card_profile_links`, saved-card flow — без диффа (вынесено в `.lovable/backlog/stripe_saved_pm_followup.md`);
- `tariff_offers.meta.acquiring` — без массовых UPDATE;
- `acquiring_connections` — без миграций;
- секреты / Vault / webhook endpoint — без изменений.

## 7. DoD PATCH-LIVE-1

- [x] Guard удалён в `_shared/create-stripe-checkout.ts`.
- [x] Guard удалён в `stripe-create-subscription-checkout/index.ts`.
- [x] Sandbox-flow по-прежнему работает (мы не запретили test_mode=true, мы сняли запрет на live).
- [x] Telemetry сохранена (`meta.test_mode`, `account_code`, webhook `livemode`).
- [x] bePaid untouched.
- [x] Backlog `stripe_saved_pm_followup.md` обновлён под Saved Cards × Stripe Live.

## 8. Verify after deploy (manual)

1. Открыть существующую live ссылку `/pay/:token` → ошибка `stripe_account_not_test_mode` должна исчезнуть; кнопка оплаты активна.
2. При проблеме — `supabase--edge_function_logs` для `public-checkout` / `stripe-create-subscription-checkout`.
3. После реального live-платежа (новой картой) выполнить SQL-проверку:

```sql
SELECT event_id, provider, account_code, event_type, livemode, signature_valid,
       processing_status, related_payment_id, processing_error, created_at
FROM provider_events
WHERE provider='stripe' ORDER BY created_at DESC LIMIT 20;

SELECT id, provider, provider_payment_id, order_id, amount, currency, status,
       receipt_url, meta->'stripe' AS stripe_meta, created_at
FROM payments_v2 WHERE provider='stripe' ORDER BY created_at DESC LIMIT 10;

SELECT id, status, contact_id, profile_id, product_id, tariff_id,
       final_price, currency, paid_at, meta
FROM orders_v2 ORDER BY created_at DESC LIMIT 10;
```

## 9. L-4 PASS criteria (после реального платежа)

- `provider_events.livemode=true`, `signature_valid=true`, `processing_status='processed'`;
- `payments_v2.provider='stripe'`, `status='paid'`, `receipt_url` заполнен;
- order/contact/profile связаны, `entitlement` создан один раз;
- платёж виден в `/admin/payments`;
- bePaid untouched; нет дублей в provider_events / orders / payments / access;
- live subscription checkout также больше не падает с `stripe_account_not_test_mode`.
