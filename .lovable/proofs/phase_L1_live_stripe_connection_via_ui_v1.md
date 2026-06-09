# Phase L-1 Proof — Live Stripe Connection via UI

Дата: 2026-06-09
Решение: **PASS**

## Что подтверждено
1. Stripe live connection создан **через существующий UI**
   `/admin/integrations/payments` → `StripeConnectionDialog` →
   `acquiring-save-connection`.
2. Секреты (`secret_key`, `webhook_signing_secret`) сохранены через
   существующий flow: edge function → RPC `admin_save_acquiring_secret`
   → Vault. Браузер ключи обратно не получает.
3. **Ручные Supabase secrets не использовались.** `secrets--add_secret` не
   вызывался. Прямой INSERT в `acquiring_connections` / Vault не делался.
4. `stripe_poland` live connection активен:

```
provider | account_code  | account_name        | test_mode | is_default | status | last_verified_at
stripe   | stripe_poland | Stripe - Gorbova.pl | false     | true       | active | 2026-06-09 09:36:27+00
```

5. `test_mode=false` подтверждён (live keys сохранены).
6. `is_default=true` подтверждён и принят пользователем (variant A).
7. bePaid connection не изменён:

```
provider | alias                 | status     | is_default | shop_id | test_mode
bepaid   | bePaid  - ажур инкам  | connected  | true       | 33524   | false
```

8. Existing offer/button settings не изменены: ни одной строки
   `tariff_offers.meta.acquiring` не трогали.

## Пояснение по is_default=true (variant A)

> Stripe live default account is accepted. It only defines default Stripe
> account resolution after Stripe provider is selected. It does not enable
> Stripe globally for all offers. Offer/button allowed providers remain the
> business gate.

Фактическое использование Stripe на публичных кнопках регулируется:
1. настройками конкретной кнопки / offer;
2. `tariff_offers.meta.acquiring.allowed_payment_providers`;
3. ручным admin override при создании ссылки из карточки контакта.

`is_default=true` влияет только на резолвер «какой Stripe-аккаунт взять»,
когда Stripe уже выбран как provider для данной операции.

## Что НЕ сделано (по policy)
- Не использовался `secrets--add_secret`.
- Не делался ручной INSERT в `acquiring_connections` / Vault.
- Не снимался `is_default` со Stripe.
- Не менялся default на bePaid.
- Не менялись `tariff_offers.meta.acquiring` массово.
- Не запускались protective updates.

## Verdict
**Phase L-1 = PASS.** Live Stripe connection доступен и сохранён каноническим
путём через UI интеграций. Готовы к L-2.
