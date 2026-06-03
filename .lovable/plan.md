да, согласен, с учетом правок:

1. **BYN оставить в UI, но добавить backend fallback-проверку Stripe.**
  &nbsp;
  В `stripe-admin-sandbox-checkout` при ошибке Stripe по валюте BYN вернуть понятный код:
  ```text
  stripe_currency_not_supported
  ```
  Сообщение:
2. **В proof не писать полный Checkout URL, если он содержит чувствительные session-параметры.**
  &nbsp;
  Достаточно:
3. **Email fallback уточнить.**
  &nbsp;
  Если email пустой:
  - использовать email текущего admin-пользователя;
  - если его нет — разрешить checkout без email, если Stripe API допускает;
  - иначе вернуть понятную ошибку `buyer_email_required`.
4. **Добавить проверку minor units.**
  &nbsp;
  Backend должен конвертировать major units в minor units:
  ```text
  10.50 USD → 1050
  ```
  Для валют с разными правилами округления использовать существующий/новый helper, не делать на глаз строковой конкатенацией.
5. **DoD дополнить:**

```text
- сумма 10.50 корректно уходит в Stripe как 1050 minor units;
- ошибка неподдерживаемой валюты BYN возвращается понятно;
- в proof нет полного checkout URL и нет секретов.
```

После этих правок план можно запускать.

&nbsp;

План: Фикс admin-only Stripe Sandbox Checkout (Фаза 2)

Скоуп: только `src/components/admin/integrations/StripeSandboxCheckoutDialog.tsx` и `supabase/functions/stripe-admin-sandbox-checkout/index.ts`. Никаких изменений в bePaid, `create-payment-checkout.ts`, public `payment_links`, обычном flow «Ссылка на оплату», Stripe webhook/idempotency/refund.

## 1. Продукты (только те, у кого есть активные офферы)

Заменить простой `from('products')` на двухшаговую загрузку:

1. выбрать все `tariff_offers` где `is_active=true AND offer_type='pay_now'`, взять `tariff_id`;
2. по этим `tariff_id` взять `tariffs (id, product_id) where is_active=true`;
3. по полученным `product_id` загрузить `products(id, name) where is_active=true`, отсортировать по `name`.

В UI:

- placeholder «Выберите продукт» — никакого автоподстановления (state стартует пустой строкой; убедиться, что нет дефолтного `setProductId`).
- если список пуст — disabled select + подсказка «Нет продуктов с активными офферами».

## 2. Тарифы

После выбора продукта грузить только тарифы с активными `pay_now` офферами:

- `tariffs.select('id, product_id, name').eq('product_id', productId).eq('is_active', true).order('display_order')`;
- затем отфильтровать по `tariff_offers (tariff_id in …, is_active=true, offer_type='pay_now')`.

Если результат пуст — рендерить в SelectContent disabled-строку «У продукта нет активных тарифов».

## 3. Offer (кнопка оплаты)

После выбора тарифа:

- грузить `tariff_offers` как сейчас (`is_active=true`, `offer_type='pay_now'`, `order('sort_order')`);
- если массив непуст — автоматически `setOfferId(offers[0].id)`;
- если пуст — показать checkbox «Sandbox fallback: ввести сумму вручную» и при включении разрешить submit без `offer_id` (см. §6 и backend §B).

## 4. Валюты

В UI: `const CURRENCIES = ['USD','EUR','PLN','BYN']` — убрать GBP, не добавлять RUB.

В edge: `ALLOWED_CURRENCIES = new Set(['USD','EUR','PLN','BYN'])`.

## 5. BYN warning

Если `currency === 'BYN'` — под селектом валюты показывать:
«BYN выбран как бизнес-валюта. Stripe может конвертировать/обработать валюту в зависимости от настроек аккаунта. Если Stripe отклонит валюту, checkout вернёт ошибку.»
(жёлтый бордер `border-yellow-500/40 bg-yellow-500/10`, без блокировки кнопки).

## 6. Сумма

Поле «Сумма» больше не readOnly:

- при выборе offer — автозаполнить значением `offer.amount` (через `useEffect`) и держать поле редактируемым;
- если offer нет (sandbox fallback включён) — пустое поле, ручной ввод;
- валидация: `Number(amount) > 0`; иначе hint «Сумма должна быть больше 0» и блок кнопки.

State: `const [amount, setAmount] = useState<string>('')`.

## 7. Email

Валидация лёгкой regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. Пустой email допустим (используется `user.email` на бэке). Если введён и невалиден — inline ошибка + блок кнопки.

## 8. Кнопка submit

`canSubmit = !!connection && !!productId && (!!offerId || sandboxFallback) && currency && amountValid && emailValid && !submitting`.

В payload edge-функции добавить `amount` (число, major units) — backend будет использовать его как override.

## A. Backend изменения (минимально, add-only)

`supabase/functions/stripe-admin-sandbox-checkout/index.ts`:

- whitelist валют → `USD/EUR/PLN/BYN`;
- принимать опциональный `amount?: number` и опциональный `offer_id?: string` (если оба отсутствуют → 400 `missing_amount_or_offer`);
- если `offer_id` есть — сохранять текущую валидацию tariff/offer match;
- если `offer_id` отсутствует и передан `amount` (>0) — режим sandbox fallback:
  - не делать lookup `tariff_offers`;
  - использовать `offer_id=null` в `orders_v2`;
  - в `meta` добавить `sandbox_fallback: true, manual_amount: true`;
- если `amount` передан вместе с `offer_id` и отличается от `offer.amount` — использовать переданный `amount`, в `meta` записать `amount_override: true, original_offer_amount`;
- остальные guard'ы (super_admin, test_mode, account_code) — без изменений.

## DoD / Proof

После реализации проверить вручную:

1. dropdown «Продукт» — только продукты с активными offers;
2. «Тариф» открывается и показывает корректный список;
3. «Кнопка оплаты» автоматически выбирает первую;
4. Валюты: USD/EUR/PLN/BYN, GBP отсутствует;
5. BYN показывает warning;
6. Сумма автоподтягивается и редактируется;
7. Кнопка активна при валидных данных;
8. Создаётся `orders_v2` с `provider='stripe'`, `meta.sandbox=true`;
9. Открывается Stripe Checkout (`https://checkout.stripe.com/...`).

Proof-документ: `.lovable/proofs/stripe_phase_2_admin_sandbox_checkout_fix.md` — содержит чек-лист DoD, SQL-выборку нового sandbox order и URL Checkout session.

## Технические детали (для подрядчика)

Файлы:

- `src/components/admin/integrations/StripeSandboxCheckoutDialog.tsx` — переписать загрузку продуктов/тарифов, убрать readOnly, добавить amount/sandboxFallback/emailValid state, BYN warning, обновить `canSubmit`.
- `supabase/functions/stripe-admin-sandbox-checkout/index.ts` — обновить `ALLOWED_CURRENCIES`, добавить ветку `manual_amount`/`sandbox_fallback`, опциональный `offer_id`.

Freeze-зоны (не трогать):

- `supabase/functions/bepaid-*`
- `supabase/functions/_shared/create-payment-checkout.ts`
- `supabase/functions/stripe-create-checkout/index.ts`
- `supabase/functions/stripe-webhook*`
- `payment_links`, `CreatePublicLinkDialog`.