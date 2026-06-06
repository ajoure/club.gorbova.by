# да, согласен, с учетом правок:

1. **Не делать прямой UPDATE для** `meta.smoke_test=true`

Пункт:

```text
Pending Stripe subscriptions_v2 + provider_subscriptions,
созданные шагом 4: пометить meta.smoke_test=true
через прямой DB update
```

убрать.

У нас действует правило:

```text
никаких ручных UPDATE бизнес-сущностей ради тестов
```

Достаточно:

```text
- payment_link.status='inactive'
- pending subscriptions остаются pending
- штатный cleanup их обработает
```

2. **Для Stripe subscription smoke дополнительно проверить отсутствие orders_v2**

Сейчас это критичный контракт.

Добавить отдельный gate:

```text
Stripe subscription smoke:

orders_v2 created before invoice.paid = 0
```

И приложить SQL proof.

Не ограничиваться формулировкой «не создан».

Нужен факт:

```sql
count(*) = 0
```

по конкретной тестовой связке.

3. **Для Stripe one-time smoke проверить наличие orders_v2**

Зеркальная проверка.

Нужен отдельный proof:

```text
orders_v2 pending provider='stripe' = 1
status='pending'
payment_link_id присутствует
```

4. **Проверить реальный redirect_url**

Не только факт успешного ответа.

Нужен proof:

```text
redirect_url starts with:

https://checkout.stripe.com/
```

для:

```text
- Stripe one-time
- Stripe subscription
```

5. **Для bePaid existing link проверить именно legacy link**

Не новую ссылку.

Использовать существующую:

```text
8be717eacdee2ccb6c3898186dad7124
```

которую уже указал в плане.

Это лучший non-regression тест.

6. **Проверка provider routing**

Добавить в runtime proof отдельный раздел:

```text
payment_links.provider='bepaid'
→ public-checkout
→ bePaid

payment_links.provider='stripe'
→ public-checkout
→ Stripe
```

с реальными id ссылок.

7. **GBP удалить не только из UI**

Проверить:

```text
AdminPaymentLinkDialog
admin-create-public-link
```

Чтобы backend тоже не принимал GBP.

Иначе можно получить ссылку через API.

8. **Если Stripe-eligible offer только один**

Дополнительно зафиксировать в proof:

```text
Gorbova Club / CHAT
offer_id=6f306cbc-...
```

как единственную текущую Stripe subscription fixture.

Это важно для следующих спринтов, чтобы потом не искать, почему остальные тарифы недоступны.

После этих правок план можно выполнять.

&nbsp;

PATCH 4.1.1 — Provider routing: валюты + Stripe subscription offers + runtime smoke

## 1. Проблема (Diagnose)

Текущее состояние формы создания публичной ссылки (`AdminPaymentLinkDialog`) и writer'а `admin-create-public-link`:

1. В UI селекторе валют присутствует **GBP**, а также по требованию нужно ограничить набор до **BYN / EUR / USD / PLN**.
2. В whitelist backend `STRIPE_ALLOWED_CURRENCIES` шире набора (GBP/CHF/CZK/RON) — рассинхрон с UI.
3. Валюта не валидируется против фактических `capabilities_snapshot.supported_currencies` выбранного Stripe-аккаунта. Для `stripe_poland` SOT уже содержит список (включая `byn`, `eur`, `usd`, `pln`), но UI его не использует.
4. При Stripe + Subscription, если у выбранной по дефолту «кнопки» нет `meta.stripe.price_id`, оператор видит ошибку «У выбранной кнопки нет привязанного Stripe Price ID» — UI не фильтрует кнопки и не блокирует невалидный выбор. По данным БД: 5 активных recurring pay_now-офферов, **только 1** содержит `meta.stripe.price_id` (Gorbova Club / CHAT, offer `6f306cbc-…`).
5. Runtime smoke по 4 сценариям ссылок и admin Stripe subscription checkout ещё не сделан.

Не в scope: `stripe-webhook`, `grant-access-for-order`, bePaid webhook, Telegram, миграции, GitHub Actions, новые public Stripe endpoints.

## 2. Решение

### 2.1. Whitelist валют (SOT)

- **Backend** `supabase/functions/admin-create-public-link/index.ts`:
  - `STRIPE_ALLOWED_CURRENCIES` → `Set(['BYN','EUR','USD','PLN'])`.
  - Дополнительно: после резолва Stripe-аккаунта валидировать `currency.toLowerCase() ∈ acquiring_connections.capabilities_snapshot.supported_currencies` (массив строк). Если не входит — 400 `stripe_currency_not_supported_by_account` с `account_code` в `detail`.
- **Frontend** `AdminPaymentLinkDialog.tsx`:
  - Удалить пункт `<SelectItem value="GBP">`.
  - Подтянуть из загруженного `stripeAccounts` `capabilities_snapshot.supported_currencies` выбранного `stripeAccountCode`. Для каждого `<SelectItem>` BYN/EUR/USD/PLN — атрибут `disabled` если валюта не входит в supported для текущего account_code. Tooltip / описание: «Не поддерживается аккаунтом ‹account_code›».
  - Если текущая `stripeCurrency` стала disabled при смене account_code — автоматически переключить на первую доступную из BYN/EUR/USD/PLN.
  - Расширить query `acquiring-connections-stripe-active` на `capabilities_snapshot`.

### 2.2. Stripe subscription: фильтр кнопок по price_id

- В `AdminPaymentLinkDialog.tsx`:
  - Ввести производный `stripeEligibleOffers = activeOffers.filter(o => !!o.meta?.stripe?.price_id)` (используется только когда `provider === 'stripe'` и `paymentType === 'subscription'`).
  - Селектор «Кнопка оплаты»:
    - bePaid или Stripe + one_time → как сейчас (`activeOffers`).
    - Stripe + subscription → рендерить только `stripeEligibleOffers`. Каждый item: показывать бейдж «Stripe price_id ✓».
  - Резолвер по умолчанию (`resolveCanonicalOffer`) для Stripe+subscription — выбирать первый валидный из `stripeEligibleOffers` (через предварительную фильтрацию входа); если их нет — вернуть `ok:false reason:'no_stripe_subscription_offers'` с сообщением «У этого тарифа нет настроенной кнопки для Stripe-подписки. Используйте bePaid или добавьте Stripe Price в настройках кнопки».
  - Убрать показ красной строки `stripeSubscriptionPriceMissing` как причины «error возвращается оператору» — теперь это состояние недостижимо, потому что выбрать невалидную кнопку нельзя; оставить guard как paranoia-check + дизейбл кнопки создания.
  - При смене `paymentType` на subscription или провайдера на stripe — сбросить `selectedOfferId` если он не в `stripeEligibleOffers`, чтобы автоселект сработал.

### 2.3. Writer параллельно — без изменения контракта

- `admin-create-public-link` дополнительно проверяет: если `provider==='stripe' && payment_type==='subscription'` и `offer_id` валиден, но `meta.stripe.price_id` отсутствует — оставить текущий 400 `stripe_price_missing_in_offer_meta` (defence-in-depth, UI этот путь больше не вызывает).

### 2.4. Runtime smoke (выполняется после кода)

На аккаунте `7500084@gmail.com` (admin/super_admin), preview-окружение:

1. **bePaid existing public link** — открыть существующую `https://club.gorbova.by/pay/8be717eacdee2ccb6c3898186dad7124` (provider=bepaid, one_time). Подтвердить: страница рендерится, `GET public-checkout?token=…` возвращает `provider:"bepaid"`, кнопка «Оплатить» доступна. Оплату не запускаем.
2. **bePaid new public link** — через AdminPaymentLinkDialog создать новую bePaid one_time ссылку на Gorbova Club / любой тариф. Подтвердить `payment_links.provider='bepaid'`, `account_code IS NULL`, открытие `/pay/:token` → `GET` возвращает корректные данные. Удалить тестовую ссылку через admin-invalidate-payment-link (status='inactive').
3. **Stripe one-time public link** — создать ссылку Stripe + one_time (account_code=stripe_poland, currency=EUR, любой тариф с любой кнопкой). Подтвердить `payment_links.provider='stripe', account_code='stripe_poland', currency='EUR'`. Открыть `/pay/:token`, нажать «Оплатить» — `POST public-checkout` должен вернуть `redirect_url`, начинающийся с `https://checkout.stripe.com/`. Подтвердить `orders_v2 pending provider='stripe'` создан с `meta.payment_link_id`. Не доводим до оплаты.
4. **Stripe subscription public link** — выбрать Gorbova Club / CHAT (единственный оффер с `meta.stripe.price_id`). Создать Stripe + subscription, currency=EUR. Открыть, нажать «Оплатить» — подтвердить `https://checkout.stripe.com/...` mode=subscription. В БД: `subscriptions_v2(status='pending', billing_type='provider_managed', meta.stripe.price_id=…)` и `provider_subscriptions(provider='stripe', state='pending', provider_subscription_id LIKE 'pending:%')` созданы; `orders_v2` НЕ создан.
5. **Admin Stripe subscription checkout** — вызвать `stripe-create-subscription-checkout` через `supabase--curl_edge_functions` с `dry_run:true` на той же фикстуре (user=[7500084@gmail.com](mailto:7500084@gmail.com), product=Gorbova Club, tariff=CHAT, tariff_offer_id=6f306cbc-…, account_code=stripe_poland). Ответ ok=true, plan=…, без INSERT.
6. **Валюты BYN/EUR/USD/PLN** — в UI после фикса убедиться, что доступны ровно эти 4 пункта, GBP отсутствует, и валюты, не входящие в `capabilities_snapshot.supported_currencies`, помечены disabled.
7. **Не пытаемся реально дёргать оплату картой** — задача проверить routing/pre-create, а не реальное списание.

### 2.5. Очистка тестовых данных

- Все созданные в smoke ссылки — пометить `status='inactive'` через `admin-invalidate-payment-link`.
- Pending Stripe `subscriptions_v2` + `provider_subscriptions`, созданные шагом 4: пометить `meta.smoke_test=true` через прямой DB update (отдельной insert-миграции/RPC не делаем; запись pending — cleanup-функция Stripe ловит). Если оплата не дошла, существующая инфраструктура pending-cleanup сама уберёт.

## 3. Изменяемые компоненты

- `supabase/functions/admin-create-public-link/index.ts` (whitelist + capabilities check).
- `src/components/admin/AdminPaymentLinkDialog.tsx` (валюты, supported_currencies, stripeEligibleOffers, autoselect, тексты).
- (опц.) `src/hooks/usePaymentLinks.ts` — не трогаем, типы провайдера уже подтянуты.

## 4. Что НЕ будет изменено

- `supabase/functions/stripe-webhook/*`
- `supabase/functions/grant-access-for-order/*`
- `supabase/functions/bepaid-webhook/*`
- `supabase/functions/_shared/create-stripe-checkout.ts` (логика без изменений; ему уже передаются провалидированные данные)
- `supabase/functions/_shared/stripe-pre-create-subscription.ts`
- `supabase/functions/stripe-create-subscription-checkout/index.ts` (только runtime smoke с dry_run)
- Telegram-функции, миграции, GitHub Actions, RLS, types.

## 5. Dry-run

- Перед runtime smoke использовать `dry_run:true` для `stripe-create-subscription-checkout`.
- Перед оплатой никаких реальных карт — только проверка факта редиректа на `checkout.stripe.com` и факта pre-create.

## 6. Execute

- Внести два правочных коммита (backend + frontend) одним батчем.
- Runtime smoke по 7 пунктам.
- Cleanup тестовых ссылок.

## 7. STOP-guards

- Если новый Stripe-checkout не возвращает URL `checkout.stripe.com` → остановить, отдельный диагностический dump (audit_logs `stripe.checkout.declined`).
- Если capabilities_snapshot.supported_currencies отсутствует у активного аккаунта — backend возвращает 400 и не падает.
- Если резолвер не находит ни одного Stripe-eligible offer — UI блокирует «Создать», показывает inline-сообщение, не отправляет запрос.

## 8. DoD

Итоговый отчёт строго в формате:

```
Stripe one-time public link     = PASS / FAIL
Stripe subscription public link = PASS / FAIL
bePaid existing public link     = PASS / FAIL
bePaid new public link          = PASS / FAIL
Admin Stripe subscription chk   = PASS / FAIL
Валюты BYN/EUR/USD/PLN          = PASS / FAIL
GBP удалён                       = PASS / FAIL
```

Для каждого FAIL — точка отказа и конкретный фикс.

## 9. Риски и зависимости

- R1: `capabilities_snapshot.supported_currencies` отсутствует для каких-то будущих аккаунтов → fallback на статический whitelist BYN/EUR/USD/PLN, с предупреждением в UI «Аккаунт не верифицирован, используется консервативный whitelist».
- R2: единственный Stripe-subscription-eligible offer сейчас — Gorbova Club / CHAT. Smoke ограничен этим тарифом; другие продукты для Stripe-подписки UI просто не даст выбрать (это правильное поведение, не баг).
- R3: GBP исторически уже использовался в whitelist; payment_links с currency='GBP' в БД нет (113 ссылок все BYN), регрессии нет.

## 10. Технические заметки

- `capabilities_snapshot` хранится в `acquiring_connections.capabilities_snapshot` (jsonb). Текущий пример для stripe_poland:
  ```json
  {"supported_currencies":["usd","eur","pln","byn", ...], "account":{"country":"PL","default_currency":"pln", ...}}
  ```
- Сравнение делать case-insensitive (`String(c).toLowerCase()`).
- `payment_links.account_code` для bePaid остаётся NULL; для stripe — `stripe_poland`.
- Все 113 legacy ссылок — provider='bepaid', regression check: GET по любой из них в smoke = PASS.