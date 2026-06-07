# Phase 7 — Currency Provider Resolver: Spec (discovery-only)

Дата: 2026-06-07. **Spec-only.** В этом спринте Phase 7 не меняет runtime, checkout, webhook, UI и БД.

## 1. Цель
Единый резолвер, отвечающий на вопрос: «какие платёжные провайдеры доступны для валюты X на акквайринговом аккаунте Y».

## 2. Подпись
```ts
type Provider = 'bepaid' | 'stripe';

type ReasonCode =
  | 'currency_not_supported_by_provider'   // (1) provider technically does not support currency
  | 'currency_not_supported_by_account'    // (2) Stripe account capability missing
  | 'currency_not_allowed_by_business'     // (3) business whitelist forbids
  | 'provider_not_configured'              // нет acquiring_connection
  | 'provider_disabled'                    // connection.is_active=false
  | 'missing_shop_id'                      // bePaid: нет shop_id для валюты
  | 'missing_account_code';                // Stripe: не определён account

type DisabledProvider = {
  provider: Provider;
  reason_code: ReasonCode;
  message: string;
  source: 'provider_static' | 'stripe_account_capabilities' | 'business_whitelist' | 'acquiring_connections';
};

resolveAvailableProviders(input: {
  currency: string;          // ISO-4217: 'BYN' | 'EUR' | 'PLN' | 'USD' | 'RUB'
  offer_id?: string;
  account_code?: string;
  payment_type?: 'one_time' | 'subscription';
}): {
  availableProviders: Provider[];
  disabledProviders: DisabledProvider[];
  warnings: string[];
}
```

## 3. Псевдокод
```ts
function resolveAvailableProviders({ currency, offer_id, account_code, payment_type }) {
  const available: Provider[] = [];
  const disabled: DisabledProvider[] = [];

  for (const p of ['bepaid', 'stripe'] as Provider[]) {
    const provider_supported = providerStaticSupports(p, currency);
    const account_enabled    = accountSupports(p, currency, account_code);
    const business_allowed   = businessWhitelist(p, currency);
    const final_allowed      = provider_supported && account_enabled && business_allowed;

    if (final_allowed) {
      available.push(p);
    } else {
      disabled.push({
        provider: p,
        reason_code: !business_allowed ? 'currency_not_allowed_by_business'
          : !provider_supported ? 'currency_not_supported_by_provider'
          : 'currency_not_supported_by_account',
        message: `Currency ${currency} unavailable for ${p}`,
        source: !business_allowed ? 'business_whitelist'
          : !provider_supported ? 'provider_static'
          : 'stripe_account_capabilities',
      });
    }
  }
  return { availableProviders: available, disabledProviders: disabled, warnings: [] };
}
```

Разделение источников:
- **provider_supported** — технически поддерживается провайдером (Stripe Poland / bePaid).
- **account_enabled** — доступно конкретному акквайринговому аккаунту (Stripe `capabilities`, bePaid `shop_id`).
- **business_allowed** — разрешено бизнес-логикой проекта (whitelist).
- **final_allowed = provider_supported && account_enabled && business_allowed**.

## 4. Три уровня источника истины для Stripe
Финальный резолвер — пересечение:
1. **Валюты, которые Stripe Poland теоретически поддерживает** (Stripe docs / `GET /v1/country_specs/PL`).
2. **Валюты, реально доступные конкретному Stripe account** (capabilities из `GET /v1/account` + активные PM в `GET /v1/payment_method_configurations`).
3. **Валюты, разрешённые бизнесом проекта** (бизнес-whitelist: EUR, PLN, USD, BYN, RUB).

`stripeAccountSupports(currency, code) = (1) ∩ (2) ∩ (3)`.

## 5. bePaid — текущая гипотеза
`bepaidSupports(currency)`:
- Phase 7 Discovery: BYN — **текущее known-supported значение** (подтверждается реальными payments_v2: 5978 строк BYN).
- НЕ закладывать постоянный hardcode без proof по существующим настройкам bePaid (`shop_id`, plans).
- Все прочие валюты — `false` до отдельного discovery.

## 6. STOP-логика (обязательная)
Если `resolveAvailableProviders(currency) = []`:
- Public checkout — **blocked** (`HTTP 200 fallback:true` + error message).
- Admin UI — показать понятную ошибку («Валюта X не поддерживается ни одним подключённым провайдером»).
- **Никакого silent fallback** на BYN/EUR.
- **Никакой автоматической смены** валюты offer/link без явного действия администратора.

## 7. UI-поведение (под EXEC-фазу, не сейчас)
- Селектор валюты показывает **весь бизнес-whitelist** (5 валют).
- Валюты с пустым `resolveAvailableProviders` — `disabled` + tooltip с причиной.
- Валюты с одним provider — авто-выбор этого provider, скрытие переключателя.
- Валюты с двумя providers — customer choice по Phase 5-D контракту.

## 8. Discovery API (как наполнить уровень 2)
Использовать существующий `admin-payments-diagnostics`, **если он уже поддерживает read-only Stripe capability checks**.

Если не поддерживает — **НЕ создавать** новый helper в этом спринте без отдельного mini-plan. Зафиксировать как open question / follow-up для Phase 7-EXEC.

Запросы (только в EXEC-фазе):
- `GET /v1/account` → `capabilities`, `settlement_currency`, `country`.
- `GET /v1/country_specs/PL` → `supported_presentment_currencies`, `supported_payment_methods`.
- `GET /v1/payment_method_configurations` → активные PM.

Результат → `.lovable/discovery/stripe_currency_support_v1.md` §2.

## 9. Точки внедрения (UI impact map, для EXEC)
| Слой | Файл | Изменение |
|---|---|---|
| Shared (edge) | `supabase/functions/_shared/acquiring/currency-provider-resolver.ts` | новый модуль (псевдокод §3) |
| Shared (frontend) | `src/utils/currencyProviderResolver.ts` | зеркало для UI |
| **Product/Offer editor** | `OfferAcquiringSettings.tsx` / Product editor | селектор валюты оффера: сразу показывать какие provider будут available/disabled с reason |
| UI admin link | `AdminPaymentLinkDialog.tsx` | резолвер вместо `STRIPE_CURRENCY_OPTIONS`; авто-фильтр provider по currency; override валидируется |
| UI public | `src/components/payments/PaymentDialog.tsx` / `PublicPayPage` | customer choice только из совместимых; если 1 provider — без выбора |
| Edge | `public-checkout/index.ts` | заменить fallback `EUR/BYN` на STOP-логику §6 |
| Edge | `stripe-create-subscription-checkout` | pre-check currency × Stripe account |
| Edge | bePaid checkout helper | pre-check currency × shop_id |

## 10. Не входит в Phase 7-EXEC
- Adaptive Pricing Stripe.
- Settlement vs presentment курсы.
- bePaid поддержка валют ≠ BYN.
- Кросс-валютная подписка (Stripe EUR → BYN payout).

## DoD Phase 7 Discovery (spec)
- [x] Подпись резолвера.
- [x] Псевдокод.
- [x] Три уровня источника истины.
- [x] STOP-логика.
- [x] Точки внедрения зафиксированы.
- [x] Никаких изменений кода / БД / runtime.
