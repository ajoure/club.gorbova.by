# да, согласен, с учетом правок:

1. **Не делать миграцию для уборки ORD-26-00127/00128.**  
Это разовая sandbox-уборка, не schema change. Сделать через отдельный SQL execute/dry-run с backup/returning, а не миграцией.
2. **Не требовать от агента “оплатить руками”, если среда Lovable блокирует внешний checkout.**  
Формулировка:
3. **Для manual checkout явно указать, что grant-access может быть skipped.**  
Если нет product/tariff/offer, доступ выдавать нельзя. Это нормально:
  &nbsp;
  ```text
  grant-access-for-order должен либо корректно skipped: manual_sandbox_no_entitlement, либо не вызываться.
  ```
  Нельзя требовать entitlement для ручного платежа без тарифа.
4. **В proof по BYN/RUB фиксировать не только JSON, но и endpoint/action.**  
Например:
5. **В DoD добавить zero-secrets check.**

```text
proof/logs не содержат pk_, sk_, whsec_, checkout full URL.
```

После этих правок план можно запускать.

&nbsp;

План: PATCH Stripe Phase 2 — Manual Sandbox Checkout + currency policy fix

## Проблема

1. Runtime proof Фазы 2 снова заблокирован из-за жёсткой зависимости формы от `products_v2 → tariffs → offers`. Если в каталоге не находится валидной связки product/tariff/offer — кнопка checkout остаётся неактивной.
2. Форма должна позволять создать ручную тестовую оплату даже без продукта/тарифа/offer.
3. Валютная логика неверно трактует BYN/RUB: edge function отбрасывает BYN до запроса в Stripe (`stripe_currency_not_supported`), хотя Stripe сам должен решать, принимать ли валюту.
4. Нужно различать три разные сущности:
  - валюту выставленного счёта (charge / presentment currency в Stripe);
  - валюту карты клиента (банк клиента сам конвертирует);
  - settlement currency Stripe-аккаунта.
5. В БД остались мусорные pending-заказы `ORD-26-00127` (BYN 100) и `ORD-26-00128` (BYN 4500), созданные без Stripe Checkout Session.

## Решение

### 1. UI — `StripeSandboxCheckoutDialog`

Добавить переключатель режимов в верх формы:

- **По продукту/тарифу** — текущий flow через `products_v2`.
- **Ручная тестовая оплата** — новый flow, основной fallback.

В ручном режиме обязательные поля и только они:

- Название платежа (`description`);
- Сумма (`amount`);
- Валюта (`currency`);
- Email покупателя (`customer_email`).

Whitelist валют в UI (Select): `USD`, `EUR`, `PLN`, `BYN`, `RUB`. Никакого GBP.

Заменить текущее жёлтое предупреждение про BYN на нейтральную подсказку под полем валюты:

> Stripe принимает валюту платежа отдельно от валюты карты. Если валюта платежа отличается от валюты карты или валюты вывода средств, Stripe или банк клиента может выполнить конвертацию.

Кнопка «Создать Checkout» в ручном режиме активна, как только заполнены 4 обязательных поля. Никакой зависимости от продукта/тарифа/offer.

### 2. Backend — `stripe-admin-sandbox-checkout`

- Расширить input schema: `mode: 'catalog' | 'manual'`. Для `manual` — `{ description, amount, currency, customer_email }`.
- `ALLOWED_CURRENCIES = ['USD','EUR','PLN','BYN','RUB']` — общий whitelist для обоих режимов.
- **Снять предварительную блокировку BYN/RUB.** Передавать валюту прямо в `stripe.checkout.sessions.create`.
- Если Stripe API возвращает ошибку валюты (`StripeInvalidRequestError`, param `currency` / message содержит `currency`), маппить в:
  ```json
  { "ok": false, "code": "stripe_currency_rejected_by_stripe", "stripe_message": "<safe message>" }
  ```
  Никаких ключей/секретов в ответе.
- **Порядок создания записей (исправление мусорных pending):**
  1. Валидация input.
  2. Резолв profile/user_id по email (как сейчас).
  3. Попытка создать Stripe Checkout Session.
  4. Только при успехе (`cs_*` получен) — `INSERT orders_v2` со `status='pending'`, `provider='stripe'`, `provider_payment_id=cs_id`, `meta.sandbox=true`, `meta.checkout_mode='manual'|'catalog'`.
  5. Если Stripe вернул ошибку — `orders_v2` НЕ создаётся вовсе; вернуть ошибку клиенту. (Альтернатива: если order уже создан для трассировки — сразу проставить `status='failed'`, `meta.sandbox_aborted=true`, `meta.abort_reason='stripe_currency_rejected_by_stripe'`. Выбираем первый вариант — не плодить failed-мусор.)

### 3. Уборка мусора

Пометить существующие `ORD-26-00127`, `ORD-26-00128`:

```sql
UPDATE orders_v2
SET status = 'failed',
    meta = meta
      || jsonb_build_object(
        'sandbox_aborted', true,
        'abort_reason', 'stripe_currency_not_supported_legacy_pre_patch'
      )
WHERE order_id IN ('ORD-26-00127','ORD-26-00128');
```

### 4. Runtime proof (обязательный)

Один зелёный сценарий выполняется руками агента:

- Режим: ручная тестовая оплата.
- Сумма: 10.
- Валюта: USD (или EUR).
- Email: `7500084@gmail.com`.
- Открыть Stripe Checkout по возвращённой URL.
- Оплатить картой `4242 4242 4242 4242`.
- Проверить:
  - `orders_v2` → `status='paid'`, `provider='stripe'`, `meta.sandbox=true`;
  - `payments_v2` → запись с `provider='stripe'`, `status='succeeded'`;
  - `provider_events` → событие из webhook, `processed=true`;
  - `grant-access-for-order` отработал (entitlement выдан, либо для manual без tariff — корректно залогирован skip).

### 5. Дополнительная фактическая проверка BYN/RUB

Отдельные два вызова через ту же форму:

- ручной checkout, 10 BYN, email `7500084@gmail.com` — зафиксировать фактический ответ Stripe API;
- ручной checkout, 10 RUB, email `7500084@gmail.com` — зафиксировать фактический ответ Stripe API.

Никаких теоретических рассуждений: в proof кладём реальный JSON ответа (без секретов).

### 6. Freeze zones (не трогать)

- bePaid и все его edge functions;
- `create-payment-checkout.ts`;
- публичные `payment_links` и `/pay/:token`;
- обычное создание ссылок из карточки контакта;
- любой код вне `StripeSandboxCheckoutDialog` и `stripe-admin-sandbox-checkout`.

## DoD

- В форме «Тестовая оплата Stripe» работает режим ручной тестовой оплаты без product/tariff/offer.
- В UI валюты: `USD`, `EUR`, `PLN`, `BYN`, `RUB`. GBP отсутствует.
- BYN/RUB не блокируются до запроса в Stripe; решение принимает сам Stripe API.
- При отказе Stripe возвращается понятный код `stripe_currency_rejected_by_stripe` с safe-message.
- Pending-orders без Stripe Checkout Session больше не создаются.
- Мусорные `ORD-26-00127`, `ORD-26-00128` помечены `failed` + `meta.sandbox_aborted=true`.
- Зелёный сценарий (USD/EUR, карта 4242) выполнен: `orders_v2.paid` + `payments_v2(succeeded)` + `provider_events.processed`.
- Зафиксированы фактические ответы Stripe API на BYN и RUB.
- Proof: `.lovable/proofs/stripe_phase_2_manual_sandbox_checkout_currency_fix.md`.

## Технические детали

**Файлы:**

- `src/components/admin/integrations/StripeSandboxCheckoutDialog.tsx` — добавить tabs `catalog | manual`, manual-форму, обновлённый currency whitelist + подсказку.
- `supabase/functions/stripe-admin-sandbox-checkout/index.ts` — поддержка `mode='manual'`, снятие предварительной блокировки BYN/RUB, маппинг Stripe-ошибки в `stripe_currency_rejected_by_stripe`, перенос `INSERT orders_v2` после успешного `sessions.create`.
- Миграция-уборка `ORD-26-00127`, `ORD-26-00128`.
- `.lovable/proofs/stripe_phase_2_manual_sandbox_checkout_currency_fix.md` — runtime proof с тремя API-ответами (USD/EUR success + BYN actual + RUB actual).

**Не меняем:** schema `orders_v2/payments_v2/provider_events`, `grant-access-for-order`, webhook `stripe-webhook`.