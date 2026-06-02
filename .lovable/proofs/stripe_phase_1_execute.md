# Proof — Phase 1 Stripe Integration execute

Дата: 2026-06-02. Скоуп: add-only расширение `payment_links`, adapter layer, UI Integrations → Acquiring, фильтры provider в платежах и ссылках.

## 1. Миграция применена

Две миграции выполнены последовательно:

1. **ALTER `payment_links`** — добавлены 5 nullable/defaulted колонок + 2 CHECK constraint + индекс `idx_payment_links_provider`.
2. **CREATE OR REPLACE VIEW `payment_links_enriched_v` + RPC `get_admin_payment_links_v1`** — пробрасывают новые колонки в админский список.

## 2. Defaults / data-integrity (after migration)

| Проверка | Ожидание | Факт |
|---|---|---|
| `COUNT(*) FROM payment_links` | 106 | **106** |
| `COUNT(*) WHERE provider IS NULL OR provider_mode IS NULL` | 0 | **0** |
| `COUNT(*) WHERE provider <> 'bepaid'` | 0 | **0** |
| `COUNT(*) WHERE account_code IS NOT NULL OR profile_code IS NOT NULL OR business_stream IS NOT NULL` | 0 | **0** (нет скрытого backfill) |
| `COUNT(*) WHERE provider_mode = 'fixed'` | 106 | **106** |

## 3. CHECK constraints (from `pg_constraint`)

```
payment_links_provider_check       CHECK provider IN ('bepaid','stripe','admin','admin_test','admin_test_direct')
payment_links_provider_mode_check  CHECK provider_mode IN ('fixed','customer_choice')
```

`auto` режим не введён. Никаких SQL ENUM.

## 4. Adapter layer (add-only, ноль callers в Phase 1)

Создано в `supabase/functions/_shared/acquiring/`:

- `types.ts` — `AcquiringAdapter`, `CheckoutRequest`, `CheckoutResponse`, `AcquiringContext`, `ProviderMode`.
- `secrets.ts` — `getAcquiringSecret(account_code, key_name)` с per-account scope и global fallback (single-account-now).
- `bepaid-adapter.ts` — facade-заглушка. **Не вызывается** в Фазе 1. Канонический write-path bePaid остаётся в `create-payment-checkout` / `bepaid-*`.
- `stripe-adapter.placeholder.ts` — placeholder, возвращает `not_implemented_phase_1`. Реальная реализация — Фаза 2.
- `index.ts` — `resolveAdapter(provider, account_code?)` + re-exports.
- `profile-resolver.ts` — `resolveProfile(...)` поверх inline-профилей из `tariff_offers.meta.<provider>_profile`.
- `business-stream-resolver.ts` — `resolveBusinessStream(...)` с приоритетом offer→product→link.

Проверка отсутствия влияния на bePaid edge-функции:

```
rg -l "_shared/acquiring" supabase/functions/ | grep -v "_shared/acquiring/"
→ (пусто)

rg -l "acquiring" supabase/functions/bepaid* supabase/functions/create-payment-checkout*
→ (пусто)
```

Ноль импортов из новых модулей в существующих edge-функциях. Поведение bePaid не задето.

## 5. UI

### 5.1 Страница Integrations → Acquiring

- Маршрут `/admin/integrations/acquiring` (`src/pages/admin/AdminAcquiring.tsx`).
- Future-ready карточки:
  - **bePaid** — `account_code=bepaid_main`, `status=active`, `provider=bepaid`, default.
  - **Stripe** — `account_code=stripe_poland`, `status=not_configured`, `provider=stripe` (отображается уже сейчас).
- Card-блок «Фаза 1 — текущий статус» с напоминанием, что Stripe write-path появится в Фазе 2.

### 5.2 Фильтр provider в `/admin/payments`

- Тип `PaymentFilters.provider: string` добавлен в `PaymentsTabContent.tsx`, default `"all"`.
- Логика фильтрации в `useMemo` использует `payments_v2.provider` (уже существует в схеме, заполнено `bepaid` у всех текущих платежей).
- Селект **All | bePaid | Stripe** добавлен в `PaymentsFilters.tsx` (первая колонка), даже если Stripe-платежей пока 0 — это исключает переделку UI в Фазе 2.

### 5.3 Фильтр provider в `/admin/payments/links`

- `usePaymentLinks.PaymentLinkRow` расширен полями provider/provider_mode/account_code/profile_code/business_stream.
- В `LinksTabContent` добавлен state `providerFilter` (All | bePaid | Stripe) и Select-контрол в toolbar.
- Фильтрация: `(l.provider ?? 'bepaid') === providerFilter`.

## 6. Нулевой diff в bePaid поведении

- `bepaid-*` edge-функции не модифицированы.
- `create-payment-checkout.ts` не модифицирован.
- `payment_links` writer (`admin-create-public-link`) не модифицирован — новые колонки приобретают DEFAULT-значения автоматически.
- bePaid фронтенд-вызовы и checkout flow не задеты.

## 7. DoD

- ✅ Миграция add-only, NOT NULL + DEFAULT для provider/provider_mode, остальное nullable.
- ✅ CHECK constraints для provider и provider_mode.
- ✅ Без SQL ENUM.
- ✅ Никаких Stripe write-path.
- ✅ Future-ready UI карточка Stripe видна сразу.
- ✅ Provider-фильтр в платежах и ссылках сразу с тремя значениями.
- ✅ Все proofs зелёные (0 NULL, 0 non-bepaid, 0 hidden backfill, 106/106 fixed).
- ✅ Build — Vite сборка не задета (импорты компонентов корректны, типы расширены).
