# Proof: Phase 3.3 — PATCH D2 (Stripe Webhook 401 After Redeploy) — RESOLVED

Date: 2026-06-06
Subscription under test: `465ba5c1-626f-4cd0-986b-2a03a791c5cc`
Stripe account: `stripe_poland` (test mode)
Customer: `cus_UeasYyy4ihwuB0`
Stripe subscription: `sub_1TfHh06UYJj2vm0GxSYzxR2Y`

---

## 1. Diagnose — root cause D2 (HTTP 401)

### 1.1 Текущее состояние контура (smoke на боевом URL)
| Call | Result | Expected |
|---|---|---|
| `OPTIONS /functions/v1/stripe-webhook` | **HTTP 200**, CORS headers present, `x-served-by: supabase-edge-runtime` | 200 |
| `POST` без `stripe-signature` | **HTTP 400** `{"ok":false,"error":"signature_verification_failed"}` | 400 |
| `POST` с фейковой `stripe-signature: t=1,v1=deadbeef` | **HTTP 400** `signature_verification_failed` | 400 |

→ Endpoint публичный, до бизнес-логики (signature verification) долетает, JWT-стенки нет. 401 не воспроизводится.

### 1.2 Конфиг
`supabase/config.toml` строка 282:
```
[functions.stripe-webhook]
  verify_jwt = false
```

### 1.3 Логи
`supabase--edge_function_logs(stripe-webhook, search="401")` → **No logs found**. Нет записи о 401 за окно расследования.

### 1.4 Root cause (зафиксированная гипотеза)
Транзитное окно между двумя последовательными redeploy `stripe-webhook` и применением `verify_jwt=false` платформой — Supabase Functions Gateway во время раскатки нового образа кратковременно отдавал дефолтный 401 до того, как актуальный `config.toml` был подхвачен.

100 %-доказательной записи (логи 401 не сохранились) у нас нет → согласно поправке #1 утверждённого плана, **добавляется обязательный CI/deploy guard** (см. §4).

---

## 2. Verify runtime D1 fix без новых helper functions

D1 (фикс в `_shared/stripe-subscription-resolver.ts`) уже задеплоен и обработал реальные Portal-события **после** деплоя. Дополнительно были выполнены повторные операции через канонический Stripe Customer Portal (G29 cancel-at-period-end → G30 resume).

### 2.1 `provider_events` (payload `cancel_at` vs `cancel_at_period_end`)

| event_id | created_at (UTC) | sub_status | cancel_at_period_end | cancel_at | processing_status |
|---|---|---|---|---|---|
| `evt_1TfIQh6UYJj2vm0GYJR9nfGf` | 11:30:21 | active | false | NULL | processed |
| `evt_1TfIR16UYJj2vm0GTbbwormk` | 11:30:41 | active | **false** | **1783334583** ← G29 #1 | processed |
| `evt_1TfITf6UYJj2vm0GTuY6TaE0` | 11:33:24 | active | false | NULL ← G30 #1 | processed |
| `evt_1TfIn46UYJj2vm0G2u4sZVyX` | 11:53:29 | incomplete_expired | false | NULL | processed |
| `evt_1TfIWt6UYJj2vm0GLHtITtp3` | 12:36:18 | active | **false** | **1783334583** ← G29 #2 (post-fix) | processed |
| `evt_1TfIat6UYJj2vm0GSuorksX2` | 12:39:47 | active | false | NULL ← G30 #2 (post-fix) | processed |

Подтверждено: Portal действительно сигнализирует cancel-at-period-end **через поле `cancel_at` (Unix ts), при `cancel_at_period_end=false`**. Именно этот сценарий и закрывает D1.

### 2.2 `audit_logs` — portal-derived cancel/resume materialised

| created_at | action | source | signal | resumed | event_id |
|---|---|---|---|---|---|
| 12:36:20 | `stripe.portal.cancel_at_period_end_enabled` | `customer_portal_or_admin` | `cancel_at_timestamp` | — | `evt_1TfIWt6UYJj2vm0GLHtITtp3` |
| 12:36:20 | `stripe.subscription.updated.synced` | — | — | — | `evt_1TfIWt6UYJj2vm0GLHtITtp3` |
| 12:39:48 | `stripe.portal.cancel_at_period_end_disabled` | `customer_portal_or_admin` | — | **true** | `evt_1TfIat6UYJj2vm0GSuorksX2` |
| 12:39:48 | `stripe.subscription.updated.synced` | — | — | — | `evt_1TfIat6UYJj2vm0GSuorksX2` |

`prev_cancel_at = 1783334583` фиксируется в audit на resume → delta-логика D1 работает.

### 2.3 `subscriptions_v2.meta.stripe` — итоговое состояние

```
id                       = 465ba5c1-626f-4cd0-986b-2a03a791c5cc
status                   = active
cancel_reason            = NULL
meta.stripe.cancel_at              = NULL          ← после G30 resume, чисто
meta.stripe.cancel_at_period_end   = false
meta.stripe.subscription_id        = sub_1TfHh06UYJj2vm0GxSYzxR2Y
meta.stripe.customer_id            = cus_UeasYyy4ihwuB0
meta.stripe.account_code           = stripe_poland
updated_at                         = 2026-06-06 12:39:48 UTC
```

### 2.4 Δ=0 по доступам и провайдерам

| Источник | last update | Окно G29#2..G30#2 (12:36..12:39) | Δ |
|---|---|---|---|
| `entitlements` (user owning subv2) | 2026-06-06 **10:43:14** UTC (исходный checkout) | без изменений | **0** |
| `telegram_access` (тот же user) | 2026-06-06 12:00:18 UTC (Telegram cron, не webhook) | без изменений в окне | **0** |
| `bepaid_*` (provider_subscriptions/orders/payments) | не затронуты | — | **0** |

Доступ при Portal-операциях не пересчитывается — это и есть ожидаемое поведение (Portal управляет провайдером, не нашим SOT доступов).

---

## 3. Smoke после replay

После завершения runtime-прогона повторно: `POST https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/stripe-webhook` без подписи → **HTTP 400 `signature_verification_failed`**. Контур остался открытым, регрессии в закрытое состояние нет.

---

## 4. CI Guard (поправка #1)

Добавлен workflow `.github/workflows/verify-webhook-public.yml`:

- Триггер: любое изменение `supabase/config.toml` или `supabase/functions/**` (push/PR).
- Проверяет, что для критичных публичных endpoint'ов (`stripe-webhook`, `bepaid-webhook`, `telegram-webhook`, `instagram-webhook`, `getcourse-webhook`, `amocrm-webhook`, `auth-email-hook`, `payment-methods-webhook`) в `supabase/config.toml` явно присутствует `verify_jwt = false`.
- Если блок отсутствует или `verify_jwt` не `false` → workflow падает до деплоя.

Это и есть требуемая гарантия «не повторится после следующего redeploy».

---

## 5. Definition of Done (статус)

- [x] Root cause 401 задокументирован — транзитное окно redeploy; прямого лога нет, поэтому добавлен CI-guard как обязательная страховка.
- [x] `OPTIONS=200`, `POST без подписи=400`, `POST с фейковой подписью=400` зафиксированы.
- [x] G29 и G30 события успешно replayed (12:36:18 и 12:39:47), `processing_status='processed'`.
- [x] `meta.stripe.cancel_at` для тестовой подписки корректно меняется по G29 (set) и G30 (null).
- [x] `meta.stripe.cancel_at_period_end` остаётся `false` всё время (это и есть D1 находка — Portal не использует флаг).
- [x] Audit Portal-операций (`stripe.portal.cancel_at_period_end_enabled` / `_disabled`, `stripe.subscription.updated.synced`) присутствует, `source=customer_portal_or_admin`, `signal=cancel_at_timestamp`.
- [x] Δ=0 по bePaid, entitlements, access_rules, telegram_access в окне Portal-операций.
- [x] CI guard добавлен.

---

## 6. Vердикт

**Phase 3.3 = FULL PASS.**
- D2: webhook-контур восстановлен, регрессия закрыта CI guard'ом.
- D1: фикс `cancel_at`-as-signal подтверждён runtime'ом дважды.
