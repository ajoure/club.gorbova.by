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
