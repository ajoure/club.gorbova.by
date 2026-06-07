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
