# Phase 8-A Discovery — Receipts / Documents Inventory v1

Scope: read-only. Никаких миграций, edge functions, UI, backfill, storage upload.
Дата: 2026-06-08.

---

## 1. Просмотренные таблицы (public schema, информация о колонках)

| Таблица | Релевантные поля | Назначение |
|---|---|---|
| `payments_v2` | `receipt_url TEXT`, `refunds JSONB`, `provider_response JSONB`, `provider`, `provider_payment_id`, `meta JSONB`, `card_last4`, `card_brand` | SOT факта платежа. Поле `receipt_url` уже существует и заполняется ТОЛЬКО bePaid. |
| `orders_v2` | `meta JSONB`, `invoice_sent_at`, `invoice_email`, `purchase_snapshot JSONB`, `provider`, `provider_payment_id` | Заказ. `invoice_sent_at` — legacy от старой системы счёт-актов. |
| `provider_events` | `payload JSONB` (полный webhook), `event_type`, `provider`, `related_payment_id`, `related_order_id`, `processing_status` | Сырые webhook'и. **Stripe payload содержит `data.object.receipt_url` / `hosted_invoice_url` / `invoice_pdf`, но они НЕ извлекаются.** |
| `payment_links` | `meta JSONB`, `public_url`, `provider`, `account_code` | Публичные ссылки. Не хранят receipt. |
| `subscriptions_v2` | `meta JSONB`, `payment_method_id` | Подписка. Receipt лежит per-charge в `payments_v2`. |
| `generated_documents` | `file_path`, `file_url`, `document_type`, `document_number`, `status`, `order_id` | **Legacy** SOT счёт-актов (deprecated в UI per Cabinet Documents Canonical SOT). |
| `ai_generated_documents` | `file_path`, `storage_bucket`, `document_number`, `context_type='order'`, `context_id=order_id`, `template_id`, `meta` | **Канонический** SOT сгенерированных документов (счёт-актов и пакетов). Writer: `canonical-document-generate-strict`. |
| `document_templates` | `file_name_template`, `template_code`, `template_version_id` | Шаблоны DOCX → PDF (Gotenberg). |
| `document_package_templates`, `document_package_template_items`, `document_package_sessions`, `document_package_item_role_assignments`, `document_package_role_catalog`, `document_package_token_aliases` | Пакеты документов (Sprint 3D/3G/3H-fix). | Многодокументные сценарии для УЛ/ИП/ФЛ. |
| `audit_logs` | `action`, `entity_type`, `entity_id`, `meta` | Аудит. Используется для `document.sent.email`, `document.send_blocked_no_payment` и т.п. |
| `storage.buckets` | `documents` (private), `documents-templates` (private), `charter-documents` (private), `signatures` (public), `tariff-media` (private), `avatars/owner-photos/training-*/telegram-media/webinar-prestart` (public) | PDF сгенерированных документов лежат в bucket `documents` (private, INSERT только service_role per Public Bucket Listing Policy). |

---

## 2. Где сейчас лежат receipt/invoice/document поля

| Поле | Где хранится | Кто пишет | Кто читает |
|---|---|---|---|
| `receipt_url` (фискальный чек bePaid) | `payments_v2.receipt_url`, дубль в `payment_reconcile_queue.receipt_url`, также внутри `payments_v2.provider_response.transaction.receipt_url` | bePaid: `bepaid-receipts-cron`, `bepaid-receipts-sync`, `bepaid-receipts-backfill`, `bepaid-receipts-2026-backfill-cron`, `bepaid-fetch-receipt`, `bepaid-get-receipt`, `bepaid-get-payment-docs`, `bepaid-docs-backfill`, `bepaid-webhook` (через canonical fetch). | UI Cabinet: `useOrderCanonicalDocuments` + кнопка «Чек» в `/purchases`; admin: `useUnifiedPayments`, `PaymentsTable`. Helper: `purchaseDocumentRules.hasRealReceipt(p)` — читает `receipt_url ∥ provider_response.transaction.receipt_url`. |
| `hosted_invoice_url` (Stripe) | **Нигде не сохраняется.** Присутствует в `provider_events.payload` для `invoice.paid` (9 событий). | — | — |
| `invoice_pdf` (Stripe) | **Нигде не сохраняется.** Присутствует в `provider_events.payload`. | — | — |
| Stripe `charge.receipt_url` | **Нигде не сохраняется.** Присутствует в `provider_events.payload` (`payment_intent.succeeded`, `charge.refunded`). | — | — |
| `document_url` / `file_path` (сгенерированный PDF счёт-акт) | `ai_generated_documents.file_path` + `storage_bucket='documents'` | `canonical-document-generate-strict` | UI: `downloadDocumentBlob` через edge `document-download` (blob, не signed URL). |
| Legacy `file_url` / `file_path` | `generated_documents.*` | `generate-invoice-act`, `generate-document-pdf` (deprecated) | Только admin-аудит (Sprint 12 backlog). |
| Provider payload | `provider_events.payload JSONB` | `bepaid-webhook`, `stripe-webhook` | Только diagnostics; не используется как SOT для receipt. |

---

## 3. bePaid — текущий контур чеков

- **Where**: `payments_v2.receipt_url` (живёт там; редко `provider_response.transaction.receipt_url`).
- **Capture path A (real-time)**: bePaid webhook → `bepaid-webhook` → внутри `_shared/bepaid-receipt-fetch.ts` запрос `GET /v2/transactions/{uid}` → write `receipt_url`.
- **Capture path B (cron)**: `bepaid-receipts-cron` (sweep последних 48ч с `receipt_url IS NULL`) + `bepaid-receipts-sync` (queue+payments).
- **Capture path C (backfill)**: `bepaid-receipts-backfill`, `bepaid-receipts-2026-backfill-cron`, `bepaid-docs-backfill`.
- **Ad-hoc**: `bepaid-fetch-receipt`, `bepaid-get-receipt`, `bepaid-get-payment-docs` — pull-on-demand.
- **UI exposure**:
  - `/purchases` → `useOrderCanonicalDocuments` + helper `purchaseDocumentRules` → кнопка «Чек» если есть `receipt_url`.
  - Admin: `PaymentsTable` (бейдж «Чек есть/нет»), `DealDocumentsCard`/`DealPayerDocumentsCard`, `BepaidRawDataTab`.
- **Метрика покрытия** (live snapshot):
  - bepaid: 5 672 платежа, 1 120 с `receipt_url` (~20%, остальное — old admin/refund/manual).
  - stripe: 28 платежей, 0 с `receipt_url`.
  - admin/admin_test: 299, 0.

---

## 4. Stripe — gap-анализ

| Артефакт | Stripe источник | Сохраняется? | Доступно где? |
|---|---|---|---|
| `charge.receipt_url` (одноразовый платёж) | `payment_intent.succeeded → charges.data[0].receipt_url` или `charge.succeeded` | **Нет.** | Только сырой `provider_events.payload`. |
| `invoice.hosted_invoice_url` (подписка) | `invoice.paid → object.hosted_invoice_url` | **Нет.** | Только `provider_events.payload` (9 событий `invoice.paid`). |
| `invoice.invoice_pdf` | `invoice.paid → object.invoice_pdf` | **Нет.** | Только `provider_events.payload`. |
| Refund receipt | `charge.refunded → refunds.data[*].receipt_url` | **Нет.** | bePaid пишет в `payments_v2.refunds[].receipt_url`; Stripe — нет. |

`stripe-webhook/index.ts` (610 LOC) обрабатывает: `checkout.session.completed`, `payment_intent.succeeded`, `charge.refunded`, `refund.created/updated`, `charge.dispute.created`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`. В обработчиках `invoice.paid` и `payment_intent.succeeded` **нет ни одного присваивания `receipt_url`/`hosted_invoice_url`/`invoice_pdf`** в `payments_v2`.

Доп. наблюдение: `stripe-create-customer-portal-session` уже даёт пользователю доступ к Stripe-портреам со списком invoices/receipts — это альтернативный канал, но он не пишет в нашу БД.

---

## 5. UI inventory

| Точка | Файл | Текущее поведение | Stripe gap |
|---|---|---|---|
| Cabinet «Мои покупки» → карточка платежа | `src/pages/Purchases.tsx`, `src/components/purchases/OrderListItem.tsx`, `SubscriptionDocumentActions.tsx`, `OrderDocuments.tsx` | Кнопки «Сформировать документ» (счёт-акт) и «Чек» (если `payments_v2.receipt_url`). | Для Stripe-заказа «Чек» никогда не появляется. |
| Admin «Сделки» | `src/components/admin/DealDetailSheet.tsx`, `DealDocumentsCard`, `DealPayerDocumentsCard` | Видит сгенерированные документы из `ai_generated_documents`. Чек bePaid — через `useUnifiedPayments`. | Stripe receipt не виден. |
| Admin «Платежи» | `src/components/admin/payments/PaymentsTable.tsx`, `PaymentsTabContent.tsx`, `PaymentsBatchActions.tsx` | Колонка/бейдж «Чек», действие «Получить чек» (вызывает `bepaid-get-receipt`). | Действие провайдер-агностично НЕ работает: нет Stripe-эквивалента. |
| Admin «Контакты» → сделки | `src/components/admin/contact/ContactDealsTab.tsx` | Reuse `useUnifiedPayments`. | То же. |
| Admin «bePaid raw» | `src/components/admin/bepaid/BepaidRawDataTab.tsx` | Дамп `payment_reconcile_queue` + `receipt_url`. | n/a. |
| Public success page | (после оплаты редирект) | Нет рендера receipt URL. | n/a. |
| Helper для покупок | `src/lib/documents/purchaseDocumentRules.ts` + `supabase/functions/_shared/purchase-document-rules.ts` | `hasRealReceipt(p)` проверяет `receipt_url ∥ provider_response.transaction.receipt_url`. | Контракт уже провайдер-агностичен на уровне `payments_v2.receipt_url`. Проблема не в helper'е, а в том, что Stripe это поле не заполняет. |

---

## 6. Hardcode bePaid / Stripe gaps

**Hardcode «receipt = только bePaid»** (читают bePaid-specific path или зовут bePaid-only функции):

1. `supabase/functions/bepaid-get-payment-docs/index.ts` — единственный «get docs» endpoint; зовётся из UI безусловно для любого provider.
2. `supabase/functions/bepaid-fetch-receipt`, `bepaid-get-receipt` — провайдер-привязаны.
3. `supabase/functions/bepaid-receipts-cron`, `bepaid-receipts-sync`, `bepaid-receipts-backfill`, `bepaid-receipts-2026-backfill-cron`, `bepaid-docs-backfill` — sweep'ы только по bePaid.
4. UI кнопка «Получить чек» в `PaymentsTable` → invoke `bepaid-get-receipt` без `provider` switch.
5. `PaymentsBatchActions` — batch «Получить чеки» только bePaid.
6. `useUnifiedPayments.tsx` метрики `withReceipt` / `withoutReceipt` — корректны на уровне поля, но `useBepaidMappings` остаётся bePaid-only fetch.

**Stripe receipt НЕ учитывается** в:

- `stripe-webhook/index.ts` (нет write в `payments_v2.receipt_url`, нет нового поля для `hosted_invoice_url`/`invoice_pdf`).
- Нет cron `stripe-receipts-*`.
- Нет UI action для Stripe «Получить чек / открыть hosted invoice».

`purchase-document-rules.ts` сам по себе провайдер-агностичен — поэтому **если Stripe-webhook начнёт писать `receipt_url`, UI «Чек» сразу заработает без UI-правок**.

---

## 7. Рекомендация (без миграции, без кода)

### 7.1 Reuse vs. новая таблица

**Рекомендация: REUSE существующих полей. Новая таблица `payment_documents` НЕ нужна на Phase 8-B.**

Аргументы:
- `payments_v2.receipt_url` уже существует, уже отображается UI, уже покрывается helper'ом `hasRealReceipt`. Контракт «one receipt per payment» соответствует и bePaid (один fiscal receipt на транзакцию), и Stripe (`charge.receipt_url`).
- `payments_v2.refunds JSONB` уже хранит per-refund `receipt_url` (bePaid model). Stripe refund-receipts могут лечь сюда же.
- `payments_v2.meta JSONB` — естественное место для Stripe-специфичных полей `hosted_invoice_url`, `invoice_pdf`, `stripe_invoice_id`, `stripe_charge_id`. Это нестандартный «PDF self-service» (URL хостится Stripe'ом, не у нас) — не оправдывает отдельной таблицы.
- `provider_events.payload` уже хранит сырой webhook → backfill не требует внешних API-запросов для последних 30 дней.

Если в будущем (Phase 8-C+) понадобятся:
- множественные документы на один платёж (например, separate VAT invoice + receipt),
- ссылки между платежами и сгенерированными PDF в storage,
- внешние ЭСЧФ/налоговые документы,

→ тогда вводить отдельную `payment_documents` (`payment_id, kind, url, file_path, source, meta`). Сейчас — преждевременная нормализация.

### 7.2 Куда в UI показывать Stripe-документы

- В `/purchases` — та же кнопка «Чек», которую уже рендерит `purchaseDocumentRules.hasRealReceipt`. Никаких новых блоков.
- Доп. label опционально: «Открыть в Stripe» (для hosted invoice — это полноценный self-service кабинет покупателя).
- Admin `PaymentsTable` — кнопку «Получить чек» сделать провайдер-aware (`provider==='stripe' → stripe-get-receipt`).

### 7.3 Backfill — можно ли без новой Edge Function

**Да, частично.** Для последних ~30 дней Stripe-данные лежат в `provider_events.payload` локально:

```sql
-- report-only example, не выполнять как backfill
SELECT pe.related_payment_id,
       pe.payload->'data'->'object'->>'receipt_url'        AS charge_receipt_url,
       pe.payload->'data'->'object'->>'hosted_invoice_url' AS hosted_invoice_url,
       pe.payload->'data'->'object'->>'invoice_pdf'        AS invoice_pdf
FROM provider_events pe
WHERE pe.provider='stripe'
  AND pe.event_type IN ('payment_intent.succeeded','charge.succeeded','invoice.paid','invoice.payment_succeeded');
```

→ report-only SQL покрывает все 28 stripe-платежей без обращения к Stripe API.

Для платежей старше webhook-retention (или без события в БД) — потребуется одноразовый Stripe API pull, **что уже подпадает под «новая Edge Function»** и должно быть отдельным sub-phase (Phase 8-D Backfill), не в первом MVP.

---

## 8. Risk register

| Риск | Severity | Mitigation |
|---|---|---|
| Изменение `stripe-webhook` ломает recurring sync | HIGH | Hotfix-2 уже прошёл; держать diff минимальным: только дописать read-only fields в `payments_v2.{receipt_url, meta}`. Никаких изменений RPC `grant-access-for-order`. |
| Запись Stripe `hosted_invoice_url` в `payments_v2.receipt_url` смешает семантику с фискальным чеком РБ | MEDIUM | Канонически: `receipt_url` = «чек оплаты» (любого acquirer'а). `hosted_invoice_url` — отдельно в `meta.stripe.hosted_invoice_url`. Helper `hasRealReceipt` уже это поддержит без правок. |
| Stripe `invoice_pdf` — это публичный URL Stripe'а; expires через ~годы, но не вечен | LOW | Хранить URL, не PDF; кнопка «Скачать» — redirect. При деградации — Phase 8-D backfill. |
| ЭСЧФ / налоговая отчётность РБ для Stripe-платежей (USD/EUR/PLN, не БЕЛ-резиденты) | OUT OF SCOPE | Не trogать в Phase 8. Включить в отдельную backlog. |
| `provider_events.payload` иногда не имеет `related_payment_id` (Stripe события приходят раньше нашего записи `payments_v2`) | MEDIUM | На read-only backfill — JOIN через `payload->>'id'` к `payments_v2.provider_payment_id`. |
| Bucket `documents` private — Stripe URL'ы внешние, в storage не уходят | LOW | Не требуется upload. |

---

## 9. Что НЕ трогалось в этом Discovery

- Никаких миграций, новых таблиц, новых Edge Functions.
- `stripe-webhook`, `bepaid-webhook` — read-only осмотр.
- `grant-access-for-order`, `telegram-*`, `subscriptions-reconcile-*`, `bepaid-receipts-cron` — read-only.
- `canonical-document-generate-strict`, `canonical-document-send`, `document-download` — read-only.
- Storage buckets — не создавались/не модифицировались.
- UI компоненты — не изменялись.
- Backfill DRY-run/EXECUTE — не запускался.
- `ai_generated_documents`, `document_templates`, `document_package_*` — не модифицировались.

---

## 10. Просмотренные edge functions (read-only)

bePaid (43 шт., релевантные для Phase 8):
`bepaid-webhook`, `bepaid-receipts-cron`, `bepaid-receipts-sync`, `bepaid-receipts-backfill`, `bepaid-receipts-2026-backfill-cron`, `bepaid-fetch-receipt`, `bepaid-get-receipt`, `bepaid-get-payment-docs`, `bepaid-docs-backfill`, `bepaid-raw-transactions`, `bepaid-archive-import`, `bepaid-fetch-transactions`, `_shared/bepaid-receipt-fetch.ts`.

Stripe:
`stripe-webhook`, `stripe-create-checkout`, `stripe-create-subscription-checkout`, `stripe-create-customer-portal-session`, `stripe-get-session`, `stripe-reconcile-session`, `stripe-list-events`, `stripe-subscription-action`, `stripe-discovery-objects`, `stripe-admin-refund`, `stripe-ensure-webhook`, `admin-stripe-price-lookup`, `admin-stripe-subscription-capability-probe`, `admin-provision-stripe-price`, `stripe-admin-sandbox-checkout`.

Shared:
`_shared/purchase-document-rules.ts`.

Documents canonical:
`canonical-document-generate-strict`, `canonical-document-send`, `document-download` (read-only осмотр).

---

## 11. Просмотренные UI-точки

- `src/pages/Purchases.tsx`
- `src/components/purchases/OrderListItem.tsx`
- `src/components/purchases/OrderDocuments.tsx`
- `src/components/purchases/SubscriptionDetailSheet.tsx`
- `src/components/purchases/SubscriptionDocumentActions.tsx`
- `src/pages/admin/AdminOrdersV2.tsx`
- `src/pages/admin/AdminPaymentDiagnostics.tsx`
- `src/components/admin/DealDetailSheet.tsx`
- `src/components/admin/DealDocumentsCard.tsx`
- `src/components/admin/contact/ContactDealsTab.tsx`
- `src/components/admin/payments/PaymentsTable.tsx`
- `src/components/admin/payments/PaymentsTabContent.tsx`
- `src/components/admin/payments/PaymentsBatchActions.tsx`
- `src/components/admin/payments/DiagnosticsTabContent.tsx`
- `src/components/admin/bepaid/BepaidRawDataTab.tsx`
- `src/components/ai-documents/DealDocumentsPanel.tsx`
- `src/hooks/useUnifiedPayments.tsx`
- `src/hooks/useGeneratedDocuments.ts`
- `src/hooks/useOrderCanonicalDocuments.ts`
- `src/utils/downloadDocumentBlob.ts`
- `src/lib/documents/purchaseDocumentRules.ts`

---

## 12. Summary для Phase 8-B approve

- **Gap**: Stripe receipt/invoice URLs не сохраняются в `payments_v2`, хотя webhook их получает.
- **Fix scope (для будущего Phase 8-B)**:
  1. `stripe-webhook`: при `payment_intent.succeeded` / `charge.succeeded` / `invoice.paid` извлечь `receipt_url` → `payments_v2.receipt_url`, а `hosted_invoice_url` / `invoice_pdf` / `stripe_invoice_id` → `payments_v2.meta.stripe.*`.
  2. UI кнопка «Получить чек» в `PaymentsTable` → провайдер-aware switch (для Stripe — pull через новый `stripe-get-receipt` либо просто открыть существующий URL).
  3. Backfill — отдельный sub-phase, read-only SQL покрывает последние ~30 дней без новых функций.
- **Новой таблицы НЕ требуется.**
- **Никаких изменений в** `grant-access-for-order`, `telegram-*`, `subscriptions-reconcile-*`, canonical document pipeline, storage, ЭСЧФ.
