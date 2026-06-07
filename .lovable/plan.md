# да, согласен

План можно выполнять.

Ключевые условия зафиксированы правильно:

- Phase 8 не начинать до закрытия P7-7.
- Только UI follow-up.
- Backend / Edge Functions / миграции не трогать.
- `currencyProviderResolver.ts` не менять без отдельного STOP + approve.
- `OfferAcquiringSettings` только предупреждает, но не меняет `allowed_payment_providers`.
- Backend остаётся source of truth.
- Proof должен закрыть `P7-7-final` скринами и `git diff --name-only`.

После выполнения нужен **отчет о выполненной работе**, не новый план:

```md
Отчет о выполнении: Phase 7-UI follow-up — currency/provider mirror в админ UI
```

В отчете обязательно: измененные файлы, скрины, diff, freeze confirmation, статус `P7-7-final`.

&nbsp;

да, согласен, с учетом правок:

1. **Добавь pre-check перед кодом: не менять** `currencyProviderResolver.ts`**, если его текущий контракт не покрывает нужные поля.**

```md
Перед правками UI проверить, что `src/utils/currencyProviderResolver.ts` уже поддерживает нужные inputs:
- currency;
- payment_type;
- candidate_providers;
- stripe supported currencies;
- account/shop resolved;
- is_installment.

Если контракт не покрывает эти inputs — STOP и отдельный approve на изменение mirror resolver. В рамках этого плана mirror resolver не правим.
```

2. **В** `OfferAcquiringSettings.tsx` **уточнить: не блокировать сохранение offer только из-за UI mirror.**

Текущий пункт:

Если все providers недоступны — показать предупреждение «Сохранение допустимо, но создание ссылки будет отклонено backend».

Оставить, но добавить:

```md
UI mirror в `OfferAcquiringSettings` не является source of truth и не должен автоматически удалять provider из `allowed_payment_providers`. Он только предупреждает администратора. Финальная блокировка несовместимой оплаты — на backend resolver в `admin-create-public-link`.
```

3. **В** `AdminPaymentLinkDialog.tsx` **добавить отдельное правило для режима “Клиент выбирает”.**

```md
В режиме «Клиент выбирает» UI должен формировать список только из совместимых provider'ов.

Если один provider совместим — ссылку разрешить, но показать warning:
«Сейчас доступен только один способ оплаты».

Если ноль provider'ов совместимы — submit disabled.
```

4. **Добавь проверку, что UI не меняет валюту сам.**

```md
Удаление auto-fallback должно быть доказано:
- нет useEffect, который автоматически меняет currency на BYN/EUR;
- нет silent fallback при несовместимой валюте;
- пользователь сам выбирает валюту/провайдера.
```

5. **В proof добавить точный** `git diff --name-only`**.**

Ожидаемо только:

```text
src/components/admin/AdminPaymentLinkDialog.tsx
src/components/admin/products/OfferAcquiringSettings.tsx
.lovable/proofs/phase_7_ui_followup_v1.md
.lovable/proofs/phase_7_currency_provider_resolver_v1.md
```

Если появляется `src/utils/currencyProviderResolver.ts` — нужен отдельный комментарий, почему нарушен out of scope.

6. **Добавь gate P7-7-final.**

```md
| P7-7-final | Admin UI показывает disabled/reason для несовместимых currency/provider комбинаций в AdminPaymentLinkDialog и OfferAcquiringSettings, подтверждено скринами |
```

После этих правок план можно выполнять. Это правильный короткий UI follow-up: backend уже является SOT, теперь нужно привести админский UI в соответствие, без изменений runtime и без перехода к Phase 8 до закрытия P7-7.  

&nbsp;

План: Phase 7-UI follow-up — currency/provider mirror в админ UI

## Контекст и Diagnose

P7-7 ранее помечен как PASS, но это не подтверждено:

- `src/components/admin/AdminPaymentLinkDialog.tsx` (строки 244–270, 985, 1267) использует **локальный** `isStripeCurrencyDisabled`, основанный только на `stripeSupportedCurrencies` выбранного Stripe-аккаунта. Он:
  - НЕ дизейблит bePaid при non-BYN валюте (нет аналога `bepaidSupports`);
  - НЕ показывает структурированный `reason_code` / tooltip;
  - НЕ переиспользует `src/utils/currencyProviderResolver.ts`.
- `src/components/admin/products/OfferAcquiringSettings.tsx` не импортирует shared mirror.

Следовательно: backend Phase 7-EXEC = PASS, но **P7-7 = PARTIAL**. До исправления — Phase 8 не начинаем.

## Цель

Довести Phase 7 до полного PASS: админский UI показывает, какие провайдеры доступны/недоступны для выбранной валюты, с человеческой причиной. Backend остаётся SOT и проверки на стороне сервера не меняются.

## Scope (UI-only)

### 1. `src/components/admin/AdminPaymentLinkDialog.tsx`

- Заменить локальный `isStripeCurrencyDisabled` на вызов `resolveAvailableProviders` из `src/utils/currencyProviderResolver.ts`.
- Source-инпуты резолвера:
  - `currency` — выбранная валюта (для bePaid всегда BYN; для Stripe — `stripeCurrency`);
  - `payment_type` — текущий выбранный тип;
  - `candidate_providers` — зависит от режима (`fixed` → один provider; `customer_choice` → оба);
  - `stripe_account_supported_currencies` — из `capabilities_snapshot` выбранного аккаунта;
  - `stripe_account_resolved` / `bepaid_shop_resolved` — по факту наличия конфигурации;
  - `is_installment` — из текущего offer.
- Поведение UI:
  - В селекторе валют Stripe — пункт `disabled` + tooltip с `message` из резолвера;
  - В блоке выбора провайдера (fixed/customer_choice) — карточка провайдера disabled, если он в `disabledProviders`, с reason-tooltip;
  - В customer_choice: чекбоксы провайдеров, попавших в `disabledProviders`, недоступны;
  - Кнопка submit disabled, если `availableProviders` пуст для выбранной конфигурации;
  - Никакого auto-fallback валюты (удалить `useEffect` строки 263–270) — пользователь сам выбирает совместимую комбинацию.
- Никаких технических slug (`bepaid`/`stripe`/`account_code`) в copy: использовать «карта белорусского банка» / «карта иностранного банка» / «валюта недоступна для этого способа оплаты», по контракту `CustomerProviderChoice`.

### 2. `src/components/admin/products/OfferAcquiringSettings.tsx`

- Импорт `resolveAvailableProviders`.
- При смене валюты offer:
  - Для каждого `allowed_payment_providers` показать статус (доступен / недоступен + причина);
  - BYN → bePaid доступен; Stripe — по `account.capabilities_snapshot`;
  - EUR/PLN/USD → bePaid disabled с reason `currency_not_supported_by_provider`; Stripe — по аккаунту;
  - Не менять валюту автоматически, не делать silent fallback;
  - Если все providers недоступны — показать предупреждение «Сохранение допустимо, но создание ссылки будет отклонено backend».
- Не трогать схему `meta.acquiring` (runtime freeze).

### 3. Proof: `.lovable/proofs/phase_7_ui_followup_v1.md`

Содержит:

- Скрин `AdminPaymentLinkDialog`: BYN-режим, Stripe карточка/опция disabled с reason (если account не поддерживает BYN);
- Скрин `AdminPaymentLinkDialog`: EUR-режим, bePaid карточка disabled с reason;
- Скрин `OfferAcquiringSettings`: BYN offer — статусы провайдеров;
- Скрин `OfferAcquiringSettings`: EUR/PLN/USD offer — bePaid disabled;
- Скрин customer_choice: оба провайдера активны при совместимости, один disabled при несовместимости;
- git diff по двум файлам;
- Подтверждение backend freeze: edge functions/migrations не тронуты;
- Закрытие P7-7 с привязкой каждого скрина к gate.

## Out of scope (явно НЕ трогаем)

- `supabase/functions/admin-create-public-link/index.ts` и любые edge functions;
- `currency-provider-resolver.ts` (edge SOT) — не правим;
- `currencyProviderResolver.ts` (frontend mirror) — только использовать, без правок логики;
- Любые миграции / схема БД;
- Webhook / grant-access / reconcile / Telegram;
- `admin-provision-stripe-price` whitelist (остаётся в follow-up Phase 7-EXEC §10.1);
- `CustomerProviderChoice` (публичный /pay/:token) — copy уже корректен.

## DoD

- `AdminPaymentLinkDialog` и `OfferAcquiringSettings` используют `currencyProviderResolver`;
- BYN + Stripe (без BYN в capabilities) → Stripe disabled с reason в UI;
- EUR/PLN/USD + bePaid → bePaid disabled с reason в UI;
- Customer_choice исключает несовместимых в UI до submit;
- Нет auto-fallback валюты;
- Никаких технических slug в copy для пользователя;
- Backend не изменён (freeze diff пустой по edge functions/migrations);
- `.lovable/proofs/phase_7_ui_followup_v1.md` создан со всеми скринами и закрывает P7-7;
- Финальный статус Phase 7-EXEC обновлён до полного PASS в `.lovable/proofs/phase_7_currency_provider_resolver_v1.md` (короткая ссылка на UI follow-up proof).

После PASS — переходим к Phase 8 (Receipts / Documents).