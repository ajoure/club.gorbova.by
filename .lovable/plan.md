# да, согласен, с учетом правок:

## **1. План в целом правильный**

Это действительно **баг**, а не настройка оффера.

Правильная модель:

- `offer.allowed_payment_providers` управляет **публичной кнопкой**.
- `admin-created payment link` из карточки контакта — это **override на уровне конкретной ссылки**.
- Админ должен иметь возможность создать Stripe-ссылку, даже если в настройках offer включён только bePaid.
- `tariff_offers.meta.acquiring` при этом **не меняется**.

---

## **2. Главная правка к плану: customer_choice должен учитывать разные валюты для bePaid и Stripe**

В плане сейчас есть риск: `resolveAvailableProviders({ currency, payment_type })` использует одну валюту для всех provider.

Но в нашей модели:

- bePaid использует валюту основной ссылки / offer, чаще BYN;
- Stripe может использовать `stripe_currency`, выбранную админом;
- для admin override Stripe-валюта может отличаться от валюты bePaid.

Добавь в план:

```md
Для customer_choice explicit нельзя проверять все provider'ы одной общей currency.

Правильно:
- bePaid проверяется по `link.currency` / `offer.currency`;
- Stripe проверяется по `stripe_currency`;
- итоговый `effectiveAllowed` собирается по каждому provider отдельно.

Пример:
- offer currency = BYN;
- stripe_currency = EUR;
- customer_choice = ['bepaid','stripe'];

Это валидный сценарий:
- bePaid branch работает в BYN;
- Stripe branch работает в EUR;
- оба provider могут попасть в allowed list, если каждый проходит свою техническую проверку.
```

---

## **3. В §2.2 fixed bePaid explicit уточнить валюту**

Сейчас написано:

currency допустим bePaid-резолвером

Добавить:

```md
Для fixed bePaid используется основная валюта ссылки / offer.
bePaid не должен использовать `stripe_currency`.
```

---

## **4. В §2.3 fixed Stripe explicit уточнить валюту**

Добавить:

```md
Для fixed Stripe используется `stripe_currency`, если она передана.
Если `stripe_currency` не передана — использовать валюту offer/link.
Нельзя по умолчанию подставлять EUR.
```

И оставить только 4 валюты:

```md
Разрешённые валюты проекта для Stripe-ссылок: BYN / USD / EUR / PLN.
Другие валюты в этом hotfix не учитывать.
```

---

## **5. В §2.4 customer_choice explicit исправить формулу**

Текущий вариант:

```text
effectiveAllowed = explicitAllowedList ∩ technicallyAvailable(currency)
```

Заменить на:

```md
effectiveAllowed собирается provider-by-provider:

- если explicitAllowedList содержит `bepaid`:
  - проверить bePaid по основной валюте ссылки/offer;
  - если проходит — добавить `bepaid`.

- если explicitAllowedList содержит `stripe`:
  - проверить Stripe по `stripe_currency` или fallback currency offer;
  - если проходит — добавить `stripe`.

Нельзя исключать Stripe только потому, что основная валюта ссылки BYN, если для Stripe передана отдельная `stripe_currency`.
```

---

## **6. В smoke F заменить пример**

Текущий пример:

customer_choice empty intersect (например BYN-only + admin прислал [‘stripe’] с stripe-currency=EUR)

Это некорректный пример, потому что `stripe_currency=EUR` может быть валидным.

Заменить на:

```md
F — customer_choice empty intersect:
- explicitAllowedList содержит только provider, который технически недоступен;
- например Stripe без active account_code;
- либо currency вне BYN/USD/EUR/PLN;
- либо installment + Stripe.

Ожидаемо: 400 `customer_choice_no_technically_available_providers`.
```

---

## **7. Audit — правильно, но добавить failure audit**

В §2.6 добавить:

```md
Если admin override отклонён техническим guard'ом, записать диагностический audit/log без создания payment_link:
- action: `admin.payment_provider.override_failed`
- reason_code;
- provider;
- provider_mode;
- provider_choice_source;
- offer_id;
- offer_allowed;
- requested_allowed;
- effective_allowed.
```

Если audit до создания link неудобен — минимум структурированный log в proof.

---

## **8. SuperAdminBypass формулировку упростить**

Фраза:

superAdminBypass остаётся как safety-net на случай, когда auto режим запросил странную конфигурацию

Лучше заменить:

```md
superAdminBypass оставить без расширения. Новый admin override не должен зависеть от superAdminBypass: обычный admin, которому доступно создание ссылок, должен иметь право выбрать Stripe/bePaid/customer_choice в рамках технических guard'ов.
```

---

## **9. В Proof добавить проверку ролей**

Добавь:

```md
Smoke выполнять под обычным admin/developer, не под super_admin.
Цель — доказать, что обычный админский flow работает без super_admin bypass.
```

---

## **10. Итоговый ответ Lovable**

```md
План принят, с обязательными правками:

1. Не менять `tariff_offers.meta.acquiring.allowed_payment_providers`.
2. Не включать Stripe массово в offer.
3. Admin-created link — это override на уровне `payment_links`.
4. Guard `offer.allowed_payment_providers` применяется только для режима «По настройке кнопки» / `provider_choice_source='auto'`.
5. Для explicit fixed Stripe / fixed bePaid / customer_choice этот guard не применяется.
6. Для customer_choice проверять provider'ы отдельно:
   - bePaid по основной валюте ссылки/offer;
   - Stripe по `stripe_currency` или fallback валюте offer.
7. Валюты Stripe в этом hotfix только: BYN / USD / EUR / PLN.
8. Не подставлять EUR по умолчанию.
9. Smoke делать под обычным admin/developer, не super_admin.
10. Proof должен подтвердить, что offer не изменился, а override записан только в `payment_links`.

После этих правок выполняй blocker-fix.

Порядок остаётся прежним:
1. Admin provider override blocker → PASS.
2. Повторить smoke Hotfix-1 Stripe currency.
3. Повторить smoke Hotfix-2 bePaid 404 replacement.
4. Только потом Phase 8-A Discovery.
5. Phase 8-B…F — только после отдельного approve по результатам Discovery.
```

Ключевое: **offer.allowed — это настройки кнопки, а не ограничение для ручной админской ссылки.**

&nbsp;

План: BLOCKER FIX — admin provider override не зависит от `offer.allowed_payment_providers`

## 1. Контекст

`admin-create-public-link` сейчас применяет один и тот же guard:

```
provider ∈ tariff_offers.meta.acquiring.allowed_payment_providers
```

для всех режимов админ-ссылки. Это блокирует fixed Stripe / customer_choice
Stripe даже при `provider_choice_source='explicit'`, если в оффере по-умолчанию
включён только bePaid. По базе сейчас 0/38 офферов имеют Stripe в whitelist →
fixed Stripe-ссылку нельзя создать ни на одном продукте без super_admin bypass.

Это баг: ограничение `allowed_payment_providers` — это **настройка публичной
кнопки**, а админ-ссылка из карточки контакта — это override на уровне
конкретной ссылки.

## 2. Что меняем

Один файл — `supabase/functions/admin-create-public-link/index.ts`,
секция «Phase 5-C / 5-D: validation per provider_mode» (~строки 216–239).
UI уже шлёт `provider_choice_source: 'auto' | 'explicit'` — backend это поле
сейчас использует только для audit, не для логики gating. Делаем его частью
gating.

### 2.1 Новый contract gating


| Режим (UI)          | provider_mode                 | provider_choice_source | gating                                                                            |
| ------------------- | ----------------------------- | ---------------------- | --------------------------------------------------------------------------------- |
| По настройке кнопки | `fixed` (резолвится из offer) | `auto`                 | provider обязан быть в `offer.allowed_payment_providers`                          |
| Только bePaid       | `fixed`                       | `explicit`             | guard offer.allowed снят; только технические проверки bePaid                      |
| Только Stripe       | `fixed`                       | `explicit`             | guard offer.allowed снят; только технические проверки Stripe                      |
| Клиент выбирает     | `customer_choice`             | `explicit`             | guard offer.allowed снят; effectiveAllowed = explicit list ∩ технически доступные |


### 2.2 Технические проверки fixed bePaid (`explicit`)

- payment_type ∈ {`one_time`, `subscription`};
- currency допустим bePaid-резолвером (через существующий `resolveAvailableProviders`);
- installment guard сохранить как есть.

Никаких новых вызовов bePaid API из writer (контракт writer'а — only INSERT в
`payment_links`). Проверка `shop_id`/активного подключения уже происходит
позже, в `public-checkout` → `_shared/create-payment-checkout.ts`.

### 2.3 Технические проверки fixed Stripe (`explicit`)

- active Stripe `acquiring_connections` row есть (или валидный `account_code`);
- если `account_code` не передан — резолв через тот же fallback на
`is_default=true`, что уже используется в `public-checkout` (Phase 7-EXEC);
- currency ∈ `['BYN','USD','EUR','PLN']`;
- payment_type ∈ {`one_time`, `subscription`};
- если subscription — отрабатывает уже существующий вызов
`admin-provision-stripe-price` (внутри writer);
- installment guard: fixed Stripe + installment → 400 `stripe_installment_not_supported`.

### 2.4 customer_choice (`explicit`)

- effectiveAllowed = `(explicitAllowedList ?? offer.allowed_payment_providers) ∩ technicallyAvailable(currency)`;
- если результат пуст → 400 `customer_choice_no_technically_available_providers`;
- installment guard как сейчас (`customer_choice_not_supported_for_installment`);
- запись override → ТОЛЬКО в `payment_links.meta.acquiring.allowed_payment_providers`;
`tariff_offers.meta.acquiring` НЕ трогать.

### 2.5 «По настройке кнопки» (`auto`)

- единственный путь, где остаётся guard `provider ∈ offer.allowed_payment_providers`;
- `offerAllowedProviders` legacy fallback (`['bepaid']` при пустой acquiring meta) сохраняется только для этого режима.

### 2.6 Audit

Добавить в `audit_logs` явные actions без изменения существующих:

- `admin.payment_provider.override` — для fixed bepaid/stripe explicit;
- `admin.payment_provider.customer_choice_override` — для customer_choice explicit с непустым `allowedProvidersOverride`.

actor = JWT user; metadata = `{ link_id, provider, provider_mode, provider_choice_source, offer_id, offer_allowed, effective_allowed, currency }`.

## 3. Что НЕ делаем

- НЕ `UPDATE tariff_offers.meta.acquiring`;
- НЕ массовое включение Stripe на офферах;
- НЕ требуем super_admin для обычного admin override (текущий `superAdminBypass` оставляем как safety-net, но обычным admin'ам он больше не нужен);
- НЕ обходим через service_role на стороне фронта;
- НЕ меняем `public-checkout` (он уже корректно auto-select'ит при single allowed → fix `provider_choice_required` уже в проде);
- НЕ меняем UI dialog (`AdminPaymentLinkDialog.tsx` уже шлёт `provider_choice_source`);
- НЕ трогаем `bepaid-webhook`, `grant-access-for-order`, `telegram-grant-access`, `subscriptions-reconcile-*`;
- Миграций нет.

## 4. Технические детали (для разработчика)

Файлы, которые меняются:

```
supabase/functions/admin-create-public-link/index.ts   (~30–50 строк в одном блоке)
```

Псевдокод нового блока validation:

```text
if (providerMode === 'fixed' && providerChoiceSource === 'auto') {
  // «По настройке кнопки»
  if (!offerAllowedProviders.includes(provider))
    return errorResponse('provider_not_allowed_by_offer:' + provider, 400);
}
else if (providerMode === 'fixed' && providerChoiceSource === 'explicit') {
  // Только bePaid / Только Stripe — admin override
  const techAvail = resolveAvailableProviders({ currency, payment_type });
  if (!techAvail.includes(provider))
    return errorResponse('provider_not_technically_available:' + provider, 400);
  if (provider === 'stripe') {
    // currency whitelist + account_code resolution + installment guard
  }
  // НЕ читаем offer.allowed_payment_providers как блокирующий guard
  // audit: admin.payment_provider.override
}
else if (providerMode === 'customer_choice') {
  const baseAllowed = explicitAllowedList?.length ? explicitAllowedList : offerAllowedProviders;
  const techAvail = resolveAvailableProviders({ currency, payment_type });
  effectiveAllowed = intersect(baseAllowed, techAvail);
  if (effectiveAllowed.length === 0)
    return errorResponse('customer_choice_no_technically_available_providers', 400);
  if (effectiveAllowed.includes('stripe') && (installment_offer || offerPaymentMethod === 'internal_installment'))
    return errorResponse('customer_choice_not_supported_for_installment', 400);
  // audit: admin.payment_provider.customer_choice_override (если allowedProvidersOverride)
}
```

`superAdminBypass` остаётся как safety-net на случай, когда `auto` режим
запросил странную конфигурацию — поведение не регрессирует.

## 5. Smoke + Proof

После имплементации:

1. Runtime smoke по `admin-create-public-link` (curl, JWT обычного admin'а, не super_admin):
  - **A — fixed Stripe override**: offer с allowed=`['bepaid']`, body `{ provider:'stripe', provider_mode:'fixed', provider_choice_source:'explicit', currency:'BYN', payment_type:'one_time' }` → 200, в payment_links строка с `provider='stripe'`, offer не изменён.
  - **B — customer_choice override**: offer allowed=`['bepaid']`, body `{ provider_mode:'customer_choice', provider_choice_source:'explicit', allowed_payment_providers:['bepaid','stripe'] }` → 200, `payment_links.meta.acquiring.allowed_payment_providers=['bepaid','stripe']`, offer не изменён.
  - **C — auto «По настройке кнопки»**: тот же offer, body `{ provider:'bepaid', provider_mode:'fixed', provider_choice_source:'auto' }` → 200, bepaid-only; повтор с `provider:'stripe'` → 400 `provider_not_allowed_by_offer:stripe` (регрессия отсутствует).
  - **D — fixed bePaid explicit**: 200, без регрессии.
  - **E — Stripe + installment fixed**: 400 `stripe_installment_not_supported`.
  - **F — customer_choice empty intersect** (например BYN-only + admin прислал `['stripe']` с stripe-currency=EUR): 400 `customer_choice_no_technically_available_providers`.
2. Proof файл: `.lovable/proofs/hotfix_admin_provider_override_v1.md` —
  SQL before/after по `tariff_offers` и `payment_links`, audit_logs выборка, freeze confirmation, git diff (только index.ts), результаты A–F.

## 6. Порядок после PASS

1. Этот blocker-fix → PASS.
2. Повторить runtime smoke Hotfix-1 (Stripe currency) и Hotfix-2 (bePaid 404 replacement).
3. Только затем — Phase 8-A Discovery (read-only).
4. Phase 8-B…F — отдельным approve после Discovery.

## 7. Gates (DoD)

- AOV-1 fixed Stripe admin link создаётся при offer allowed=`['bepaid']`;
- AOV-2 customer_choice admin link создаётся при offer allowed=`['bepaid']`;
- AOV-3 «По настройке кнопки» сохраняет старое поведение;
- AOV-4 `tariff_offers.meta.acquiring` не меняется ни в одном сценарии;
- AOV-5 Stripe subscription provisioning работает для fixed Stripe / customer_choice (через существующий `admin-provision-stripe-price`);
- AOV-6 fixed bePaid без регрессии;
- AOV-7 freeze: webhook / grant / telegram / reconcile / миграций — без изменений;
- AOV-8 proof содержит SQL before/after, выборку payment_links, audit, результаты smoke A–F.