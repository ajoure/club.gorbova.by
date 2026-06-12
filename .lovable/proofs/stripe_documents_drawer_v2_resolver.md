# Отчёт о выполнении: PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B

Статус: **Approve B = выполнено локально, deploy НЕ выполнен.**
Дата: 2026-06-12.
Зависит от: Approve A (PASS, `.lovable/discovery/stripe_documents_drawer_v2.md`).

---

## 1. Список файлов / diff-summary

| Путь | Действие | Назначение |
|---|---|---|
| `supabase/functions/admin-payment-documents-resolve/index.ts` | **created** | Read-only HTTP-orchestrator + DI-резолвер. |
| `supabase/functions/admin-payment-documents-resolve/index.test.ts` | **created** | 28 локальных тестов (Deno test), все mock. |
| `supabase/functions/_shared/payments/documents/types.ts` | **created** | Canonical contract, machine codes, PCI forbidden keys. |
| `supabase/functions/_shared/payments/documents/url-security.ts` | **created** | https-only, boundary-safe allowlist. |
| `supabase/functions/_shared/payments/documents/stripe-documents.ts` | **created** | Exact retrieve adapter, account/mode-aware. |
| `supabase/functions/_shared/payments/documents/bepaid-documents.ts` | **created** | Read-only локальный extractor. |
| `supabase/functions/_shared/payments/documents/internal-documents.ts` | **created** | `ai_generated_documents` по `order_id`, signed URL per request. |
| `supabase/functions/_shared/payments/documents/generation-status.ts` | **created** | Чистый классификатор (без вызова generation). |
| `supabase/config.toml` | edited | Добавлен блок `[functions.admin-payment-documents-resolve] verify_jwt = true` (config-only, deploy НЕ выполнен). |
| `supabase/functions.registry.txt` | edited | Добавлена запись `admin-payment-documents-resolve` (deploy reserved for Approve D). |
| `.lovable/backlog/stripe_test_fixture_marker_v1.md` | **created** | Backlog для canonical fixture marker. |
| `.lovable/proofs/stripe_documents_drawer_v2_resolver.md` | **created** | Этот отчёт. |

`function deployed = false`. `runtime production unchanged = true`.

---

## 2. Dependency graph

```
admin-payment-documents-resolve/index.ts
  ├── _shared/cors.ts                                 (canonical CORS)
  ├── _shared/payments/documents/types.ts             (contract)
  ├── _shared/payments/documents/url-security.ts      (URL allowlist)
  ├── _shared/payments/documents/stripe-documents.ts  (exact retrieve)
  │     └── types.ts, url-security.ts
  ├── _shared/payments/documents/bepaid-documents.ts  (read-only)
  │     └── types.ts, url-security.ts
  ├── _shared/payments/documents/internal-documents.ts(signed URL)
  │     └── types.ts, url-security.ts
  └── _shared/payments/documents/generation-status.ts (classifier)
        └── types.ts
```

Shared-модули входят в bundle resolver; отдельно не деплоятся.

---

## 3. Canonical contract

Input:
```json
{ "payment_id": "uuid", "refresh_provider": false }
```

HTTP коды: `400 INVALID_REQUEST` / `401 UNAUTHORIZED` / `403 FORBIDDEN` / `404 PAYMENT_NOT_FOUND` / `200 RESOLVED` / `500 INTERNAL_ERROR` (только для необработанных).

Provider/internal adapter failure → НЕ 500. Документ помечается `status='unavailable'`, добавляется `warning.code = PROVIDER_DOCUMENT_RETRIEVE_FAILED, retryable: true`. Drawer продолжает работать.

Response (см. `types.ts → ResolverResponse`):
- `payment`: `{id, provider, status, amount, currency, order_id, is_refund}`
- `provider_documents[]`: `{provider, type, external_id, status, source, url, url_kind, can_open, can_download, can_copy, expires_at, warning?}`
- `internal_documents[]`: `{id, order_id, document_type, status, number, created_at, url, url_kind, can_open, can_download, can_copy, expires_at}`
- `generation`: `{scenario_found, can_generate, blocked_reason}`
- `diagnostics`: только super_admin, иначе `null`
- `warnings[]`: `{code, retryable?, detail?}`

Raw provider error text клиенту НЕ возвращается (только `safe_error_code`).

---

## 4. RBAC mapping

Реализовано через `supabase.rpc('has_role_v2', { _user_id, _role_code })` — существующий canonical helper, новых permissions / migrations нет.

| Capability | Допуск |
|---|---|
| view (resolve без refresh) | `super_admin`, `admin`, `accountant` (тот же кохорт, что уже видит `/admin/payments`) |
| refresh_provider | `super_admin`, `admin` |
| diagnostics block | `super_admin` |
| прочие | 403 `FORBIDDEN` |

JWT обязателен (`verify_jwt = true` зафиксировано в `supabase/config.toml`).

---

## 5. Stripe account/mode resolution

- `account_code` берётся ТОЛЬКО из `payments_v2.meta.stripe.account_code` (или `meta.account_code` fallback).
- `buildStripeClient(account_code)` — DI; production-реализация должна резолвить ключ через `_shared/acquiring/vault.ts` + `acquiring_connections.test_mode`. В Approve B production wiring оставлен как заглушка `() => null` (Approve D подключит реальный клиент после ревью).
- При `accountCode = null` → `stripeAccountResolved = null`/`false`, refresh пропускается, warning `PROVIDER_DOCUMENT_RETRIEVE_FAILED detail=STRIPE_ACCOUNT_NOT_RESOLVED`. Никакого fallback на live/default.

---

## 6. Exact retrieve proof

`stripe-documents.ts` принимает только regex-валидные ID:

| Resource | Regex |
|---|---|
| `payment_intents` | `^pi_[A-Za-z0-9_]+$` |
| `charges` | `^ch_[A-Za-z0-9_]+$` |
| `invoices` | `^in_[A-Za-z0-9_]+$` |
| `refunds` | `^re_[A-Za-z0-9_]+$` |
| `credit_notes` | `^cn_[A-Za-z0-9_]+$` |
| `subscriptions` | `^sub_[A-Za-z0-9_]+$` |

Допустимый chain (используется только то, что возвращает exact retrieve): `PaymentIntent.latest_charge → ch_*`; `Invoice.payment_intent → pi_*`.

Code-search (`rg`):
```
=== stripe list/search ===
supabase/functions/_shared/payments/documents/stripe-documents.ts:165:
    // 2c) Credit note — ONLY by exact cn_* id. Forbidden: creditNotes.list({ invoice }).
supabase/functions/_shared/payments/documents/internal-documents.ts:37:
    const rows = await source.list(orderId);  // DB list of ai_generated_documents (NOT Stripe API)
```
Никаких `.list(` / `.search(` Stripe-вызовов. Подтверждено тестом **A3** («Exact retrieve only — no list/search ever invoked»).

Credit note возвращается ТОЛЬКО при наличии точного `cn_*`. Поиск через `Invoice.creditNotes.list({invoice})` запрещён и не реализован.

---

## 7. bePaid read-only proof

`bepaid-documents.ts` использует только локальные поля:
- `payments_v2.receipt_url`,
- `payments_v2.meta.provider_response.transaction.receipt_url`,
- `transaction.uid` / `provider_payment_id` как canonical external_id.

Code-search показал отсутствие вызовов `bepaid-get-payment-docs` (только упоминания в комментариях):
```
=== bepaid-get-payment-docs invocation ===
supabase/functions/admin-payment-documents-resolve/index.ts:14: comment
supabase/functions/_shared/payments/documents/bepaid-documents.ts:7: comment
(empty = good)
```

Refresh для bePaid без локального receipt → warning `BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY`, drawer не падает (тест 8, тест 20).

---

## 8. Refund parent proof

Использован ТОЛЬКО canonical `payments_v2.meta.parent_payment_id` (UUID). Никаких эвристик по сумме/дате/email/last4 не добавлено.

Поведение:
- parent найден → `effectiveMeta` = parent.meta, документы берутся parent'а, `generation.blocked_reason = REFUND_USES_PARENT_DOCUMENTS` (тест 5);
- parent отсутствует → `warning REFUND_PARENT_NOT_RESOLVED`, фиктивные receipt не выдаются (тест 14).

---

## 9. Internal document relation

`payment.order_id → ai_generated_documents.order_id` (UUID-only). Поле `payment_id` в схеме отсутствует и не используется. Identity документа = его UUID. Дедупликация по версиям не выполняется (отсутствие канонического поля = документы не склеиваются). Сортировка: `created_at DESC, id ASC`.

Signed URL создаётся per request через injected `signer.sign(storage_path, file_name, ttl)`. Никогда не сохраняется (тест 18: `ops.paymentsWrite.calls === 0`, `ops.signCalls === 1`).

---

## 10. URL-security proof

`url-security.ts` реализует:
- `https:` only;
- запрет `username/password` в URL;
- запрет `javascript:`, `data:`, `file:`, `blob:` (через protocol check);
- exact-host allowlist: `pay.stripe.com`, `invoice.stripe.com`, `files.stripe.com`, `bepaid.by`;
- suffix-safe `*.bepaid.by` (host === 'bepaid.by' OR host.endsWith('.bepaid.by') AND длиннее суффикса).

Negative-кейсы покрыты unit-тестом `url-security: boundary-safe hostname check`:
- `https://bepaid.by.evil.com/x` → unsafe ✓
- `https://evilbepaid.by/x` → unsafe ✓
- `http://pay.stripe.com/x` → unsafe ✓
- `https://u:p@pay.stripe.com/x` → unsafe ✓
- `javascript:alert(1)` → unsafe ✓

Unsafe URL не отдаётся клиенту: `url=null, url_kind='unavailable', status='unavailable', warning='UNSAFE_DOCUMENT_URL'` (тест 13).

---

## 11. Deduplication rules

| Слой | Identity |
|---|---|
| Stripe | `provider='stripe' + type + external_id (ch_/in_/cn_)` |
| bePaid | `provider='bepaid' + type + external_id (transaction.uid \|\| provider_payment_id)` |
| Internal | document UUID |

При совпадении exact identity (local + provider_api) → одна карточка, `source='local_meta+provider_api'` (тест 15). По URL/имени/номеру дедупликация ЗАПРЕЩЕНА.

Если bePaid receipt URL есть, но external_id отсутствует → `status='unavailable'`, `warning='PROVIDER_DOCUMENT_ID_NOT_RESOLVED'`.

---

## 12. Тесты и результаты

Запуск: `Deno test admin-payment-documents-resolve` (изолированно, mocks).

```
ok | 28 passed | 0 failed (15ms)
```

Полная матрица (20 канонических + 5 дополнительных + 3 helper):

| # | Кейс | Status |
|---|---|---|
| 1 | Stripe receipt — local | PASS |
| 2 | Stripe hosted invoice — local | PASS |
| 3 | Stripe invoice PDF — local | PASS |
| 4 | Stripe без provider documents | PASS |
| 5 | Stripe refund с canonical parent → REFUND_USES_PARENT_DOCUMENTS | PASS |
| 6 | Consultation generation classifier (NO_DOCUMENT_SCENARIO) | PASS |
| 7 | bePaid с локальным receipt | PASS |
| 8 | bePaid без receipt + refresh → BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY | PASS |
| 9 | Payment без order → PAYMENT_NOT_LINKED_TO_ORDER | PASS |
| 10 | Payment с internal document (UUID relation) | PASS |
| 11 | Payment без scenario → NO_DOCUMENT_SCENARIO | PASS |
| 12 | Stripe account не определён → warning + locals | PASS |
| 13 | Unsafe URL не возвращается клиенту | PASS |
| 14 | Refund parent отсутствует → REFUND_PARENT_NOT_RESOLVED | PASS |
| 15 | Дубликат local/provider → 1 карточка, source `local_meta+provider_api` | PASS |
| 16 | View-only не может выполнить refresh | PASS |
| 17 | Provider API timeout не скрывает internal documents | PASS |
| 18 | Signed URL не сохраняется (0 DB writes, 1 sign call) | PASS |
| 19 | Resolve без refresh → 0 audit | PASS |
| 20 | bePaid локальный receipt совместимость | PASS |
| A1 | Capabilities=0 → diagnostics=null, без refresh | PASS |
| A2 | Refresh не мутирует payments_v2 (insert/update/upsert/delete = 0) | PASS |
| A3 | Exact retrieve only — нет list/search | PASS |
| A4 | Diagnostics скрыты для не-super_admin | PASS |
| A5 | PCI forbidden fields отсутствуют в response и audit | PASS |
| H1 | url-security boundary-safe hostname check | PASS |
| H2 | url-security signed storage https + no credentials | PASS |
| H3 | generation-status: refund overrides all | PASS |

Все провайдер-клиенты, Supabase client, signer переданы через DI/mock. Тесты:
- 0 network calls;
- 0 DB writes при `refresh=false`;
- ≤1 audit при `refresh=true`;
- 0 generation calls;
- 0 document number allocations;
- 0 unsafe URLs в response.

---

## 13. Подтверждение отсутствия deploy / DB / lifecycle changes

- `supabase deploy ...` не выполнялся для `admin-payment-documents-resolve`.
- В `supabase/config.toml` добавлен только expected-блок, который активирует JWT-проверку ПОСЛЕ деплоя (Approve D). Существующие функции не затронуты.
- В `supabase/functions.registry.txt` добавлена 1 строка для CI-учёта; deploy выполняется только в Approve D.
- Миграций нет. Новых таблиц/RPC/permissions нет.
- `payments_v2`, `orders_v2`, `subscriptions_v2`, `ai_generated_documents`, `access_rules`, `entitlements` — НЕ изменялись.
- `stripe-webhook`, `bepaid-webhook`, `bepaid-get-payment-docs`, `canonical-document-*` — НЕ переразворачивались и не вызываются из нового resolver.

Code-search proof (см. § 6, § 7, § 11 выше): нет `payments_v2` writes, нет `canonical-document` / `document_number` / `generate-strict` / `regenerate`, нет Stripe `.list(` / `.search(`, нет `bepaid-get-payment-docs` invocation, нет persistence signed URL.

---

## 14. Proposed deploy scope для Approve D

Минимальный единый deploy-блок (НИЧЕГО другого):
1. Edge Function: `admin-payment-documents-resolve` (shared `_shared/payments/documents/*` входят в bundle).
2. Frontend bundle (после Approve C): Drawer и кнопка «Документы» внутри `PaymentsTable`.

В Approve D обязательно покрыть:
- runtime RBAC probe (super_admin / admin / accountant / non-admin: 200/200/200/403);
- runtime refresh probe Stripe (с реальным `account_code`, без list/search);
- runtime refresh probe bePaid (с локальным receipt → SUCCESS; без — `BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY`);
- runtime refund parent probe;
- SQL diff before/after по `payments_v2`, `audit_logs` (только `admin.payment_documents.provider_refresh` row);
- PCI scan response + audit meta;
- regression: 0 изменений в `payments_v2` lifecycle, 0 auto-generations, 0 webhook redeployments;
- подтверждение удаления temporary harness, если потребуется.

---

## 15. Gate status

- Approve A = PASS
- Approve B = выполнено локально (no deploy)
- Approve C = NOT APPROVED
- Approve D = NOT APPROVED
- Backlog: `PATCH-STRIPE-TEST-FIXTURE-MARKER-V1` сохранён.

STOP. Жду решения по Approve C.

---

## Approve B.1 — Production wiring (canonical account+mode-aware Stripe client)

Дата: 2026-06-12. Статус: **B.1 = DONE (local)**, deploy НЕ выполнен.

### 1. Файлы, реально изменённые в B.1

| Файл | Назначение |
|---|---|
| `supabase/functions/_shared/payments/documents/types.ts` | Добавлен `StripeClientResolutionError` (12 безопасных кодов). |
| `supabase/functions/_shared/payments/documents/stripe-client-factory.ts` | **НОВЫЙ.** Канонический factory + чистые helpers + HTTP retrieve. |
| `supabase/functions/admin-payment-documents-resolve/index.ts` | Заменён stub `= () => null` на реальную lazy factory через `_shared/acquiring/vault.ts` + `acquiring_connections`. Сигнатура `ResolverDeps.buildStripeClient` → discriminated `StripeClientResolution`. |
| `supabase/functions/admin-payment-documents-resolve/index.test.ts` | +28 новых assertions (B1.1–B1.28). Существующие fixtures: добавлен `livemode: false` к stripe-сценариям. |
| `.lovable/proofs/stripe_documents_drawer_v2_resolver.md` | Этот раздел. |

Никаких других изменений: 0 миграций, 0 правок `config.toml` / `functions.registry.txt`, 0 правок frontend, 0 правок `bepaid-documents.ts` / `internal-documents.ts` / `url-security.ts` / `generation-status.ts`, 0 deploy.

### 2. Фактическая схема `acquiring_connections` (read-only discovery)

```
provider              text   not null  CHECK in ('stripe','bepaid')
account_code          text   not null
account_name          text   not null
is_default            bool   not null  default false
test_mode             bool   not null  default true
status                text   not null  CHECK in ('pending','active','disabled','invalid')
capabilities_snapshot jsonb  not null  default '{}'
…
UNIQUE (provider, account_code)
```

Фактические записи (production): `provider=stripe, account_code=stripe_poland, test_mode=true, status=active`.

### 3. Фактическая сигнатура vault helper

`_shared/acquiring/vault.ts`:
```ts
readAcquiringSecret(provider: 'stripe'|'bepaid', account_code: string, kind: 'secret_key'|'webhook_signing_secret'): Promise<string>
```
Чтение через SECURITY DEFINER RPC `get_acquiring_secret`. Прямой `Deno.env.get('STRIPE_SECRET_KEY*')` в factory/resolver/adapter отсутствует (grep clean).

Существующий Stripe HTTP helper `_shared/acquiring/stripe-client.ts` использует `Stripe-Version: '2024-06-20'`. **Тот же pinned version** воспроизведён в `makeStripeRetrieveOverHttp` (дублирование оправдано добавлением AbortController/timeout + строгой санитизацией ошибок, и тем самым сохранён узкий SOT factory). Если базовая версия будет когда-либо бампнута — оба места меняются вместе.

### 4. Production composition graph

```
HTTP entrypoint (Deno.serve)
  ├─ JWT auth (supabase.auth.getUser)
  ├─ RBAC: has_role_v2 × VIEW_ROLES
  ├─ canRefresh = ∃ role ∈ {super_admin, admin}
  ├─ load payments_v2 row (SELECT-only)
  ├─ extract from payment.meta:
  │     account_code      = meta.stripe.account_code  ∥  meta.account_code  (с детекцией конфликта)
  │     livemode          = meta.stripe.livemode
  │     test_mode         = meta.stripe.test_mode
  ├─ resolveStripeAccountCode → ok | NOT_RESOLVED | CODE_CONFLICT
  ├─ normalizeStripeMode      → ok | NOT_RESOLVED | CONFLICT
  └─ if refresh && canRefresh && both ok:
        deps.buildStripeClient({ accountCode, livemode, testMode })
            ↓
        createStripeClientForPayment(args, {
            lookupConnection: SELECT id,provider,account_code,test_mode,status
                              FROM acquiring_connections
                              WHERE provider='stripe' AND account_code=$1 AND status='active'
            readSecret:       readAcquiringSecret('stripe', code, 'secret_key')   // Vault RPC
            makeRetrieve:     makeStripeRetrieveOverHttp(secret)                  // GET only
        })
            ↓
        StripeClientResolution =
          | { ok:true, client, accountCode, mode:'test'|'live', connectionId }
          | { ok:false, code: <safe machine code>, retryable }
            ↓
        ok → resolveStripeDocuments({ stripe: client, refresh: true, ... })
        !ok → warnings += { code:'PROVIDER_DOCUMENT_RETRIEVE_FAILED', detail:<code>, retryable }
              providerDocs остаются local-only
```

### 5. Account-code conflict matrix

| `meta.stripe.account_code` | `meta.account_code` | Verdict |
|---|---|---|
| `null` | `null` | `STRIPE_ACCOUNT_NOT_RESOLVED` |
| `'a'`  | `null` | `'a'` |
| `null` | `'b'`  | `'b'` |
| `'a'`  | `'a'`  | `'a'` |
| `'a'`  | `'b'`  | `STRIPE_ACCOUNT_CODE_CONFLICT` |

Молчаливый приоритет одного поля над другим **отсутствует**.

### 6. Mode normalization matrix

| `livemode` | `test_mode` | Verdict |
|---|---|---|
| `null` | `null` | `STRIPE_MODE_NOT_RESOLVED` |
| `true` | `null` | `live` |
| `false`| `null` | `test` |
| `null` | `true` | `test` |
| `null` | `false`| `live` |
| `true` | `false`| `live` (consistent) |
| `false`| `true` | `test` (consistent) |
| `true` | `true` | `STRIPE_MODE_CONFLICT` |
| `false`| `false`| `STRIPE_MODE_CONFLICT` |

### 7. Test/live isolation matrix

| Payment mode | Connection `test_mode` | Verdict |
|---|---|---|
| `test` | `true`  | ok |
| `test` | `false` | `STRIPE_MODE_MISMATCH` (no fallback) |
| `live` | `false` | ok |
| `live` | `true`  | `STRIPE_MODE_MISMATCH` (no fallback) |

### 8. Exact retrieve resource matrix

| Resource | ID regex | Indirect via |
|---|---|---|
| `payment_intents` | `^pi_[A-Za-z0-9]+$` | — |
| `charges`         | `^ch_[A-Za-z0-9]+$` | `payment_intents.latest_charge` (только exact `ch_*` после strict regex) |
| `invoices`        | `^in_[A-Za-z0-9]+$` | — |
| `refunds`         | `^re_[A-Za-z0-9]+$` | — |
| `credit_notes`    | `^cn_[A-Za-z0-9]+$` | НИКОГДА через `invoices.creditNotes.list` |
| `subscriptions`   | `^sub_[A-Za-z0-9]+$` | — |

Pre-flight regex выполняется **до** сети → 0 network на mismatch (тесты B1.21/22/23). Любой невалидный prefix или path-injection (`ch_x/../../delete`) отбрасывается без вызова fetch. Кроме regex применяется `encodeURIComponent`.

### 9. Safe failure matrix (что НЕ попадает в response / audit)

| Code | retryable | Что **не** утекает |
|---|---|---|
| `STRIPE_ACCOUNT_NOT_RESOLVED`     | false | — |
| `STRIPE_ACCOUNT_CODE_CONFLICT`    | false | конкретные значения метаданных не пересылаются как detail |
| `STRIPE_CONNECTION_AMBIGUOUS`     | false | id строк не возвращаются |
| `STRIPE_MODE_NOT_RESOLVED`        | false | — |
| `STRIPE_MODE_CONFLICT`            | false | — |
| `STRIPE_MODE_MISMATCH`            | false | `connection.id` не возвращается клиенту |
| `STRIPE_SECRET_UNAVAILABLE`       | true  | secret value, vault path, error message (тест B1.19) |
| `INVALID_STRIPE_RESOURCE`         | false | путь URL не строится; 0 network |
| `INVALID_STRIPE_ID`               | false | id не уходит наружу; 0 network |
| `STRIPE_HTTP_ERROR`               | true  | response body, `doc_url`, `error.message` (тест B1.24) |
| `NETWORK_ERROR`                   | true  | stack trace, secret в exception text (тест B1.26) |
| `REQUEST_TIMEOUT`                 | true  | — (тест B1.25) |

Authorization header не логируется. Full Stripe object не сохраняется (в `stripe-documents.ts` адаптер уже whitelist-ит поля).

### 10. Lazy resolution (фактический порядок)

```
JWT auth
  → RBAC refresh permission
  → payment UUID load
  → provider === 'stripe'
  → refresh_provider === true
  → account-code resolution (pure)
  → mode normalization (pure)
  → factory call (DI)
       → acquiring_connections SELECT
       → readAcquiringSecret (Vault RPC)
       → makeStripeRetrieveOverHttp(secret)
  → exact Stripe retrieve
```

При `refresh_provider=false` factory НЕ вызывается → vault НЕ читается → `acquiring_connections` НЕ запрашивается → 0 network (тест B1.1). При `provider !== 'stripe'` factory НЕ вызывается.

### 11. Audit (без изменений контракта)

При `refresh_provider=true` пишется `admin.payment_documents.provider_refresh` в `audit_logs` с полями: `payment_id`, `provider`, `actor_user_id`, `document_types_found`, `source`, `verdict`, `safe_error_code`, `retryable`. **Не пишутся**: secret, vault error text, full Stripe object, Stripe response body, Authorization header, `connection.id`. Тест B1.8 / A5 покрывают.

### 12. Code-search proof (B.1)

```
$ rg -n '= \(\) => null' supabase/functions/admin-payment-documents-resolve/index.ts
→ 0 matches (только упоминания в .test.ts как assertion)

$ rg -n 'createStripeClientForPayment' supabase/functions/admin-payment-documents-resolve/index.ts
→ 2 matches (import + call)

$ rg -n '\.list\(|\.search\(|autoPaging' supabase/functions/_shared/payments/documents/stripe-documents.ts \
                                          supabase/functions/_shared/payments/documents/stripe-client-factory.ts \
                                          supabase/functions/admin-payment-documents-resolve/index.ts
→ 0 Stripe .list/.search/autoPaging matches
  (единственный `.list(` в shared — это `lookupConnection.list()` контракт для acquiring_connections и `InternalDocSource.list()` — не Stripe API)

$ rg -n 'payments_v2.*(insert|update|upsert|delete)' supabase/functions/admin-payment-documents-resolve/ \
                                                      supabase/functions/_shared/payments/documents/
→ 0 matches (только assertion в test)

$ rg -n 'bepaid-get-payment-docs' supabase/functions/admin-payment-documents-resolve/ \
                                   supabase/functions/_shared/payments/documents/
→ 0 invocation matches (только комментарии-маркеры)

$ rg -n "Deno\.env\.get\(['\"]STRIPE_SECRET_KEY" supabase/functions/admin-payment-documents-resolve/ \
                                                  supabase/functions/_shared/payments/documents/
→ 0 matches (только doc-comment в factory)

$ rg -n 'createSignedUrl' supabase/functions/admin-payment-documents-resolve/
→ 1 match (per-request, не сохраняется в БД)
```

### 13. Тесты (итого)

Запуск: `deno test --allow-net --allow-env --allow-read admin-payment-documents-resolve/index.test.ts`

```
ok | 56 passed | 0 failed (36ms)
```

Новые B.1 тесты:
- B1.1 — `refresh_provider=false` → 0 factory / 0 vault / 0 network
- B1.2 — happy path: account+mode ok → exact retrieve вызван
- B1.3 — account_code отсутствует → NOT_RESOLVED, 0 network
- B1.4 — account-code conflict
- B1.5 — livemode отсутствует
- B1.6 — livemode/test_mode conflict
- B1.7 — MODE_MISMATCH из factory
- B1.8 — SECRET_UNAVAILABLE: secret/vault не утекают
- B1.9 — exact Charge retrieve → receipt с `source=provider_api`
- B1.10 — production composition guard (static read of index.ts)
- B1.11/12 — `resolveStripeAccountCode` (single/conflict)
- B1.13 — `normalizeStripeMode` (все ветки)
- B1.14–B1.20 — Factory contract: account null, 0 active, ambiguous, test↔live mismatch (×2), vault throw, happy path
- B1.21–B1.27 — HTTP retrieve safety: invalid resource, wrong-prefix ID, path-injection, sanitized non-2xx, REQUEST_TIMEOUT, NETWORK_ERROR, happy path + pinned Stripe-Version assertion
- B1.28 — Runtime composition: factory + mock lookup + mock vault + mock fetch → drawer surfaces provider_api receipt

Все 0 network вызовов, 0 production DB calls — DI mocks.

### 14. Gate

| Approve | Status |
|---|---|
| A | PASS |
| B | PARTIAL → закрыт B.1 |
| **B.1** | **DONE (local)** |
| C | NOT APPROVED |
| D | NOT APPROVED |

Deploy / frontend / production runtime НЕ начаты. После B.1 — STOP, ожидание решения по Approve C.
