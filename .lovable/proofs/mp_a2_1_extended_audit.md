# MP-A2-1 — Расширенный hardcode audit (правка #3, классификация по правке #1)

Дата: 2026-06-03. Тип: read-only сканирование всего проекта.

Команда:
```bash
rg -n "stripe_poland|example\.com" supabase/functions/ src/
```

## 1. Stripe payment context — MUST-FIX-A2-1

Целевая область: edge-функции, выполняющие реальные операции с Stripe API
(checkout, refund, webhook, get-session, reconcile, ensure-webhook), и общий adapter / metadata layer.

| Файл | Строка | Хардкод | Действие |
|---|---|---|---|
| supabase/functions/_shared/acquiring/stripe-adapter.ts | 14 | `account_code ?? 'stripe_poland'` | ✅ Удалено, throw `stripe_adapter_missing_account_code` |
| supabase/functions/_shared/acquiring/stripe-adapter.ts | 36 | `success_url ?? 'https://example.com/success'` | ✅ Удалено, throw `stripe_adapter_missing_redirect_urls` |
| supabase/functions/_shared/acquiring/stripe-adapter.ts | 37 | `cancel_url ?? 'https://example.com/cancel'` | ✅ Удалено (см. выше) |
| supabase/functions/_shared/acquiring/stripe-metadata.ts | 49 | `business_stream ?? 'default'` | ✅ Заменено на `'unspecified'` + console audit `business_stream_unspecified` |
| supabase/functions/stripe-create-checkout/index.ts | 41 | `body.account_code ?? 'stripe_poland'` | ✅ `resolveDefaultStripeAccount(supabase, body.account_code)` |
| supabase/functions/stripe-admin-sandbox-checkout/index.ts | 132 (sim branch) | `account_code: body.account_code ?? 'stripe_poland'` | ✅ SOT resolver |
| supabase/functions/stripe-admin-sandbox-checkout/index.ts | 159 (main branch) | `account_code = body.account_code ?? 'stripe_poland'` | ✅ SOT resolver |
| supabase/functions/stripe-admin-refund/index.ts | 26 | `body.account_code ?? 'stripe_poland'` | ✅ SOT resolver |
| supabase/functions/stripe-ensure-webhook/index.ts | 38 | `account_code ?? 'stripe_poland'` | ✅ SOT resolver |
| supabase/functions/stripe-reconcile-session/index.ts | 36 | `body.account_code ?? 'stripe_poland'` | ✅ SOT resolver |
| supabase/functions/stripe-get-session/index.ts | 13 | `account_code ?? 'stripe_poland'` | ✅ SOT resolver |

**Итог MUST-FIX**: 11/11 устранены. Финальное `rg` по live-коду этих файлов даёт 0 (см. § 4).

## 2. UI/admin defaults — BACKLOG (вне scope MP-A2-1)

Это **frontend UI** — placeholders/initial values для админ-формы заведения Stripe connection.
Не выполняет API-вызовы Stripe; служит лишь pre-fill для оператора.

| Файл | Строка | Контекст | Решение |
|---|---|---|---|
| src/components/admin/integrations/StripeConnectionDialog.tsx | 52, 91 | `useState("stripe_poland")` — initial value поля account_code в форме создания connection | BACKLOG. Заменить на placeholder без значения, либо генерация по schema (`stripe_<country>`). Не блокирует payment context. |
| src/pages/admin/AdminAcquiring.tsx | 108, 151 | `connections.find(c => c.account_code === "stripe_poland")` — выбор default connection в админке | BACKLOG. Заменить на `c.is_default === true`. Не блокирует runtime payment flow (тот уже использует SOT). |

## 3. example.com — OK (unrelated UI/demo/healthcheck context)

| Файл | Строка | Контекст | Категория |
|---|---|---|---|
| src/utils/packagePlaceholderCatalog.ts | 230, 300, 386 | Demo legal-details placeholders | OK (demo data) |
| src/constants/demoLegalDetails.ts | 8, 32, 47, 57-59 | Demo legal-details fixtures | OK (demo data) |
| src/lib/email-template-validation.ts | 120 | Email template preview fixture | OK (preview data) |
| src/pages/admin/AdminEmail.tsx | 365-368 | Email template preview state | OK (preview data) |
| src/pages/Help.tsx | 838 | Support email в FAQ ответе | OK (текст, не код) |
| src/components/ui/MultiContactInput.tsx | 32 | Placeholder для input | OK (UI placeholder) |
| src/components/legal-details/*.tsx | several | Form placeholders | OK (UI placeholder) |
| src/components/auth/InlineAuthForm.tsx | 114 | Auth form placeholder | OK (UI placeholder) |
| src/components/course/PreregistrationDialog.tsx | 269 | Form placeholder | OK (UI placeholder) |
| src/components/admin/InviteUserDialog.tsx | 113 | Form placeholder | OK (UI placeholder) |
| src/components/admin/EditContactDialog.tsx | 310 | Form placeholder | OK (UI placeholder) |
| src/components/admin/OrderFilters.tsx | 209 | Filter input placeholder | OK (UI placeholder) |
| src/components/admin/communication/CommunicationSettingsTabContent.tsx | 199-202 | Preview fixture | OK (preview data) |
| src/components/admin/site-builder/blocks/FooterBlockEditor.tsx | 196 | Footer input placeholder | OK (UI placeholder) |
| src/components/admin/site-builder/blocks/SiteAudioBlockEditor.tsx | 20 | Audio URL placeholder | OK (UI placeholder) |
| src/hooks/useIntegrations.tsx | 133 | Integration field placeholder | OK (UI placeholder) |
| src/components/admin/CleanupDialog.tsx | 119 | Описание правила очистки демо-аккаунтов | OK (текст) |
| src/components/ai-requisites/PersonFieldsForm.tsx | 329 | Form placeholder | OK (UI placeholder) |
| supabase/functions/integration-healthcheck/index.ts | 190, 191 | bePaid healthcheck dummy URLs (не Stripe) | OK (bePaid healthcheck, не payment-context) |
| supabase/functions/telegram-mass-broadcast/index.ts | 563 | APP_URL fallback `app.example.com` | BACKLOG (отдельный mini-plan: telegram broadcast app URL) |
| supabase/functions/public-charge-saved-card/index.ts | 253 | `'unknown@example.com'` placeholder для bePaid customer_email | OK (bePaid path) |
| supabase/functions/_shared/create-payment-checkout.ts | 128 | `'unknown@example.com'` placeholder для bePaid customer_email | OK (bePaid path, FREEZE) |

## 4. Финальная верификация (live-код Stripe payment context)

```bash
rg -n "'stripe_poland'|\"stripe_poland\"" supabase/functions/_shared/acquiring/ \
   supabase/functions/stripe-create-checkout/ supabase/functions/stripe-admin-sandbox-checkout/ \
   supabase/functions/stripe-admin-refund/ supabase/functions/stripe-ensure-webhook/ \
   supabase/functions/stripe-reconcile-session/ supabase/functions/stripe-get-session/ \
   supabase/functions/stripe-webhook/
```
Результат: **только комментарии MP-A2-1 + один e.g.-комментарий в `stripe-metadata.ts:10`**. В live-коде — 0.

```bash
rg -n "example\.com" supabase/functions/_shared/acquiring/ supabase/functions/stripe-*
```
Результат: **только комментарии MP-A2-1**. В live-коде — 0.

```bash
rg -n "'default'" supabase/functions/_shared/acquiring/stripe-metadata.ts
```
Результат: **только комментарий MP-A2-1** (строка 45). Литерала `'default'` в коде нет.

## 5. DoD по правке #1 + #3
- ✅ MUST-FIX по Stripe payment context: 0 в live-коде.
- ✅ BACKLOG: 3 пункта (UI defaults StripeConnectionDialog/AdminAcquiring + telegram APP_URL) зафиксированы, не блокируют пилот.
- ✅ OK/unrelated: 20+ попаданий — демо-данные/UI placeholders/bePaid context, не Stripe payment path.
- ✅ Не требовали 0 по всему проекту, только по Stripe payment context — соответствует правке #1.
