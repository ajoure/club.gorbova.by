# Discovery: поддержка валют Stripe

Дата: 2026-06-02.

## 1. Бизнес-whitelist валют
Поддерживаемые на стороне нашего продукта:
- EUR
- PLN
- USD
- BYN
- RUB

**Это бизнес-whitelist, не гарантия Stripe-поддержки.** Фактическая поддержка определяется discovery через Stripe API конкретного аккаунта.

## 2. Discovery-задача (Фаза 1)

В начале Фазы 1 выполнить тест-вызовы Stripe API на аккаунте Stripe Poland:

```
GET /v1/account                  → settlement currency, country, capabilities
GET /v1/country_specs/PL         → supported_presentment_currencies, supported_payment_methods
GET /v1/payment_method_configurations  → активные PM
```

Результат записывается в этот файл как таблица:

| Currency | card | blik | p24 | sepa_debit | apple_pay | google_pay | Supported by Stripe Poland |
|---|---|---|---|---|---|---|---|
| EUR | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| PLN | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| USD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| BYN | — | — | — | — | — | — | **ожидается: нет** |
| RUB | — | — | — | — | — | — | **ожидается: нет** |

(заполняется по факту выполнения discovery)

## 3. Принципы UI

- UI всегда показывает **полный бизнес-whitelist** (5 валют).
- Валюты, НЕ поддерживаемые Stripe-аккаунтом, помечаются disabled с tooltip: «Не поддерживается аккаунтом Stripe Poland. Используйте bePaid.»
- При попытке выбрать неподдерживаемую валюту + provider=stripe — UI автоматически предлагает переключиться на bePaid (если у тарифа есть bePaid-маппинг).

## 4. Архитектурное правило (важно)

❌ **НЕ предполагать**, что Stripe поддержит BYN/RUB.
✅ Архитектура поддерживает все 5 валют на уровне моделей и UI.
✅ Резолвер `resolveAvailableProviders(currency, tariff)` возвращает только тех провайдеров, кто реально поддерживает валюту.

```ts
function resolveAvailableProviders(currency: string, tariff: Tariff): Provider[] {
  const providers: Provider[] = [];
  if (bepaidSupports(currency)) providers.push('bepaid');
  if (stripeAccountSupports(currency, tariff.account_code ?? 'stripe_poland'))
    providers.push('stripe');
  return providers;
}
```

## 5. Settlement vs Presentment

- **Settlement currency** Stripe Poland = вероятно EUR или PLN (подтверждается discovery).
- **Presentment currency** = в чём показываем покупателю.
- Если presentment ≠ settlement, Stripe выполняет конверсию с комиссией (+2%) либо `Adaptive Pricing` (если включено).

## 6. Fallback на bePaid

Контракт: если валюта недоступна в Stripe, но доступна в bePaid (BYN/RUB), система **автоматически предлагает bePaid** в UI создания payment_link и в PaymentDialog. Никаких ошибок, никакого блока — просто переключение провайдера с тостом «Для этой валюты используется bePaid».

## 7. DoD discovery (выполняется в Фазе 1)
- ✅ Таблица в §2 заполнена реальными данными из Stripe API.
- ✅ Список фактически активированных PM зафиксирован в `acquiring_accounts.metadata.capabilities` (на будущее).
- ✅ Подтверждено или опровергнуто, доступен ли BYN/RUB через `Adaptive Pricing`.
- ✅ Settlement currency аккаунта зафиксирована.
