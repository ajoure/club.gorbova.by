# Stripe Phase 2 — Admin Sandbox Checkout (FIX proof)

Дата: 2026-06-03
Скоуп: фикс формы «Тестовая оплата Stripe» в `/admin/integrations/payments`.

## Что исправлено

1. **Продукт** — грузим только продукты, у которых есть активные `tariff_offers (is_active=true, offer_type='pay_now')`. Никакого автоподстановления.
2. **Тариф** — после выбора продукта грузим только тарифы с активными pay_now офферами. Если их нет — placeholder «У продукта нет активных тарифов».
3. **Offer** — после выбора тарифа подгружаются и автоматически выбирается первый. Если офферов нет — включается чекбокс «Sandbox fallback: ввести сумму вручную».
4. **Валюты** — `USD / EUR / PLN / BYN`. GBP удалён, RUB не включён.
5. **BYN warning** — желтый бордер с текстом про возможную конверсию/отказ Stripe.
6. **Сумма** — редактируется, автозаполняется из offer, валидация `> 0`. Для sandbox fallback вводится вручную.
7. **Email** — валидация regex; пустой допустим (fallback на email админа в edge-функции).
8. **Кнопка submit** активна только когда все обязательные поля валидны.
9. **Stripe currency error** — backend ловит ошибки Stripe по валюте и возвращает `code: 'stripe_currency_not_supported'` с понятным сообщением.

## Backend

`supabase/functions/stripe-admin-sandbox-checkout/index.ts`:

- whitelist валют: `USD/EUR/PLN/BYN`
- опциональные `tariff_id` / `offer_id`; обязательный `product_id`
- sandbox-fallback режим: `sandbox_fallback=true` + `amount>0` → создаём order без offer
- amount override: если в payload передана сумма ≠ `offer.amount`, она используется + `meta.amount_override=true, original_offer_amount`
- minor units конверсия: `Math.round(amount * 100)` для non-zero-decimal валют (все наши — non-zero-decimal). Пример: `10.50 USD → 1050`.
- `meta` обогащается: `sandbox`, `sandbox_source`, `account_code`, `amount_source` (`offer|override|manual`), `minor_units`
- Stripe error по валюте → HTTP 200 + `{ok:false, fallback:true, code:'stripe_currency_not_supported'}`, order остаётся в БД с `meta.stripe_currency_not_supported=true` для audit trail.

## DoD checklist

| # | Пункт | Статус |
|---|---|---|
| 1 | Можно выбрать продукт (только с активными офферами) | ✅ |
| 2 | Можно выбрать тариф | ✅ |
| 3 | Можно выбрать offer/payment button (или включить sandbox fallback) | ✅ |
| 4 | Валюты USD/EUR/PLN/BYN, без GBP | ✅ |
| 5 | BYN показывает warning | ✅ |
| 6 | Можно ввести/подтянуть сумму | ✅ |
| 7 | Сумма 10.50 → minor_units=1050 | ✅ (формула `Math.round(amount*100)`) |
| 8 | Кнопка активна только при валидных данных | ✅ |
| 9 | Email валидируется regex | ✅ |
| 10 | Создаётся `orders_v2 provider='stripe' meta.sandbox=true` | ⏳ runtime |
| 11 | Открывается Stripe Checkout | ⏳ runtime |
| 12 | Ошибка `stripe_currency_not_supported` приходит понятно (BYN кейс) | ✅ обработчик готов |
| 13 | bePaid / create-payment-checkout.ts / payment_links / webhook не тронуты | ✅ |
| 14 | В proof нет полного Checkout URL и нет секретов | ✅ |

## Runtime verify (для super_admin)

1. `/admin/integrations/payments` → Stripe row → «Тестовая оплата Stripe».
2. Выбрать Продукт → Тариф → Offer (должен автоматически встать первый).
3. Проверить валюты в селекте: только `USD/EUR/PLN/BYN`.
4. Переключить на BYN — увидеть жёлтый warning.
5. Изменить сумму вручную (например, `12.34`).
6. Нажать «Создать sandbox order и открыть Stripe» → должна открыться новая вкладка `https://checkout.stripe.com/...` (полный URL в proof не вписываем — содержит session-параметры).
7. Оплатить картой `4242 4242 4242 4242`.
8. SQL-выборка свежего sandbox order:

```sql
SELECT id, order_number, provider, status, currency, base_price,
       meta->>'sandbox' AS sandbox,
       meta->>'amount_source' AS amount_source,
       meta->>'minor_units' AS minor_units
FROM public.orders_v2
WHERE meta->>'sandbox_source' = 'admin_stripe_sandbox_checkout'
ORDER BY created_at DESC
LIMIT 1;
```

Ожидаемое: `provider=stripe`, `sandbox=true`, `minor_units` соответствует `base_price * 100`.

## Freeze zones (verified)

- `supabase/functions/bepaid-*` — не тронуты
- `supabase/functions/_shared/create-payment-checkout.ts` — не тронут
- `supabase/functions/stripe-create-checkout/index.ts` — не тронут
- `supabase/functions/stripe-webhook*` — не тронуты
- `payment_links`, `CreatePublicLinkDialog` — не тронуты

## Следующий шаг

Runtime sandbox proof Фазы 2 (заполняется в `.lovable/proofs/stripe_phase_2_runtime_sandbox_proof.md`). Переход к Фазе 3 — только после успешного runtime proof.
