---
name: subscriptions_v2 schema contract
description: subscriptions_v2 не имеет колонок access_days/amount/currency; billing_type только mit|provider_managed; access_days живёт в tariffs.access_days и meta
type: constraint
---

`public.subscriptions_v2` — реальная схема:

- НЕ содержит колонок `access_days`, `amount`, `currency`. Любая попытка вставить эти поля как колонки → `PGRST204`.
- `billing_type` имеет CHECK: только `'mit'` или `'provider_managed'`. Значения `'internal_installment'`, `'installment'` и т.п. как значение колонки **запрещены** — используйте `'mit'` + `meta.model='internal_installment'`.
- Длительность доступа считается из `tariffs.access_days` или `purchase_snapshot.access_days`; для подписок-снимка дублируем в `subscriptions_v2.meta.tariff_access_days`.
- Сумма платежа лежит в `orders_v2.final_price` / `payments_v2.amount`; для удобства — `subscriptions_v2.meta.amount_byn` + `meta.currency`.

**Why:** в апреле 2026 `create-payment-checkout.ts` пытался вставить `access_days` колонкой и blokировал весь публичный checkout (`Failed to pre-create subscription`).

**How to apply:** при insert/update `subscriptions_v2` всегда писать только реально существующие колонки; всё дополнительное — в `meta`.
