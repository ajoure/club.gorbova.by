# да, согласен, с учетом правок:

1. **В §2.1 не использовать** `provider_mode = 'customer_choice'` **как единственный новый internal mode без проверки enum/CHECK.**

Добавить:

```md
Перед изменением payload проверить фактический CHECK/enum для `payment_links.provider_mode`.

Если `customer_choice` уже разрешён — использовать его.
Если не разрешён — не делать миграцию в этой задаче, а использовать существующее допустимое значение/metadata-контракт, который уже читает `PublicPayPage`.
Если без миграции невозможно — STOP и отдельный approve.
```

2. **В §2.1 уточнить, что “Клиент выбирает” не должен слепо добавлять Stripe, если валюта BYN и Stripe её не поддерживает.**

```md
Режим «Клиент выбирает» собирает не все подключенные provider'ы вообще, а все совместимые provider'ы для текущих:
- currency;
- payment_type;
- offer_id;
- account/shop settings;
- subscription capability.
```

3. **В §2.2 убрать риск перезаписи настроек кнопки.**

Добавить:

```md
Создание admin public link в режиме «Клиент выбирает» не должно изменять `tariff_offers.meta.acquiring.allowed_payment_providers`.
Override хранится только в `payment_links` / metadata конкретной ссылки.
```

4. **В §2.2 по** `provider` **колонке осторожнее.**

Сейчас написано:

```md
provider = default из списка
```

Уточнить:

```md
`payment_links.provider` заполняется только для backward compatibility. Source of truth для режима выбора — `provider_mode` + `meta.acquiring.allowed_payment_providers`. Downstream не должен ошибочно трактовать `provider` как принудительный единственный provider, если `provider_mode='customer_choice'`.
```

5. **В §2.3 добавить explicit rule: “По настройке кнопки” и “Клиент выбирает” — разные режимы.**

```md
`По настройке кнопки`:
- использует allowed_payment_providers из offer/button settings.

`Клиент выбирает`:
- игнорирует provider-настройку кнопки как ограничение;
- собирает доступные provider'ы по acquiring connections + currency/type guards;
- сохраняет override только на уровне payment_link.
```

6. **В §2.4 не утверждать “при одном — сразу инициирует оплату” без проверки текущего поведения.**

Заменить на:

```md
Проверить текущее поведение `/pay/:token` при одном provider:
- либо сразу инициирует оплату;
- либо показывает одну карточку.
Оба варианта допустимы, если пользователь не попадает в тупик и checkout создаётся корректно.
```

7. **В Proof добавить сценарий “0 provider доступно”.**

```md
Сценарий E:
- выбрать режим «Клиент выбирает»;
- смоделировать валюту/тип оплаты, где нет доступных provider'ов;
- submit blocked;
- показана понятная ошибка;
- payment_link не создаётся.
```

8. **В Gates добавить C10.**

```md
| C10 | Режим «Клиент выбирает» не изменяет настройки исходной кнопки/offer |
```

9. **В DoD добавить обязательный runtime smoke по новому режиму.**

```md
DoD включает создание реальной ссылки из карточки контакта в режиме «Клиент выбирает» и проверку `/pay/:token`, что клиент видит доступные варианты оплаты.
```

После этих правок план можно выполнять. Главное: 4-й режим должен быть **override на уровне конкретной ссылки**, а не изменение кнопки/тарифа. Это соответствует безопасной архитектуре: не ломать source of truth кнопки и не делать скрытых побочных эффектов.  

&nbsp;

План: Admin payment link — режим «Клиент выбирает способ оплаты»

## 0. Статус

- Предыдущий blocker fix (Stripe subscription link, eager provision price_id) принят как CODE COMPLETE / WAITING FOR RUNTIME SMOKE.
- Phase 7-EXEC отложен до закрытия этой задачи.
- Runtime freeze сохраняется: webhook/grant/Telegram/reconcile/bePaid checkout не трогаем.

## 1. Проблема

В `AdminPaymentLinkDialog` сейчас 3 режима:

1. По настройке кнопки
2. Белорусская карта (force bePaid)
3. Иностранная карта (force Stripe)

Не хватает 4-го: **«Клиент выбирает»** — принудительно собрать ВСЕ технически доступные provider'ы и показать customer choice на public checkout, независимо от настройки кнопки.

## 2. Изменения в коде

### 2.1 Frontend — `src/components/admin/AdminPaymentLinkDialog.tsx`

- Добавить 4-ю карточку в селектор «Способ оплаты для этой ссылки»:
  - Label: «Клиент выбирает»
  - Subtitle (динамический):
    - если доступны ≥2 provider'а → «Клиент сам выберет белорусскую или иностранную карту»
    - если только 1 доступен → warning «Сейчас доступен только один способ оплаты: bePaid / Stripe» + режим разрешён
    - если 0 доступно → submit blocked
- Карточки вертикально, full-width, тот же selected-state, без slug/account_code в копирайте.
- Новый internal mode: `provider_mode = 'customer_choice'`.
- Резолвер доступных provider'ов читает `useAcquiringProfiles` + STOP-guards (см. §2.3) и формирует `allowed_payment_providers: ('bepaid'|'stripe')[]`.
- Submit payload в admin-create-public-link:
  - `provider_mode: 'customer_choice'`
  - `allowed_payment_providers: [...]`
  - `provider_choice_source: 'explicit'`
  - `provider` колонка: основной (default = `bepaid` если в списке, иначе первый из списка) — чтобы не нарушать существующий CHECK constraint.

### 2.2 Backend — `supabase/functions/admin-create-public-link/index.ts`

Проверить и при необходимости минимально доработать:

- Принимает `provider_mode='customer_choice'` + `allowed_payment_providers[]`.
- Записывает в `payment_links`:
  - `provider` = default из списка
  - `provider_mode` = `'customer_choice'`
  - `account_code` = соответствующий default account
  - `meta.acquiring.allowed_payment_providers` = массив
  - `meta.acquiring.default_provider`
- Если в списке есть `stripe` и `payment_type='subscription'` → вызвать eager provisioning Stripe price (логика уже добавлена blocker-фиксом, переиспользуем).
- STOP-guards применить ДО INSERT; при пустом списке → 400 с понятной причиной.
- НЕ трогать webhook / grant-access / checkout downstream.

### 2.3 STOP-guards для `customer_choice`

Provider добавляется в `allowed_payment_providers` только если:

- провайдер enabled, есть active acquiring connection (`useAcquiringProfiles`/`acquiring_connections`/`integration_instances`);
- есть account_code / shop_id;
- валюта поддерживается (для Stripe — `capabilities_snapshot.supported_currencies`; для bePaid — BYN/локальный whitelist);
- если `payment_type='subscription'` — provider поддерживает recurring (Stripe: да, bePaid: да);
- для Stripe subscription provisioning возможен (offer_id есть, recurring meta согласован);
- `offer_id`/`amount`/`currency` присутствуют.

### 2.4 Public checkout

Уже есть `resolveProviderChoice` (читает `meta.acquiring.allowed_payment_providers`) и `CustomerProviderChoice` UI. **Кода не трогаем** — проверяем, что при `allowed_payment_providers=['bepaid','stripe']` страница `/pay/:token` показывает выбор; при одном — сразу инициирует оплату.

## 3. Что НЕ трогаем (runtime freeze)

- `bepaid-webhook`, `stripe-webhook`
- `grant-access-for-order`
- `telegram-grant-access`, queue
- `subscriptions-reconcile`
- `_shared/create-payment-checkout.ts` (downstream branch)
- миграции БД

## 4. Proof — `.lovable/proofs/phase_6_payment_profiles_v1.md`

Новый раздел **«Admin contact link — customer choice override»**:

- Скрин модалки с 4 вариантами.
- Сценарий A: кнопка только bePaid + «Клиент выбирает» → `allowed=['bepaid','stripe']`.
- Сценарий B: кнопка bePaid+Stripe + «По настройке» → клиент видит выбор.
- Сценарий C: «Белорусская карта» → только bePaid на checkout.
- Сценарий D: «Иностранная карта» → только Stripe.
- SQL extract по `payment_links`: `provider`, `provider_mode`, `meta.acquiring.allowed_payment_providers`, `provider_choice_source`, `payment_type`, `offer_id`.
- Runtime freeze diff (`git diff --name-only` — только UI + admin-create-public-link + proof).

## 5. Gates


| Gate | Проверка                                                                 |
| ---- | ------------------------------------------------------------------------ |
| C1   | В AdminPaymentLinkDialog есть 4-й вариант «Клиент выбирает»              |
| C2   | «По настройке кнопки» использует только настройки кнопки                 |
| C3   | «Клиент выбирает» собирает все доступные provider'ы независимо от кнопки |
| C4   | Force bePaid → только bePaid на checkout                                 |
| C5   | Force Stripe → только Stripe на checkout                                 |
| C6   | Stripe subscription provisioning price_id отрабатывает                   |
| C7   | Provider, недоступный по валюте/типу оплаты, не попадает в список        |
| C8   | Runtime freeze соблюдён (нет diff в webhook/grant/checkout shared)       |
| C9   | Proof содержит 4 сценария + SQL extract                                  |


## 6. DoD

Из карточки контакта ссылка создаётся в любом из 4 режимов; public checkout показывает корректный набор; SQL по `payment_links` совпадает с выбранным режимом; proof обновлён; runtime smoke по blocker fix также пройден.

## 7. Дальше по спринту

1. Runtime smoke по blocker fix (Stripe subscription link).
2. Эта задача (customer choice).
3. Phase 7-EXEC — Currency Provider Resolver Implementation.
4. Final Regression §S9 (E2E по обоим provider'ам, customer choice, admin override, entitlements/access).