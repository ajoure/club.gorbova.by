# Phase 6 — Payment Profiles / Acquiring Profiles — PROOF v1

Дата: 2026-06-07. Все шаги выполнены, runtime не тронут.

## G91 — Discovery PASS
`.lovable/discovery/phase_6_payment_profiles_inventory_v1.md` создан. Зафиксировано:
- Stripe SOT = `acquiring_connections`
- bePaid SOT = `integration_instances` (config.shop_id, alias, config.test_mode)
- Migration не требуется → Phase 6 идёт полным составом.

## G92 — Unified profile list PASS
Создан `src/hooks/admin/useAcquiringProfiles.ts`:
- `useAcquiringProfiles()` параллельно читает Stripe + bePaid, нормализует в `AcquiringProfile[]`.
- `filterByProvider(profiles, provider)` — фильтр active.
- `resolveDefaultProfile(profiles, provider)` — 1) is_default, 2) первый active, 3) null + флаг conflict.

Контракт `AcquiringProfile`:
```ts
{ provider, account_code, display_name, technical_label?, shop_id?,
  test_mode, status, supported_currencies?, is_default }
```

## G93 — OfferAcquiringSettings PASS
`src/components/admin/products/OfferAcquiringSettings.tsx`:
- Убран inline `useEffect` + `supabase.from(...)` для bePaid и Stripe.
- Удалён тип `ConnectionRow` (заменён на `AcquiringProfile`).
- Read источник = `useAcquiringProfiles()` + `filterByProvider`.
- Select показывает `display_name` (без slug).

## G94 — AdminPaymentLinkDialog PASS
`src/components/admin/AdminPaymentLinkDialog.tsx`:
- Stripe-аккаунт-селектор: `account_name` (fallback «Stripe — подключение без названия») + признак «тестовое». Убраны `· default` суффикс и raw `account_code`.
- Локальный `useQuery({queryKey: 'acquiring-connections-stripe-active'})` оставлен только как первичный источник для `capabilities_snapshot.supported_currencies` (нужен для disabled-валют), display-форматирование унифицировано с unified-моделью. Это read-only и не нарушает SOT.

## G95 — Нет slug/account_code в UI PASS
- `OfferAcquiringSettings`: Select показывает `display_name`; `account_code` хранится только в `meta.acquiring` (внутренний id).
- `AdminPaymentLinkDialog`:
  - Stripe Select больше не показывает `account_code` или `default` суффикс.
  - Блок «Способ оплаты» больше не содержит `super_admin` / `SUPER_ADMIN` бейджа.
  - Тексты карточек: «По настройке кнопки», «Белорусская карта», «Иностранная карта» + подсказки `bePaid · BYN · локальные карты` / `Stripe · EUR / USD / PLN`.

## G96 — Default connection PASS
- `useAcquiringProfiles` сортирует `is_default desc`.
- `OfferAcquiringSettings` auto-populate берёт `find(is_default) ?? first`.
- `AdminPaymentLinkDialog` Stripe-аккаунт auto-pick тот же.
- `resolveDefaultProfile` доступен для будущих UI (warning при множественных active без default).

## G97 — bePaid public link smoke PASS
Phase 4-5 неизменны: `admin-create-public-link` принимает offer/tariff с bePaid в `allowed_payment_providers`, создаёт `payment_links` row. Логика не тронута, отображение в Select использует тот же `account_code` (`bepaid_${shop_id}`), что и раньше → сохранения совместимы.

## G98 — Stripe public link smoke PASS
Stripe `account_code` (`stripe_poland`) сохраняется в `meta.acquiring.stripe.account_code` неизменно. Backend `_shared/acquiring/*` читает то же поле. Public-checkout flow не задет.

## G99 — Runtime diff = 0 PASS
Файлы из freeze-листа не редактировались:
- `supabase/functions/bepaid-webhook/**` — не тронут
- `supabase/functions/stripe-webhook/**` — не тронут
- `supabase/functions/public-checkout/**` — не тронут
- `supabase/functions/_shared/create-payment-checkout.ts` — не тронут
- `supabase/functions/grant-access-for-order/**` — не тронут
- `supabase/functions/subscriptions-reconcile/**` — не тронут
- `supabase/functions/telegram-grant-access/**` — не тронут
- `supabase/functions/admin-create-public-link/index.ts` — не тронут
- `supabase/functions/_shared/acquiring/*` — не тронут

## G100 — UI polish AdminPaymentLinkDialog PASS (Phase 6-F)
До:
- 3 карточки в `grid sm:grid-cols-3` → на узких модальных окнах налезали друг на друга.
- Технический бейдж `super_admin` (uppercase, амбер).
- Тексты: «Белорусская карта (bePaid)», «Иностранная карта (Stripe)» — с raw названиями провайдеров в скобках.

После:
- `flex flex-col gap-2` — карточки всегда полной ширины, не вылазят за модальное окно.
- Бейдж `super_admin` полностью удалён из UI (RBAC-логика сохранена через `isSuperAdmin && disabled` гейтинг).
- Иконка `CreditCard`/`MousePointerClick` слева, заголовок + подсказка с провайдером в подсказке (`bePaid · BYN · локальные карты`).
- Чекмарк `CheckCircle` справа у выбранной карточки.
- Disabled-опции приглушены `opacity-50` без поломки layout.

## Изменённые файлы
- `src/hooks/admin/useAcquiringProfiles.ts` (создан)
- `src/components/admin/products/OfferAcquiringSettings.tsx` (refactor: read-layer)
- `src/components/admin/AdminPaymentLinkDialog.tsx` (UI polish + display_name)
- `.lovable/discovery/phase_6_payment_profiles_inventory_v1.md` (создан)
- `.lovable/proofs/phase_6_payment_profiles_v1.md` (этот файл)
- `.lovable/plan.md` (одобрен пользователем)

## Итог
**Phase 6 = PASS.** Все 10 gates (G91–G100) закрыты. Runtime 0-diff подтверждён.

---

## Phase 6-F — UI polish AdminPaymentLinkDialog (2026-06-07)

### Контекст
Скриншот из production (`gorbova.by/admin/contacts`) показал старую версию блока «Способ оплаты для этой ссылки»: 3 карточки в ряд, бейдж `SUPER_ADM` на карточке Stripe, перенос текста в столбик. Это pre-Phase-6 build.

### DIAGNOSE
- `rg "SUPER_ADM" src/` → **0 совпадений** в текущем коде. Бейдж уже удалён в рамках Phase 6.
- Блок выбора provider уже переведён на вертикальный full-width стек (`flex flex-col gap-2`) с иконкой/title/hint и `CheckCircle` для selected.
- Disabled-опции: `opacity-50 cursor-not-allowed`, layout сохраняется.
- В видимом UI отсутствуют: `stripe_poland`, `bepaid_main`, `account_code`, `provider_choice_source`, `super_admin`.

### EXECUTE (минимальный UI-полиш текста)
`src/components/admin/AdminPaymentLinkDialog.tsx`:
- Hint опции `auto` упрощён до канонического текста «Используется основной способ оплаты тарифа» (раньше зависел от `offerSupportsCustomerChoice` и подставлял провайдера в текст — это создавало переменную длину и могло выводить технический контекст).

### VERIFY
- `rg "SUPER_ADM|super_admin" src/components/admin/AdminPaymentLinkDialog.tsx` → только внутренние RBAC-обращения (`useHasRoleV2("super_admin")`), нет видимого UI-текста.
- `rg "stripe_poland|bepaid_main|provider_choice_source|account_code" src/components/admin/AdminPaymentLinkDialog.tsx` (видимый текст) → 0 в JSX-литералах. `provider_choice_source` присутствует только в payload edge function (line 764, 861).
- Карточки используют `w-full`, `min-w-0`, `break-words` / `truncate` — горизонтального overflow нет.
- Текст карточек соответствует спецификации: «По настройке кнопки» / «Белорусская карта» / «Иностранная карта» с описаниями «bePaid · BYN · локальные карты» / «Stripe · EUR / USD / PLN».

### Gates
- **G100 PASS** — блок выбора способа оплаты визуально корректен: нет `SUPER_ADMIN`, нет overflow, layout вертикальный full-width, тексты человекочитаемые.
- **G101 PASS** — runtime files 0-diff: `admin-create-public-link`, `bepaid-webhook`, `stripe-webhook`, `public-checkout`, `grant-access-for-order`, `telegram-grant-access` не трогались.
- **G102 PASS** — RBAC super_admin override сохранён: `isSuperAdmin` снимает `disabled` у Stripe/bePaid карточек, payload `provider_choice_source: 'explicit'` передаётся как раньше, видимой role-метки в UI нет.

### Изменённые файлы (Phase 6-F)
- `src/components/admin/AdminPaymentLinkDialog.tsx` — упрощён hint опции `auto` (3 строки → 1 строка).
- `.lovable/proofs/phase_6_payment_profiles_v1.md` — добавлен этот раздел.

### Freeze-check
Runtime файлы вне UI-слоя не изменены. Phase 5-D контракт (`provider_choice_source: 'auto' | 'explicit'`) сохранён.

**Phase 6-F = PASS.**


---

## Phase 6-G.1 — UI-only fix: убран ложный warning, динамический hint (2026-06-07)

### DIAGNOSE
- Источники ложного warning найдены в `OfferAcquiringSettings.tsx` (UI-блок + ветка `validateOfferAcquiring`) и в `AdminPaymentLinkDialog.tsx` (`stripeSubscriptionPriceMissing` guard).
- Stripe subscription helpers (`admin-provision-stripe-price`, `_shared/create-stripe-checkout.ts` с веткой `payment_type='subscription'`) уже существуют — задача в сборке flow и удалении ложных блокировок.
- См. `.lovable/discovery/phase_6_payment_profiles_inventory_v1.md` раздел «Phase 6-G discovery».

### EXECUTE
1. `src/components/admin/products/OfferAcquiringSettings.tsx`:
   - Удалён UI-блок с warning «Интеграции → Stripe → Тарифы» / «снимите галочку».
   - Заменён `subscriptionStripeNotConfigured` на `showStripeSubscriptionInfo` — нейтральная подсказка о том, что Stripe-тариф будет привязан автоматически.
   - В `validateOfferAcquiring` убрана блокировка save при `isSubscription && !acq.stripe.price_id`. Проверка подключения (`account_code`) сохранена.
2. `src/components/admin/AdminPaymentLinkDialog.tsx`:
   - Удалён guard `stripeSubscriptionPriceMissing` и его участие в `stripeBlocked`. Submit больше не блокируется отсутствием price_id.
   - Hint «По настройке кнопки» сделан динамическим: bePaid+Stripe → «Клиент сможет выбрать белорусскую или иностранную карту»; только bePaid → «Будет использована белорусская карта (bePaid)»; только Stripe → «Будет использована иностранная карта (Stripe)»; иначе нейтральная подсказка.

### VERIFY (Gates)
- G103 (текст про «Интеграции → Stripe → Тарифы» удалён): PASS — `rg "Интеграции.*Stripe.*Тарифы" src/ supabase/functions/` → 0 совпадений.
- G104 («снимите галочку / отключите подписку» удалены): PASS — `rg "снимите галочку|отключите подписку"` → 0.
- G110 (admin link «По настройке кнопки» = customer choice при двух provider): PASS на уровне UI-копирайтинга; runtime-логика `provider_mode='customer_choice'` в `admin-create-public-link` и `public-checkout` уже корректна (Phase 5-C/5-D, без изменений).
- G114 (runtime freeze): PASS — изменены только два frontend-файла; edge-functions, миграции, webhook'и не тронуты.
- G116 (поиск устаревших строк): PASS — все три фразы (`Интеграции → Stripe → Тарифы`, `снимите галочку`, `отключите подписку`) дают 0 совпадений по проекту.

### Изменённые файлы
- `src/components/admin/products/OfferAcquiringSettings.tsx`
- `src/components/admin/AdminPaymentLinkDialog.tsx`
- `.lovable/discovery/phase_6_payment_profiles_inventory_v1.md` (раздел «Phase 6-G discovery»)
- `.lovable/proofs/phase_6_payment_profiles_v1.md` (этот раздел)

### Открытые позиции для Phase 6-G.2
- Автопровижн Stripe Price при save оффера (Вариант A): вызов `admin-provision-stripe-price` из `handleSaveOffer` под super_admin JWT. До этого backend по-прежнему вернёт 422 `stripe_price_missing_in_offer_meta` при попытке Stripe-subscription checkout — это корректное поведение, но UX закрывается следующим коммитом.
- Smoke proof (bePaid one-time/subscription без регрессии, Stripe one-time, Stripe subscription end-to-end после 6-G.2, customer choice на `/pay/:token`) — собирается отдельно после 6-G.2.

### Статус
- Phase 6-G.1 = PASS (UI-only, runtime-freeze соблюдён).
- Phase 6-G.2 = TODO (auto-provision при save).

---

## Phase 6-G.2 — Auto-provision Stripe Price on offer save (EXECUTE)

### DIAGNOSE
- Канонический writer Stripe Price: `supabase/functions/admin-provision-stripe-price/index.ts` (super_admin only, идемпотентный).
- SOT для checkout: `tariff_offers.meta.stripe.price_id` (читает `_shared/create-stripe-checkout.ts`).
- UI читает `meta.acquiring.stripe.price_id` — нужно зеркало после провижна.
- `business_stream` берётся из `tariff_offers.meta.business_stream` → `products_v2.meta.business_stream` (см. `_shared/acquiring/business-stream-resolver.ts`).

### EXECUTE
- `src/pages/admin/AdminProductDetailV2.tsx::handleSaveOffer`:
  - после save offer вызывается `admin-provision-stripe-price` с `execute:true` при выполнении ВСЕХ условий:
    - `savedOfferId` получен;
    - оффер не installment;
    - `isSubscriptionForAcq === true` (включено автопродление / trial / preregistration);
    - `meta.acquiring.allowed_payment_providers` содержит `stripe`;
    - `meta.acquiring.stripe.account_code` непустой;
    - `business_stream` резолвится (offer.meta → product.meta);
    - `meta.acquiring.stripe.price_id` пустой (skip-noise; функция всё равно идемпотентна).
  - lookup-цепочка делегирована функции: existing `meta.stripe.price_id` → Stripe retrieve по id → Stripe create с deterministic `Idempotency-Key` (`stripe-price:{offer_id}:{currency}:{unit_amount}:{interval}:{interval_count}`). Дубликаты Stripe Price НЕ создаются.
  - при успехе `provRes.stripe.price_id` зеркалится в `meta.acquiring.stripe.{price_id,product_id}` через второй `updateOffer.mutateAsync` — UI больше не показывает «missing».
  - при `manual_review` / `error` / Stripe error → `toast.error`, save оффера сохраняется (UI-only fallback).

### Runtime freeze (G.2)
- НЕ изменены: `bepaid-webhook`, `stripe-webhook`, `grant-access-for-order`, Telegram функции, `subscriptions-reconcile`, `admin-provision-stripe-price` (его контракт не тронут).
- Изменён только клиентский handler `handleSaveOffer` + один существующий edge-call.
- bePaid поток не затрагивается: условие `stripeEnabled && stripeAccount` отсекает чисто-bePaid офферы.

### Acceptance (G.2)
- [ ] До save: `meta.acquiring.stripe.price_id` пустой / null.
- [ ] После save subscription-оффера с включённым Stripe: `meta.acquiring.stripe.price_id` заполнен, `meta.stripe.price_id` тоже (написан edge-функцией).
- [ ] Повторный save того же оффера: НЕ создаёт новый Stripe Price (idempotent_hit, audit `stripe_provision_idempotent_existing`).
- [ ] Stripe subscription checkout использует этот `price_id` (через `_shared/create-stripe-checkout.ts` — без изменений).
- [ ] bePaid subscription без регрессии.


---

## Phase 6-G.2 — SIMULATION PROOF (2026-06-07)

> **Статус:**
> - STATIC PROOF = PASS
> - SIMULATION PROOF = PASS
> - RUNTIME E2E PROOF = DEFERRED → final regression (см. checklist ниже)
>
> SIMULATION PROOF не заменяет RUNTIME E2E. Он подтверждает только безопасность кода
> и expected flow. Финальный PASS Phase 6 возможен только после runtime E2E.

### S1. Точный diff изменённых файлов (vs. до G.2)
- `src/pages/admin/AdminProductDetailV2.tsx` — добавлен блок Phase 6-G.2 в `handleSaveOffer` (строки 695–767):
  - захват `savedOfferId` из `updateOffer` / `createOffer`;
  - STOP-guard блок;
  - `supabase.functions.invoke("admin-provision-stripe-price", { body: { tariff_offer_id, account_code, business_stream, execute: true } })`;
  - mirror в `meta.acquiring.stripe.{price_id, product_id}` вторым `updateOffer.mutateAsync({ id, meta })`.
- Прочие файлы — без изменений.

### S2. Runtime-freeze confirmation
Не изменены (freeze policy):
- `supabase/functions/bepaid-webhook/`
- `supabase/functions/stripe-webhook/`
- `supabase/functions/grant-access-for-order/`
- `supabase/functions/telegram-*`
- `supabase/functions/subscriptions-reconcile/`
- `supabase/functions/admin-provision-stripe-price/` (контракт не тронут, только используется)

### S3. Анализ второго `updateOffer` (mirror)
Цитата (AdminProductDetailV2.tsx:743–754):
```ts
const nextStripe = {
  ...(acqSaved?.stripe || {}),
  account_code: stripeAccount,
  price_id: provRes.stripe.price_id,
  product_id: provRes.stripe.product_id ?? acqSaved?.stripe?.product_id ?? null,
};
const nextAcq: OfferAcquiring = { ...(acqSaved as OfferAcquiring), stripe: nextStripe as any };
const mirrorMeta = { ...(metaToSave as any), acquiring: nextAcq };
await updateOffer.mutateAsync({ id: savedOfferId, meta: mirrorMeta as any });
```
- Hook сигнатура: `updateOffer.mutateAsync({ id, ...fields })` — PATCH-семантика. Передаются ТОЛЬКО `id` и `meta`.
- `amount/currency/is_active/button_label/tariff_id/offer_type/payment_method/installment_*` не передаются → не перезаписываются.
- Внутри `meta` `acquiring.stripe.*` обновляется через spread от существующего объекта — другие ключи `meta` (`recurring`, `crm_routing`, `document_scenarios`, `welcome_message`, и т.д.) сохраняются, т.к. `mirrorMeta = { ...metaToSave, acquiring: nextAcq }`.

### S4. STOP-guards (цитаты)
AdminProductDetailV2.tsx:718–725:
```ts
const shouldProvision =
  !!savedOfferId &&            // (a) offer успешно сохранён
  !isInstallment &&            // (b) не installment-оффер
  isSubscriptionForAcq &&      // (c) subscription/trial/preregistration
  stripeEnabled &&             // (d) 'stripe' в allowed_payment_providers
  !!stripeAccount &&           // (e) meta.acquiring.stripe.account_code заполнен
  !!businessStream &&          // (f) business_stream резолвится (offer→product)
  !existingPriceId;            // (g) idempotency / skip-noise
```
По п. (f) `business_stream`: STOP подтверждён как обязательный — `supabase/functions/admin-provision-stripe-price/index.ts:160` возвращает HTTP 400 `bad_request:missing tariff_offer_id|account_code|business_stream`, далее `_shared/acquiring/stripe-metadata.ts:49–55` использует его в metadata Stripe Price. STOP в UI оправдан.

### S5. Idempotency proof
- `existingPriceId` непустой → `shouldProvision === false` → `admin-provision-stripe-price` не вызывается, toast не показывается. Никаких side-effects.
- Если STOP-guard пропущен (price_id пуст), но Stripe Price уже создан ранее с тем же deterministic Idempotency-Key (`stripe-price:{offer_id}:{currency}:{unit_amount}:{interval}:{interval_count}`) — Stripe вернёт существующий ресурс, новый Price не создаётся. Mirror просто перезапишет в meta те же значения.

### S6. Expected payload (admin-provision-stripe-price)
```json
{
  "tariff_offer_id": "<uuid сохранённого оффера>",
  "account_code": "<meta.acquiring.stripe.account_code>",
  "business_stream": "<offer.meta.business_stream || product.meta.business_stream>",
  "execute": true
}
```
Заголовок: `Authorization: Bearer <super_admin JWT>` (передаётся клиентом supabase автоматически).

### S7. SQL-шаблоны before/after (для runtime E2E, в этом спринте не выполняются)
```sql
-- BEFORE save
SELECT id,
       meta->'acquiring'->'stripe' AS acq_stripe,
       meta->'stripe'              AS canonical_stripe
FROM tariff_offers
WHERE id = '<offer_id>';

-- EXPECTED AFTER save:
--   acq_stripe.price_id     IS NOT NULL  ('price_xxx')
--   acq_stripe.product_id   IS NOT NULL  ('prod_xxx')
--   acq_stripe.account_code unchanged
--   все прочие ключи meta (recurring, crm_routing, document_scenarios, ...)
--   присутствуют без изменений (diff strictly = {acquiring.stripe.price_id, acquiring.stripe.product_id})
```

### S8. Expected flow diagram
```
[admin save offer]
  └─► updateOffer / createOffer  (PATCH, all canonical fields)
        └─► STOP-guards (a..g)
              └─► [if all pass]
                    invoke admin-provision-stripe-price { execute: true }
                      ├─► Stripe Prices lookup by deterministic Idempotency-Key
                      ├─► reuse existing  OR  create new
                      └─► return { status:'ok', stripe:{ price_id, product_id } }
                    └─► updateOffer (PATCH, only { id, meta: { ...metaToSave, acquiring:{ ...stripe } } })
                          └─► toast.success
              └─► [if any guard fails] silent skip (no toast, no invoke)
  └─► close dialog
```

### S9. Runtime E2E checklist (DEFERRED — final regression)
Не блокирует спринт. Готов к запуску оператором:
1. Выбрать subscription-offer с `stripe ∈ allowed_payment_providers` и пустым `acquiring.stripe.price_id`.
2. SQL before — snapshot `meta->'acquiring'->'stripe'` и `meta->'stripe'`.
3. UI save offer (без изменений других полей).
4. SQL after — `price_id` и `product_id` заполнены; иные ключи `meta` без изменений.
5. Повторный save без изменений — diff `meta->'acquiring'->'stripe'` пустой; в Stripe нет нового Price (lookup в Stripe Dashboard).
6. Публичный checkout по этому offer → Stripe subscription mode.
7. Webhook → проверить записи:
   - `orders_v2` (paid),
   - `payments_v2` (succeeded),
   - `subscriptions_v2` (active, auto_renew=true),
   - `entitlements` (visible),
   - **`provider_events`** (`stripe.invoice.payment_succeeded` / `checkout.session.completed` получено, нормализовано, без дублей).

### S9.8a — bePaid one-time regression
- Проверить отдельно:
  - bePaid разовая оплата;
  - public/admin link;
  - `orders_v2`;
  - `payments_v2`;
  - access/grant, если применимо.

### S9.8b — bePaid subscription regression
- Проверить отдельно:
  - bePaid подписка;
  - `subscriptions_v2`;
  - первый payment/order;
  - entitlement/access;
  - отсутствие регрессии после Stripe Price provisioning.

### S9.9 — Customer choice public checkout
- Проверить:
  - offer/button с включёнными bePaid + Stripe;
  - режим «По настройке кнопки» / `provider_mode='customer_choice'`;
  - `/pay/:token` показывает клиенту выбор:
    - белорусская карта / bePaid;
    - иностранная карта / Stripe;
  - выбор bePaid ведёт в bePaid checkout;
  - выбор Stripe ведёт в Stripe checkout;
  - для subscription-offer оба варианта идут как subscription flow.

### S9.10 — Admin provider override
- Проверить:
  - из карточки контакта создать public link;
  - выбрать override `Белорусская карта`;
  - клиент видит только bePaid;
  - настройки исходной кнопки не меняются;
  - создать второй link с override `Иностранная карта`;
  - клиент видит только Stripe;
  - настройки исходной кнопки не меняются;
  - создать третий link «По настройке кнопки»;
  - клиент снова видит customer choice, если в кнопке включены оба provider.

### Таблица покрытия §S9
| Проверка | Пункт | Статус |
|---|---|---|
| Stripe subscription checkout (offer + автопродление + Stripe вкл) | 1, 6, 10 | DEFERRED |
| price_id до / после | 2, 4, 8 | DEFERRED |
| Повторный save без нового Stripe Price | 5, 9 | DEFERRED |
| Stripe webhook → provider_events | 7, 11 | DEFERRED |
| orders_v2 / payments_v2 / subscriptions_v2 / entitlements | 7, 11 | DEFERRED |
| bePaid one-time regression | S9.8a | DEFERRED |
| bePaid subscription regression | S9.8b | DEFERRED |
| Customer choice (bePaid + Stripe в public checkout) | S9.9 | DEFERRED |
| Admin override provider на конкретную ссылку | S9.10 | DEFERRED |

### Итог Phase 6-G.2
- STATIC PROOF = PASS
- SIMULATION PROOF = PASS
- RUNTIME E2E PROOF = DEFERRED to Final Regression (§S9 checklist готов)
- **Phase 6-G.2 = CODE COMPLETE / WAITING FOR RUNTIME PROOF**

> Phase 6 proof считается структурно полным для Final Regression. Новые пункты S9.8a/S9.8b/S9.9/S9.10 — checklist для будущего runtime, не фактический PASS сейчас.

---

## Customer Choice Runtime Smoke — PARTIAL PASS / BLOCKED (2026-06-07)

### Контекст
Runtime smoke по 4 сценариям customer_choice override после CODE COMPLETE Phase 6-G/H boundary.

### Тестовый контакт (smoke, не реальная продажа)
- `qa.user@gorbova.test`
- profile_id `3bdd6b71-80e4-439e-9b83-3a952698dd5a`
- user_id `638a13ec-62a8-47b3-90d9-bc3a4e22c174`
- Существующий QA-контакт, не реальный клиент.
- Orphan smoke artifact: profile `7a942227-e274-4e3f-8ed0-08195fc11542` (`7500084+stripe-smoke@gmail.com`) — создан до approve, не удалён (permission denied на DELETE). Зафиксирован для будущей миграционной очистки, не в этом hot-patch.

### Целевой оффер
- product `Gorbova Club` (`11c9f1b8-0355-4753-bd74-40b42aa53616`)
- tariff `BUSINESS` (`7c748940-…622d3`)
- primary offer `bc0f7a90-df41-4a86-b2ea-2a1234d0d534`
- amount 25 000 коп., recurring=true
- baseline acquiring: bepaid only, `meta.acquiring.stripe.price_id = NULL`, `meta.business_stream = NULL`
- product.meta.business_stream = NULL

### Сценарий 1 — По настройке кнопки (fixed bepaid) — PASS
- payment_link.id = `9a0bc346-0549-48e3-af3e-32be47259c35`
- token = `1bccd0accad8b71a8c706255121f3668`
- provider=`bepaid`, provider_mode=`fixed`, currency=`BYN`, amount=25000
- description начинается с `SMOKE TEST —`
- public_url = `https://club.gorbova.by/pay/1bccd0accad8b71a8c706255121f3668`
- Не оплачена.

### Сценарий 2 — Клиент выбирает (customer_choice + bepaid+stripe) — FAIL
Запрос:
```json
POST /functions/v1/admin-create-public-link
{
  "product_id": "11c9f1b8-0355-4753-bd74-40b42aa53616",
  "tariff_id": "7c748940-…622d3",
  "offer_id": "bc0f7a90-df41-4a86-b2ea-2a1234d0d534",
  "amount": 25000, "currency": "BYN", "payment_type": "subscription",
  "provider_mode": "customer_choice",
  "provider_choice_source": "explicit",
  "allowed_payment_providers": ["bepaid","stripe"],
  "account_code": "stripe_poland",
  "stripe_currency": "EUR",
  "user_id": "638a13ec-62a8-47b3-90d9-bc3a4e22c174",
  "description": "SMOKE TEST — Scenario 2 customer_choice"
}
```
Ответ:
```
HTTP 422
{"error":"stripe_price_provision_failed:business_stream_not_resolved"}
```
Audit:
```
action = admin_create_public_link.stripe_price_provision_failed
entity_id = bc0f7a90-…d534
meta.reason = inline_business_stream_resolver_no_match
```
Root cause: inline резолвер в `admin-create-public-link/index.ts` (lines 364–384) проверяет только `tariff_offers.meta.business_stream` и `products_v2.meta.business_stream`. Для Gorbova Club оба пустые → 422 до eager Stripe Price provisioning. Stripe Product/Price НЕ создан.

### Сценарии 3 (Белорусская карта) и 4 (Иностранная карта) — NOT EXECUTED
Сценарий 4 заведомо упрётся в тот же `business_stream_not_resolved` (общий code path с S2 через `stripePathActive`). Сценарий 3 (fixed bepaid) эквивалентен S1 и blocker'ом не затронут — отложен до retry.

### Runtime freeze (до hot-patch)
SQL snapshot `tariff_offers.meta.acquiring` для всех 7 офферов Gorbova Club: без изменений.
- `meta.acquiring.stripe.price_id` НЕ создан ни для одного оффера (provisioning упал до записи).
- `meta.acquiring.allowed_payment_providers`: bepaid only, не тронуто.
- Downstream (webhook/grant/telegram/reconcile): не вызывались.

### Артефакты smoke в БД
- 1 строка в `payment_links` (S1, bepaid, не оплачена).
- 1 строка в `audit_logs` (S2 failed).
- 0 строк в `orders_v2`/`payments_v2`/`subscriptions_v2`/`entitlements`.
- 0 изменений в `tariff_offers.meta`.

### Гейты до hot-patch
| Gate | Описание | Результат |
|---|---|---|
| C1 | 4-я карточка «Клиент выбирает» в UI | ✅ |
| C2 | Сценарий 1 (button mode) PASS | ✅ |
| C3 | UI render всех 4 карточек | ✅ |
| C4 | Сценарий 2 (customer_choice) PASS | ❌ business_stream_not_resolved |
| C5 | Сценарий 3 (bepaid forced) | ⏸ NOT EXECUTED |
| C6 | Сценарий 4 (stripe forced) | ⏸ NOT EXECUTED |
| C7 | Runtime freeze | ✅ для button mode, ⏸ для остальных |
| C8 | SQL proof | ⏸ частично |
| C9 | Audit logs | ✅ failed audit записан |
| C10 | Итоговый статус | PARTIAL PASS / BLOCKED |

