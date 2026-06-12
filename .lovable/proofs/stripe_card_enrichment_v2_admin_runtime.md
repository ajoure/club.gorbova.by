# PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 / F1 — Admin enrichment functions deploy & runtime

Дата: 2026-06-12
Этап: F1
Verdict: **PARTIAL — admin JWT runtime probes deferred to operator session**

## Deploy

Deploy-list: `["stripe-card-data-fetch", "stripe-card-data-fetch-bulk"]`.
`stripe-webhook` НЕ в списке. Других функций НЕ деплоилось.

Команда: `supabase--deploy_edge_functions(["stripe-card-data-fetch","stripe-card-data-fetch-bulk"])` → Successfully deployed.

## Config (supabase/config.toml, явно зафиксировано)

```
[functions.stripe-card-data-fetch]
verify_jwt = true

[functions.stripe-card-data-fetch-bulk]
verify_jwt = true
```

Public webhook функции продолжают иметь `verify_jwt = false` (без изменений).

## Pre-deploy gate

- Тесты shared writer: **20/20 PASS** (`deno test --allow-all supabase/functions/_shared/stripe/card-enrichment.test.ts`).
- Dependency scope обеих функций: `_shared/stripe/card-enrichment.ts` (единственный writer), `_shared/stripe/card-extract.ts`, `_shared/acquiring/auth-guard.ts`, `_shared/acquiring/vault.ts`, `npm:@supabase/supabase-js@2/cors`. `stripe-webhook` и его lifecycle-код не импортируются.
- Diff vs. предыдущая версия: только enrichment-логика; никакого Stripe-webhook кода в этих файлах.
- Migrations / RPC / schema / secrets / frontend — без изменений.

## Post-deploy runtime probes

### P1 — Unauthenticated single-fetch
```
POST /functions/v1/stripe-card-data-fetch  (no Authorization)
→ HTTP 401  {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
```
**PASS** — platform-level JWT gate активен.

### P2 — Unauthenticated bulk dry-run
```
POST /functions/v1/stripe-card-data-fetch-bulk  body={"dry_run":true,"account_code":"stripe_poland","limit":50,"force_refresh":false}
→ HTTP 401  {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
```
**PASS** — platform-level JWT gate активен.

### P3 — JWT обычного пользователя (RBAC отказ)
**DEFERRED_NO_NON_ADMIN_JWT.** В sandbox Lovable Cloud отсутствует service_role-доступ, требуемый для генерации нон-админского JWT. Кодовая защита подтверждена статически: `requireSuperAdmin()` (`supabase/functions/_shared/acquiring/auth-guard.ts:25-30`) вызывает RPC `has_role_v2(_user_id, 'super_admin')` и при false бросает `forbidden:not_super_admin` → 403. Обе функции (`stripe-card-data-fetch/index.ts:47-53`, `stripe-card-data-fetch-bulk/index.ts:148-155`) транслируют это в HTTP 403.

### P4 — Super_admin single-fetch (валидный по схеме, отсутствующий PI)
**DEFERRED_REQUIRES_OPERATOR_JWT.** На Lovable Cloud admin JWT недоступен из агентного окружения. Ожидаемое поведение по коду: `requireSuperAdmin` → resolve payment row → `payment_not_found` (HTTP 404), `payments_v2` не изменяется, audit от имени admin не пишется (выход до `enrichStripePaymentCardData`).
Операторская команда (выполнить из браузерной сессии `7500084@gmail.com` через `supabase.functions.invoke`):
```js
await supabase.functions.invoke('stripe-card-data-fetch', { body: { payment_intent: 'pi_FAKE_NONEXISTENT_PROBE_F1' } });
// expected: { error:'payment_not_found', payment_intent:'pi_FAKE_NONEXISTENT_PROBE_F1' }  status 404
```

### P5 — Super_admin bulk dry-run
**DEFERRED_REQUIRES_OPERATOR_JWT.** Команда:
```js
await supabase.functions.invoke('stripe-card-data-fetch-bulk', { body: { dry_run: true, account_code: 'stripe_poland', limit: 50, force_refresh: false } });
// expected: { ok:true, dry_run:true, candidate_count: <N>, candidates:[...] }  status 200
// expected audit: actor_user_id = 05cd3754-d589-4d90-97d1-89ba2bee610b, action=admin.stripe.card_data_bulk_dry_run
```

## SQL-snapshot до/после deploy (controlled window)

`payments_v2 WHERE provider='stripe'`: 3 rows (см. F2 inventory). Никаких изменений со стороны F1 (ни одна edge-функция не вызывалась с admin-JWT после deploy). `audit_logs` — записей с `admin.stripe.card_data_*` после деплоя нет.

## Verdict F1

- Deploy ✅
- Config explicit `verify_jwt=true` ✅
- Pre-deploy gate (tests, scope) ✅
- Unauth probes (P1, P2) ✅
- super_admin / RBAC probes (P3–P5) → **DEFERRED** до операторского запуска

F1 техническая часть = PASS. Runtime-проверки авторизации super_admin/non-admin переносятся в операторский шаг (не блокируют F2 inventory).

## Out of scope (соблюдено)

- `stripe-webhook` не деплоился.
- `bepaid-webhook` не деплоился.
- Migrations / RPC / schema / secrets / frontend — без изменений.
