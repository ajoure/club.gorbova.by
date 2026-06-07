## да, согласен, с учетом правок:

1. **Не трогать** `PaymentDialog.tsx` **в 5-C**

В плане указано:

```text
PaymentDialog.tsx (integration)
```

Но это уже ближе к admin/internal checkout и Phase 5-D.

В 5-C ограничиться:

```text
/pay/:token
Pay.tsx
public-checkout
admin-create-public-link
```

`PaymentDialog.tsx` оставить для Phase 5-D.

---

2. **Phase 5-C не должен менять admin checkout**

В 5-C делаем только:

```text
customer provider selection
public links provider_mode
public-checkout provider_choice
```

Admin override и внутренний PaymentDialog — только discovery.

---

3. **PATCH 5-B.1 выполнить первым и отдельно в proof**

В proof должен быть отдельный раздел:

```text
PATCH 5-B.1 UX Cleanup
```

Проверить:

- Product ID скрыт;
- account slug скрыт;
- `test/live` заменены на `Тестовый режим / Боевой режим`;
- «Код тарифа Stripe» вместо `Stripe Price ID`;
- «Приём оплаты иностранными картами» вместо «Настройки Stripe».

---

4. `admin-create-public-link` **с customer_choice должен учитывать CHECK**

Так как `payment_links.provider` NOT NULL и CHECK ограничен, нельзя ставить `provider=null`.

Для `customer_choice` использовать:

```text
payment_links.provider = default_provider
payment_links.provider_mode = 'customer_choice'
payment_links.meta.allowed_payment_providers = [...]
```

Например:

```text
provider='bepaid'
provider_mode='customer_choice'
meta.allowed_payment_providers=['bepaid','stripe']
```

---

5. **Public link forced provider**

Если админ создаёт forced link:

```text
provider_mode='fixed'
provider='bepaid' | 'stripe'
```

И provider должен входить в `allowed_payment_providers`.

---

6. **Single provider auto**

Если offer:

```text
allowed_payment_providers=['stripe']
```

то auto-link должен стать:

```text
provider='stripe'
provider_mode='fixed'
```

Если:

```text
allowed_payment_providers=['bepaid']
```

то:

```text
provider='bepaid'
provider_mode='fixed'
```

---

7. **Multi provider auto**

Если:

```text
allowed_payment_providers=['bepaid','stripe']
```

то:

```text
provider=default_provider
provider_mode='customer_choice'
```

---

8. `public-checkout` **validation**

Правила:

```text
provider_mode='fixed'
→ provider_choice игнорируется или rejected как not_allowed
→ используется payment_links.provider

provider_mode='customer_choice'
→ provider_choice обязателен
→ provider_choice должен входить в meta.allowed_payment_providers
```

Я бы выбрал:

```text
fixed + provider_choice present and != link.provider
→ 400 provider_choice_not_allowed
```

чтобы не было скрытого поведения.

---

9. **Frontend copy**

В клиентском UI использовать:

```text
Карта белорусского банка
Для карт банков Беларуси

Карта иностранного банка
Для карт банков Европы, США и других стран
```

Не писать названия банков типа Беларусбанк/Приорбанк — лучше не перечислять конкретные банки.

---

10. **Runtime gates заменить с code-trace на browser/runtime smoke**

Не принимать только code-trace.

Минимум:

```text
G81: link [bepaid] → без выбора → bePaid checkout
G82: link [stripe] → без выбора → Stripe checkout
G83: multi link → экран выбора
G84: выбор белорусская карта → bePaid checkout
G85: выбор иностранная карта → Stripe checkout
G86: provider_choice invalid → 400
G87: freeze grep
```

---

11. **Discovery 5-D оставить, но без изменения кода**

Да, подготовить:

```text
.lovable/discovery/phase_5_d_admin_override_inventory_v1.md
```

Но никаких правок `PaymentDialog.tsx`.

---

После этих правок Phase 5-C можно запускать.

&nbsp;

Phase 5-C + PATCH 5-B.1 — Customer Provider Selection + UX Cleanup

Один спринт. PATCH 5-B.1 (UX-чистка Stripe) выполняется первым, затем основная Phase 5-C (выбор провайдера пользователем).

Все runtime-файлы (`bepaid-webhook`, `stripe-webhook`, `grant-access-for-order`, `subscriptions-reconcile`, telegram lifecycle) остаются нетронутыми.

---

### Step 1 — PATCH 5-B.1: UX-чистка `OfferAcquiringSettings.tsx`

Только UI, БД и meta-схема не меняются.

**Убрать из UI:**

- поле `Stripe Product ID`
- селект `Stripe Account` (`stripe_poland`)
- toggle `test` / `live` в текущем виде

**Переименовать лейблы:**

- секция «Настройки Stripe» → **«Приём оплаты иностранными картами»**
- чекбокс «Stripe (зарубежные карты)» → **«Принимать иностранные карты»**
- поле `Stripe Price ID` → **«Код тарифа Stripe»**
- режим `test` → **«Тестовый режим»**, `live` → **«Боевой режим»** (radio/toggle с человеческими надписями)

**Скрыть от пользователя:**

- `product_id`, `account_code`, slug «stripe_poland», слово «Stripe» в служебных подписях (кроме «Код тарифа Stripe» и заголовка «Tariff Stripe подключён»).

**Показывать в форме:**

- Код тарифа Stripe (input)
- Валюта оплаты (read-only после lookup)
- Режим: Тестовый / Боевой (radio)
- Кнопка «Подтвердить» (вызывает `admin-stripe-price-lookup`)

**После успешного lookup — статус-блок:**

```
✓ Тариф Stripe подключён
   Валюта оплаты: EUR
   Режим: Тестовый режим
```

**Технические поля (`product_id`, `account_code`, `mode`, `currency`) сохраняются в `meta.acquiring.stripe**` через скрытое state и lookup-результат. Никаких миграций, никаких изменений валидатора БД.

Чекбокс bePaid остаётся как есть («Карта белорусского банка (bePaid)» → переименовать в **«Принимать белорусские карты»**, без слова bePaid в подписи).

---

### Step 2 — Phase 5-C.1: Provider Resolution helper

Новый shared-модуль `src/utils/resolveCustomerProviderChoice.ts`:

```ts
type AcquiringMeta = { allowed_payment_providers: string[]; default_provider: string };
export function resolveProviderChoice(meta?: AcquiringMeta): {
  mode: 'single' | 'choice';
  providers: ('bepaid' | 'stripe')[];
  defaultProvider: 'bepaid' | 'stripe';
};
```

Правила:

- `["bepaid"]` → `single`, провайдер bepaid
- `["stripe"]` → `single`, провайдер stripe
- `["bepaid","stripe"]` → `choice`

Зеркальный helper в edge `supabase/functions/_shared/resolve-provider-choice.ts` для серверной валидации.

---

### Step 3 — Phase 5-C.2: UI компонент выбора оплаты

Новый компонент `src/components/payments/CustomerProviderChoice.tsx` (~120 строк).

Используется в двух местах:

1. `PaymentDialog.tsx` (admin/internal checkout flow)
2. `src/pages/Pay.tsx` (public link `/pay/:token`)

**Структура:**

- Заголовок: «Выберите способ оплаты»
- Две карточки (адаптивная сетка, `h-full`, identical height — см. memory tariff-card-rendering-standard):

**Карточка 1 — Карта белорусского банка**

- Иконка карты
- Подзаголовок: «Visa / Mastercard банков Беларуси»
- Описание: «Подходит для карт Беларусбанка, Приорбанка, Белгазпромбанка и др.»
- CTA: «Оплатить»

**Карточка 2 — Карта иностранного банка**

- Иконка глобуса/карты
- Подзаголовок: «Visa / Mastercard банков Европы, США и других стран»
- CTA: «Оплатить»

**Запреты в копирайте:** ни «bePaid», ни «Stripe», ни «stripe_poland», ни «provider», ни «account_code». Только нейтральные пользовательские формулировки.

Если `mode === 'single'` — компонент не рендерится, родитель сразу вызывает соответствующий checkout.

---

### Step 4 — Phase 5-C.3: расширение `public-checkout`

В `supabase/functions/public-checkout/index.ts`:

- Принять опциональное `provider_choice: 'bepaid' | 'stripe'` в body.
- Резолв оффера → `meta.acquiring.allowed_payment_providers`.
- Если `length > 1` и `provider_choice` отсутствует → 400 `provider_choice_required`.
- Если `provider_choice ∉ allowed_payment_providers` → 400 `invalid_provider_choice`.
- Если `length === 1` → `provider_choice` игнорируется, используется единственный.
- Дальше существующий роутинг: `bepaid` → текущая ветка, `stripe` → `create-stripe-checkout`.

Никаких изменений в webhook/grant-access.

---

### Step 5 — Phase 5-C.4: Payment Links + provider_mode

В таблице `payment_links` уже есть `provider`, `provider_mode` (см. `PaymentLinkRow`). Дополнить:

- `provider_mode = 'fixed'` — текущее поведение (привязка к конкретному провайдеру).
- `provider_mode = 'customer_choice'` — новое: при открытии `/pay/:token` фронт показывает `CustomerProviderChoice`, если оффер действительно `[bepaid, stripe]`.

**UI в `admin-create-public-link` форме:** добавить radio «Способ оплаты» с тремя опциями:

- «По настройке кнопки» (`customer_choice` если оффер multi, иначе fixed=default)
- «Только белорусская карта» (`fixed` + bepaid)
- «Только иностранная карта» (`fixed` + stripe, disabled если оффер не поддерживает Stripe или installment)

`admin-create-public-link` edge function — добавить валидацию: `fixed` + provider должен входить в `allowed_payment_providers` оффера. Никаких изменений в bePaid-ветке создания заказа.

`Pay.tsx` загружает link → если `provider_mode = 'customer_choice'` и оффер multi → рендерит `CustomerProviderChoice` → при выборе вызывает `public-checkout` с `provider_choice`.

---

### Step 6 — Runtime Gates G81–G87 (code-trace)


| Gate | Сценарий                                                  | Ожидание                                                                                                                                         |
| ---- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| G81  | offer=`[bepaid]`                                          | choice не рендерится, сразу bePaid                                                                                                               |
| G82  | offer=`[stripe]`                                          | choice не рендерится, сразу Stripe                                                                                                               |
| G83  | offer=`[bepaid,stripe]`                                   | рендерится `CustomerProviderChoice`                                                                                                              |
| G84  | choice → «белорусская карта»                              | `public-checkout` с `provider_choice=bepaid` → bePaid flow                                                                                       |
| G85  | choice → «иностранная карта»                              | `public-checkout` с `provider_choice=stripe` → Stripe flow                                                                                       |
| G86  | public link `provider_mode=customer_choice` + multi offer | `/pay/:token` показывает choice                                                                                                                  |
| G87  | Zero-diff freeze                                          | grep подтверждает: `bepaid-webhook`, `stripe-webhook`, `grant-access-for-order`, subscriptions-reconcile cron, telegram-grant-access не изменены |


---

### Step 7 — Discovery для Phase 5-D (Admin Override)

Только разведка, без кода:

Файл `.lovable/discovery/phase_5_d_admin_override_inventory_v1.md`:

- Где в `PaymentDialog.tsx` admin/super_admin триггерит checkout → точки для override-селектора.
- Что нужно расширить в `create-payment-checkout` для приёма `admin_provider_override` + audit-лог.
- RBAC: только admin/super_admin (через `has_role_v2`).
- Список радио для override:
  - «По настройке кнопки» (default)
  - «Белорусская карта (bePaid)» — admin видит технические имена, в отличие от клиента
  - «Международная карта (Stripe)»
- Audit-action: `admin.payment_provider.override`.

Документ закрывается выводом «READY for Phase 5-D implementation» — но код 5-D не пишется до отдельного approve.

---

### DoD

- PATCH 5-B.1: лейблы и поля очищены, технические идентификаторы скрыты в UI, сохраняются в meta.
- `resolveProviderChoice` (фронт + edge mirror).
- `CustomerProviderChoice` компонент без упоминаний bePaid/Stripe в копирайте.
- `public-checkout` принимает `provider_choice` + валидация (400 `invalid_provider_choice` / `provider_choice_required`).
- `admin-create-public-link` поддерживает `provider_mode in {fixed, customer_choice}` + валидация.
- `Pay.tsx` рендерит choice при `customer_choice` + multi.
- G81–G87 = PASS (code-trace + grep zero-diff).
- Proof `.lovable/proofs/phase_5_c_customer_provider_choice_v1.md` (UI скриншоты code-trace, grep, before/after лейблы PATCH 5-B.1).
- Discovery `.lovable/discovery/phase_5_d_admin_override_inventory_v1.md` подготовлен.
- `.lovable/plan.md`: Phase 5-C = DONE/PASS, Phase 5-D = READY (pending approve).

---

### Файлы (предварительно)

**Новые:**

- `src/utils/resolveCustomerProviderChoice.ts`
- `supabase/functions/_shared/resolve-provider-choice.ts`
- `src/components/payments/CustomerProviderChoice.tsx`
- `.lovable/proofs/phase_5_c_customer_provider_choice_v1.md`
- `.lovable/discovery/phase_5_d_admin_override_inventory_v1.md`

**Изменяются:**

- `src/components/admin/products/OfferAcquiringSettings.tsx` (PATCH 5-B.1)
- `src/components/payments/PaymentDialog.tsx` (integration)
- `src/pages/Pay.tsx` (integration)
- `supabase/functions/public-checkout/index.ts` (provider_choice param)
- `supabase/functions/admin-create-public-link/index.ts` (provider_mode validation)
- UI создания public link (admin форма)
- `.lovable/plan.md`

**Не трогаем (freeze, проверяется grep):**

- `bepaid-webhook`, `stripe-webhook`
- `grant-access-for-order`
- `_shared/stripe-subscription-resolver.ts`
- `stripe-pre-create-subscription`, `create-stripe-checkout`, `stripe-create-subscription-checkout`
- `telegram-grant-access`, subscriptions-reconcile cron
- DB схема / триггеры `tariff_offers_acquiring_*` (PATCH 5-B.1 — чисто UI)
---

## Phase 5-C + PATCH 5-B.1 — Status: **DONE / PASS** (2026-06-07)

- PATCH 5-B.1 (UX cleanup) ✅
- Customer provider selection ✅ — runtime smoke G81–G87 PASS на deployed edge functions.
- Zero-diff freeze ✅ (webhooks / grant-access / telegram / subscriptions-reconcile / stripe-shared).
- `PublicPayPage.tsx` — пользовательский экран выбора без упоминаний bePaid/Stripe.
- `admin-create-public-link` принимает `provider_mode`, snapshot allowed_providers + stripe_account_code.
- `public-checkout` принимает `provider_choice`, валидирует против allowed; 400-коды: `provider_choice_required` / `invalid_provider_choice` / `provider_choice_not_allowed`.
- Proof: `.lovable/proofs/phase_5_c_customer_provider_choice_v1.md`.
- `PaymentDialog.tsx` НЕ трогали (по правкам пользователя — это Phase 5-D).

## Phase 5-D — Status: **READY** (pending approve)

- Discovery: `.lovable/discovery/phase_5_d_admin_override_inventory_v1.md`.
- Скоуп: admin override провайдера в `PaymentDialog` (internal checkout) + audit `admin.payment_provider.override`.
- Код не пишется до отдельного approve.
