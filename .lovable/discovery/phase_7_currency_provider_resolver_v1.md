# Phase 7 — Currency Provider Resolver: Spec (discovery-only)

Дата: 2026-06-07. **Spec-only.** В этом спринте Phase 7 не меняет runtime, checkout, webhook, UI и БД.

## 1. Цель
Единый резолвер, отвечающий на вопрос: «какие платёжные провайдеры доступны для валюты X на акквайринговом аккаунте Y».

## 2. Подпись
```ts
type Provider = 'bepaid' | 'stripe';

resolveAvailableProviders(input: {
  currency: string;          // ISO-4217: 'BYN' | 'EUR' | 'PLN' | 'USD' | 'RUB'
  tariff?: TariffOffer;      // для будущих per-tariff ограничений
  account?: AcquiringConnection;  // { code, capabilities? }
}): Provider[]
```

## 3. Псевдокод
```ts
function resolveAvailableProviders({ currency, tariff, account }) {
  const providers: Provider[] = [];
  if (bepaidSupports(currency)) providers.push('bepaid');
  if (stripeAccountSupports(currency, account?.code ?? 'stripe_poland')) {
    providers.push('stripe');
  }
  return providers;
}
```

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

## 9. Точки внедрения (для EXEC)
| Слой | Файл | Изменение |
|---|---|---|
| Shared (edge) | `supabase/functions/_shared/acquiring/currency-provider-resolver.ts` | новый модуль (псевдокод §3) |
| Shared (frontend) | `src/utils/currencyProviderResolver.ts` | зеркало для UI |
| UI offer | `OfferAcquiringSettings.tsx` | селектор валюты с disabled+tooltip |
| UI admin link | `AdminPaymentLinkDialog.tsx` | резолвер вместо `STRIPE_CURRENCY_OPTIONS` |
| UI public | `src/components/payments/PaymentDialog.tsx` | набор provider под `link.currency` |
| Edge | `public-checkout/index.ts` | заменить fallback `EUR/BYN` на STOP-логику §6 |

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
