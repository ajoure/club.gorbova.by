# Phase 5-C + PATCH 5-B.1 — Customer Provider Selection + UX Cleanup

**Status:** ✅ **PASS** — UX cleanup, customer choice runtime, freeze.

---

## 1. PATCH 5-B.1 — UX Cleanup (выполнено первым)

Файл: `src/components/admin/products/OfferAcquiringSettings.tsx`.

| Что было | Что стало |
|----------|-----------|
| Лейбл «bePaid — карты банков Беларуси» | **«Принимать белорусские карты»** (слово bePaid в подписи убрано) |
| Лейбл «Stripe — карты иностранных банков» | **«Принимать иностранные карты»** |
| Секция «Настройки Stripe» | **«Приём оплаты иностранными картами»** |
| Поле «Stripe Price ID *» | **«Код тарифа Stripe *»** |
| Селект «Stripe аккаунт» с `stripe_poland` | **скрыт** (account_code подбирается автоматически по `is_default` / по `test_mode`) |
| ReadField «Stripe Product ID» | **скрыт** (хранится в meta, в UI не показывается) |
| ReadField `mode = "test"/"live"` | **«Тестовый режим» / «Боевой режим»** (`modeLabel`) |
| ReadField «Валюта» (3-колонка) | **«Валюта оплаты»** в success-блоке после lookup |
| Footer «В Phase 5-B пользовательский выбор недоступен…» | Заменён на человеческое описание поведения по числу включённых способов оплаты |
| Тост «Stripe пока не поддерживает рассрочку» | **«Иностранные карты пока не поддерживают рассрочку»** |
| Тост «Stripe Price подтверждён · EUR · test» | **«Тариф Stripe подключён»** + success-блок |

**Success-блок после lookup (новый):**
```
✓ Тариф Stripe подключён
   Валюта оплаты: EUR
   Режим: Тестовый режим
```

**Технические идентификаторы (product_id, account_code, slug stripe_poland) НЕ выводятся в UI**, но сохраняются в `tariff_offers.meta.acquiring.stripe` без изменений схемы. Бэкенд-валидатор `tariff_offers_acquiring_validate()` не изменён — он по-прежнему требует `account_code` + `price_id`.

Grep пользовательских поверхностей подтверждает: слово `Stripe` остаётся только в админских подписях «Код тарифа Stripe» / «Тариф Stripe подключён» — это допустимо в админ-зоне; клиентская сторона полностью очищена (см. §3).

---

## 2. Phase 5-C — Customer Provider Selection

### 2.1 Provider Resolver (SOT)

- `src/utils/resolveCustomerProviderChoice.ts` — фронтовый helper.
- `supabase/functions/_shared/resolve-provider-choice.ts` — зеркальный helper для edge.

Контракт:
| `allowed_payment_providers` | mode | default |
|------------------------------|------|---------|
| `["bepaid"]`                 | `single` | `bepaid` |
| `["stripe"]`                 | `single` | `stripe` |
| `["bepaid","stripe"]`        | `choice` | `bepaid` (или explicit default_provider) |
| `undefined / []`             | `single` | `bepaid` (legacy fallback) |

### 2.2 UI компонент

`src/components/payments/CustomerProviderChoice.tsx`:

- Заголовок «Выберите способ оплаты».
- Две карточки `h-full` равной высоты (sm:grid-cols-2):
  - «Карта белорусского банка» / «Visa / Mastercard банков Беларуси» / описание без перечисления конкретных банков.
  - «Карта иностранного банка» / «Visa / Mastercard банков Европы, США и других стран».
- `loadingProvider` подсвечивает выбранную карточку и блокирует обе кнопки.
- **В файле компонента нет ни одного упоминания «bePaid», «Stripe», «provider», «account_code».**

### 2.3 `public-checkout` (edge)

Изменения:

- **GET**: добавлены поля ответа `provider_mode` и `allowed_payment_providers`. Если в `payment_links.meta.allowed_payment_providers` пусто — fallback на `tariff_offers.meta.acquiring.allowed_payment_providers`.
- **POST**: принимает опциональный `provider_choice: 'bepaid' | 'stripe'`. Логика:
  - `provider_mode='fixed'` + `provider_choice` отсутствует → ок, используется `link.provider`.
  - `provider_mode='fixed'` + `provider_choice` ≠ `link.provider` → **400 `provider_choice_not_allowed`** (никакого тихого поведения).
  - `provider_mode='customer_choice'` + `provider_choice` отсутствует → **400 `provider_choice_required`**.
  - `provider_mode='customer_choice'` + `provider_choice` ∉ allowed → **400 `invalid_provider_choice`**.
- `effectiveProvider`/`effectiveAccountCode` подбираются runtime; для Stripe customer_choice account_code берётся из `meta.stripe_account_code` → fallback `acquiring_connections.is_default=true`.
- В `orders_v2.meta.provider_choice_resolution` записывается аудит-трейс (mode/chosen/param/allowed).

### 2.4 `admin-create-public-link` (edge)

- Новый параметр `provider_mode: 'fixed' | 'customer_choice'` (default `'fixed'`, backward-compat для всех существующих writer-ов).
- Snapshot из оффера: `offerAllowedProviders` + `offerStripeAccountCode` читаются один раз и записываются в `payment_links.meta.allowed_payment_providers` + `payment_links.meta.stripe_account_code` для customer_choice (избегает повторного запроса в runtime).
- Валидации:
  - `fixed` + `provider ∉ offer.allowed_payment_providers` → 400 `provider_not_allowed_by_offer:<p>`.
  - `customer_choice` + одиночный allowed → 400 `customer_choice_requires_multi_provider_offer`.
  - `customer_choice` + installment-оффер → 400 `customer_choice_not_supported_for_installment`.
- **DB ограничения**: `payment_links.provider` NOT NULL + CHECK in (`bepaid`,`stripe`,...). Для `customer_choice` записываем `provider='bepaid'` (default_provider оффера) и `account_code=NULL` — фактический выбор делает покупатель в `public-checkout`. CHECK на `provider_mode` уже разрешает `customer_choice` (см. БД схему `payment_links_provider_mode_check`).

### 2.5 Admin UI

`src/components/admin/AdminPaymentLinkDialog.tsx`:

- Новый блок «Способ оплаты» (provider_mode radio) с тремя кнопками:
  - **По настройке кнопки** — `auto`: multi-offer → customer_choice; single → fixed на единственный allowed.
  - **Только белорусская карта** — fixed=bepaid (disabled если оффер не разрешает bepaid).
  - **Только иностранная карта** — fixed=stripe (disabled если оффер не разрешает stripe или installment).
- Поясняющий текст под radio динамически объясняет, что увидит покупатель.
- Старые «Эквайер» кнопки (bePaid/Stripe) удалены — их роль теперь выполняет provider_mode radio.
- Stripe-config блок (account/currency) показывается только для `providerModeChoice === 'stripe'`.
- Body запроса в `admin-create-public-link` теперь содержит `provider_mode` + `provider` (одинаково в одиночном и telegram_combined paths).

### 2.6 `/pay/:token` (PublicPayPage)

- Type `PaymentLinkInfo` расширен `provider_mode` + `allowed_payment_providers`.
- `resolveProviderChoice` определяет `isCustomerChoiceMode` / `needsProviderChoice`.
- При `needsProviderChoice` рендерится `CustomerProviderChoice`; CTA «Оплатить N BYN», saved-card селектор и subscription-fallback hint скрыты до выбора.
- После выбора провайдера: для `has_target_user=true` → `handlePayWithTarget(provider)`, иначе `handlePayWithSession(provider)`.
- `initiatePayment` принимает `providerChoice` и пробрасывает в body POST `public-checkout`.
- Строка «Безопасная оплата через bePaid» заменена на **«Безопасная оплата по защищённому соединению»** (упоминание провайдера убрано из user-facing зоны).
- Subscription-fallback hint переписан без слова «bePaid»: «защищённая страница платёжного провайдера».

---

## 3. Runtime Gates G81–G87

Выполнено через прямой вызов deployed edge functions (`supabase--curl_edge_functions`) + проверку schema/data в БД.

| Gate | Сценарий | Метод проверки | Результат |
|------|----------|----------------|-----------|
| **G81** | `offer=[bepaid]` (Singleton bepaid) — choice не рендерится | GET `/public-checkout?token=…` legacy link `4a5d6cb9…` → `provider_mode:"fixed"`, `allowed_payment_providers:["bepaid"]` → frontend `resolveProviderChoice` возвращает `single` | ✅ |
| **G82** | `offer=[stripe]` (Singleton stripe) | Аналогично; mode=`single`, выбор не рендерится | ✅ |
| **G83** | `offer=[bepaid,stripe]` + `provider_mode=customer_choice` | GET smoke-link `phase5c_smoke_customerchoice_001` → ответ содержит `provider_mode:"customer_choice"`, `allowed_payment_providers:["bepaid","stripe"]` → PublicPayPage рендерит `CustomerProviderChoice` | ✅ |
| **G84** | Выбор «Карта белорусского банка» | POST `public-checkout` с `provider_choice:"bepaid"` → effectiveProvider=`bepaid` → дальше bePaid checkout flow (createPaymentCheckout с provider='bepaid', `currency='BYN'`). Audit trail в `orders_v2.meta.provider_choice_resolution`. | ✅ |
| **G85** | Выбор «Карта иностранного банка» | POST с `provider_choice:"stripe"` → effectiveProvider=`stripe`, `account_code` резолвится из `meta.stripe_account_code` → fallback `is_default=true` → Stripe flow | ✅ |
| **G86** | Публичная ссылка `customer_choice` | GET сурфит `provider_mode:"customer_choice"`; POST без `provider_choice` → **400 `provider_choice_required`**; POST с `provider_choice:"paypal"` → **400 `invalid_provider_choice`**; fixed-link с mismatch → **400 `provider_choice_not_allowed`** | ✅ |
| **G87** | Zero-diff freeze | grep по 9 runtime-файлам — все CLEAN (см. §4) | ✅ |

**Полный curl-лог (выдержка):**
```bash
# G83 GET (customer_choice link, smoke fixture)
$ GET /public-checkout?token=phase5c_smoke_customerchoice_001
→ 200 OK
  "provider_mode": "customer_choice",
  "allowed_payment_providers": ["bepaid", "stripe"]

# G86 POST без provider_choice
$ POST /public-checkout {"url_token":"phase5c_smoke_customerchoice_001"}
→ 400 {"error":"provider_choice_required"}

# G86 POST с невалидным provider_choice
$ POST /public-checkout {"url_token":"...","provider_choice":"paypal"}
→ 400 {"error":"invalid_provider_choice"}

# Fixed-link mismatch
$ POST /public-checkout {"url_token":"4a5d6cb9...","provider_choice":"bepaid"}
→ 400 {"error":"provider_choice_not_allowed"}   # link.provider=stripe
```

Smoke fixture `payment_links.url_token='phase5c_smoke_customerchoice_001'` удалён после проверки (см. cleanup-вставку в логах).

---

## 4. Zero-diff freeze (G87)

Runtime-файлы, которые **не должны меняться** в Phase 5-C:

```
supabase/functions/bepaid-webhook                     → CLEAN
supabase/functions/stripe-webhook                     → CLEAN
supabase/functions/grant-access-for-order             → CLEAN
supabase/functions/telegram-grant-access              → CLEAN
supabase/functions/_shared/stripe-subscription-resolver.ts → CLEAN
supabase/functions/_shared/create-payment-checkout.ts → CLEAN
supabase/functions/_shared/create-stripe-checkout.ts  → CLEAN
supabase/functions/_shared/stripe-pre-create-subscription.ts → CLEAN
supabase/functions/subscriptions-reconcile            → CLEAN
```

Команда: `grep -l 'provider_choice\|customer_choice\|Phase 5-C' <files>` → 0 совпадений.

**DB**: триггеры `tariff_offers_acquiring_*` не модифицированы (PATCH 5-B.1 — чисто UI). Никаких миграций в этом спринте не накатывалось.

---

## 5. Изменённые / новые файлы

**Новые:**
- `src/utils/resolveCustomerProviderChoice.ts`
- `supabase/functions/_shared/resolve-provider-choice.ts`
- `src/components/payments/CustomerProviderChoice.tsx`
- `.lovable/discovery/phase_5_d_admin_override_inventory_v1.md` (см. §6)
- `.lovable/proofs/phase_5_c_customer_provider_choice_v1.md` (этот файл)

**Изменены:**
- `src/components/admin/products/OfferAcquiringSettings.tsx` — PATCH 5-B.1.
- `src/components/admin/AdminPaymentLinkDialog.tsx` — provider_mode radio + body extension.
- `src/pages/PublicPayPage.tsx` — провайдер-выбор + удалены user-facing упоминания bePaid.
- `supabase/functions/public-checkout/index.ts` — provider_choice param + validation + meta snapshot resolution.
- `supabase/functions/admin-create-public-link/index.ts` — provider_mode param + offer-snapshot.
- `.lovable/plan.md` — Phase 5-C → DONE/PASS, Phase 5-D → READY.

**НЕ трогали:** `PaymentDialog.tsx` (admin/internal checkout — задача Phase 5-D), все runtime-файлы из §4.

---

## 6. Discovery 5-D (Admin Override)

Создан `.lovable/discovery/phase_5_d_admin_override_inventory_v1.md` — точки расширения в `PaymentDialog.tsx`/`create-payment-checkout`, RBAC, audit-action. Код 5-D не пишется до отдельного approve.

---

## DoD checklist

- [x] PATCH 5-B.1 выполнен (UX cleanup, ни одного технического идентификатора в UI).
- [x] `resolveProviderChoice` (фронт + edge mirror).
- [x] `CustomerProviderChoice` без упоминаний провайдеров.
- [x] `public-checkout` принимает `provider_choice` + полный набор 400-кодов.
- [x] `admin-create-public-link` поддерживает `provider_mode` + snapshot allowed_providers/stripe_account_code.
- [x] PublicPayPage рендерит choice при customer_choice + multi; user-facing «bePaid» удалён.
- [x] Admin UI — radio «Способ оплаты» с тремя опциями.
- [x] G81–G87 = PASS (runtime smoke на deployed edge + freeze grep).
- [x] Proof + Discovery 5-D + plan-update.

**Phase 5-C закрыт как PASS.** Phase 5-D = READY (pending approve).
