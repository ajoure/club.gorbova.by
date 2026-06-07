да, согласен, с учетом правок:

1. **Phase 7 не называй “мультивалютность” как полноценное внедрение.**  
Сейчас по плану это только discovery/spec. Лучше заголовок:

```md
Phase 7 — Currencies Discovery / Currency Provider Resolver Spec
```

И явно зафиксировать:

```md
В этом спринте Phase 7 не меняет runtime, checkout, webhook, UI и БД. Это discovery/spec-only этап.
```

2. **В §2.3 по Stripe API убрать “новый read-only helper” как автоматическое разрешение.**  
Лучше так:

```md
Использовать существующий admin-payments-diagnostics, если он уже поддерживает read-only Stripe capability checks.

Если не поддерживает — не создавать новый helper в этом спринте без отдельного mini-plan. Зафиксировать как open question / follow-up для Phase 7-EXEC.
```

Иначе план сам себе противоречит: в конце написано «никаких изменений кода», но в §2.3 допускается новый helper.

3. **В §2.1 inventory по hardcoded валютам расширить.**  
Добавить поиск не только `'BYN' / 'EUR'`, но и:

```md
'PLN', 'USD', 'RUB', currency fallback, defaultCurrency, default_currency, amount_currency, provider_currency
```

4. **В §2.2 resolver-spec добавить STOP-логику.**

```md
Если валюта не поддерживается ни одним provider:
- public checkout должен быть blocked;
- admin UI должен показывать понятную ошибку;
- нельзя silently fallback на BYN/EUR;
- нельзя автоматически менять валюту offer/link без действия администратора.
```

5. **В §2.2 по bePaid указать явно: BYN только как текущая гипотеза discovery, не как окончательный hardcode.**

```md
bepaidSupports(currency): на Phase 7 Discovery считать BYN текущим known-supported значением, но подтвердить по существующим настройкам bePaid/shop_id и текущим платежам. Не закладывать постоянный hardcode без proof.
```

6. **В §2.3 по Stripe Poland capabilities добавить источник истины.**

```md
Stripe capability discovery должен различать:
- валюты, которые Stripe Poland теоретически поддерживает;
- валюты, которые реально доступны конкретному Stripe account;
- валюты, которые разрешены бизнесом проекта.
Итоговый resolver использует пересечение этих трех уровней.
```

7. **В Phase 6-G.2 simulation proof добавить статус “не заменяет runtime proof”.**

```md
SIMULATION PROOF не является основанием считать Stripe subscription E2E закрытым. Он только подтверждает безопасность кода и expected flow. Runtime E2E остается обязательным gate final regression.
```

8. **В §1.1 пункт 4 по STOP-guards добавить business_stream как STOP только если функция реально требует его.**

Сейчас в отчете написано, что guard требует `business_stream`. В plan надо добавить:

```md
Если discovery/код admin-provision-stripe-price подтверждает, что business_stream обязателен — оставить как STOP.
Если business_stream используется только для metadata/reporting, а не для создания Price — не блокировать provisioning, а писать warning.
```

Иначе можно случайно заблокировать Stripe price из-за необязательного бизнес-поля.

9. **В §1.2 runtime checklist добавить provider_events.**

```md
После webhook проверить не только orders/payments/subscriptions/entitlements, но и provider_events: событие Stripe invoice/checkout/subscription получено, нормализовано и не задублировано.
```

10. **В §1.4 статус Phase 6 лучше формулировать аккуратно:**

Заменить:

```md
Phase 6 как закрыт
```

на:

```md
Phase 6 implementation complete.
Runtime E2E proof deferred to Final Regression.
Final PASS по Phase 6 возможен только после runtime E2E.
```

Так будет честно: реализация завершена, но финальный PASS еще не доказан.

После этих правок план можно утверждать. Главное: не блокировать спринт на runtime proof, но и не подменять его simulation proof’ом. Это соответствует правилу safe workflow и разделению PLAN / VERIFY: выполнение считается завершённым только после доказуемой проверки, а некритичные runtime-хвосты можно вынести в follow-up/final regression.  

&nbsp;

План: закрытие Phase 6-G.2 (simulation proof) и переход к Phase 7 — Currencies

## 0. Контекст и статус

Phase 6-G.2 закрывается как **CODE COMPLETE / WAITING FOR RUNTIME PROOF**.

- STATIC PROOF (diff + freeze) = PASS
- SIMULATION PROOF (dry-run reasoning + SQL шаблоны) = выполняется в этом спринте
- RUNTIME E2E PROOF (реальный Stripe subscription checkout + webhook) = DEFERRED в final regression

Никакого ожидания `tariff_offer_id` от пользователя. Спринт продолжается.

---

## 1. Phase 6-G.2 — simulation proof (без runtime)

### 1.1 Подготовить и записать в `.lovable/proofs/phase_6_payment_profiles_v1.md` секцию **Phase 6-G.2 — SIMULATION PROOF**:

1. **Точный diff** изменённых файлов:
  - `src/pages/admin/AdminProductDetailV2.tsx` — блок `handleSaveOffer` после успешного save (строки ~685–780).
  - Подтверждение, что другие файлы (`bepaid-webhook`, `stripe-webhook`, `grant-access-for-order`, `telegram-*`, `subscriptions-reconcile`, `admin-provision-stripe-price`) не изменены: `git diff --name-only` и явный список.
2. **Runtime-freeze confirmation** — список путей под `supabase/functions/`, которые НЕ изменены, со ссылкой на freeze policy.
3. **Анализ второго `updateOffer**` (mirror price_id/product_id):
  - показать, что `mirrorMeta` содержит только `acquiring.stripe.{price_id, product_id}` и наследует существующие ключи через spread;
  - PATCH-семантика hook'а `updateOffer.mutateAsync({ id, meta })` — поля `amount/currency/is_active/button_label/tariff_id/offer_type` не передаются и не перезаписываются;
  - явная цитата кода с подсветкой.
4. **STOP-guards** (условия запуска provision):
  ```
   savedOfferId
   && !isInstallment
   && isSubscriptionForAcq === true
   && allowed_payment_providers includes 'stripe'
   && meta.acquiring.stripe.account_code != ''
   && business_stream resolved (offer.meta || product.meta)
   && !existingPriceId   // idempotency
  ```
   Каждое условие — с цитатой строки.
5. **Idempotency proof** — при `existingPriceId` второй provision не вызывается (early return / skip-noise), audit/toast не показывается.
6. **Expected payload** в `admin-provision-stripe-price`:
  ```json
   {
     "tariff_offer_id": "<uuid>",
     "account_code": "<from meta>",
     "business_stream": "<from offer.meta or product.meta>",
     "execute": true
   }
  ```
7. **SQL-шаблоны before/after** (для последующего runtime, не выполнять):
  ```sql
   -- BEFORE save
   SELECT id, meta->'acquiring'->'stripe' AS stripe_acq
   FROM tariff_offers WHERE id = '<offer_id>';

   -- AFTER save (expected)
   -- stripe_acq.price_id: filled (price_xxx)
   -- stripe_acq.product_id: filled (prod_xxx)
   -- stripe_acq.account_code: unchanged
  ```
8. **Expected flow diagram**:
  ```
   save offer
     → updateOffer (canonical) PATCH
     → STOP-guards check
     → admin-provision-stripe-price { execute: true }
        → Stripe Price lookup by deterministic Idempotency-Key
        → reuse OR create
     → second updateOffer PATCH (meta.acquiring.stripe only)
     → close dialog
  ```
9. **Маркировка статуса** в proof:
  - `STATIC PROOF = PASS`
  - `SIMULATION PROOF = PASS`
  - `RUNTIME E2E PROOF = DEFERRED → see runtime checklist`

### 1.2 Runtime E2E checklist — отдельным блоком в proof

Без выполнения, готов к запуску оператором:

1. выбрать конкретный subscription-offer со Stripe в `allowed_payment_providers`;
2. SQL before (snapshot `meta->'acquiring'->'stripe'`);
3. UI save offer;
4. SQL after (price_id/product_id заполнены);
5. повторный save без изменений → SQL diff показывает отсутствие нового Stripe Price (тот же `price_id`);
6. публичный checkout с этим offer → Stripe subscription mode;
7. webhook → `orders_v2`, `payments_v2`, `subscriptions_v2`, `entitlements` записи;
8. bePaid sanity: тот же offer через bePaid провайдер — без регрессии.

### 1.3 Обновить `.lovable/discovery/phase_6_payment_profiles_inventory_v1.md`

Зафиксировать:

- inventory статусов G.1 / G.2;
- список freeze-файлов;
- зависимость от `admin-provision-stripe-price` (already deployed, no changes).

### 1.4 Обновить `.lovable/plan.md`

Закрыть Phase 6 как:

- 6-A/B/C/D/E/F = PASS
- 6-G.1 = PASS
- 6-G.2 = CODE COMPLETE + SIMULATION PROOF PASS; RUNTIME DEFERRED → final regression
- bePaid runtime freeze = confirmed

---

## 2. Phase 7 — Currencies (мультивалютность)

### 2.1 Discovery (read-only, никаких миграций)

1. Прочитать существующие discovery:
  - `.lovable/discovery/stripe_currency_support_v1.md` (бизнес-whitelist EUR/PLN/USD/BYN/RUB);
  - `.lovable/discovery/payment_provider_profiles_model_v1.md` (inline профили MVP);
  - `.lovable/discovery/multi_account_stripe_architecture_v1.md`;
  - `.lovable/discovery/stripe_api_capabilities_v1.md`.
2. Inventory текущей работы с валютой:
  - `tariff_offers.currency` — все distinct значения;
  - `payment_links.currency` — все distinct значения;
  - `orders_v2.currency`, `payments_v2.currency`, `subscriptions_v2.currency` — все distinct значения;
  - захардкоженные `'BYN'` / `'EUR'` в frontend (`grep -r`) и в edge-functions (`_shared/`, `create-stripe-checkout`, `bepaid-*`).
3. Создать `.lovable/discovery/phase_7_currencies_inventory_v1.md`:
  - таблица "поле → текущее множество значений → источник";
  - список hardcoded валютных литералов с file:line;
  - текущая логика выбора валюты в UI создания offer / payment_link.

### 2.2 Резолвер провайдеров по валюте

Спецификация (без кода) в `.lovable/discovery/phase_7_currency_provider_resolver_v1.md`:

```
resolveAvailableProviders(currency, tariff, account):
  providers = []
  if bepaidSupports(currency): providers.push('bepaid')
  if stripeAccountSupports(currency, account.code): providers.push('stripe')
  return providers
```

- `bepaidSupports`: const whitelist (BYN сейчас де-факто);
- `stripeAccountSupports`: discovery через `acquiring_connections.metadata.capabilities` (если есть) или статический список Stripe Poland (EUR/PLN/USD подтверждены, BYN/RUB — нет).

### 2.3 Stripe Poland capabilities — discovery API

Через `admin-payments-diagnostics` (или новый read-only хелпер):

- `GET /v1/account`,
- `GET /v1/country_specs/PL`,
- `GET /v1/payment_method_configurations`.

Записать результат в `.lovable/discovery/stripe_currency_support_v1.md` §2 (заполнить таблицу).

### 2.4 UI план (NO IMPLEMENTATION на этом спринте)

В плане зафиксировать места изменений на будущий sprint Phase 7-EXEC:

- `OfferAcquiringSettings.tsx` — селектор валюты с disabled+tooltip для неподдерживаемых пар (currency × provider);
- `AdminPaymentLinkDialog.tsx` — авто-переключение provider при выборе валюты;
- `PaymentDialog.tsx` (public) — корректный набор провайдеров под `link.currency`.

### 2.5 DoD Phase 7 Discovery

- ✅ inventory заполнен реальными SQL-данными;
- ✅ Stripe Poland capabilities зафиксированы;
- ✅ резолвер описан, ready-for-impl;
- ✅ список UI-точек изменения;
- ✅ open questions сформулированы;
- ❌ нет миграций, нет UI-изменений, нет runtime-вмешательства.

---

## 3. Технические заметки

**Freeze-зона на всём спринте:**

- `supabase/functions/bepaid-webhook/`
- `supabase/functions/stripe-webhook/`
- `supabase/functions/grant-access-for-order/`
- `supabase/functions/telegram-*`
- `supabase/functions/subscriptions-reconcile/`
- `supabase/functions/admin-provision-stripe-price/`

**Артефакты, которые будут созданы/обновлены:**

- updated: `.lovable/proofs/phase_6_payment_profiles_v1.md`
- updated: `.lovable/discovery/phase_6_payment_profiles_inventory_v1.md`
- updated: `.lovable/plan.md`
- new: `.lovable/discovery/phase_7_currencies_inventory_v1.md`
- new: `.lovable/discovery/phase_7_currency_provider_resolver_v1.md`
- updated: `.lovable/discovery/stripe_currency_support_v1.md` (§2 заполнен)

**Никаких изменений кода** в этом спринте — только proof и discovery.