# MP-A2-1 — Account / Business Stream Defaults Cleanup (v1)

Дата: 2026-06-03. Режим: execute approved (plan v2 с 5 правками).
Связанные файлы: `mp_a2_1_extended_audit.md` (классификация хардкодов).

## 1. Цель и Scope

Убрать хардкоды из Stripe payment-context:
- `account_code = 'stripe_poland'` — заменено на SOT-резолвер `resolveDefaultStripeAccount()`.
- `business_stream = 'default'` — заменено на резолв через `resolveBusinessStream()` (offer→product→override), fallback `'unspecified'` + audit.
- `https://example.com/success|cancel` — удалено, новый порядок: connection → server-side PUBLIC_APP_HOST → sandbox-fallback (только для admin sandbox).

bePaid, RLS, schema, `record_refund_atomic_multi` — НЕ затронуты.

## 2. Изменённые файлы

### Новые (add-only)
1. `supabase/functions/_shared/acquiring/default-account.ts` — `resolveDefaultStripeAccount(supabase, override?)` SOT-резолвер. SELECT по `(provider='stripe', is_default=true, status='active')` либо по override. Возвращает `account_code`, `test_mode`, `success_url`, `cancel_url`, `connection_id`, `source`.
2. `supabase/functions/_shared/public-app-host.ts` — server-side канонический host (`gorbova.by` default, override через env `PUBLIC_APP_HOST`). Helper `resolveStripeCheckoutUrls()` с 3-уровневой priority: connection → PUBLIC_APP_HOST → sandbox-fallback. **Без импорта из `src/`** (правка #2).

### Изменённые
3. `supabase/functions/_shared/acquiring/stripe-metadata.ts` — убран literal `'default'`. Пустой `business_stream` → `'unspecified'` + `console.warn({audit:'business_stream_unspecified',...})`.
4. `supabase/functions/_shared/acquiring/stripe-adapter.ts` — убраны fallback'и `'stripe_poland'` и `https://example.com/*`. Adapter теперь возвращает `{ok:false, error:'stripe_adapter_missing_account_code'|'stripe_adapter_missing_redirect_urls'}` если caller не передал необходимое.
5. `supabase/functions/stripe-create-checkout/index.ts` — SOT account, business_stream через offer/product meta, URL через `resolveStripeCheckoutUrls({sandbox:false})`.
6. `supabase/functions/stripe-admin-sandbox-checkout/index.ts` — то же + sandbox-fallback URLs (`/admin/payments/sandbox-return?status=...`); catalog mode резолвит business_stream через offer/product meta, manual mode → 'unspecified'. Симуляционная ветка тоже на SOT.
7. `supabase/functions/stripe-admin-refund/index.ts` — SOT account.
8. `supabase/functions/stripe-ensure-webhook/index.ts` — SOT account (reuse `connection_id` из resolver).
9. `supabase/functions/stripe-reconcile-session/index.ts` — SOT account.
10. `supabase/functions/stripe-get-session/index.ts` — SOT account.

## 3. Diff (ключевые фрагменты)

### `stripe-metadata.ts` (было / стало)
```ts
// BEFORE
business_stream: input.business_stream ?? 'default',

// AFTER
let business_stream = input.business_stream?.trim() ?? '';
if (!business_stream) {
  business_stream = 'unspecified';
  console.warn(JSON.stringify({audit:'business_stream_unspecified', order_id, product_id, tariff_id, offer_id, account_code}));
}
```

### `stripe-adapter.ts` (URL fallback)
```ts
// BEFORE
['success_url', req.return_url ?? 'https://example.com/success'],
['cancel_url', req.cancel_url ?? 'https://example.com/cancel'],

// AFTER
if (!success_url || !cancel_url) return {ok:false, fallback:true, error:'stripe_adapter_missing_redirect_urls'};
['success_url', success_url],
['cancel_url', cancel_url],
```

### `stripe-create-checkout` (account + URL + business_stream)
```ts
// BEFORE
const account_code = body.account_code ?? 'stripe_poland';
const {data: conn} = await supabase.from('acquiring_connections').select('*')...
// ...
return_url: conn.success_url ?? undefined,
business_stream: body.business_stream ?? null,

// AFTER
const acct = await resolveDefaultStripeAccount(supabase, body.account_code);
const account_code = acct.account_code;
// business_stream через offer/product meta
let bs = body.business_stream ?? null;
if (!bs) {
  const [offerRes, productRes] = await Promise.all([...]);
  bs = resolveBusinessStream({tariff_offer_meta:..., product_meta:..., link_business_stream:null});
}
const urls = resolveStripeCheckoutUrls({connection_success_url:acct.success_url, ..., sandbox:false});
// adapter call
return_url: urls.success_url,
context: {provider:'stripe', account_code, business_stream: bs}
```

### `stripe-admin-sandbox-checkout` (catalog meta + sandbox URLs)
```ts
// AFTER: catalog mode подгружает meta для resolveBusinessStream
const businessStream = mode === 'catalog'
  ? resolveBusinessStream({tariff_offer_meta: offerRow?.meta, product_meta: productRow?.meta, link_business_stream:null})
  : null;
const urls = resolveStripeCheckoutUrls({connection_success_url:acct.success_url, ..., sandbox:true});
```

## 4. Контракт URL-резолвера (правки #1 + #2)

`resolveStripeCheckoutUrls()` приоритет:
1. **connection** — `acquiring_connections.success_url` AND `cancel_url` оба не пустые → используем их (`source: 'connection'`).
2. **public_app_host_fallback** — `${PUBLIC_APP_HOST}/payment/{success|cancel}` для production checkout.
3. **sandbox_fallback** — `${PUBLIC_APP_HOST}/admin/payments/sandbox-return?status={success|cancel}` (только если `sandbox=true AND test_mode=true`).
4. throw `no_redirect_url_configured` — недостижимо в нормальной конфигурации (PUBLIC_APP_HOST имеет deterministic default `https://gorbova.by`).

**Правка #1 выполнена**: жёсткий throw для sandbox/test невозможен — fallback всегда работает.
**Правка #2 выполнена**: edge-функции читают `PUBLIC_APP_HOST` из `_shared/public-app-host.ts` (server-side), без импорта `src/utils/publicAppHost.ts`.

## 5. E2E metadata trace (правка #2, фронт-к-Stripe-к-БД)

Контракт: `account_code` и `business_stream` доходят до 6 точек.

| Точка | Где пишется | Источник |
|---|---|---|
| 1. Stripe Checkout Session metadata | `stripe-adapter.ts:metadataToFormPairs` | `buildStripeMetadata(...).account_code, .business_stream` |
| 2. Stripe PaymentIntent metadata | adapter mirror `payment_intent_data[metadata]` | то же |
| 3. payments_v2.meta | `stripe-webhook` обработчик `payment_intent.succeeded` (без изменений) | Stripe PI.metadata |
| 4. orders_v2.meta | `stripe-admin-sandbox-checkout` INSERT (line ~290) — поле `account_code` уже в meta; для business_stream — через PI/Session metadata при confirm | `acct.account_code` + Stripe session.metadata |
| 5. provider_events.account_code | `stripe-webhook` (без изменений) + симуляционная ветка `stripe-admin-sandbox-checkout` (line ~134) — теперь SOT | `simAcct.account_code` |
| 6. Stripe Dashboard (Session / PaymentIntent) | визуально через Dashboard UI | mirror Stripe metadata |

Runtime-валидация шести точек выполняется во время smoke (см. §7) — после approve MP-A2-1 пользователь подтверждает runtime-проверку.

## 6. Финальный grep (live-код, без комментариев)

```bash
# Stripe payment context
$ rg -n "'stripe_poland'|\"stripe_poland\"" \
     supabase/functions/_shared/acquiring/ supabase/functions/stripe-*/
# → только строки-комментарии MP-A2-1 и одна e.g. в stripe-metadata.ts:10

$ rg -n "example\.com" supabase/functions/_shared/acquiring/ supabase/functions/stripe-*/
# → только комментарии MP-A2-1

$ rg -n "'default'" supabase/functions/_shared/acquiring/stripe-metadata.ts
# → только комментарий MP-A2-1 (line 45)
```

**В live-коде MUST-FIX: 0.** Классификация попаданий по всему проекту — в `mp_a2_1_extended_audit.md`.

## 7. Verify (что предстоит сделать перед approve MP-A2-2)

Runtime-проверки, выполняются пользователем:

| # | Сценарий | Ожидание |
|---|---|---|
| 1 | `stripe-admin-sandbox-checkout` (catalog mode, реальный product/tariff/offer с meta.business_stream) | Session создан, `metadata.account_code` = текущий default, `metadata.business_stream` = из offer.meta, `success_url` начинается с `gorbova.by` либо с conn.success_url |
| 2 | `stripe-admin-sandbox-checkout` (manual mode) | Session создан, `metadata.business_stream='unspecified'`, в edge_logs появилась audit-запись `business_stream_unspecified` |
| 3 | `stripe-admin-sandbox-checkout` без `body.account_code` | Берётся `is_default=true` запись из `acquiring_connections` |
| 4 | `stripe-get-session` без `account_code` | Возвращает `account_code` поля resolver'а |
| 5 | `stripe-admin-refund` без `account_code` | Refund выполняется через default connection |
| 6 | 10/10 Phase 2 regression (запускает super_admin) | PASS |

## 8. bePaid не затронут

```bash
$ ls supabase/functions/bepaid-* -d | wc -l
32
```
Ни один из 32 bePaid-функций не редактировался в этом mini-plan. Никаких изменений в `record_refund_atomic*`, `bepaid_product_mappings`, `subscriptions_v2` schema.

## 9. DoD

- ✅ Хардкоды Stripe payment context: 0 в live-коде.
- ✅ Extended audit (все попадания по проекту) классифицирован: MUST-FIX (исправлено) / BACKLOG / OK.
- ✅ Server-side PUBLIC_APP_HOST без импорта `src/` (правка #2).
- ✅ URL-резолвер без жёсткого throw для test/sandbox (правка #1).
- ✅ Proof разделяет Stripe payment context / unrelated UI / comments-tests (правка #1 классификации).
- ✅ Pilot Readiness Review (после MP-A2-2): требование "test_mode=true для активного пилотного подключения" — без блокировки наличия live-подключений (правка #5).
- ⏳ Runtime smoke + 10/10 регрессия — выполняется пользователем; результат добавляется в этот файл секцией §7-results.
- ⏳ MP-A2-2 — отдельный approve после получения отчёта по MP-A2-1.

---

**Готово к runtime-верификации. Edge-функции задеплоятся автоматически после сохранения.**
