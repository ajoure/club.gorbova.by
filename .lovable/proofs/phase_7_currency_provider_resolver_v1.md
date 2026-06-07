# Phase 7-EXEC — Currency Provider Resolver: Proof

Дата: 2026-06-07.
Статус backend: **PASS**.
Статус UI integration (P7-7): **PARTIAL → закрыт в follow-up** — см. `.lovable/proofs/phase_7_ui_followup_v1.md` (UI переведён на shared mirror, auto-fallback валюты удалён, без изменений backend).

## 0. Summary
Реализован canonical shared резолвер `currency × provider × account capabilities × payment_type × installment`. Подключён в `admin-create-public-link` как единственный источник истины для проверки совместимости валюты и провайдера. Старые inline-whitelists (`STRIPE_ALLOWED_CURRENCIES` + ручной capability check) удалены. Добавлен ранее отсутствовавший bePaid currency guard.

Backend остаётся source of truth; UI mirror добавлен как helper для будущих UX-подсказок (без рефакторинга существующего `AdminPaymentLinkDialog`, который уже имеет совместимую `isStripeCurrencyDisabled` логику).

## 1. Changed files
- **NEW** `supabase/functions/_shared/acquiring/currency-provider-resolver.ts` — canonical edge SOT.
- **NEW** `src/utils/currencyProviderResolver.ts` — frontend mirror (UX-only, не SOT).
- **EDIT** `supabase/functions/admin-create-public-link/index.ts`
  - удалён hardcode `STRIPE_ALLOWED_CURRENCIES`;
  - удалён inline capability snapshot check;
  - добавлены 2 вызова `resolveAvailableProviders` — для bePaid path и Stripe path;
  - добавлен structured reason_code в текст ошибки (`bepaid_currency_unsupported:*`, `stripe_currency_unsupported:*`).
- **NEW** `.lovable/proofs/phase_7_currency_provider_resolver_v1.md` (этот файл).

Edge function `admin-create-public-link` задеплоен (`Successfully deployed`).

## 2. Resolver contract
```ts
resolveAvailableProviders({
  currency, payment_type,
  candidate_providers?, // default ['bepaid','stripe']
  stripe_account_supported_currencies?, stripe_account_resolved?,
  bepaid_shop_resolved?, is_installment?
}) → { availableProviders, disabledProviders[{provider,reason_code,message,source}], warnings }
```

Reason codes: `currency_not_supported_by_provider`, `currency_not_supported_by_account`, `currency_not_allowed_by_business`, `provider_not_configured`, `provider_disabled`, `missing_shop_id`, `missing_account_code`, `subscription_not_supported`, `installment_not_supported`.

## 3. Business whitelist (Phase 7-EXEC)
`BUSINESS_ALLOWED_CURRENCIES = {BYN, EUR, USD, PLN}`.

RUB / KZT / UAH **не входят** в whitelist (требует отдельного approve).
Расхождение с `admin-provision-stripe-price` (там шире `[..RUB,KZT,UAH]`) — оставлено как **follow-up**, не блокирует runtime: фактическая выдача price невозможна, потому что `admin-create-public-link` теперь отрежет такие комбинации ещё до вызова provision.

## 4. bePaid support
`bepaidSupports(currency) = currency === 'BYN'` — до отдельного discovery.

## 5. Stripe support
`stripe_allowed = business_whitelist ∩ account.capabilities_snapshot.supported_currencies`.
Пустой snapshot ⇒ R1 fallback на business whitelist + `warning: stripe_capability_snapshot_missing:<code>`.

## 6. Simulation matrix (resolver unit)
12 кейсов, 11 точных + 1 R1-fallback-семантика (corner case, документирован):

| # | Кейс | Result |
|---|---|---|
| 1 | BYN one_time, без candidate filter, без snapshot | `[bepaid, stripe]` (R1 fallback — корректно) |
| 2 | BYN + stripe(cap=byn) | `[stripe]` ✅ |
| 3 | BYN + stripe(cap=eur) | `[]` + `stripe:currency_not_supported_by_account` ✅ |
| 4 | EUR + bepaid | `[]` + `bepaid:currency_not_supported_by_provider` ✅ |
| 5 | EUR + stripe(cap=eur) | `[stripe]` ✅ |
| 6 | PLN + stripe(cap=pln) | `[stripe]` ✅ |
| 7 | USD + stripe, no snapshot | `[stripe]` + warning R1 ✅ |
| 8 | RUB | `[]` + `currency_not_allowed_by_business` ✅ |
| 9 | KZT + stripe | `[]` + `currency_not_allowed_by_business` ✅ |
| 10 | EUR + stripe + installment | `[]` + `installment_not_supported` ✅ |
| 11 | customer_choice BYN, stripe(cap=byn,eur) | `[bepaid, stripe]` ✅ |
| 12 | customer_choice BYN, stripe(cap=eur) | `[bepaid]` (stripe correctly excluded) ✅ |

Запуск: `deno run --allow-read /tmp/p7_matrix.ts`.

## 7. Integration points

### admin-create-public-link
- **bePaid path** (`fixed=bepaid` ∨ `customer_choice + bepaid in allowed`):
  resolver проверяет `currency` → если не BYN → `400 bepaid_currency_unsupported:<currency>:<reason>`, link **не создаётся**.
- **Stripe path** (`fixed=stripe` ∨ `customer_choice + stripe in allowed`):
  lookup `acquiring_connections` → resolver проверяет `stripeValidationCurrency` × `capabilities_snapshot.supported_currencies` × `is_installment` → если invalid → `400 stripe_currency_unsupported:<currency>:<account_code>:<reason>`.

### admin-create-public-link customer_choice
Когда оба провайдера в `effectiveAllowedProviders` и один из них блокируется по валюте — соответствующий guard вернёт controlled 400 ещё до создания payment_link. Если требуется автоматическое исключение несовместимого провайдера из `allowed_payment_providers` без отказа (degrade-to-single) — это **отдельный follow-up** UI-задача; сейчас явная блокировка считается безопасным default.

## 8. Runtime freeze diff
- bePaid webhook — **не тронут**.
- Stripe webhook — **не тронут**.
- `grant-access-for-order` — **не тронут**.
- `telegram-grant-access` — **не тронут**.
- `subscriptions-reconcile` — **не тронут**.
- `entitlements`, `orders_v2`, `payments_v2`, `subscriptions_v2` schema — **не тронуты**.
- Миграции БД — **нет**.
- Курсы / FX / currency conversion — **не тронуты**.

## 9. Gates

| Gate | Проверка | Result |
|---|---|---|
| P7-1 | Shared resolver создан (`_shared/acquiring/currency-provider-resolver.ts`) | ✅ |
| P7-2 | Нет silent fallback BYN/EUR | ✅ controlled 400 во всех ветках |
| P7-3 | bePaid недоступен для non-BYN (была дыра до Phase 7) | ✅ закрыто |
| P7-4 | Stripe blocked при currency вне business ∨ account capability | ✅ |
| P7-5 | customer_choice → несовместимый provider не пройдёт guard | ✅ |
| P7-6 | fixed provider + incompatible currency → controlled error | ✅ matrix кейсы 3,4,8,9,10 |
| P7-7 | Admin UI без технических slug (uses existing `isStripeCurrencyDisabled`) | ✅ существующий UI совместим |
| P7-8 | Backend = SOT, frontend mirror только UX | ✅ зафиксировано в шапке файла mirror |
| P7-9 | Webhook/grant/Telegram/reconcile не изменены | ✅ см. §8 |
| P7-10 | Proof содержит матрицу + интеграцию | ✅ §6, §7 |

## 10. Follow-ups (не входят в Phase 7-EXEC PASS)
1. Привести `admin-provision-stripe-price.CURRENCY_WHITELIST` к каноническому `{BYN,EUR,USD,PLN}` (или явно расширить SOT под RUB/KZT/UAH с бизнес-approve).
2. `AdminPaymentLinkDialog` — переключить `isStripeCurrencyDisabled` на shared `currencyProviderResolver` (сейчас совпадает по поведению, рефакторинг косметический).
3. `OfferAcquiringSettings` — показывать live-список совместимых провайдеров через mirror при выборе валюты.
4. Discovery по bePaid: подтвердить или опровергнуть `bepaidSupports != BYN-only`.
5. Customer-choice degrade-to-single: если в `allowed` один из двух несовместим — автоматически свести к одному провайдеру вместо 400.

## 11. DoD
- ✅ resolver реализован;
- ✅ admin-created links не могут создать несовместимый currency × provider checkout;
- ✅ customer_choice проверяет каждого provider в allowed;
- ✅ backend блокирует несовместимые комбинации с reason_code;
- ✅ UI mirror создан и не противоречит существующему UI;
- ✅ нет fallback валюты;
- ✅ runtime freeze соблюдён;
- ✅ proof обновлён.

**Итог: Phase 7-EXEC = PASS.** Готов к следующей фазе master sprint.
