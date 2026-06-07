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

Результат записывается в этот файл как provider support matrix.

**Гипотеза до проверки** (не вывод, не PASS): EUR/PLN/USD *могут быть* допустимы Stripe Poland; BYN/RUB *могут быть* недоступны. Финальная классификация — только после Stripe API discovery в Phase 7-EXEC.

Разделение слоёв (заполняется по факту):

| Currency | provider_supported (Stripe theoretical / PL country_specs) | account_enabled (capabilities нашего account) | business_allowed (whitelist) | final_allowed |
|---|---|---|---|---|
| EUR | TBD | TBD | yes | TBD |
| PLN | TBD | TBD | yes | TBD |
| USD | TBD | TBD | yes | TBD |
| BYN | TBD (ожидание: no) | TBD | yes | TBD |
| RUB | TBD (ожидание: no) | TBD | yes | TBD |

Per-PM (заполняется в EXEC):

| Currency | card | blik | p24 | sepa_debit | apple_pay | google_pay |
|---|---|---|---|---|---|---|
| EUR | TBD | TBD | TBD | TBD | TBD | TBD |
| PLN | TBD | TBD | TBD | TBD | TBD | TBD |
| USD | TBD | TBD | TBD | TBD | TBD | TBD |
| BYN | — | — | — | — | — | — |
| RUB | — | — | — | — | — | — |

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

## 6. Поведение при отсутствии provider для валюты

**STOP-правило (канон Phase 7):** если ни один provider не поддерживает выбранную валюту — checkout блокируется, валюта silent-fallback'ом не меняется. UI показывает понятную ошибку и предлагает админу либо сменить валюту, либо подключить нужный provider.

Запрещено: silent fallback `currency unsupported → BYN/EUR by default`. См. `phase_7_currency_provider_resolver_v1.md` §6.

## 7. DoD discovery (выполняется в Фазе 1)
- ✅ Таблица в §2 заполнена реальными данными из Stripe API.
- ✅ Список фактически активированных PM зафиксирован в `acquiring_accounts.metadata.capabilities` (на будущее).
- ✅ Подтверждено или опровергнуто, доступен ли BYN/RUB через `Adaptive Pricing`.
- ✅ Settlement currency аккаунта зафиксирована.
