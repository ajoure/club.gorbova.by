# Отчёт о выполнении: PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve A

Статус: **Approve A = PASS (read-only discovery)**
Дата: 2026-06-12. Код / config / DB не изменялись.

---

## A1. Exact file map (UI слой /admin/payments)

| Артефакт | Путь | Назначение |
|---|---|---|
| Hub-таблица | `src/pages/admin/AdminPaymentsHub.tsx` | Вкладки Payments Hub. |
| Tab content | `src/components/admin/payments/PaymentsTabContent.tsx` | Загрузка/фильтрация, экспорт. |
| Таблица строк | `src/components/admin/payments/PaymentsTable.tsx` | Колонка `receipt` (lines 662–682), actions DropdownMenu (lines 685–742). |
| Кнопка/бейдж документа | `src/components/admin/payments/ReceiptStatusBadge.tsx` | Единая кнопка «Чек/Документ» (Stripe не зовёт `bepaid-get-receipt`, только `open(receipt_url)`). |
| Unified resolver (frontend) | `src/hooks/useUnifiedPayments.tsx` | Lines 351–404 `resolveDocumentUrl()`, 406–482 `resolvePayerCard()`, поля `document_url` + `document_url_source` (lines 112, 115, 650–651, 772–773). |
| Cabinet (для справки) | `src/components/admin/DealDocumentsCard.tsx` → `DealDocumentsPanel` | Канонические `ai_generated_documents` по order. |
| Hook canonical docs | `src/hooks/useOrderCanonicalDocuments.ts` | Чтение `ai_generated_documents` по `context_type='order'`. |
| Download helper | `src/utils/downloadDocumentBlob.ts`, edge `document-download` | Signed blob-download (private bucket `documents`). |
| Provider бейдж | `src/utils/extractStripeCardFromMeta.ts` | Whitelisted extractor PAN-safe полей. |

**Drawer/Modal для документов одной payment-row отсутствует.** Сейчас вся info в колонке `receipt` + DropdownMenu actions (`Принудительно получить чек`, `Открыть в bePaid`).

Readers, найденные в UI кода:
- `payment.receipt_url`, `payment.document_url`, `payment.document_url_source`,
- `meta.stripe.charge.receipt_url`, `meta.stripe.hosted_invoice_url`, `meta.stripe.invoice_pdf`, `meta.stripe.invoice.hosted_invoice_url`, `meta.stripe.invoice.invoice_pdf`,
- `meta.provider_response.stripe.refund.receipt_url|hosted_receipt_url`,
- `meta.parent_payment_id|parent_payment_uid` + `stripeParentIndex`,
- `ai_generated_documents` (по `context_type='order'`).

---

## A2. Existing resolver/drawer inventory

### Server-side resolvers, относящиеся к документам

| Функция | Назначение | Read/Write |
|---|---|---|
| `bepaid-get-payment-docs` | Admin, авторизован JWT + role∈{super_admin, admin, accountant}. Дёргает bePaid API, возвращает receipt + refunds. | Write side-effect: пишет `audit_logs` + может обновлять локальные данные. **Не provider-agnostic.** |
| `bepaid-get-receipt`, `bepaid-fetch-receipt`, `bepaid-receipts-*` | bePaid-only sync/refresh receipt'ов. | Write: обновляют payments_v2 / queue. |
| `canonical-document-generate-strict` | Канонический writer ai_generated_documents (Sprint 12). | Write: ai_generated_documents + counters. |
| `canonical-document-payment-hook` | Авто-генерация акта по `order_paid`. | Write: ai_generated_documents (под feature flag). |
| `canonical-document-regenerate` | Регенерация существующего документа. | Write. |
| `canonical-document-send` | Email/Telegram отправка PDF. | Write side-effects, не генерирует. |
| `document-download` | Signed blob-download bucket `documents`. | Read-only Storage. |
| `document-field-resolver-v2` | Resolver полей документа (FLD-*). | Read-only. |

### Frontend resolver

`useUnifiedPayments.tsx` содержит **единственный** существующий resolver «document_url для строки платежа» — целиком клиентский, оперирует whitelisted полями из `payments_v2.meta`. **Серверного provider-agnostic resolver «документы платежа» не существует.**

### Verdict A2

> Канонического resolver и drawer «документы одной payment-row» нет.
> Существующие endpoint'ы — это либо bePaid-only (`bepaid-get-payment-docs`), либо writer'ы (`canonical-document-*`). Использовать их как read-only drawer-resolver **нельзя без расширения контракта**.

→ **Recommended scope Approve B:** создать новую тонкую edge-функцию `admin-payment-documents-resolve` (read-only, JWT + RBAC) как orchestrator поверх:
- whitelisted чтение `payments_v2.meta` (без provider API),
- опционального retrieve через bePaid adapter (переиспользует существующий код `bepaid-get-payment-docs`, выделить в `_shared/payments/documents/bepaid-documents.ts`) и Stripe adapter (новый `_shared/payments/documents/stripe-documents.ts` поверх `stripe-client.ts` + `default-account.ts` + `vault.ts`),
- чтения `ai_generated_documents` через каноническую UUID-связь `payments_v2.order_id → context_id`.

Не расширять `bepaid-get-payment-docs` (его write-побочки и провайдер-специфичный контракт = риск). ARCHITECTURE_CONFLICT не зафиксирован: двух конкурирующих resolver'ов нет — только один frontend + один bePaid-only backend.

---

## A3. DB relationship map (UUID-only)

```
payments_v2.id ──┬── (refund row) meta.parent_payment_id → payments_v2.id (parent)
                 │                                  └── meta.parent_payment_uid → payments_v2.provider_payment_id
                 │
                 ├── order_id → orders_v2.id ──┬── tariff_id, offer_id, product_id
                 │                              └── ai_generated_documents.context_id
                 │                                  (WHERE context_type='order')
                 │
                 ├── subscription_id → subscriptions_v2.id
                 ├── profile_id → profiles.id
                 └── meta.stripe.{payment_intent_id, charge_id, invoice_id, refund_id,
                                  subscription_id, account_code, test_mode}
                     meta.bepaid.* / receipt_url / provider_response.transaction.receipt_url
```

Связь refund → parent **уже каноническая** через `meta.parent_payment_id` (UUID локальной строки). Эвристики (amount/date/email) **не используются** и в этом патче запрещены.

Связь payment ↔ internal document — **только через `order_id`**. Прямая `ai_generated_documents.payment_id` отсутствует в схеме (таблица 44 колонки, `payment_id` нет). Текущий контракт SOT: `context_type='order' AND context_id=order_id`.

---

## A4. Stripe / bePaid document-source matrix

### Stripe (locally stored, no provider API)

| Источник | Поле | Тип документа |
|---|---|---|
| `meta.stripe.charge.receipt_url` | URL | `receipt` |
| `meta.stripe.hosted_invoice_url` / `meta.stripe.invoice.hosted_invoice_url` | URL | `hosted_invoice` |
| `meta.stripe.invoice_pdf` / `meta.stripe.invoice.invoice_pdf` | URL | `invoice_pdf` |
| `meta.provider_response.stripe.refund.receipt_url` или `hosted_receipt_url` | URL | (refund — отображается как `parent_payment`) |
| `payments_v2.receipt_url` (DB column) | URL | fallback |

### Stripe (требует provider retrieve)

Если локальный URL отсутствует, но есть точный ID (`pi_*`, `ch_*`, `in_*`, `re_*`, `cn_*`) — server-side `GET /v1/{resource}/{id}` через канонический Stripe client (см. A8). **Запрещено** `list/search`.

### bePaid

| Источник | Поле | Тип |
|---|---|---|
| `payments_v2.receipt_url` | URL | `receipt` |
| `provider_response.transaction.receipt_url` | URL | `receipt` (fallback) |
| `bepaid-get-payment-docs` | (refresh) | дёргает bePaid API, переиспользуется adapter'ом в read-only режиме |

---

## A5. Refund parent mapping

Канонический источник связи refund → parent в проекте уже один: **`payments_v2.meta.parent_payment_id` (UUID локальной payment-row)** + дублирующий `meta.parent_payment_uid` (provider_payment_id).

Подтверждено фактически на единственной refund-row Stripe:
- `0da381ef-1286-4432-b929-c9df7502b5d4` (refund, -5 BYN) → `meta.parent_payment_id = 2d40bc7e-e69f-4633-88d5-102561e49a54` → parent `succeeded`, BYN 5, `pi_3TgMkD…vH`.

Также допустимые fallback (уже используются в `useUnifiedPayments.tsx` строки 385–402):
- `meta.provider_response.stripe.refund.payment_intent|charge` (provider parent ID),
- индекс `stripeParentIndex` по `payments_v2.id / provider_payment_id / sm.charge_id / sm.payment_intent_id`.

**Запрещены** в этом патче: amount, date, email, last4, order title, nearest payment.

**Если parent не найден** → `source = unavailable`, `warning = REFUND_PARENT_NOT_RESOLVED`, фиктивный receipt не выдаём.

---

## A6. Technical payment marker

**Канонического marker НЕ обнаружено.**

Реальный inventory:
| Payment | Сумма | Marker `meta.test_payment` | `meta.stripe.test_mode` |
|---|---|---|---|
| `2d40bc7e…` (BYN 5) | 5.00 | ∅ | ∅ |
| `0da381ef…` (BYN -5 refund) | -5.00 | ∅ | ∅ |
| `00b39954…` (USD 2) | 2.00 | ∅ | ∅ — но `account_code = stripe_poland`, реальный live `acct_1Tc88d6…`, `subscription_create` |

`meta.stripe.account_code` присутствует на двух row, но это **не маркер технической оплаты**, а account routing. `meta.stripe.test_mode` нигде не выставлен (на live-аккаунте поле даже не возвращается Stripe — нужно резолвить по самому `account_code` через `acquiring_connections.test_mode`).

→ В Approve B/C не определять «техническую оплату» условием `amount == 2 USD`. **Если marker отсутствует — generation-action для этой row остаётся как для обычной**, отдельный backlog-PATCH должен ввести canonical fixture marker (`meta.test_payment=true` или `meta.fixture=true`). До этого `TEST_PAYMENT_DOCUMENT_BLOCKED` НЕ выставляется автоматически. Это явно фиксируется в discovery как **deferred** — не блокирует drawer.

---

## A7. RBAC mapping (capability → существующие permissions)

Существующая RBAC v2: enum `app_role`, RPC `has_role_v2(_user_id, _role_code)`, helpers `useRbac()`, `useSuperAdmin()`, `useHasRoleV2()`. Edge: `requireSuperAdmin` (используется в stripe-card-data-fetch*).

| Capability drawer | Используем существующее |
|---|---|
| `view_payment_documents` | Тот же guard, что уже даёт доступ к `/admin/payments` (admin / accountant / super_admin — по образцу `bepaid-get-payment-docs`). |
| `refresh_provider_documents` | Минимум `admin`/`super_admin` (то же, что write на платежах). |
| `generate_internal_document` | Существующий guard `canonical-document-generate-strict` (не переизобретаем). |
| `regenerate_internal_document` | Существующий guard `canonical-document-regenerate`. |
| `diagnostics_section` | `useSuperAdmin()` / `has_role_v2(_, 'super_admin')`. |

→ **Новые DB permissions / role tables / migrations в этом патче запрещены.** Granular permission'ы реализуются комбинацией существующих role-checks внутри новой функции `admin-payment-documents-resolve`. В `supabase/config.toml` добавится только `[functions.admin-payment-documents-resolve] verify_jwt = true` (Approve B).

---

## A8. URL / domain inventory (allowlist)

| Provider | Хосты для provider URL (allowlist) |
|---|---|
| Stripe | `pay.stripe.com`, `invoice.stripe.com`, `files.stripe.com` |
| bePaid | `bepaid.by`, `checkout.bepaid.by`, `merchant.bepaid.by` (+ subdomain `*.bepaid.by`) |
| Internal | НЕТ публичных хостов — только `document-download` edge → signed-URL on-the-fly (private bucket `documents`). |

Storage buckets (psql):
- `documents` — **private** (`public=f`). SOT для всех PDF. INSERT — service_role, чтение — через signed URL.
- `documents-templates`, `tariff-media`, `ticket-attachments`, `charter-documents`, `prompt-attachments`, `telegram-media` — private.
- `signatures`, `avatars`, `training-content`, `owner-photos`, `webinar-prestart`, `training-assets` — public.

Drawer Approve B обязан:
- никогда не отдавать `storage://.../path` напрямую,
- возвращать только `https://…` URL,
- для внутренних PDF — short-lived signed URL (создаётся в момент resolve, не сохраняется в БД/audit),
- провайдерские URL — отдавать только если хост в allowlist выше.

---

## A9. Inventory с terminal verdict

### Stripe rows (3 шт., всё, что есть)

| payment_id | provider | type | parent | account_code | mode | pi | ch | in | re | cn | local docs | refreshable | order_id | internal docs | scenario | can_generate | blocked_reason | test marker | **verdict** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `2d40bc7e…` | stripe | payment | — | stripe_poland | (resolve via conn) | `pi_3TgMkD…vH` | `ch_3TgMkD…E7` | — | — | — | **none** | charge.receipt via PI/CH | `b464dc75…` | 0 | ? (см. ниже) | tbd | — | — | **NO_PROVIDER_DOCUMENTS** + опц. `READY_PROVIDER_REFRESH` |
| `0da381ef…` | stripe | refund | parent=`2d40bc7e…` (canonical) | (наследует) | (наследует) | — | — | — | `re_3TgMkD…XP` | — | none | refund.receipt via `re_*` | `b464dc75…` | 0 (через parent.order_id) | — | — | `REFUND_USES_PARENT_DOCUMENTS` | — | **REFUND_PARENT_RESOLVED** + `READY_PROVIDER_REFRESH` |
| `00b39954…` | stripe | payment | — | stripe_poland | live (`acct_1Tc88d6…`) | `pi_3TgWoM…Ce` | `ch_3TgWoM…lE` | `in_1TgWoM…XO` | — | — | **invoice_pdf + hosted_invoice_url локально** | charge.receipt via PI/CH | `849c68b7…` | 0 | order имеет `document_data` snapshot → scenario возможен | tbd (offer FLD есть) | — | **∅** (нет canonical fixture marker) | **READY_LOCAL_ONLY** (+ при наличии sceanrio → `READY_GENERATION`) |

### bePaid sample (5 succeeded)

| payment_id | receipt_url col | provider_response.receipt | order_id | verdict |
|---|---|---|---|---|
| `8bcc0519…` | ∅ | (не проверяли — Approve B) | ✓ | **NO_PROVIDER_DOCUMENTS** (требуется refresh через `bepaid-get-payment-docs`) |
| `22b9f6d5…` | ∅ | ditto | ✓ | NO_PROVIDER_DOCUMENTS |
| `8dceda56…` | ∅ | ditto | ✓ | NO_PROVIDER_DOCUMENTS |
| `88b77739…` | ∅ | ditto | ✓ | NO_PROVIDER_DOCUMENTS |
| `054a6062…` | ∅ | ∅ (проверено) | ✓ | NO_PROVIDER_DOCUMENTS |

**Зомби-выводов нет:** `ARCHITECTURE_CONFLICT` не зафиксирован. `REFUND_PARENT_NOT_RESOLVED` ни одной row. `TEST_PAYMENT_GENERATION_BLOCKED` ни одной row (marker отсутствует — см. A6).

Канонические документы `ai_generated_documents` (101 запись total: order=70, package=31). Для всех 3 Stripe + 5 sampled bePaid orders — **0 internal docs**. Это норма (новые транзакции, акты не сгенерированы).

---

## A10. Canonical recommendation + proposed exact scope Approve B

### Архитектурное решение
- **Новый** edge: `admin-payment-documents-resolve` (read-only orchestrator).
- **Не расширять** `bepaid-get-payment-docs` (имеет write-побочки и bePaid-specific контракт).
- **Не создавать** второй resolver: единственная точка чтения document state для строки платежа = новая функция.

### Файлы Approve B (точный список)

```
supabase/functions/admin-payment-documents-resolve/index.ts      [new]
supabase/functions/admin-payment-documents-resolve/index.test.ts [new]
supabase/functions/_shared/payments/documents/types.ts            [new]
supabase/functions/_shared/payments/documents/stripe-documents.ts [new]
supabase/functions/_shared/payments/documents/bepaid-documents.ts [new — wraps bepaid-get-payment-docs core, read-only]
supabase/functions/_shared/payments/documents/internal-documents.ts [new]
supabase/functions/_shared/payments/documents/url-contract.ts     [new]
supabase/functions/_shared/payments/documents/refund-parent.ts    [new]
supabase/config.toml                                              [add functions.admin-payment-documents-resolve verify_jwt=true]
```

### Точный response contract (фиксируется в Approve B)

```ts
{
  payment: { id, provider, status, amount, currency, order_id, is_refund, masked_provider_id },
  provider_documents: Array<{
    type: "receipt" | "hosted_invoice" | "invoice_pdf" | "credit_note",
    provider: "stripe" | "bepaid",
    title: string,
    url: string,
    url_kind: "external_provider" | "signed_storage",
    can_open: boolean, can_download: boolean, can_copy: boolean, expires_at: string | null,
    status: "available" | "unavailable" | "expired" | "error",
    source: "local_meta" | "provider_api" | "parent_payment" | "local_meta+provider_api",
    external_id_masked: string | null,
    created_at: string | null,
    retryable?: boolean,
  }>,
  internal_documents: Array<{ id, type, title, status: "generated"|"pending"|"failed",
    file_url, url_kind:"signed_storage", expires_at, document_number_masked,
    created_at, source: "ai_generated_documents", latest: boolean }>,
  generation: { scenario_found: boolean, can_generate: boolean,
    blocked_reason: null | "NO_DOCUMENT_SCENARIO" | "MISSING_REQUIRED_REQUISITES" |
                   "TEST_PAYMENT_DOCUMENT_BLOCKED" | "DOCUMENT_ALREADY_GENERATED" |
                   "GENERATION_IN_PROGRESS" | "GENERATION_FAILED" |
                   "PAYMENT_NOT_LINKED_TO_ORDER" | "REFUND_USES_PARENT_DOCUMENTS" |
                   "STRIPE_ACCOUNT_NOT_RESOLVED" | "REFUND_PARENT_NOT_RESOLVED" },
  warnings: string[],
  diagnostics_super_admin_only?: {
    provider_object_ids_masked, scenario_source, template_id_masked, executor_id_masked,
    last_provider_refresh_at, refund_parent_payment_id_masked
  }
}
```

### Тестовая матрица (минимум 20)
Перечислена в плане §3 B12.

---

## A11. Conflicts / STOP conditions

**Найденные риски (не блокеры, но фиксируются для Approve B):**

1. **Отсутствие canonical fixture marker (см. A6).** Технические Stripe-платежи 2 USD не помечены. Решение: в Approve B `TEST_PAYMENT_DOCUMENT_BLOCKED` использует ТОЛЬКО явный marker (`meta.test_payment===true` или `meta.fixture===true`). Если marker отсутствует — generation работает как для обычной row. Backlog-PATCH `stripe_test_fixture_marker_v1` — отдельно.

2. **`test_mode` определяется через `acquiring_connections.test_mode` по `account_code`**, не через `meta.stripe.test_mode` (поле отсутствует на live). Adapter обязан резолвить test/live через табличный lookup, не по эвристике.

3. **`ai_generated_documents.payment_id` нет** — только через `order_id`. Это фиксированный канон. Версионирование документов — через `created_at DESC`, `latest=true` для самого свежего status∈{generated, success}, остальные — historical. Frontend дедупликацию по filename/document_number **не** делает.

4. **bePaid sample показал 0 receipt_url в DB columns** на 5 свежих succeeded rows. Это значит drawer для bePaid почти всегда будет требовать `refresh_provider=true` через `bepaid-get-payment-docs` adapter. Refresh пишет ТОЛЬКО `audit_logs` в drawer-контракте (write payments_v2 запрещён). Если потребуется постоянное кэширование — отдельный PATCH.

**ARCHITECTURE_CONFLICT — НЕТ.** Двух конкурирующих resolver-path не существует. Текущий клиентский `resolveDocumentUrl()` в `useUnifiedPayments.tsx` после Approve C должен делегировать в новый backend resolver для подробного drawer-view (но колонка-бейдж в таблице остаётся как сейчас — короткий single-URL).

---

## Итоговый verdict Approve A

- Exact file map: ✓
- Existing resolver/drawer inventory: ✓ (нового нет, рекомендация — создать read-only orchestrator)
- DB relationship map: ✓ (UUID-only через `meta.parent_payment_id` и `order_id`)
- Stripe/bePaid document-source matrix: ✓
- Refund parent mapping: ✓ (1 row, canonical link подтверждён)
- Technical payment marker: ✗ marker отсутствует → deferred backlog, drawer не блокируется
- RBAC mapping: ✓ без миграций
- URL/domain inventory: ✓ (Stripe/bePaid allowlist + private bucket `documents`)
- Inventory с terminal verdict: ✓ (3 Stripe + 5 bePaid)
- Canonical recommendation: ✓ (новая `admin-payment-documents-resolve`)
- Conflicts/STOP: 4 риска зафиксированы, ARCHITECTURE_CONFLICT отсутствует
- Proposed exact scope Approve B: ✓ (файлы + contract + tests)

**Approve A = PASS.** Готов к Approve B (backend code + tests, без deploy).
