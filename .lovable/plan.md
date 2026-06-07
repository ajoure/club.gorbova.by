# да, согласен, с учетом правок:

1. **В §3.1 добавить обязательное чтение актуального** `offer.meta` **после provision.**  
Не полагаться только на ответ функции, если backend дальше читает `price_id` из БД.

```md
После успешного `admin-provision-stripe-price` backend обязан перечитать `tariff_offers.meta` по `offer_id` и получить актуальный `meta.acquiring.stripe.price_id`.

Если после provision `price_id` всё ещё отсутствует — вернуть `stripe_price_provision_failed:no_price_id_after_provision`.
```

2. **Уточнить путь meta. Сейчас в плане смешаны два пути:**

- `meta.stripe.price_id`
- `meta.acquiring.stripe.price_id`

Нужно везде привести к одному каноническому пути:

```md
Канонический путь: `tariff_offers.meta.acquiring.stripe.price_id`.
Legacy/старые проверки `meta.stripe.price_id` удалить или заменить на canonical resolver.
```

3. **В §3.1 добавить запрет на пользовательский JWT при backend provision.**

```md
Вызов `admin-provision-stripe-price` из `admin-create-public-link` должен выполняться через service role / internal context. Нельзя использовать пользовательский JWT как источник полномочий для server-side provisioning.
```

4. **В §3.1 добавить защиту от частичного успеха.**

```md
Если Stripe Price создан, но запись `price_id` в `tariff_offers.meta.acquiring.stripe.price_id` не подтверждена повторным чтением БД, ссылку не создавать. Вернуть controlled error и записать audit/log для диагностики.
```

5. **В §3.2 frontend не должен сам решать currency support.**

Frontend может показывать предупреждения, но финальное решение — backend.

Добавить:

```md
Frontend guard не является source of truth. Backend `admin-create-public-link` обязан повторно проверить offer_id, payment_type, provider, account_code, currency и price/provision result.
```

6. **В §5 добавить проверку customer choice после фикса.**

Потому что этот blocker может затронуть не только explicit Stripe, но и режим «По настройке кнопки».

```md
Дополнительно проверить: если admin выбирает «По настройке кнопки», а offer содержит bePaid + Stripe и subscription, public link создаётся с customer_choice и Stripe branch не блокируется отсутствием initial price_id.
```

7. **В §6 proof добавить audit/log по backend error path.**

```md
Proof должен показать не только successful path, но и controlled failure path:
- если provision упал, backend возвращает понятную ошибку;
- ссылка не создаётся частично;
- нет orphan payment_link без рабочего Stripe subscription path.
```

8. **В §7 добавить gate B8.**

```md
| B8 | Customer choice subscription link с bePaid + Stripe создаётся и не блокируется отсутствием initial Stripe price_id |
```

После этих правок план можно выполнять. Это правильный blocker-fix: сначала закрыть невозможность создать Stripe subscription link из карточки контакта, потом возвращаться к Phase 7-EXEC. Главное — не оставлять `price_id` ручной UI-настройкой, а обрабатывать его как технический provider mapping с backend-проверкой и audit. Это соответствует safe workflow и запрету скрытых побочных эффектов.  

&nbsp;

План: BLOCKER FIX — Admin payment link Stripe subscription заблокирован старым guard'ом price_id

## 0. Статус

- Phase 7 Discovery — DONE, не трогаем.
- Phase 7-EXEC откладывается до закрытия этого blocker'а.
- Runtime freeze сохраняется: bepaid-webhook, stripe-webhook, grant-access-for-order, telegram-*, subscriptions-reconcile, bePaid checkout — не трогаем.

## 1. Diagnose (подтверждено чтением кода)

Блокировка существует в ДВУХ местах одновременно:

### 1.1. Frontend — `src/components/admin/AdminPaymentLinkDialog.tsx`

- Стр. 277–293: `stripeEligibleOffers = activeOffers.filter(o => meta.stripe.price_id)`; `noStripeSubscriptionOffers = …length === 0` → схлопывает список офферов для Stripe+subscription.
- Стр. 310–333: `effectiveOffer` для Stripe+subscription берётся только из `stripeEligibleOffers` → при отсутствии price_id → `null` → submit недоступен.
- Стр. 1239 и 1324–1325: видимые тексты «нужен meta.stripe.price_id … Используйте bePaid или добавьте Stripe Price».
- Стр. 1346: повторная фильтрация офферов по `meta.stripe.price_id` в селекторе.

### 1.2. Backend — `supabase/functions/admin-create-public-link/index.ts`, стр. 299–312

```ts
if (payment_type === 'subscription') {
  ...
  if (!priceId) return errorResponse('stripe_price_missing_in_offer_meta', 400);
}
```

Это hard 400 без price_id — даже если UI пропустит submit, backend упадёт. Значит фикс только во frontend недостаточен.

### 1.3. Provisioning инфраструктура уже есть

- `supabase/functions/admin-provision-stripe-price/` существует.
- `supabase/functions/admin-stripe-price-lookup/` существует.
Это путь автоматического создания price без ручного ввода в meta.

## 2. Решение (выбранный вариант)

**Вариант A — eager provision в `admin-create-public-link**` (без изменений webhook'ов, без lazy provision в checkout).

Backend сам создаёт/находит Stripe Price, если его нет, и продолжает INSERT ссылки. UI больше не валидирует price_id.

Причина выбора: соответствует Phase 6-G.2 (price_id — provider mapping, а не бизнес-настройка администратора), минимальный blast radius, не трогает webhook/checkout, симметрично с другими auto-provision потоками.

## 3. Изменения

### 3.1. Backend — `supabase/functions/admin-create-public-link/index.ts`

Заменить блок стр. 299–312:

- Если `payment_type === 'subscription'` и нет `offer_id` → оставить 400 (`Stripe subscription requires offer_id`).
- Если `priceId` отсутствует:
  - вызвать `admin-provision-stripe-price` как внутренний invoke с payload:
    ```json
    { "tariff_offer_id": "<offer_id>", "account_code": "<resolvedAccountCode>", "execute": true }
    ```
  - на успех — перечитать `tariff_offers.meta.stripe.price_id` и продолжить.
  - на провал — вернуть `errorResponse('stripe_price_provision_failed:<reason>', 502)`.
- Идемпотентность: provision сам идемпотентен (повторный вызов не создаёт дубль) — это уже свойство `admin-provision-stripe-price`, подтвердить чтением функции до правки.
- STOP-guards оставить: installment+stripe запрет, currency whitelist, account capability, отсутствие offer_id.

### 3.2. Frontend — `src/components/admin/AdminPaymentLinkDialog.tsx`

- Удалить `stripeEligibleOffers` и `noStripeSubscriptionOffers`.
- `visibleOffers` для Stripe+subscription = `activeOffers` (без фильтра по price_id).
- `effectiveOffer` для Stripe+subscription резолвится так же, как для bePaid (через `resolveCanonicalOffer` + override).
- Удалить тексты на стр. 1239 и 1324–1325; заменить нейтральным info-блоком: «Stripe-подписка будет создана по настройкам тарифа. Техническая привязка Stripe Price выполняется автоматически.»
- В фильтре селектора (стр. ≈1346) убрать ветку `hasStripePrice`.
- Submit блокируется ТОЛЬКО при: нет offer_id, нет amount, нет currency, нет account_code (для stripe), offer не recurring/autorenew (для subscription), provider disabled, currency не поддерживается аккаунтом.

### 3.3. Что НЕ трогаем

- bepaid-webhook, stripe-webhook, grant-access-for-order, telegram-*, subscriptions-reconcile, bePaid checkout, `_shared/create-payment-checkout.ts`, `stripe-pre-create-subscription.ts`.
- `admin-provision-stripe-price` — только вызываем, тело не правим.
- Миграций нет.

## 4. STOP-guards (после фикса)

Stripe subscription link НЕ создаётся, если: нет `offer_id` / `amount` / `currency` / `Stripe account_code`; offer не subscription/autorenewal; Stripe provider disabled; currency не поддерживается аккаунтом; provision price упал.

Отсутствие price_id в meta — НЕ повод для STOP.

## 5. Verify (runtime smoke из карточки контакта)

Тарифа Gorbova Club FULL, способ оплаты «Иностранная карта/Stripe», тип «Подписка»:

1. Если у оффера НЕТ `meta.stripe.price_id` — ссылка создаётся, в `tariff_offers.meta.stripe.price_id` появляется значение, в `payment_links` строка с `provider='stripe'`, `payment_type='subscription'`, `provider_choice_source='explicit'`, `offer_id` заполнен.
2. Повторное создание ссылки на тот же оффер — `price_id` не меняется (идемпотентность provision).
3. Если у оффера УЖЕ есть `price_id` — provision не вызывается (проверить по логам edge-функции), ссылка создаётся.
4. bePaid one-time и bePaid subscription из того же диалога — без регрессии.

## 6. Proof

Обновить `.lovable/proofs/phase_6_payment_profiles_v1.md`, добавить раздел **«Admin contact link — Stripe subscription blocker fix»**:

- Скрин «до»: ошибка про `meta.stripe.price_id`.
- Скрин «после»: Stripe + Подписка выбраны, ошибки нет, ссылка создана.
- SQL-выдержка из `payment_links` (provider, payment_type, provider_choice_source, offer_id) и `tariff_offers.meta.stripe.price_id` (до/после).
- Лог `admin-provision-stripe-price` (single call / no-op при повторе).
- Diff изменённых файлов (только 2: `AdminPaymentLinkDialog.tsx`, `admin-create-public-link/index.ts`).
- Подтверждение runtime freeze (`git diff --name-only` — отсутствие webhook/grant/telegram/reconcile).
- bePaid smoke — PASS.

## 7. Gates / DoD


| Gate | Проверка                                                                               |
| ---- | -------------------------------------------------------------------------------------- |
| B1   | В `AdminPaymentLinkDialog.tsx` нет упоминаний `meta.stripe.price_id` в видимых строках |
| B2   | Из карточки контакта создаётся Stripe subscription link на Gorbova Club FULL           |
| B3   | Отсутствие price_id в оффере не блокирует submit                                       |
| B4   | Все остальные STOP-guards сохранены                                                    |
| B5   | bePaid создание ссылок без регрессии                                                   |
| B6   | Runtime freeze (webhooks/grant/telegram/reconcile/bepaid-checkout не тронуты)          |
| B7   | Proof содержит скрины до/после, payload, лог provision, diff                           |


DoD: успешный runtime smoke по п.5 + обновлённый proof. После этого возврат к Phase 7-EXEC.