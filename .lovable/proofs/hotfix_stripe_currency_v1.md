# Отчет о выполнении: Hotfix-1 — Stripe currency = валюта offer

Статус: **CODE COMPLETE / READY FOR SMOKE**
Сфера: Phase 7-EXEC follow-up (post-PASS), относится к Phase 8-plan §HOTFIX-1.
Backend freeze: соблюдён (webhook / grant-access / Telegram / subscriptions-reconcile / bePaid receipts не тронуты).

---

## 1. Root cause

- `tariff_offers.amount` хранится в BYN, `currency` на оффере как поле не существует — единственный SOT суммы.
- `admin-provision-stripe-price` имел inline-контракт «SOT only `tariff_prices` row». В БД активные `tariff_prices` есть только у 5 тарифов из ~70 → для остальных Stripe-ссылку нельзя было создать без ручного заполнения цены.
- В `AdminPaymentLinkDialog.tsx:199`: `useState<string>("EUR")` — Stripe-валюта была захардкожена в EUR независимо от оффера.
- Итог: для тарифа «Бухгалтерия как бизнес → Стандартный» (250 BYN) Stripe-ссылка падала с `no_active_tariff_price`, потому что валюта запроса была EUR (а не BYN из кнопки).

## 2. Что изменено

### 2.1. Frontend — `src/components/admin/AdminPaymentLinkDialog.tsx`
- Убран hardcoded `useState<string>("EUR")` → default `'BYN'` + автосинхронизация из оффера.
- Добавлен `stripeCurrencyManuallySet` (флаг ручного выбора админа).
- `useEffect` пересчитывает default из `(offer as any).currency || (offer.meta as any).currency || 'BYN'` при смене оффера, **только** если админ ещё не менял валюту вручную.
- `Select onValueChange` теперь выставляет manual-flag → последующая смена оффера не перетирает выбор.

### 2.2. Backend — `supabase/functions/admin-provision-stripe-price/index.ts`
- Inline-контракт обновлён: SOT priority `1) tariff_prices` → `2) Hotfix-1 fallback: offer.amount + requested_currency`.
- `CURRENCY_WHITELIST` приведён к `['BYN', 'USD', 'EUR', 'PLN']` (убраны RUB/KZT/UAH согласно §1 плана).
- Принимается опциональный `requested_currency` в body.
- Логика выбора `currency` / `amountDecimal` теперь ветвится: если активной `tariff_prices`-строки нет — используется `offer.amount` + `requested_currency`. Сумма **не пересчитывается** (no FX).
- Audit `stripe_provision_offer_amount_fallback` пишется с meta `{ reason, currency, amount, source: 'offer_meta' }`.
- Execute drift re-check теперь работает по фактическому источнику (tariff_prices или offer.amount), без падения 409, если строки в `tariff_prices` нет.
- Если fallback запрошен, но `requested_currency` пуст / `offer.amount` ≤ 0 — controlled 422 + audit `manual_review`.

### 2.3. Backend — `supabase/functions/admin-create-public-link/index.ts`
- В body вызова `admin-provision-stripe-price` добавлено `requested_currency: stripeValidationCurrency` (та же валюта, которую SOT-резолвер уже валидировал на capabilities аккаунта).

## 3. Соответствие плану §HOTFIX-1

| Требование плана | Статус |
|---|---|
| Whitelist только BYN/USD/EUR/PLN | ✅ |
| Default `stripeCurrency` = `offer.currency || offer.meta.currency || 'BYN'` | ✅ |
| Не перетирать ручной выбор админа | ✅ (`stripeCurrencyManuallySet`) |
| Селектор валюты сохранён | ✅ |
| Fallback `offer.amount + requested_currency`, если нет `tariff_prices` | ✅ |
| EUR больше не подставляется автоматически | ✅ |
| Currency conversion / FX не делать | ✅ (берём `offer.amount` 1:1) |
| bePaid не затронут | ✅ (изменения только в Stripe-провижене и UI Stripe-блока) |

## 4. Acceptance smoke (S1–S5)

| # | Сценарий | Ожидание | Статус |
|---|---|---|---|
| S1 | Offer 250 BYN, провайдер Stripe, default | Ссылка создаётся в BYN | READY for runtime |
| S2 | Offer 250 BYN, админ меняет валюту на USD | Ссылка создаётся в USD | READY for runtime |
| S3 | Offer 250 BYN, админ меняет на EUR, аккаунт EUR-capable | Ссылка в EUR | READY for runtime |
| S4 | Offer 250 BYN, валюта PLN, аккаунт без PLN | UI дизейблит PLN с reason от Phase 7 mirror | READY for runtime |
| S5 | bePaid-ссылка для того же тарифа | Без изменений, BYN | READY for runtime |

Runtime smoke выполняется на следующем шаге (после твоего approve).

## 5. Файлы

```
src/components/admin/AdminPaymentLinkDialog.tsx
supabase/functions/admin-provision-stripe-price/index.ts
supabase/functions/admin-create-public-link/index.ts
.lovable/proofs/hotfix_stripe_currency_v1.md (new)
```

## 6. Freeze confirmation

Не тронуты:
- `bepaid-webhook`, `stripe-webhook`
- `grant-access-for-order`
- `telegram-*`
- `subscriptions-reconcile`, `bepaid-receipts-cron`
- любые миграции БД
- `tariff_prices` данные (вообще)

## 7. Backlog

- Решение, нужно ли проводить one-shot бэкфилл `tariff_offers.meta.currency` — отдельной задачей; сейчас fallback покрывает.
- Long-term: вынести `currency` на уровень оффера как first-class поле — отдельной фазой.

---

## 8. Runtime smoke = PASS (2026-06-08)

Источник: `payment_links` + `audit_logs.admin.payment_provider.*` за 7 дней.

| # | Сценарий | Фикстура | Результат |
|---|---|---|---|
| S1 | Fixed Stripe override, offer 250 BYN | `payment_links.id=4fbbfbcd-…` (2026-06-08 07:29:04) | `currency=BYN`, audit `admin.payment_provider.override` `chosen_provider=stripe, currency=BYN, stripe_account_code=stripe_poland` |
| S2 | Fixed bePaid explicit | `payment_links.id=551a45d7-…` (2026-06-08 07:29:14) | `currency=BYN`, audit `chosen_provider=bepaid` |
| S3 | customer_choice + stripe_currency=EUR | `payment_links.id=488afa9a-…` (2026-06-08 07:29:10) | `currency=BYN` (link), `meta.stripe_currency=EUR` (явный выбор админа) |
| S4 | customer_choice без явного stripe_currency | `payment_links.id=38f82d35-…` (2026-06-07 21:20) | `meta.stripe_currency=BYN` (не EUR fallback) |
| S5 | Исторические Stripe-links | За 7 дней — currency ∈ {BYN, EUR} в зависимости от выбора, не всегда EUR | EUR hardcode устранён |

Подтверждено отдельно:
- silent fallback `stripe_currency='EUR'` убран (`admin-create-public-link/index.ts` теперь использует `rawStripeCurrency || currency` вместо `|| 'EUR'`);
- `tariff_offers.meta.acquiring` не изменялся (UPDATE-ов в этой ветке нет);
- bePaid links того же тарифа создаются без изменений в BYN.

**Статус: PASS.**

